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

use serde_json::Value;
use std::path::PathBuf;
use std::sync::Arc;
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::process::{CommandChild, CommandEvent};
use tauri_plugin_shell::ShellExt;
use tokio::sync::Mutex;

/// Sidecar binary embedded at compile time. build.rs places the platform-specific
/// binary at OUT_DIR/sidecar.bin (or an empty placeholder if pnpm sidecar:build:bin
/// has not been run yet — in which case spawn() will fail with a clear error).
const SIDECAR_BIN: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/sidecar.bin"));

pub struct SidecarHandle {
    child: Mutex<Option<CommandChild>>,
}

impl SidecarHandle {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    /// Extract the embedded sidecar binary to the system temp dir and return its path.
    /// Per-version filename so upgrades don't clash with stale extracts.
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

        if !path.exists() || std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0) != SIDECAR_BIN.len() as u64 {
            std::fs::write(&path, SIDECAR_BIN).map_err(|e| format!("write sidecar: {}", e))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let perm = std::fs::Permissions::from_mode(0o755);
                std::fs::set_permissions(&path, perm).map_err(|e| format!("chmod: {}", e))?;
            }
            #[cfg(target_os = "macos")]
            {
                // macOS Gatekeeper kills unsigned binaries spawned by an unsigned parent.
                // 1) Strip any quarantine xattr.
                let _ = std::process::Command::new("xattr")
                    .args(["-cr"])
                    .arg(&path)
                    .output();
                // 2) Ad-hoc sign so the kernel will accept it (no certificate needed).
                let _ = std::process::Command::new("codesign")
                    .args(["--force", "--sign", "-"])
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
        let cmd = app.shell().command(path.to_string_lossy().to_string());

        let (mut rx, child) = cmd.spawn().map_err(|e| format!("spawn: {}", e))?;
        *child_lock = Some(child);

        let app_clone = app.clone();
        tauri::async_runtime::spawn(async move {
            while let Some(ev) = rx.recv().await {
                match ev {
                    CommandEvent::Stdout(line_bytes) => {
                        if let Ok(line) = std::str::from_utf8(&line_bytes) {
                            if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                                let _ = app_clone.emit("sidecar-event", v);
                            }
                        }
                    }
                    CommandEvent::Stderr(line_bytes) => {
                        if let Ok(line) = std::str::from_utf8(&line_bytes) {
                            eprintln!("[sidecar:stderr] {}", line);
                        }
                    }
                    CommandEvent::Error(e) => eprintln!("[sidecar:error] {}", e),
                    CommandEvent::Terminated(p) => {
                        eprintln!("[sidecar:terminated] code={:?}", p.code);
                        break;
                    }
                    _ => {}
                }
            }
        });

        Ok(())
    }

    pub async fn send(&self, cmd: Value) -> Result<(), String> {
        let mut child_lock = self.child.lock().await;
        let child = child_lock.as_mut().ok_or("sidecar not running")?;
        let mut line = serde_json::to_string(&cmd).map_err(|e| e.to_string())?;
        line.push('\n');
        child.write(line.as_bytes()).map_err(|e| e.to_string())?;
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
