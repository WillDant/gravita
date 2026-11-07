//! Opens a web link from a message in the user's browser. Agents write these links, so they
//! can point anywhere: this command takes http and https pages only, and refuses anything that
//! could disguise where the link goes (see docs/adr/010-opening-links-from-messages.md). The
//! webview checks too (`isExternalUrl`). Goes through the system's own handler, never a shell.

use crate::sign_in::open;

/// True for `http(s)://<host>/...` with no credentials, whitespace, control characters or
/// backslashes, and nothing else.
pub fn is_external_url(url: &str) -> bool {
    if url.chars().any(|c| c.is_whitespace() || c.is_control() || c == '\\') {
        return false;
    }
    let lower = url.to_ascii_lowercase();
    let Some(prefix) = ["https://", "http://"].into_iter().find(|p| lower.starts_with(p)) else {
        return false;
    };
    let authority = url[prefix.len()..].split(['/', '?', '#']).next().unwrap_or("");
    !authority.is_empty() && !authority.starts_with(':') && !authority.contains('@')
}

#[tauri::command]
pub fn open_external_url(url: String) -> Result<(), String> {
    if !is_external_url(&url) {
        return Err("Not a web link".into());
    }
    open(&url).map_err(|e| format!("Couldn't open the browser: {e}"))
}

#[cfg(test)]
mod tests {
    use super::is_external_url;

    #[test]
    fn opens_only_web_pages() {
        assert!(is_external_url("https://example.com"));
        assert!(is_external_url("https://example.com/a?b=c#d"));
        assert!(is_external_url("HTTPS://EXAMPLE.COM/a"));
        assert!(is_external_url("http://localhost:5173/"));
        assert!(is_external_url("http://[::1]:3000/"));
        assert!(!is_external_url("file:///etc/passwd"));
        assert!(!is_external_url("javascript:alert(1)"));
        assert!(!is_external_url("ftp://example.com"));
        assert!(!is_external_url("https:example.com"));
        assert!(!is_external_url("https://"));
        assert!(!is_external_url("https://:80/"));
    }

    #[test]
    fn refuses_links_that_disguise_their_destination() {
        assert!(!is_external_url("https://user@example.com"));
        assert!(!is_external_url("https://user:secret@example.com/"));
        assert!(!is_external_url("https://example.com\\@other.example/"));
        assert!(!is_external_url("https://example.com/a b"));
        assert!(!is_external_url("https://example.com/\n"));
        assert!(!is_external_url(" https://example.com"));
    }
}
