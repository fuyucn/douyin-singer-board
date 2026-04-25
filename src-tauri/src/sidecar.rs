// Node sidecar process management.
//
// Modes:
// - dev: locate ../sidecar/build/index.cjs and run with the system `node`
// - release: use tauri-plugin-shell's sidecar API to run the bundled binary
//   (binaries built by sidecar/scripts/build-bin.mjs, externalBin in tauri.conf.json)
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

pub struct SidecarHandle {
    child: Mutex<Option<CommandChild>>,
}

impl SidecarHandle {
    pub fn new() -> Self {
        Self {
            child: Mutex::new(None),
        }
    }

    fn locate_dev_script() -> Option<PathBuf> {
        let cwd = std::env::current_dir().ok()?;
        let candidates = [
            cwd.join("../sidecar/build/index.cjs"),
            cwd.join("sidecar/build/index.cjs"),
        ];
        candidates.into_iter().find(|p| p.exists())
    }

    pub async fn spawn(&self, app: AppHandle) -> Result<(), String> {
        let mut child_lock = self.child.lock().await;
        if child_lock.is_some() {
            return Ok(());
        }

        // Prefer the bundled sidecar binary (release); fall back to `node ../sidecar/build/index.cjs` (dev)
        let cmd = if let Ok(c) = app.shell().sidecar("sidecar") {
            c
        } else if let Some(script) = Self::locate_dev_script() {
            app.shell()
                .command("node")
                .args([script.to_string_lossy().as_ref()])
        } else {
            return Err(
                "no sidecar binary or dev script found. dev: `pnpm sidecar:build`; release: `pnpm sidecar:build:bin`"
                    .to_string(),
            );
        };

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
