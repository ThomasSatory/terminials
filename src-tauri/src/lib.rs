mod notify;
mod pty;
mod socket;

use std::io::Read;
use std::sync::Arc;
use std::thread;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Emitter, State};

use crate::pty::{PtyId, PtyRegistry};

/// Lance un PTY et câble sa sortie brute vers le front via `on_data` (octets bruts).
/// Le flux est aussi scanné pour les notifications OSC 9/99/777.
// Les args sont désérialisés par nom depuis le front ; les regrouper en struct compliquerait l'appel JS.
#[allow(clippy::too_many_arguments)]
#[tauri::command]
fn spawn_pty(
    app: tauri::AppHandle,
    reg: State<'_, Arc<PtyRegistry>>,
    workspace_id: String,
    shell: String,
    cwd: String,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
) -> Result<PtyId, String> {
    let (id, mut reader) =
        pty::spawn_pty(reg.inner(), &shell, &cwd, cols, rows).map_err(|e| e.to_string())?;

    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut scanner = terminials_core::osc::OscScanner::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let chunk = &buf[..n];
                    // Scanner à état : gère les séquences OSC réparties sur plusieurs lectures.
                    for notif in scanner.feed(chunk) {
                        let _ = app.emit(
                            "agent-notification",
                            serde_json::json!({
                                "workspaceId": workspace_id,
                                "title": notif.title,
                                "body": notif.body,
                            }),
                        );
                        notify::fire(&app, &notif.title, &notif.body);
                    }
                    if on_data.send(InvokeResponseBody::Raw(chunk.to_vec())).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        let _ = app.emit("pty-exit", serde_json::json!({ "id": id }));
    });

    Ok(id)
}

#[tauri::command]
fn write_pty(reg: State<'_, Arc<PtyRegistry>>, id: PtyId, data: Vec<u8>) -> Result<(), String> {
    pty::write_pty(reg.inner(), id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn resize_pty(
    reg: State<'_, Arc<PtyRegistry>>,
    id: PtyId,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    pty::resize_pty(reg.inner(), id, cols, rows).map_err(|e| e.to_string())
}

#[tauri::command]
fn close_pty(reg: State<'_, Arc<PtyRegistry>>, id: PtyId) {
    pty::close_pty(reg.inner(), id);
}

#[tauri::command]
fn git_info(cwd: String) -> terminials_core::git::GitInfo {
    terminials_core::git::git_info(&cwd)
}

#[tauri::command]
fn git_changed_files(cwd: String) -> Vec<terminials_core::git::ChangedFile> {
    terminials_core::git::changed_files(&cwd)
}

#[tauri::command]
fn git_file_diff(cwd: String, path: String, staged: bool) -> String {
    terminials_core::git::file_diff(&cwd, &path, staged)
}

/// Existence d'un dossier (validation des cwd restaurés au boot).
#[tauri::command]
fn dir_exists(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}

#[tauri::command]
fn workspace_ports(reg: State<'_, Arc<PtyRegistry>>, pty_id: PtyId) -> Vec<u16> {
    let handles = reg.handles.lock().unwrap();
    match handles.get(&pty_id).and_then(|h| h.pid) {
        Some(pid) => terminials_core::ports::listening_ports(pid),
        None => vec![],
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Arc::new(PtyRegistry::new()))
        .invoke_handler(tauri::generate_handler![
            spawn_pty,
            write_pty,
            resize_pty,
            close_pty,
            git_info,
            git_changed_files,
            git_file_diff,
            dir_exists,
            workspace_ports
        ])
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                if let Err(e) = socket::serve(handle).await {
                    eprintln!("serveur socket arrêté: {e}");
                }
            });
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|_app, event| {
            if let tauri::RunEvent::Exit = event {
                let _ = std::fs::remove_file(socket::socket_path());
            }
        });
}
