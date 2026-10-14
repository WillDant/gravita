mod engine_http;
mod sidecar;
mod sign_in;
mod tray;

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

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let app = tauri::Builder::default()
        // Only the folder picker of the new-session panel (capability: dialog:allow-open).
        .plugin(tauri_plugin_dialog::init())
        // OS notifications (capability: notify + permission checks only).
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            let engine = Engine::spawn().map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(engine);
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
            tray::tray_update,
            // Codex's sign-in page for squads, and nothing else (see sign_in.rs).
            sign_in::open_sign_in_url
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
