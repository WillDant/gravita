//! The Cursor API key the user pastes in Gravita (ADR 008, docs/COMPLIANCE.md "Cursor API
//! key"). It is stored in the macOS Keychain only, under an item of Gravita's own, and
//! handed to the engine over its stdin (like the session token). It never goes back to the
//! webview: the webview may set it, remove it, or ask whether there is one. Nothing here
//! logs it or puts it in an error.

/// The Keychain item: Gravita's own, never Cursor's (`cursor-access-token` & co.).
pub const SERVICE: &str = "dev.gravita.app.cursor-api-key";
pub const ACCOUNT: &str = "default";

/// The longest key accepted (Cursor's are far shorter; this only bounds a bad paste).
const MAX_LEN: usize = 512;

/// Where the key is kept; tests use an in-memory one.
pub trait KeyStore: Send + Sync {
    fn get(&self) -> Result<Option<String>, String>;
    fn set(&self, value: &str) -> Result<(), String>;
    fn delete(&self) -> Result<(), String>;
}

/// The key as pasted, trimmed; refused when empty, too long, or with spaces or controls
/// inside (a paste of more than the key).
pub fn normalize(value: &str) -> Result<String, String> {
    let v = value.trim();
    if v.is_empty() {
        return Err("The key is empty".into());
    }
    if v.len() > MAX_LEN || v.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err("That doesn't look like a Cursor API key".into());
    }
    Ok(v.to_string())
}

/// The engine's stdin line that sets (or, with `None`, removes) the key.
pub fn key_message(value: Option<&str>) -> String {
    let msg = serde_json::json!({ "type": "cursorKey", "value": value });
    format!("{msg}\n")
}

#[cfg(target_os = "macos")]
mod keychain {
    use super::{KeyStore, ACCOUNT, SERVICE};
    use security_framework::passwords::{
        delete_generic_password, get_generic_password, set_generic_password,
    };

    /// errSecItemNotFound: there is no key, which is not an error.
    const NOT_FOUND: i32 = -25300;

    pub struct Keychain;

    fn describe(e: security_framework::base::Error) -> String {
        format!("Keychain error {}", e.code())
    }

    impl KeyStore for Keychain {
        fn get(&self) -> Result<Option<String>, String> {
            match get_generic_password(SERVICE, ACCOUNT) {
                Ok(bytes) => Ok(String::from_utf8(bytes).ok().filter(|s| !s.is_empty())),
                Err(e) if e.code() == NOT_FOUND => Ok(None),
                Err(e) => Err(describe(e)),
            }
        }

        fn set(&self, value: &str) -> Result<(), String> {
            set_generic_password(SERVICE, ACCOUNT, value.as_bytes()).map_err(describe)
        }

        fn delete(&self) -> Result<(), String> {
            match delete_generic_password(SERVICE, ACCOUNT) {
                Ok(()) => Ok(()),
                Err(e) if e.code() == NOT_FOUND => Ok(()),
                Err(e) => Err(describe(e)),
            }
        }
    }
}

#[cfg(not(target_os = "macos"))]
mod keychain {
    use super::KeyStore;

    /// Gravita keeps the key in the macOS Keychain only: elsewhere there is none.
    pub struct Keychain;

    impl KeyStore for Keychain {
        fn get(&self) -> Result<Option<String>, String> {
            Ok(None)
        }

        fn set(&self, _value: &str) -> Result<(), String> {
            Err("The Cursor key can only be stored on macOS".into())
        }

        fn delete(&self) -> Result<(), String> {
            Ok(())
        }
    }
}

pub use keychain::Keychain;

/// The app's key store (managed state).
pub struct CursorKey {
    store: Box<dyn KeyStore>,
}

impl CursorKey {
    pub fn new(store: Box<dyn KeyStore>) -> CursorKey {
        CursorKey { store }
    }

    /// The stored key, for the engine at start; an unreadable Keychain counts as none.
    pub fn stored(&self) -> Option<String> {
        match self.store.get() {
            Ok(key) => key,
            Err(e) => {
                eprintln!("Gravita: the Cursor key couldn't be read ({e})");
                None
            }
        }
    }

    /// Stores the key and returns the engine's line for it.
    pub fn save(&self, value: &str) -> Result<String, String> {
        let key = normalize(value)?;
        self.store.set(&key)?;
        Ok(key_message(Some(&key)))
    }

    /// Removes the key and returns the engine's line for it.
    pub fn remove(&self) -> Result<String, String> {
        self.store.delete()?;
        Ok(key_message(None))
    }

    pub fn present(&self) -> Result<bool, String> {
        Ok(self.store.get()?.is_some())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    /// A Keychain stand-in.
    #[derive(Default)]
    pub struct MemoryStore(pub Mutex<Option<String>>);

    impl KeyStore for MemoryStore {
        fn get(&self) -> Result<Option<String>, String> {
            Ok(self.0.lock().unwrap().clone())
        }
        fn set(&self, value: &str) -> Result<(), String> {
            *self.0.lock().unwrap() = Some(value.to_string());
            Ok(())
        }
        fn delete(&self) -> Result<(), String> {
            *self.0.lock().unwrap() = None;
            Ok(())
        }
    }

    const KEY: &str = "crsr_test_SENTINEL_0123456789abcdef";

    #[test]
    fn saves_trimmed_keys_and_tells_the_engine() {
        let k = CursorKey::new(Box::new(MemoryStore::default()));
        assert!(!k.present().unwrap());
        let line = k.save(&format!("  {KEY}\n")).unwrap();
        assert_eq!(line, format!("{{\"type\":\"cursorKey\",\"value\":\"{KEY}\"}}\n"));
        assert!(k.present().unwrap());
        assert_eq!(k.stored().as_deref(), Some(KEY));
        assert_eq!(k.remove().unwrap(), "{\"type\":\"cursorKey\",\"value\":null}\n");
        assert!(!k.present().unwrap());
        assert_eq!(k.stored(), None);
    }

    #[test]
    fn refuses_what_is_not_a_key() {
        let k = CursorKey::new(Box::new(MemoryStore::default()));
        assert!(k.save("   ").is_err());
        assert!(k.save("two words").is_err());
        assert!(k.save(&"x".repeat(MAX_LEN + 1)).is_err());
        assert!(k.save("a\u{0}b").is_err());
        assert!(!k.present().unwrap());
    }

    #[test]
    fn errors_never_carry_the_key() {
        let err = normalize(&format!("{KEY} {KEY}")).unwrap_err();
        assert!(!err.contains(KEY));
    }

    #[test]
    fn a_quote_in_the_key_cannot_break_the_line() {
        let line = key_message(Some("a\"b"));
        let v: serde_json::Value = serde_json::from_str(line.trim()).unwrap();
        assert_eq!(v["value"], "a\"b");
        assert_eq!(line.matches('\n').count(), 1);
    }
}
