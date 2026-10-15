mod cursor_key;
mod engine_http;
mod release;
mod sidecar;
mod sign_in;
mod tray;

use cursor_key::{CursorKey, Keychain};
use serde::Serialize;
use sidecar::Engine;
use tauri::{Manager, RunEvent, WindowEvent};

#[derive(Serialize)]
struct EngineInfo {
    port: u16,
    token: String,
}

/// The webview's only door to the engine: its local port and session token.
#[tauri::command]
fn engine_info(engine: tauri::State<'_, Engine>) -> EngineInfo {
    EngineInfo { port: engine.port, token: engine.token.clone() }
}

/// Stores the pasted Cursor key in the Keychain and hands it to the engine. The key goes
/// one way only: no command returns it.
#[tauri::command]
fn cursor_key_set(
    value: String,
    key: tauri::State<'_, CursorKey>,
    engine: tauri::State<'_, Engine>,
) -> Result<(), String> {
    let line = key.save(&value)?;
    engine.send_line(&line)
}

/// Deletes the stored Cursor key and tells the engine to forget it.
#[tauri::command]
fn cursor_key_remove(
    key: tauri::State<'_, CursorKey>,
    engine: tauri::State<'_, Engine>,
) -> Result<(), String> {
    let line = key.remove()?;
    engine.send_line(&line)
}

/// Whether a Cursor key is stored (never the key).
#[tauri::command]
fn cursor_key_present(key: tauri::State<'_, CursorKey>) -> Result<bool, String> {
    key.present()
}

/// Quits and opens Gravita again, after the updater has put the new version in place. The
/// engine (and the agents it runs) is stopped first, as on any quit.
#[tauri::command]
fn restart_app(app: tauri::AppHandle, engine: tauri::State<'_, Engine>) {
    engine.shutdown();
    app.restart();
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default();
    // In-app updates: the webview may only check and install (capability: updater:default),
    // and every package is verified against the public key in tauri.conf.json.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_updater::Builder::new().build());
    let app = builder
        // Only the folder picker of the new-session panel (capability: dialog:allow-open).
        .plugin(tauri_plugin_dialog::init())
        // OS notifications (capability: notify + permission checks only).
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let key = CursorKey::new(Box::new(Keychain));
            let engine = Engine::spawn(key.stored())
                .map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(engine);
            app.manage(key);
            tray::setup(app.handle())?;
            Ok(())
        })
        // Closing the window hides it: Gravita lives on in the tray and its agents keep
        // running. Quitting is explicit (the tray's "Quit Gravita", or ⌘Q, which goes
        // through ExitRequested untouched).
        .on_window_event(|window, event| {
            if let WindowEvent::CloseRequested { api, .. } = event {
                if window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            engine_info,
            restart_app,
            tray::tray_update,
            // Codex's sign-in page for squads, and nothing else (see sign_in.rs).
            sign_in::open_sign_in_url,
            // A release page of Gravita's own repository, for the "new release" notice (release.rs).
            release::open_release_url,
            // The Cursor API key: set, remove, or ask whether there is one (cursor_key.rs).
            cursor_key_set,
            cursor_key_remove,
            cursor_key_present
        ])
        .build(tauri::generate_context!())
        .expect("error while building Gravita");

    app.run(|handle, event| match event {
        // A Dock click (or Finder/Spotlight opening the app again) brings the hidden window
        // back. A click on one of our notifications only activates the app, and macOS may or
        // may not route that through Reopen, so the tray's "Open Gravita" is the sure way
        // back. Once the window has focus again, the webview follows the most recent
        // notification's deep link (see src/application/notifications/deepLink.ts).
        #[cfg(target_os = "macos")]
        RunEvent::Reopen { .. } => tray::show_main_window(handle),
        RunEvent::Exit => {
            if let Some(engine) = handle.try_state::<Engine>() {
                engine.shutdown();
            }
        }
        _ => {}
    });
}
