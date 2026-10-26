# 009 — A frosted menu from the window's own material

Status: accepted

## Context
The side menu should look like a native macOS sidebar (Finder, Notes): frosted glass that lets the desktop show through. A CSS `backdrop-filter` can't do that. Inside the webview the only thing behind the menu is the page's own solid background, so there would be nothing to blur.

## Decision
- **The window draws the material.** On macOS only (`tauri.macos.conf.json`), the main window is `transparent` with the `sidebar` window effect, following the window's active state, so it dims when the window loses focus. In Tauri 2.12.1+ transparency needs neither `macOSPrivateApi` nor the `macos-private-api` feature.
- **Only the menu lets it through.** With the effect on, the webview marks `<html data-vibrancy>` and the page background turns transparent. The main area paints `--ground`, and the menu paints a light tint of `--panel` over the glass. Its hover, active and edge colours are translucent tokens (`--sidebar*` in `styles.css`), so they don't land as opaque blocks on the glass.
- **The material follows the app's theme.** macOS paints it from the window's appearance, which follows the OS. The webview calls `setTheme` whenever `data-theme` changes (`windowAppearance.ts`, capability `core:window:allow-set-theme`).
- **Reduce transparency.** The setting is off by default and sets `<html data-reduce-transparency>`, which brings back the opaque tokens. The OS's own setting does the same: through `prefers-reduced-transparency`, and macOS also makes the material opaque. The setting shows only where the window has the material.

## Consequences
- Windows, Linux and the browser build look exactly as before, and they have no transparency setting.
- Any new surface in the menu should use the `--sidebar*` tokens, not `--panel-2` or `--ground`, or it will show up as an opaque patch on the glass.
