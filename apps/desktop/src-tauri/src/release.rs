//! Opens a release page of Gravita's own repository in the user's browser, for the "new
//! release" notice. Like the Codex sign-in link, it is the one thing the webview may ask to
//! open: only https pages under `github.com/WillDant/gravita/releases` (the engine hands the
//! link over and checks it too), through the system's own handler and never a shell.

use crate::sign_in::open;

const RELEASES: &str = "https://github.com/WillDant/gravita/releases";

/// True for the releases page and the pages below it, and nothing else.
pub fn is_release_url(url: &str) -> bool {
    if url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    match url.strip_prefix(RELEASES) {
        Some(rest) => rest.is_empty() || rest.starts_with(['/', '?', '#']),
        None => false,
    }
}

#[tauri::command]
pub fn open_release_url(url: String) -> Result<(), String> {
    if !is_release_url(&url) {
        return Err("Not a Gravita release link".into());
    }
    open(&url).map_err(|e| format!("Couldn't open the browser: {e}"))
}

#[cfg(test)]
mod tests {
    use super::is_release_url;

    #[test]
    fn opens_only_the_repositorys_release_pages() {
        assert!(is_release_url("https://github.com/WillDant/gravita/releases"));
        assert!(is_release_url("https://github.com/WillDant/gravita/releases/tag/v0.5.0-beta"));
        assert!(is_release_url("https://github.com/WillDant/gravita/releases?page=2"));
        assert!(!is_release_url("http://github.com/WillDant/gravita/releases"));
        assert!(!is_release_url("https://github.com/WillDant/gravita"));
        assert!(!is_release_url("https://github.com/WillDant/gravita/releases-evil"));
        assert!(!is_release_url("https://github.com.evil.example/WillDant/gravita/releases"));
        assert!(!is_release_url("https://github.com/WillDant/other/releases/tag/v1"));
        assert!(!is_release_url("https://github.com/WillDant/gravita/releases/tag/v1 x"));
        assert!(!is_release_url("javascript:alert(1)"));
    }
}
