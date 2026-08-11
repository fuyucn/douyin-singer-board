// KuGouMusicApi HTTP server hosted inside the Node sidecar process. The
// sidecar is built from `sidecar/` (which bundles the slim kugou server), so
// no separate kugou-api binary is embedded or spawned. Enabling Kugou asks
// the sidecar to start the Express server on a local port; disabling asks it
// to stop. Other Rust modules call it via
// `http://127.0.0.1:<port>/...` through `KugouApiHandle::api_url()`.

use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::sync::Mutex;

use crate::sidecar::SidecarState;

#[derive(Clone, Copy)]
struct KugouApiStateInner {
    port: Option<u16>,
    enabled: bool,
}

pub struct KugouApiHandle {
    state: Mutex<KugouApiStateInner>,
    // Monotonic generation bumped whenever the running server is invalidated
    // (stop or sidecar exit). An in-flight spawn checks it after its async
    // readiness poll so a stale completion cannot resurrect the port after a
    // user already toggled the feature off.
    generation: AtomicU64,
}

impl KugouApiHandle {
    pub fn new() -> Self {
        Self {
            state: Mutex::new(KugouApiStateInner {
                port: None,
                enabled: false,
            }),
            generation: AtomicU64::new(0),
        }
    }

    pub async fn is_enabled(&self) -> bool {
        self.state.lock().await.enabled
    }

    /// Clear the cached port after the sidecar has exited so a later respawn
    /// can start the kugou server again. The enabled flag is left untouched
    /// (crash recovery uses it to decide whether to auto-restart kugou).
    pub async fn reset(&self) {
        self.generation.fetch_add(1, Ordering::SeqCst);
        self.state.lock().await.port = None;
    }

    /// Returns the base URL of the running kugou-api server, or an error if
    /// it is not currently running.
    pub async fn api_url(&self, path: &str) -> Result<String, String> {
        let port = self.state.lock().await.port;
        let port = port.ok_or_else(|| "kugou-api not running".to_string())?;
        if path.starts_with('/') {
            Ok(format!("http://127.0.0.1:{port}{path}"))
        } else {
            Ok(format!("http://127.0.0.1:{port}/{path}"))
        }
    }

    /// Bind 127.0.0.1:0 to let the OS pick an unused port, drop the listener
    /// to free the port, then return the chosen number. There's a short race
    /// window before the kugou-api server claims it, but it's microseconds.
    fn pick_free_port() -> Result<u16, String> {
        let listener =
            std::net::TcpListener::bind("127.0.0.1:0").map_err(|e| format!("bind 0: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("local_addr: {e}"))?
            .port();
        drop(listener);
        Ok(port)
    }

    pub async fn spawn(&self, app: AppHandle, sidecar: &SidecarState) -> Result<(), String> {
        let generation = self.generation.load(Ordering::SeqCst);
        let state = self.state.lock().await;
        if state.port.is_some() && generation == self.generation.load(Ordering::SeqCst) {
            return Ok(());
        }
        drop(state);

        let port = Self::pick_free_port()?;
        log_to_ui(
            &app,
            "info",
            &format!("starting kugou-api on 127.0.0.1:{port}"),
        );
        send_with_retry(
            sidecar,
            serde_json::json!({ "cmd": "kugou_start", "port": port }),
        )
        .await?;

        // Poll until the Express server accepts a connection. The sidecar has
        // already loaded the modules, so this is usually quick.
        let url = format!("http://127.0.0.1:{port}/");
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .map_err(|e| format!("client: {e}"))?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        let mut ready = false;
        loop {
            if self.generation.load(Ordering::SeqCst) != generation {
                break;
            }
            if std::time::Instant::now() > deadline {
                break;
            }
            match client.get(&url).send().await {
                Ok(_) => {
                    ready = true;
                    break;
                }
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(200)).await,
            }
        }

        if self.generation.load(Ordering::SeqCst) != generation {
            // A stop/reset happened while we were waiting. The kill path
            // already sends kugou_stop, but the server may only just have come
            // up (currentServer is set late), so stop again to close that gap.
            let _ = send_with_retry(sidecar, serde_json::json!({ "cmd": "kugou_stop" })).await;
            return Ok(());
        }

        if !ready {
            let _ = send_with_retry(sidecar, serde_json::json!({ "cmd": "kugou_stop" })).await;
            self.state.lock().await.port = None;
            return Err("kugou-api did not become ready within 15s".into());
        }

        let mut state = self.state.lock().await;
        *state = KugouApiStateInner {
            port: Some(port),
            enabled: true,
        };
        drop(state);
        log_to_ui(&app, "info", &format!("kugou-api ready on :{port}"));
        Ok(())
    }

    /// Ask the sidecar to stop the kugou HTTP server and forget the port.
    /// Returns an error when the sidecar is alive but the stop could not be
    /// delivered; in that case the port/enabled state is left untouched so the
    /// UI does not claim the feature is off while the server is still running.
    pub async fn kill(&self, sidecar: &SidecarState) -> Result<(), String> {
        if sidecar.is_running().await {
            send_with_retry(sidecar, serde_json::json!({ "cmd": "kugou_stop" })).await?;
        }
        self.generation.fetch_add(1, Ordering::SeqCst);
        *self.state.lock().await = KugouApiStateInner {
            port: None,
            enabled: false,
        };
        Ok(())
    }
}

/// The sidecar is spawned asynchronously at startup, so a kugou enable that
/// arrives first may briefly hit "sidecar not running". Retry only that case
/// for a few seconds; real I/O errors fail immediately.
async fn send_with_retry(sidecar: &SidecarState, cmd: serde_json::Value) -> Result<(), String> {
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(5);
    loop {
        match sidecar.send(cmd.clone()).await {
            Ok(()) => return Ok(()),
            Err(e) if e.contains("not running") && std::time::Instant::now() < deadline => {
                tokio::time::sleep(std::time::Duration::from_millis(150)).await;
            }
            Err(e) => return Err(e),
        }
    }
}

fn log_to_ui(app: &AppHandle, level: &str, msg: &str) {
    let ev = serde_json::json!({ "event": "log", "level": level, "msg": msg });
    let _ = app.emit("sidecar-event", ev);
}

/// Redact sensitive cookie/token data from log lines before surfacing to UI.
/// Matches `cookie=`, `token=`, `userid=`, `dfid=` (case-insensitive) followed
/// by their values up to the next `&` or end of string.
#[allow(dead_code)]
pub type KugouApiState = Arc<KugouApiHandle>;

/// Generic proxy to the embedded KuGouMusicApi server. Used by the dev panel
/// to exercise raw endpoints (search, user/detail, user/playlist,
/// playlist/tracks/add) without scattering reqwest calls across modules.
///
/// `path` should already include the query string (e.g. `/search?keywords=foo`).
/// `cookie` is sent both as a Cookie header and as a `cookie=` query param —
/// belt-and-suspenders, since KuGouMusicApi accepts either.
/// Sanitize a copy-pasted cookie string into a single header line.
/// HTTP header values can't contain CR/LF/NUL — pasted cookies often have
/// soft-wraps or stray newlines, which produce reqwest "builder error".
/// Also collapse interior whitespace runs and trim ends.
fn sanitize_cookie(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| {
            if c == '\r' || c == '\n' || c == '\t' || c == '\0' {
                ' '
            } else {
                c
            }
        })
        .collect();
    let mut out = String::with_capacity(cleaned.len());
    let mut prev_space = false;
    for c in cleaned.chars() {
        if c == ' ' {
            if !prev_space && !out.is_empty() {
                out.push(' ');
            }
            prev_space = true;
        } else {
            out.push(c);
            prev_space = false;
        }
    }
    out.trim().trim_end_matches(';').trim().to_string()
}

