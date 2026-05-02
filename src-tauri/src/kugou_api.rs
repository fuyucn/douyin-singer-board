// KuGouMusicApi sidecar — bundled HTTP API for KuGou (login, search, playlist
// add/remove, etc). The binary is built from the upstream submodule by
// `pnpm kugou-api:build:bin` and embedded at compile time. At first run we
// extract it to the temp dir, pick a free local port, spawn it, and poll
// until the Express server is accepting connections. Other Rust modules call
// it via `http://127.0.0.1:<port>/...` through `kugou_api_url(path)`.

use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
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
        // Use app local data dir instead of temp — macOS may kill processes
        // spawned from temp dirs under memory pressure.
        let dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("app_local_data_dir: {e}"))?;
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir data: {e}"))?;
        let path = dir.join(format!("kugou-api-{version}{ext}"));

        // Clean up old versions (kugou-api-* that don't match current version)
        if let Ok(entries) = std::fs::read_dir(&dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if name.starts_with("kugou-api-") && name != format!("kugou-api-{version}{ext}") {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }

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
/// Sanitize a copy-pasted cookie string into a single header line.
/// HTTP header values can't contain CR/LF/NUL — pasted cookies often have
/// soft-wraps or stray newlines, which produce reqwest "builder error".
/// Also collapse interior whitespace runs and trim ends.
fn sanitize_cookie(raw: &str) -> String {
    let cleaned: String = raw
        .chars()
        .map(|c| if c == '\r' || c == '\n' || c == '\t' || c == '\0' { ' ' } else { c })
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
    method: String,
    path: String,
    cookie: Option<String>,
    body: Option<serde_json::Value>,
) -> Result<serde_json::Value, String> {
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

    let url = kugou_api_url(&path_with_cookie)?;
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
    let request = req
        .build()
        .map_err(|e| format!("build {url}: {e}"))?;

    let resp = client
        .execute(request)
        .await
        .map_err(|e| format!("send {url}: {e}"))?;
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
