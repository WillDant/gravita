//! The one HTTP call the shell makes to its own engine: the tray's kill switch,
//! `POST /control/stop-all` (see `HttpPaths.stopAll` in @gravita/protocol). Raw HTTP/1.1
//! over a loopback socket keeps the shell free of an HTTP client crate. The engine
//! authenticates the call with its session token and refuses anything carrying an
//! `Origin` header, so we never send one.

use std::io::{Read, Write};
use std::net::{Ipv4Addr, SocketAddr, TcpStream};
use std::time::Duration;

pub const STOP_ALL_PATH: &str = "/control/stop-all";
const CONNECT_TIMEOUT: Duration = Duration::from_secs(2);
/// The engine answers once every session is disposed, which it caps at 3 s.
const READ_TIMEOUT: Duration = Duration::from_secs(6);
/// Far more than `{"stopped":N}` and its headers; a larger answer isn't the engine's.
const MAX_RESPONSE: u64 = 64 * 1024;

/// The exact bytes of the stop-all request.
pub fn stop_all_request(port: u16, token: &str) -> String {
    format!(
        "POST {STOP_ALL_PATH} HTTP/1.1\r\n\
         Host: 127.0.0.1:{port}\r\n\
         Authorization: Bearer {token}\r\n\
         Content-Length: 0\r\n\
         Connection: close\r\n\
         \r\n"
    )
}

/// Reads `{"stopped":N}` out of a complete HTTP/1.1 response (plain or chunked body).
pub fn parse_stop_all_response(raw: &[u8]) -> Result<u32, String> {
    let split = raw
        .windows(4)
        .position(|w| w == b"\r\n\r\n")
        .ok_or("the engine's answer has no header end")?;
    let head =
        std::str::from_utf8(&raw[..split]).map_err(|_| "the engine's headers aren't text")?;
    let body = &raw[split + 4..];

    let mut lines = head.split("\r\n");
    let status_line = lines.next().unwrap_or_default();
    let status: u16 = status_line
        .split_whitespace()
        .nth(1)
        .and_then(|s| s.parse().ok())
        .ok_or_else(|| format!("unexpected status line: {status_line:?}"))?;
    if !(200..300).contains(&status) {
        return Err(format!("the engine answered {status}"));
    }

    let chunked = lines.any(|line| {
        let mut kv = line.splitn(2, ':');
        let (k, v) = (kv.next().unwrap_or_default(), kv.next().unwrap_or_default());
        k.trim().eq_ignore_ascii_case("transfer-encoding")
            && v.to_ascii_lowercase().contains("chunked")
    });
    let body = if chunked { dechunk(body)? } else { body.to_vec() };

    let json: serde_json::Value = serde_json::from_slice(&body)
        .map_err(|e| format!("the engine's answer isn't JSON: {e}"))?;
    json.get("stopped")
        .and_then(serde_json::Value::as_u64)
        .and_then(|n| u32::try_from(n).ok())
        .ok_or_else(|| "the engine's answer has no `stopped` count".to_string())
}

fn dechunk(mut body: &[u8]) -> Result<Vec<u8>, String> {
    let mut out = Vec::new();
    loop {
        let eol = body.windows(2).position(|w| w == b"\r\n").ok_or("truncated chunked body")?;
        let size_text = std::str::from_utf8(&body[..eol]).map_err(|_| "bad chunk size")?;
        let size_hex = size_text.split(';').next().unwrap_or_default().trim();
        let size = usize::from_str_radix(size_hex, 16).map_err(|_| "bad chunk size")?;
        body = &body[eol + 2..];
        if size == 0 {
            return Ok(out);
        }
        if body.len() < size {
            return Err("truncated chunk".into());
        }
        out.extend_from_slice(&body[..size]);
        body = body.get(size + 2..).ok_or("truncated chunk")?;
    }
}

/// Asks the engine to stop every session Gravita runs; resolves to how many it stopped.
/// Blocking (2 s timeouts on connect, write and read): call it off the main thread.
pub fn post_stop_all(port: u16, token: &str) -> Result<u32, String> {
    let addr = SocketAddr::from((Ipv4Addr::LOCALHOST, port));
    let mut stream = TcpStream::connect_timeout(&addr, CONNECT_TIMEOUT)
        .map_err(|e| format!("couldn't reach the engine: {e}"))?;
    stream.set_read_timeout(Some(READ_TIMEOUT)).map_err(|e| e.to_string())?;
    stream.set_write_timeout(Some(CONNECT_TIMEOUT)).map_err(|e| e.to_string())?;
    stream
        .write_all(stop_all_request(port, token).as_bytes())
        .map_err(|e| format!("couldn't send the request: {e}"))?;
    let mut raw = Vec::new();
    stream
        .take(MAX_RESPONSE)
        .read_to_end(&mut raw)
        .map_err(|e| format!("couldn't read the engine's answer: {e}"))?;
    parse_stop_all_response(&raw)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    #[test]
    fn request_is_a_bare_authenticated_post() {
        let req = stop_all_request(4319, "abc123");
        assert_eq!(
            req,
            "POST /control/stop-all HTTP/1.1\r\nHost: 127.0.0.1:4319\r\nAuthorization: Bearer abc123\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
        );
        assert!(!req.to_ascii_lowercase().contains("origin:"));
    }

    #[test]
    fn parses_a_plain_json_answer() {
        let raw = b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 13\r\n\r\n{\"stopped\":3}";
        assert_eq!(parse_stop_all_response(raw), Ok(3));
    }

    #[test]
    fn parses_a_chunked_answer() {
        let raw = b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\n6\r\n{\"stop\r\n7\r\nped\":0}\r\n0\r\n\r\n";
        assert_eq!(parse_stop_all_response(raw), Ok(0));
    }

    #[test]
    fn rejects_errors_and_garbage() {
        assert!(parse_stop_all_response(b"HTTP/1.1 401 Unauthorized\r\nContent-Length: 0\r\n\r\n")
            .unwrap_err()
            .contains("401"));
        assert!(parse_stop_all_response(b"HTTP/1.1 200 OK\r\n\r\nnot json").is_err());
        assert!(parse_stop_all_response(b"HTTP/1.1 200 OK\r\n\r\n{\"ok\":true}").is_err());
        assert!(parse_stop_all_response(b"HTTP/1.1 200 OK").is_err());
        assert!(parse_stop_all_response(b"").is_err());
        assert!(parse_stop_all_response(
            b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\n\r\nzz\r\n"
        )
        .is_err());
    }

    #[test]
    fn talks_to_a_loopback_server() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let server = std::thread::spawn(move || {
            let (mut conn, _) = listener.accept().unwrap();
            let mut buf = [0u8; 1024];
            let n = conn.read(&mut buf).unwrap();
            let got = String::from_utf8_lossy(&buf[..n]).to_string();
            conn.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 13\r\n\r\n{\"stopped\":2}")
                .unwrap();
            got
        });
        assert_eq!(post_stop_all(port, "tok"), Ok(2));
        let got = server.join().unwrap();
        assert!(got.starts_with("POST /control/stop-all HTTP/1.1\r\n"));
        assert!(got.contains("Authorization: Bearer tok\r\n"));
    }

    #[test]
    fn fails_fast_when_nothing_listens() {
        let port = TcpListener::bind("127.0.0.1:0").unwrap().local_addr().unwrap().port();
        assert!(post_stop_all(port, "tok").is_err());
    }
}
