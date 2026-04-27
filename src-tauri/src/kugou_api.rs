// KuGouMusicApi sidecar — bundled HTTP API for KuGou (login, search, playlist
// add/remove, etc). The binary is built from the upstream submodule by
// `pnpm kugou-api:build:bin` and embedded at compile time. At first run we
// extract it to the temp dir, pick a free local port, spawn it, and poll
// until the Express server is accepting connections. Other Rust modules call
// it via `http://127.0.0.1:<port>/...` through `kugou_api_url(path)`.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::Command;
use tokio::sync::OnceCell;

const KUGOU_API_BIN: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/kugou-api.bin"));

static PORT: OnceCell<u16> = OnceCell::const_new();

pub struct KugouApiHandle;

impl KugouApiHandle {
    pub fn new() -> Self {
        Self
    }

    fn extract_to_temp(app: &AppHandle) -> Result<PathBuf, String> {
        if KUGOU_API_BIN.len() < 1024 {
            return Err(
                "embedded kugou-api binary is empty/too small. Build was made without it; \
                 run `pnpm kugou-api:build:bin` and rebuild."
                    .to_string(),
            );
        }
        let version = env!("CARGO_PKG_VERSION");
        let ext = if cfg!(windows) { ".exe" } else { "" };
        let dir = std::env::temp_dir().join("sususongboard");
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir temp: {e}"))?;
        let path = dir.join(format!("kugou-api-{version}{ext}"));

        let needs_extract = !path.exists()
            || std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0)
                != KUGOU_API_BIN.len() as u64;
        if needs_extract {
            log_to_ui(app, "info", &format!("extracting kugou-api to {}", path.display()));
            std::fs::write(&path, KUGOU_API_BIN).map_err(|e| format!("write: {e}"))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                    .map_err(|e| format!("chmod: {e}"))?;
            }
            #[cfg(target_os = "macos")]
            {
                let _ = std::process::Command::new("xattr")
                    .args(["-cr"])
                    .arg(&path)
                    .output();
            }
        }
        Ok(path)
    }

    /// Bind 127.0.0.1:0 to let the OS pick an unused port, drop the listener
    /// to free the port, then return the chosen number. There's a short race
    /// window before the kugou-api server claims it, but it's microseconds.
    fn pick_free_port() -> Result<u16, String> {
        let listener = std::net::TcpListener::bind("127.0.0.1:0")
            .map_err(|e| format!("bind 0: {e}"))?;
        let port = listener
            .local_addr()
            .map_err(|e| format!("local_addr: {e}"))?
            .port();
        drop(listener);
        Ok(port)
    }

    pub async fn spawn(&self, app: AppHandle) -> Result<(), String> {
        if PORT.initialized() {
            return Ok(());
        }

        let path = Self::extract_to_temp(&app)?;
        let port = Self::pick_free_port()?;
        log_to_ui(
            &app,
            "info",
            &format!("spawning kugou-api on 127.0.0.1:{port}: {}", path.display()),
        );

        let mut cmd = Command::new(&path);
        cmd.stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            .env("PORT", port.to_string())
            .env("HOST", "127.0.0.1")
            .env("NODE_OPTIONS", "--no-deprecation --no-warnings");

        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("spawn {}: {e}", path.display()))?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;

        // Forward stdout/stderr to the UI log panel so failures surface.
        let app_out = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                log_to_ui(&app_out, "info", &format!("[kugou-api] {line}"));
            }
        });
        let app_err = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                log_to_ui(&app_err, "error", &format!("[kugou-api stderr] {line}"));
            }
        });

        // Surface non-zero exit (the child should normally outlive the app).
        let app_wait = app.clone();
        tauri::async_runtime::spawn(async move {
            match child.wait().await {
                Ok(status) => log_to_ui(
                    &app_wait,
                    "error",
                    &format!("[kugou-api] process exited (code={:?})", status.code()),
                ),
                Err(e) => log_to_ui(&app_wait, "error", &format!("[kugou-api] wait: {e}")),
            }
        });

        // Poll until the Express server accepts a connection. Retry briefly
        // because Node startup + module loading takes a couple seconds.
        let url = format!("http://127.0.0.1:{port}/");
        let client = reqwest::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .map_err(|e| format!("client: {e}"))?;
        let deadline = std::time::Instant::now() + std::time::Duration::from_secs(15);
        loop {
            if std::time::Instant::now() > deadline {
                return Err("kugou-api did not become ready within 15s".into());
            }
            match client.get(&url).send().await {
                Ok(_) => break,
                Err(_) => tokio::time::sleep(std::time::Duration::from_millis(200)).await,
            }
        }

        PORT.set(port).map_err(|_| "PORT already set".to_string())?;
        log_to_ui(&app, "info", &format!("kugou-api ready on :{port}"));
        Ok(())
    }
}

/// Returns the base URL of the running kugou-api server, or an error if it's
/// not yet ready. Other Rust modules build their request URLs from this.
pub fn kugou_api_url(path: &str) -> Result<String, String> {
    let port = PORT.get().ok_or("kugou-api not ready yet".to_string())?;
    if path.starts_with('/') {
        Ok(format!("http://127.0.0.1:{port}{path}"))
    } else {
        Ok(format!("http://127.0.0.1:{port}/{path}"))
    }
}

fn log_to_ui(app: &AppHandle, level: &str, msg: &str) {
    let ev = serde_json::json!({ "event": "log", "level": level, "msg": msg });
    let _ = app.emit("sidecar-event", ev);
}

#[allow(dead_code)]
pub type KugouApiState = Arc<KugouApiHandle>;

/// Generic proxy to the embedded KuGouMusicApi server. Used by the dev panel
/// to exercise raw endpoints (search, user/detail, user/playlist,
/// playlist/tracks/add) without scattering reqwest calls across modules.
///
/// `path` should already include the query string (e.g. `/search?keywords=foo`).
/// `cookie` is sent both as a Cookie header and as a `cookie=` query param —
/// belt-and-suspenders, since KuGouMusicApi accepts either.
#[tauri::command]
pub async fn kugou_api_request(
    method: String,
    path: String,
    cookie: Option<String>,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
    let url = kugou_api_url(&path)?;
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

    if let Some(c) = cookie.as_ref().filter(|s| !s.is_empty()) {
        req = req.header("Cookie", c.clone());
    }
    if let Some(b) = body {
        req = req.json(&b);
    }

    let resp = req.send().await.map_err(|e| format!("send: {e}"))?;
    let status = resp.status().as_u16();
    let text = resp.text().await.map_err(|e| format!("body: {e}"))?;

    // Best-effort JSON parse. If the response isn't JSON, return it as a
    // string under `_raw` so the dev panel can still show something.
    let parsed: serde_json::Value = serde_json::from_str(&text)
        .unwrap_or_else(|_| serde_json::json!({ "_raw": text }));

    Ok(serde_json::json!({
        "status": status,
        "body": parsed,
    }))
}
