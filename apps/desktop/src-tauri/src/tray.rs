//! The menu-bar (tray) icon: Gravita keeps running here after its window closes, so agents
//! keep working and the user can still see who waits on them, reopen the window, stop
//! every agent Gravita runs, or quit.
//!
//! The webview owns the numbers (it already projects the engine's state) and pushes them
//! with `tray_update`; this module only renders them. Until the first update the menu
//! reads "Nothing running" with the kill switch disabled.

use std::sync::Mutex;

use serde::Serialize;
use tauri::image::Image;
use tauri::menu::{Menu, MenuEvent, MenuItem, PredefinedMenuItem};
use tauri::tray::{TrayIcon, TrayIconBuilder};
use tauri::{AppHandle, Emitter, Manager, Runtime, State};

use crate::engine_http;
use crate::sidecar::Engine;

const ID_STATUS: &str = "gravita.status";
const ID_OPEN: &str = "gravita.open";
const ID_STOP_ALL: &str = "gravita.stop-all";
const ID_QUIT: &str = "gravita.quit";

/// Sent to the webview after the kill switch ran, so it can say so (calmly).
pub const STOPPED_ALL_EVENT: &str = "gravita://stopped-all";

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub enum Locale {
    #[default]
    En,
    PtBr,
}

impl Locale {
    /// Any Portuguese tag reads as pt-BR; everything else is English.
    pub fn from_tag(tag: &str) -> Locale {
        if tag.to_ascii_lowercase().starts_with("pt") {
            Locale::PtBr
        } else {
            Locale::En
        }
    }
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, Default)]
pub struct Counts {
    /// Agents working right now.
    pub running: u32,
    /// Agents waiting on the user.
    pub waiting: u32,
    /// Running sessions Gravita runs (and the kill switch can stop).
    pub controllable: u32,
}

pub struct Labels {
    pub open: &'static str,
    pub stop_all: &'static str,
    pub quit: &'static str,
}

pub fn labels(locale: Locale) -> Labels {
    match locale {
        Locale::En => Labels {
            open: "Open Gravita",
            stop_all: "Stop all Gravita agents",
            quit: "Quit Gravita",
        },
        Locale::PtBr => Labels {
            open: "Abrir o Gravita",
            stop_all: "Parar todos os agentes do Gravita",
            quit: "Sair do Gravita",
        },
    }
}

/// "3 running · 1 waiting for you", or "Nothing running".
pub fn status_line(locale: Locale, counts: Counts) -> String {
    let mut parts = Vec::new();
    match locale {
        Locale::En => {
            if counts.running > 0 {
                parts.push(format!("{} running", counts.running));
            }
            if counts.waiting > 0 {
                parts.push(format!("{} waiting for you", counts.waiting));
            }
            if parts.is_empty() {
                return "Nothing running".into();
            }
        }
        Locale::PtBr => {
            if counts.running > 0 {
                parts.push(format!("{} rodando", counts.running));
            }
            if counts.waiting > 0 {
                parts.push(format!("{} esperando você", counts.waiting));
            }
            if parts.is_empty() {
                return "Nada rodando".into();
            }
        }
    }
    parts.join(" · ")
}

/// The short menu-bar title next to the icon: only when someone waits on the user.
pub fn title(counts: Counts) -> Option<String> {
    (counts.waiting > 0).then(|| counts.waiting.to_string())
}

const ICON: Image<'static> = tauri::include_image!("icons/tray/tray.png");
const ICON_ATTENTION: Image<'static> = tauri::include_image!("icons/tray/tray-attention.png");

pub struct Tray<R: Runtime> {
    icon: TrayIcon<R>,
    status: MenuItem<R>,
    open: MenuItem<R>,
    stop_all: MenuItem<R>,
    quit: MenuItem<R>,
    shown: Mutex<Option<(Locale, Counts)>>,
}

/// Builds the tray and manages it as app state (for `tray_update`).
pub fn setup<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
    let l = labels(Locale::En);
    let status = MenuItem::with_id(
        app,
        ID_STATUS,
        status_line(Locale::En, Counts::default()),
        false,
        None::<&str>,
    )?;
    let open = MenuItem::with_id(app, ID_OPEN, l.open, true, None::<&str>)?;
    let stop_all = MenuItem::with_id(app, ID_STOP_ALL, l.stop_all, false, None::<&str>)?;
    let quit = MenuItem::with_id(app, ID_QUIT, l.quit, true, None::<&str>)?;
    let menu = Menu::with_items(
        app,
        &[
            &status,
            &open,
            &PredefinedMenuItem::separator(app)?,
            &stop_all,
            &PredefinedMenuItem::separator(app)?,
            &quit,
        ],
    )?;

    let builder = TrayIconBuilder::with_id("gravita")
        .tooltip("Gravita")
        .menu(&menu)
        .show_menu_on_left_click(true)
        .on_menu_event(on_menu_event);
    // macOS draws a monochrome template that follows the menu bar's appearance; elsewhere
    // the coloured app icon reads better in the tray than a black glyph.
    #[cfg(target_os = "macos")]
    let builder = builder.icon(ICON).icon_as_template(true);
    #[cfg(not(target_os = "macos"))]
    let builder = match app.default_window_icon() {
        Some(icon) => builder.icon(icon.clone()),
        None => builder.icon(ICON),
    };
    let icon = builder.build(app)?;

    app.manage(Tray { icon, status, open, stop_all, quit, shown: Mutex::new(None) });
    Ok(())
}

