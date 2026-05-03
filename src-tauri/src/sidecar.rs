// Node sidecar process management.
//
// The sidecar binary (built by `pnpm sidecar:build:bin`) is embedded into this
// crate at compile time via `include_bytes!`. At first run we extract it to
// the system temp dir, mark it executable, and spawn it.
//
// IPC:
// - Tauri → sidecar: write JSON lines on stdin (cmd: start | stop | reload_config)
// - sidecar → Tauri: read JSON lines on stdout, emit as 'sidecar-event' to the frontend.
// - sidecar stderr lines are forwarded as 'log' events (level=error, prefix [stderr]).
// - When the child exits, the exit status is forwarded as a 'log' event so the
//   user can diagnose crashes from the UI without a terminal.

use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::Mutex;

const SIDECAR_BIN: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/sidecar.bin"));

pub struct SidecarHandle {
    stdin: Mutex<Option<ChildStdin>>,
    pid: Mutex<Option<u32>>,
}

impl SidecarHandle {
    pub fn new() -> Self {
        Self { stdin: Mutex::new(None), pid: Mutex::new(None) }
    }

    pub async fn kill(&self) {
        if let Some(pid) = *self.pid.lock().await {
            #[cfg(windows)]
            {
                // taskkill /F /T kills the whole process tree, including any
                // child Node processes spawned by the sidecar.
                let _ = std::process::Command::new("taskkill")
                    .args(["/F", "/T", "/PID", &pid.to_string()])
                    .output();
            }
            #[cfg(unix)]
            {
                let _ = std::process::Command::new("kill")
                    .args(["-TERM", &pid.to_string()])
                    .output();
            }
        }
    }

    fn extract_to_temp(app: &AppHandle) -> Result<PathBuf, String> {
        if SIDECAR_BIN.len() < 1024 {
            return Err(
                "embedded sidecar is empty/too small. Build was made without a sidecar binary; \
                 run `pnpm sidecar:build:bin` and rebuild."
                    .to_string(),
            );
        }
        let version = env!("CARGO_PKG_VERSION");
        let ext = if cfg!(windows) { ".exe" } else { "" };
        // Layout: <app_local_data_dir>/<version>/sidecar/bin[.exe]
        let data_dir = app
            .path()
            .app_local_data_dir()
            .map_err(|e| format!("app_local_data_dir: {e}"))?;
        let dir = data_dir.join(version).join("sidecar");
        let path = dir.join(format!("bin{ext}"));

        // Stale version cleanup is handled by kugou_api on startup.
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir sidecar: {}", e))?;

        let needs_extract = !path.exists();
        if needs_extract {
            log_to_ui(app, "info", &format!("extracting sidecar to {}", path.display()));
            std::fs::write(&path, SIDECAR_BIN).map_err(|e| format!("write sidecar: {}", e))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                    .map_err(|e| format!("chmod: {}", e))?;
            }
            #[cfg(target_os = "macos")]
            {
                let _ = std::process::Command::new("xattr").args(["-cr"]).arg(&path).output();
            }
        }
        Ok(path)
    }

    pub async fn spawn(&self, app: AppHandle) -> Result<(), String> {
        if self.stdin.lock().await.is_some() {
            return Ok(());
        }

        let path = Self::extract_to_temp(&app)?;
        log_to_ui(&app, "info", &format!("spawning sidecar: {}", path.display()));

        let mut cmd = Command::new(&path);
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .kill_on_drop(true)
            // Silence Node's DeprecationWarnings/process warnings from transitive deps
            // (e.g. legacy Buffer() usage in protobufjs). Keeps the UI log clean.
            .env("NODE_OPTIONS", "--no-deprecation --no-warnings");

        // Windows: pkg-compiled Node binaries are console-subsystem .exe files.
        // Without CREATE_NO_WINDOW the OS opens a cmd window for them, which the
        // user can close, killing the child and producing "pipe is being closed".
        #[cfg(windows)]
        {
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            cmd.creation_flags(CREATE_NO_WINDOW);
        }

        let mut child = cmd
            .spawn()
            .map_err(|e| format!("spawn {}: {}", path.display(), e))?;
        let stdout = child.stdout.take().ok_or("no stdout")?;
        let stderr = child.stderr.take().ok_or("no stderr")?;
        let stdin = child.stdin.take().ok_or("no stdin")?;

        *self.stdin.lock().await = Some(stdin);
        *self.pid.lock().await = child.id();

        // stdout: parse JSON, forward as sidecar-event.
        let app_out = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                    let _ = app_out.emit("sidecar-event", v);
                }
            }
        });

        // stderr: each line surfaces in the UI log panel.
        let app_err = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                log_to_ui(&app_err, "error", &format!("[stderr] {}", line));
            }
        });

        // Wait task: when the child exits, surface the exit code in the UI log
        // so 'broken pipe' is preceded by a clear cause line.
        let app_wait = app.clone();
        tauri::async_runtime::spawn(async move {
            match child.wait().await {
                Ok(status) => {
                    let code = status.code().map(|c| c.to_string()).unwrap_or_else(|| "signal".into());
                    log_to_ui(
                        &app_wait,
                        "error",
                        &format!("[sidecar] process exited (code={})", code),
                    );
                }
                Err(e) => log_to_ui(&app_wait, "error", &format!("[sidecar] wait failed: {}", e)),
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
            .map_err(|e| format!("write stdin: {}", e))?;
        stdin.flush().await.map_err(|e| format!("flush stdin: {}", e))?;
        Ok(())
    }
}

fn log_to_ui(app: &AppHandle, level: &str, msg: &str) {
    let ev = json!({ "event": "log", "level": level, "msg": msg });
    let _ = app.emit("sidecar-event", ev);
}

pub type SidecarState = Arc<SidecarHandle>;

#[tauri::command]
pub async fn sidecar_send(
    state: tauri::State<'_, SidecarState>,
    cmd: Value,
) -> Result<(), String> {
    state.send(cmd).await
}