#[tauri::command]
pub async fn kugou_api_request(
    state: tauri::State<'_, KugouApiState>,
    method: String,
    path: String,
    cookie: Option<String>,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    if !state.is_enabled().await {
        return Err("Kugou features are disabled".to_string());
    }

    // KuGouMusicApi's documented way to pass cookies for non-browser clients
    // is the `?cookie=token=X;userid=Y;dfid=Z` query string. Its HTTP Cookie
    // header parser in server.js requires `;\s+` to split entries (i.e. a
    // space after each semicolon) and silently merges everything into one
    // pair otherwise — which sends the WHOLE remaining cookie string into
    // `req.cookies.token`, blowing past the 128-byte RSA limit in
    // user_detail's cryptoRSAEncrypt. The query-string path uses a simple
    // `split(';')` so the no-space format works.
    let cookie_clean = cookie
        .as_ref()
        .map(|s| sanitize_cookie(s))
        .filter(|s| !s.is_empty());
    let path_with_cookie = match cookie_clean.as_ref() {
        Some(c) => {
            let sep = if path.contains('?') { '&' } else { '?' };
            // urlencode the cookie value so `=` and `;` survive the URL parser
            let encoded: String = c
                .bytes()
                .flat_map(|b| {
                    if b.is_ascii_alphanumeric() || matches!(b, b'-' | b'_' | b'.' | b'~') {
                        vec![b as char]
                    } else {
                        format!("%{b:02X}").chars().collect()
                    }
                })
                .collect();
            format!("{path}{sep}cookie={encoded}")
        }
        None => path.clone(),
    };

    let url = state.api_url(&path_with_cookie).await?;
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(15))
        .build()
        .map_err(|e| format!("client: {e}"))?;

    let mut req = match method.to_uppercase().as_str() {
        "GET" => client.get(&url),
        "POST" => client.post(&url),
        "PUT" => client.put(&url),
        "DELETE" => client.delete(&url),
        m => return Err(format!("unsupported method {m}")),
    };

    if let Some(b) = body {
        req = req.json(&b);
    }

    // Materialize the request first so a builder error (bad URL / header /
    // serialization) surfaces with a real reason instead of opaque "builder
    // error" from send().
    let request = req.build().map_err(|e| format!("build {url}: {e}"))?;

    let resp = client
        .execute(request)
        .await
        .map_err(|e| format!("send {url}: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| format!("body: {e}"))?;

    // Best-effort JSON parse. If the response isn't JSON, return it as a
    // string under `_raw` so the dev panel can still show something.
    let parsed: serde_json::Value =
        serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({ "_raw": text }));

    Ok(serde_json::json!({
        "status": status,
        "body": parsed,
    }))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sidecar::SidecarHandle;

    #[tokio::test]
    async fn kill_without_sidecar_is_clean_noop() {
        let kugou = KugouApiHandle::new();
        let sidecar = std::sync::Arc::new(SidecarHandle::new());

        assert!(!kugou.is_enabled().await);
        assert!(kugou.kill(&sidecar).await.is_ok());
        assert!(!kugou.is_enabled().await);
        assert!(kugou.api_url("/x").await.is_err());
    }

    #[tokio::test]
    async fn reset_clears_port_only() {
        let kugou = KugouApiHandle::new();
        kugou.state.lock().await.port = Some(8080);

        kugou.reset().await;

        assert!(kugou.api_url("/x").await.is_err());
        assert!(!kugou.is_enabled().await);
    }
}
