mod sidecar;

use serde::Serialize;
use sidecar::Engine;
use tauri::{Manager, RunEvent};

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
        .setup(|app| {
            let engine = Engine::spawn().map_err(|e| -> Box<dyn std::error::Error> { e.into() })?;
            app.manage(engine);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![engine_info])
        .build(tauri::generate_context!())
        .expect("error while building Gravita");

    app.run(|handle, event| {
        if let RunEvent::Exit = event {
            if let Some(engine) = handle.try_state::<Engine>() {
                engine.shutdown();
            }
        }
    });
}
