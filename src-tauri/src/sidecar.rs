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

use process_wrap::tokio::*;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{ChildStdin, Command};
use tokio::sync::Mutex;

use crate::kugou_api::KugouApiState;

const SIDECAR_BIN: &[u8] = include_bytes!(concat!(env!("OUT_DIR"), "/sidecar.bin"));

fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let mut hasher = Sha256::new();
    hasher.update(data);
    hasher
        .finalize()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

pub struct SidecarHandle {
    stdin: Mutex<Option<ChildStdin>>,
    child: Mutex<Option<Box<dyn ChildWrapper>>>,
}

impl SidecarHandle {
    pub fn new() -> Self {
        Self {
            stdin: Mutex::new(None),
            child: Mutex::new(None),
        }
    }

    /// True when the child process is still alive and stdin is writable.
    /// A killed/exited sidecar cannot host the kugou server, so callers can
    /// treat "not running" as an already-stopped state.
    pub async fn is_running(&self) -> bool {
        self.stdin.lock().await.is_some()
    }

    /// Explicitly kill the child process, then drop the wrapper.
    /// On Windows the Job Object cleanup fires; on Unix KillOnDrop sends SIGKILL.
    /// We also briefly wait so the child is reaped before we return.
    pub async fn kill(&self) {
        let mut child_opt = self.child.lock().await;
        if let Some(mut child) = child_opt.take() {
            let _ = child.start_kill();
            // Best-effort wait so the OS reaps the child before we return.
            let _ = tokio::time::timeout(std::time::Duration::from_millis(500), child.wait()).await;
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
        let stamp_path = dir.join(format!("bin{ext}.sha256"));
        let expected_stamp = sha256_hex(SIDECAR_BIN);

        // Clean up stale version directories from older releases.
        if let Ok(entries) = std::fs::read_dir(&data_dir) {
            for entry in entries.flatten() {
                let name = entry.file_name();
                let name = name.to_string_lossy();
                if entry.path().is_dir() {
                    if name != version {
                        let _ = std::fs::remove_dir_all(entry.path());
                    } else if entry.path().join("kugou-api").exists() {
                        // Old releases extracted a separate kugou-api binary into
                        // <version>/kugou-api; the server now lives inside the
                        // sidecar, so remove the dead ~55MB binary.
                        let _ = std::fs::remove_dir_all(entry.path().join("kugou-api"));
                    }
                } else if name.starts_with("kugou-api-") {
                    // Even older releases extracted kugou-api into the data dir root.
                    let _ = std::fs::remove_file(entry.path());
                }
            }
        }
        std::fs::create_dir_all(&dir).map_err(|e| format!("mkdir sidecar: {}", e))?;

        // Re-extract when the embedded binary changed even if the path exists,
        // so a same-version upgrade does not keep running a stale sidecar.
        let needs_extract = {
            let stamp_matches = std::fs::read_to_string(&stamp_path)
                .map(|s| s.trim() == expected_stamp)
                .unwrap_or(false);
            !stamp_matches
        };
        if needs_extract {
            let msg = if path.exists() {
                "sidecar binary changed, re-extracting".to_string()
            } else {
                format!("extracting sidecar to {}", path.display())
            };
            log_to_ui(app, "info", &msg);
            std::fs::write(&path, SIDECAR_BIN).map_err(|e| format!("write sidecar: {}", e))?;
            std::fs::write(&stamp_path, &expected_stamp)
                .map_err(|e| format!("write sidecar stamp: {}", e))?;
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755))
                    .map_err(|e| format!("chmod: {}", e))?;
            }
            #[cfg(target_os = "macos")]
            {
                let _ = std::process::Command::new("xattr")
                    .args(["-cr"])
                    .arg(&path)
                    .output();
            }
        } else {
            // Ensure the extracted file is still executable even when it was
            // copied by a non-unix extraction path.
            #[cfg(unix)]
            {
                use std::os::unix::fs::PermissionsExt;
                let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o755));
            }
        }
        Ok(path)
    }

    pub async fn spawn(&self, app: AppHandle) -> Result<(), String> {
        if self.stdin.lock().await.is_some() {
            return Ok(());
        }

        // Dev hot-reload: if SIDECAR_DEV_PATH is set, spawn `node <path>`
        // directly instead of extracting the embedded binary. The script
        // self-restarts when esbuild --watch rebuilds it (see sidecar/index.ts).
        let dev_path = std::env::var("SIDECAR_DEV_PATH").ok();
        let mut cmd = if let Some(ref dev) = dev_path {
            log_to_ui(&app, "info", &format!("dev: spawning node {}", dev));
            let mut c = Command::new("node");
            c.arg(dev);
            c.env("SIDECAR_DEV", "1");
            c
        } else {
            let path = Self::extract_to_temp(&app)?;
            log_to_ui(
                &app,
                "info",
                &format!("spawning sidecar: {}", path.display()),
            );
            Command::new(&path)
        };
        cmd.stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .env("NODE_OPTIONS", "--no-deprecation --no-warnings");

        // Bind entire process tree via Job Object (Windows) / process group (Unix).
        // CreationFlags MUST come before JobObject so our CREATE_NO_WINDOW is
        // merged into JobObject's CREATE_SUSPENDED in pre_spawn.
        // KillOnDrop ensures the child is killed (whole group on Unix) when the
        // wrapper is dropped — without it, orphaned sidecar processes pile up.
        let mut wrap = CommandWrap::from(cmd);
        #[cfg(windows)]
        {
            use windows::Win32::System::Threading::PROCESS_CREATION_FLAGS;
            const CREATE_NO_WINDOW: u32 = 0x08000000;
            wrap.wrap(CreationFlags(PROCESS_CREATION_FLAGS(CREATE_NO_WINDOW)));
            wrap.wrap(JobObject);
        }
        #[cfg(unix)]
        wrap.wrap(ProcessGroup::leader());
        wrap.wrap(KillOnDrop);

        let mut child = wrap.spawn().map_err(|e| format!("spawn: {}", e))?;

        let stdout = child.stdout().take().ok_or("no stdout")?;
        let stderr = child.stderr().take().ok_or("no stderr")?;
        let stdin = child.stdin().take().ok_or("no stdin")?;

        *self.stdin.lock().await = Some(stdin);

        // stdout: parse JSON, forward as sidecar-event.
        // On EOF (process exit), reset state and emit crash event for frontend recovery.
        let app_out = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stdout).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                if let Ok(v) = serde_json::from_str::<Value>(line.trim()) {
                    let _ = app_out.emit("sidecar-event", v);
                }
            }
            // EOF: sidecar process exited
            log_to_ui(&app_out, "warn", "[sidecar] process exited (stdout EOF)");
            if let Some(state) = app_out.try_state::<SidecarState>() {
                *state.stdin.lock().await = None;
                *state.child.lock().await = None;
            }
            if let Some(kugou) = app_out.try_state::<KugouApiState>() {
                kugou.reset().await;
            }
            let _ = app_out.emit("sidecar-event", json!({ "event": "crashed" }));
        });

        // stderr: each line surfaces in the UI log panel.
        let app_err = app.clone();
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stderr).lines();
            while let Ok(Some(line)) = reader.next_line().await {
                log_to_ui(&app_err, "error", &format!("[stderr] {}", line));
            }
        });

        // Store child to keep Job Object / process group handle alive.
        *self.child.lock().await = Some(child);

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
        stdin
            .flush()
            .await
            .map_err(|e| format!("flush stdin: {}", e))?;
        Ok(())
    }
}

fn log_to_ui(app: &AppHandle, level: &str, msg: &str) {
    let ev = json!({ "event": "log", "level": level, "msg": msg });
    let _ = app.emit("sidecar-event", ev);
}

pub type SidecarState = Arc<SidecarHandle>;

#[tauri::command]
pub async fn sidecar_send(state: tauri::State<'_, SidecarState>, cmd: Value) -> Result<(), String> {
    state.send(cmd).await
}

#[tauri::command]
pub async fn sidecar_respawn(
    state: tauri::State<'_, SidecarState>,
    kugou: tauri::State<'_, KugouApiState>,
    app: AppHandle,
) -> Result<(), String> {
    state.spawn(app.clone()).await?;
    if kugou.is_enabled().await {
        kugou.spawn(app, state.inner()).await?;
    }
    Ok(())
}
