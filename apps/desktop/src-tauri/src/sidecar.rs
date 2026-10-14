//! The engine sidecar: spawned by us, handed a token (and the Cursor key, when the user
//! stored one: see cursor_key.rs) over stdin, and killed with its
//! whole process group when the app exits, so no agent keeps running (and spending)
//! after Gravita closes. The engine also exits on its own when its stdin hits EOF.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};

pub struct Engine {
    pub port: u16,
    pub token: String,
    child: Mutex<Option<Child>>,
    // Held open for the engine's lifetime; dropping it signals shutdown (EOF).
    stdin: Mutex<Option<ChildStdin>>,
}

fn random_token() -> String {
    let mut bytes = [0u8; 32];
    getrandom::fill(&mut bytes).expect("OS random source unavailable");
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

/// `GRAVITA_ENGINE_CMD` (dev) runs the engine from source, e.g.
/// `bun run ../engine/src/main.ts`; otherwise the bundled sidecar next to our binary.
fn engine_command() -> Command {
    if let Ok(cmd) = std::env::var("GRAVITA_ENGINE_CMD") {
        let mut parts = cmd.split_whitespace();
        let program = parts.next().expect("GRAVITA_ENGINE_CMD is empty");
        let mut c = Command::new(program);
        c.args(parts);
        return c;
    }
    let exe = std::env::current_exe().expect("current exe path");
    let dir = exe.parent().map(PathBuf::from).unwrap_or_default();
    let name = if cfg!(windows) { "gravita-engine.exe" } else { "gravita-engine" };
    Command::new(dir.join(name))
}

/// The first lines the engine reads: the token, then the Cursor key line when one is stored.
fn write_bootstrap(w: &mut impl Write, token: &str, cursor_key: Option<&str>) -> std::io::Result<()> {
    w.write_all(format!("{token}\n").as_bytes())?;
    if let Some(key) = cursor_key {
        w.write_all(crate::cursor_key::key_message(Some(key)).as_bytes())?;
    }
    w.flush()
}

impl Engine {
    /// Starts the engine; `cursor_key` (from the Keychain) follows the token on its stdin.
    pub fn spawn(cursor_key: Option<String>) -> Result<Engine, String> {
        let token = random_token();
        let mut cmd = engine_command();
        cmd.args(["--token-stdin", "--port", "0"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit());
        #[cfg(unix)]
        {
            use std::os::unix::process::CommandExt;
            // Own process group, so shutdown can take the engine and every agent it started.
            cmd.process_group(0);
        }
        let mut child = cmd.spawn().map_err(|e| format!("couldn't start the engine: {e}"))?;

        let mut stdin = child.stdin.take().ok_or("engine stdin unavailable")?;
        write_bootstrap(&mut stdin, &token, cursor_key.as_deref())
            .map_err(|e| format!("couldn't hand the token to the engine: {e}"))?;

        let stdout = child.stdout.take().ok_or("engine stdout unavailable")?;
        let port = read_ready_port(stdout)?;
        Ok(Engine { port, token, child: Mutex::new(Some(child)), stdin: Mutex::new(Some(stdin)) })
    }

    /// One more line on the engine's stdin (a change of the Cursor key).
    pub fn send_line(&self, line: &str) -> Result<(), String> {
        let mut guard = self.stdin.lock().map_err(|_| "the engine's input is unavailable")?;
        let stdin = guard.as_mut().ok_or("the engine has stopped")?;
        stdin
            .write_all(line.as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|_| "couldn't reach the engine".to_string())
    }

    pub fn shutdown(&self) {
        drop(self.stdin.lock().ok().and_then(|mut s| s.take()));
        let Some(mut child) = self.child.lock().ok().and_then(|mut c| c.take()) else { return };
        let deadline = Instant::now() + Duration::from_secs(3);
        while Instant::now() < deadline {
            if let Ok(Some(_)) = child.try_wait() {
                return;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        #[cfg(unix)]
        unsafe {
            // Negative pid: the whole group (engine + claude children).
            libc::kill(-(child.id() as i32), libc::SIGKILL);
        }
        let _ = child.kill();
        let _ = child.wait();
    }
}

/// The engine prints one JSON line when it's listening: {"event":"ready","port":N,...}.
fn read_ready_port(stdout: std::process::ChildStdout) -> Result<u16, String> {
    let (tx, rx) = std::sync::mpsc::channel();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        let mut line = String::new();
        loop {
            line.clear();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => {
                    let _ = tx.send(Err("the engine exited before it was ready".to_string()));
                    return;
                }
                Ok(_) => {
                    if let Ok(v) = serde_json::from_str::<serde_json::Value>(line.trim()) {
                        if v["event"] == "ready" {
                            let port = v["port"].as_u64().unwrap_or(0) as u16;
                            let _ = tx.send(if port > 0 {
                                Ok(port)
                            } else {
                                Err("engine reported no port".into())
                            });
                            // Keep draining so the engine never blocks on a full pipe.
                            let mut sink = String::new();
                            while reader.read_line(&mut sink).map(|n| n > 0).unwrap_or(false) {
                                sink.clear();
                            }
                            return;
                        }
                    }
                }
            }
        }
    });
    rx.recv_timeout(Duration::from_secs(20))
        .map_err(|_| "the engine didn't start in time".to_string())?
}

#[cfg(test)]
mod tests {
    use super::write_bootstrap;

    #[test]
    fn the_token_comes_first_then_the_key_line() {
        let mut out = Vec::new();
        write_bootstrap(&mut out, "tok", Some("crsr_k")).unwrap();
        assert_eq!(
            String::from_utf8(out).unwrap(),
            "tok\n{\"type\":\"cursorKey\",\"value\":\"crsr_k\"}\n"
        );
        let mut out = Vec::new();
        write_bootstrap(&mut out, "tok", None).unwrap();
        assert_eq!(String::from_utf8(out).unwrap(), "tok\n");
    }
}