fn on_menu_event<R: Runtime>(app: &AppHandle<R>, event: MenuEvent) {
    match event.id().as_ref() {
        ID_OPEN => show_main_window(app),
        ID_STOP_ALL => stop_all(app),
        ID_QUIT => app.exit(0),
        _ => {}
    }
}

/// Brings the main window back (it hides instead of closing) and focuses it.
pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[derive(Clone, Serialize)]
#[serde(untagged)]
enum StoppedAll {
    Done { stopped: u32 },
    Failed { error: String },
}

/// The kill switch: off the main thread, since the engine gets up to 2 s per step.
fn stop_all<R: Runtime>(app: &AppHandle<R>) {
    let Some(engine) = app.try_state::<Engine>() else {
        return;
    };
    let (port, token) = (engine.port, engine.token.clone());
    let app = app.clone();
    std::thread::spawn(move || {
        let payload = match engine_http::post_stop_all(port, &token) {
            Ok(stopped) => StoppedAll::Done { stopped },
            Err(error) => {
                eprintln!("gravita: stop-all failed: {error}");
                StoppedAll::Failed { error }
            }
        };
        let _ = app.emit(STOPPED_ALL_EVENT, payload);
    });
}

impl<R: Runtime> Tray<R> {
    fn apply(&self, locale: Locale, counts: Counts) -> tauri::Result<()> {
        let mut shown = self.shown.lock().unwrap_or_else(|e| e.into_inner());
        if *shown == Some((locale, counts)) {
            return Ok(());
        }
        let previous = *shown;
        if previous.map(|(l, _)| l) != Some(locale) {
            let l = labels(locale);
            self.open.set_text(l.open)?;
            self.stop_all.set_text(l.stop_all)?;
            self.quit.set_text(l.quit)?;
        }
        self.status.set_text(status_line(locale, counts))?;
        self.stop_all.set_enabled(counts.controllable > 0)?;

        let was_waiting = previous.is_some_and(|(_, c)| c.waiting > 0);
        #[cfg(target_os = "macos")]
        {
            if was_waiting != (counts.waiting > 0) || previous.is_none() {
                let icon = if counts.waiting > 0 { ICON_ATTENTION } else { ICON };
                self.icon.set_icon_with_as_template(Some(icon), true)?;
            }
            self.icon.set_title(title(counts))?;
        }
        #[cfg(not(target_os = "macos"))]
        {
            let _ = was_waiting;
            let tooltip = match counts.waiting {
                0 => "Gravita".to_string(),
                _ => format!("Gravita · {}", status_line(locale, counts)),
            };
            self.icon.set_tooltip(Some(tooltip))?;
        }
        *shown = Some((locale, counts));
        Ok(())
    }
}

/// The webview reports what the tray should show: counts from its own projection and the
/// UI locale. Unchanged values are ignored.
#[tauri::command]
pub fn tray_update(
    tray: State<'_, Tray<tauri::Wry>>,
    running: u32,
    waiting: u32,
    controllable: u32,
    locale: String,
) -> Result<(), String> {
    tray.apply(Locale::from_tag(&locale), Counts { running, waiting, controllable })
        .map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    const fn counts(running: u32, waiting: u32) -> Counts {
        Counts { running, waiting, controllable: 0 }
    }

    #[test]
    fn status_line_in_both_languages() {
        assert_eq!(status_line(Locale::En, counts(0, 0)), "Nothing running");
        assert_eq!(status_line(Locale::En, counts(3, 1)), "3 running · 1 waiting for you");
        assert_eq!(status_line(Locale::En, counts(0, 2)), "2 waiting for you");
        assert_eq!(status_line(Locale::PtBr, counts(0, 0)), "Nada rodando");
        assert_eq!(status_line(Locale::PtBr, counts(3, 1)), "3 rodando · 1 esperando você");
    }

    #[test]
    fn locale_tags() {
        assert_eq!(Locale::from_tag("pt-BR"), Locale::PtBr);
        assert_eq!(Locale::from_tag("pt"), Locale::PtBr);
        assert_eq!(Locale::from_tag("en"), Locale::En);
        assert_eq!(Locale::from_tag(""), Locale::En);
    }

    #[test]
    fn title_only_when_someone_waits() {
        assert_eq!(title(counts(4, 0)), None);
        assert_eq!(title(counts(0, 2)), Some("2".into()));
    }
}
