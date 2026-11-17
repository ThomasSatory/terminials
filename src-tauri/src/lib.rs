mod activity;
mod hooks;
mod images;
mod notify;
mod pont;
mod pty;
mod reglages;
mod socket;
mod superviseur;

use std::io::Read;
use std::sync::Arc;
use std::thread;

use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Emitter, Manager, State};

use terminials_core::activity::shell_integration::launch_for;
use terminials_core::osc::OscEvent;

use crate::activity::ActivityState;
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
    // Intégration shell (OSC 133) : shims posés au démarrage et drapeau activé.
    let st = app.state::<Arc<ActivityState>>().inner().clone();
    let integration = activity::integration_shell_active(&st);
    let launch = st
        .shims_dir
        .as_ref()
        .filter(|_| integration)
        .and_then(|dir| launch_for(&shell, dir));

    let (id, mut reader) = pty::spawn_pty(
        reg.inner(),
        &shell,
        &cwd,
        &workspace_id,
        cols,
        rows,
        launch.as_ref(),
    )
    .map_err(|e| e.to_string())?;

    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        let mut scanner = terminials_core::osc::OscScanner::new();
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    let chunk = &buf[..n];
                    // Scanner à état : gère les séquences OSC réparties sur plusieurs lectures.
                    for event in scanner.feed_events(chunk) {
                        match event {
                            OscEvent::Notification(notif) => {
                                let _ = app.emit(
                                    "agent-notification",
                                    serde_json::json!({
                                        "workspaceId": workspace_id,
                                        "ptyId": id,
                                        "title": notif.title,
                                        "body": notif.body,
                                    }),
                                );
                                notify::fire(&app, &notif.title, &notif.body);
                            }
                            OscEvent::Command { cmd, pwd } => {
                                activity::on_shell_command(&st, id, &cmd, &pwd);
                            }
                            OscEvent::Exit { code } => {
                                activity::on_shell_exit(&st, id, code);
                            }
                        }
                    }
                    if on_data
                        .send(InvokeResponseBody::Raw(chunk.to_vec()))
                        .is_err()
                    {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
        activity::on_pty_closed(&st, id);
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

/// Sonde branche seule : gratuite (lit .git/HEAD). Sondée à intervalle fixe.
#[tauri::command]
fn git_branch(cwd: String) -> Option<String> {
    terminials_core::git::branch(&cwd)
}

/// Sonde dirty seule : chère (lstat de chaque fichier suivi). Le front l'espace
/// selon son coût mesuré — ne jamais la câbler sur un intervalle fixe.
#[tauri::command]
fn git_dirty(cwd: String) -> bool {
    terminials_core::git::is_dirty(&cwd)
}

/// Sonde dirty avec le nombre de fichiers modifiés : même coût que `git_dirty` (un seul
/// `git status`), elle tient aussi le compteur du bouton ± à jour. Même règle d'espacement.
#[tauri::command]
fn git_dirty_count(cwd: String) -> u32 {
    terminials_core::git::dirty_count(&cwd)
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

/// Dossier courant du shell d'un PTY : un nouvel onglet démarre là.
#[tauri::command]
fn pty_cwd(reg: State<'_, Arc<PtyRegistry>>, pty_id: PtyId) -> Option<String> {
    let pid = reg.handles.lock().unwrap().get(&pty_id)?.pid?;
    terminials_core::cwd::process_cwd(pid)?
        .into_os_string()
        .into_string()
        .ok()
}

/// Colle le presse-papier dans l'élément qui a le focus (le terminal, via le textarea de
/// xterm qui reçoit alors un événement `paste`), par la commande d'édition de la webview :
/// celle du menu natif que remplace le menu « Copier / Coller » du terminal. La lecture du
/// presse-papier par la page (navigator.clipboard) est refusée par WebKitGTK.
#[tauri::command]
fn coller_presse_papier(webview: tauri::Webview) -> Result<(), String> {
    #[cfg(target_os = "linux")]
    webview
        .with_webview(|w| {
            use webkit2gtk::WebViewExt;
            w.inner().execute_editing_command("Paste");
        })
        .map_err(|e| e.to_string())?;
    #[cfg(not(target_os = "linux"))]
    let _ = webview;
    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(Arc::new(PtyRegistry::new()))
        .manage(Arc::new(activity::init()))
        .manage(Arc::new(pont::Pont::new()))
        .manage(Arc::new(superviseur::init()))
        .invoke_handler(tauri::generate_handler![
            spawn_pty,
            write_pty,
            resize_pty,
            close_pty,
            git_info,
            git_branch,
            git_dirty,
            git_dirty_count,
            git_changed_files,
            git_file_diff,
            dir_exists,
            workspace_ports,
            pty_cwd,
            coller_presse_papier,
            images::save_pasted_image,
            activity::activity_register_workspaces,
            activity::activity_collect_now,
            activity::activity_query,
            activity::activity_stats,
            activity::activity_summary,
            activity::activity_summary_cached,
            activity::activity_open_tasks,
            activity::activity_reunion_us,
            activity::activity_reunions,
            activity::activity_saisies,
            activity::activity_saisir_temps,
            activity::activity_status,
            activity::activity_get_settings,
            activity::activity_set_settings,
            // Pont requête/réponse des outils (socket ↔ front).
            pont::outil_repondre,
            notify::notifier_systeme,
            // Réglages de l'application (vue Paramètres).
            reglages::reglages_lire,
            reglages::reglages_ecrire,
            reglages::reglages_infos,
            // Hooks Claude Code (Paramètres › Agents et notifications).
            hooks::hooks_etat,
            hooks::hooks_installer,
            // Superviseur.
            superviseur::superviseur_signaler,
            superviseur::superviseur_etat,
            superviseur::superviseur_interrompre,
            superviseur::superviseur_nouvelle_session
        ])
        .setup(|app| {
            activity::start_scheduler(app.handle().clone());
            // Le moteur ne lance rien tant que le superviseur n'est pas activé.
            superviseur::demarrer(app.handle().clone());
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
        .run(|app, event| {
            if let tauri::RunEvent::Exit = event {
                superviseur::arreter(app);
                let _ = std::fs::remove_file(socket::socket_path());
            }
        });
}
