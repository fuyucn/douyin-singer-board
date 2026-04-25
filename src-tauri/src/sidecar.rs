// Node sidecar process management.
//
// The sidecar binary (built by `pnpm sidecar:build:bin`) is embedded into this
// crate at compile time via `include_bytes!`. At first run we extract it to
// the system temp dir, mark it executable, and spawn it. Each version of the
// app extracts to its own filename so old binaries can be cleaned up.
//
// IPC:
// - Tauri → sidecar: write JSON lines on stdin (cmd: start | stop | reload_config)
// - sidecar → Tauri: read JSON lines on stdout, emit as 'sidecar-event' to the frontend

use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex;

/// Sidecar binary embedded at compile time.
const SIDECAR_BIN: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/sidecar.bin"));

pub struct SidecarHandle {
    child: Mutex<Option<Child>>,
    stdin: Mutex<Option<ChildStdin>>,
}

impl SidecarHandle {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
            stdin: Mutex::new(None),
        }
    }

    fn extract_to_temp() -> Result<PathBuf, String> {
        if SIDECAR_BIN.len() < 1024 {
            return Err(
                "embedded sidecar is empty/too small. Build was made without a sidecar binary; \
                 run `pnpm sidecar:build:bin` and rebuild."
                    .to_string(),
            );
        }
        let version = env!("CARGO_PKG_VERSION");
        let ext = if cfg!(windows) { ".exe" } else { "" };
        let dir = std::env::temp_dir().join("sususongboard");
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir temp: {}", e))?;
        let path = dir.join(format!("sidecar-{}{}", version, ext));

        let needs_extract = !path.exists()
            || std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) != SIDECAR_BIN.len() as u64;
        if needs_extract {
            std::fs::write(&path, SIDECAR_BIN).map_err(|e| format!("write sidecar: {}", e))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                    .map_err(|e| format!("chmod: {}", e))?;
            }
            #[cfg(target_os = "macos")]
            {
                // pkg already ad-hoc signs the binary, but writing it via Rust IO can leave it
                // in a state where the kernel re-checks. A best-effort xattr clear keeps any
                // quarantine flag from sticking.
                let _ = std::process::Command::new("xattr")
                    .args(["-cr"])
                    .arg(&path)
                    .output();
            }
        }
        Ok(path)
    }

    pub async fn spawn(&self, app: AppHandle) -> Result<(), String> {
        let mut child_lock = self.child.lock().await;
        if child_lock.is_some() {
            return Ok(());
        }

        let path = Self::extract_to_temp()?;

        // Use raw tokio::process::Command, bypassing tauri-plugin-shell's permission/scope
        // logic — we are spawning our own embedded binary at a fixed path, no need for the
        // shell plugin's scoping.
        let mut cmd = Command::new(&path);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true);

        let mut child = cmd.spawn().map_err(|e| format!("spawn {:?}: {}", path, e))?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;
        let stdin = child.stdin.take().ok_or("no stdin")?;

        *self.stdin.lock().await = Some(stdin);
        *child_lock = Some(child);

        // stdout: parse JSON lines and forward to frontend.
        let app_out = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                    let _ = app_out.emit("sidecar-event", v);
                }
            }
        });

        // stderr: forward each line to frontend as a log event so the user can see crashes.
        let app_err = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                let ev = json!({
                    "event": "log",
                    "level": "error",
                    "msg": format!("[stderr] {}", line),
                });
                let _ = app_err.emit("sidecar-event", ev);
            }
        });

        Ok(())
    }

    pub async fn send(&self, cmd: Value) -> Result<(), String> {
        let mut stdin_lock = self.stdin.lock().await;
        let stdin = stdin_lock.as_mut().ok_or("sidecar not running")?;
        let mut line = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
        line.push('\n');
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|e| e.to_string())?;
        stdin.flush().await.map_err(|e| e.to_string())?;
        Ok(())
    }
}

pub type SidecarState = Arc<SidecarHandle>;

#[tauri::command]
pub async fn sidecar_send(
    state: tauri::State<'_, SidecarState>,
    cmd: Value,
) -> Result<(), String> {
    state.send(cmd).await
}
