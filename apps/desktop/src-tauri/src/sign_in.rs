//! Opens Codex's sign-in page for Gravita's own Codex profile (the one squads run Codex in)
//! in the user's browser. The webview gets no general way to open links: this command
//! opens only https pages on OpenAI's own hosts, which is what Codex answers
//! `account/login/start` with (the engine checks the link too). Codex itself takes the
//! browser's callback on localhost and keeps the tokens; Gravita never sees them.

use std::process::Command;

/// Hosts a sign-in page may live on: OpenAI's and ChatGPT's, and their subdomains.
const HOSTS: [&str; 2] = ["openai.com", "chatgpt.com"];

/// True for `https://<OpenAI host>/...` and nothing else (no credentials, no other scheme).
pub fn is_sign_in_url(url: &str) -> bool {
    let Some(rest) = url.strip_prefix("https://") else {
        return false;
    };
    let authority = rest.split(['/', '?', '#']).next().unwrap_or("");
    if authority.contains('@') || authority.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return false;
    }
    let host = authority.split(':').next().unwrap_or("").to_ascii_lowercase();
    HOSTS.iter().any(|h| host == *h || host.ends_with(&format!(".{h}")))
}

/// The sign-in link, opened by the system's own handler (never through a shell).
#[tauri::command]
pub fn open_sign_in_url(url: String) -> Result<(), String> {
    if !is_sign_in_url(&url) {
        return Err("Not a Codex sign-in link".into());
    }
    open(&url).map_err(|e| format!("Couldn't open the browser: {e}"))
}

#[cfg(target_os = "macos")]
fn open(url: &str) -> std::io::Result<()> {
    Command::new("/usr/bin/open").arg(url).spawn().map(|_| ())
}

#[cfg(target_os = "windows")]
fn open(url: &str) -> std::io::Result<()> {
    Command::new("rundll32").args(["url.dll,FileProtocolHandler", url]).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open(url: &str) -> std::io::Result<()> {
    Command::new("xdg-open").arg(url).spawn().map(|_| ())
}

#[cfg(test)]
mod tests {
    use super::is_sign_in_url;

    #[test]
    fn opens_only_openai_https_pages() {
        assert!(is_sign_in_url("https://auth.openai.com/oauth/authorize?client_id=x"));
        assert!(is_sign_in_url("https://chatgpt.com/auth/login"));
        assert!(is_sign_in_url("https://AUTH.OPENAI.COM/x"));
        assert!(!is_sign_in_url("http://auth.openai.com/x"));
        assert!(!is_sign_in_url("https://openai.com.evil.example/x"));
        assert!(!is_sign_in_url("https://evilopenai.com/x"));
        assert!(!is_sign_in_url("https://user@auth.openai.com/x"));
        assert!(!is_sign_in_url("file:///etc/passwd"));
        assert!(!is_sign_in_url("javascript:alert(1)"));
    }
}
