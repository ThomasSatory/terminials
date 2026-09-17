//! Gestion des PTY via portable-pty : ouverture, écriture, resize, et registre des PTY vivants.

use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::Mutex;

use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use terminials_core::activity::shell_integration::ShellLaunch;

pub type PtyId = u32;

/// Un PTY vivant : writer pour l'entrée, master pour le resize, child gardé vivant (+ son PID).
pub struct PtyHandle {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
    pub pid: Option<u32>,
    /// Gardé vivant pour ne pas tuer le process enfant.
    _child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct PtyRegistry {
    next: AtomicU32,
    pub handles: Mutex<HashMap<PtyId, PtyHandle>>,
}

impl PtyRegistry {
    pub fn new() -> Self {
        Self::default()
    }

    pub fn next_id(&self) -> PtyId {
        self.next.fetch_add(1, Ordering::SeqCst)
    }
}

/// Construit la commande du shell d'un pane.
/// TERM/COLORTERM sont déclarés explicitement et non hérités : lancé depuis un
/// lanceur .desktop, le process de l'app n'a aucun TERM, et un TERM absent fait
/// tomber dircolors (LS_COLORS vide → `ls` monochrome), git et la plupart des
/// outils en noir et blanc. xterm.js rend les 256 couleurs et le truecolor.
/// `launch` (intégration shell OSC 133) remplace le programme et pose ses arguments
/// et variables d'environnement ; `None` = shell nu, comportement historique.
fn build_shell_command(
    shell: &str,
    cwd: &str,
    workspace_id: &str,
    id: PtyId,
    launch: Option<&ShellLaunch>,
) -> CommandBuilder {
    let mut cmd = match launch {
        Some(l) => {
            let mut c = CommandBuilder::new(&l.program);
            for arg in &l.args {
                c.arg(arg);
            }
            for (k, v) in &l.env {
                c.env(k, v);
            }
            c
        }
        None => CommandBuilder::new(shell),
    };
    cmd.cwd(cwd);
    cmd.env("TERM", "xterm-256color");
    cmd.env("COLORTERM", "truecolor");
    cmd.env("TERMINIALS_WORKSPACE_ID", workspace_id);
    cmd.env("TERMINIALS_PTY_ID", id.to_string());
    cmd
}

/// Ouvre un PTY, lance `shell` dans `cwd`, enregistre le handle et retourne (id, reader).
/// Le reader est destiné à un thread lecteur dédié (lectures bloquantes).
/// Injecte TERMINIALS_WORKSPACE_ID / TERMINIALS_PTY_ID dans l'env du shell : la CLI
/// `terminials` les relit pour router notify/set-status/set-progress vers le
/// workspace émetteur (spec §7).
pub fn spawn_pty(
    reg: &PtyRegistry,
    shell: &str,
    cwd: &str,
    workspace_id: &str,
    cols: u16,
    rows: u16,
    launch: Option<&ShellLaunch>,
) -> std::io::Result<(PtyId, Box<dyn std::io::Read + Send>)> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    // L'id est réservé AVANT le spawn (simple compteur atomique) pour pouvoir
    // l'injecter dans l'env du shell. En cas d'échec du spawn, l'id est juste perdu.
    let id = reg.next_id();
    let cmd = build_shell_command(shell, cwd, workspace_id, id, launch);
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    drop(pair.slave);

    let pid = child.process_id();
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    reg.handles
        .lock()
        .unwrap()
        .insert(id, PtyHandle { writer, master: pair.master, pid, _child: child });
    Ok((id, reader))
}

pub fn write_pty(reg: &PtyRegistry, id: PtyId, data: &[u8]) -> std::io::Result<()> {
    let mut handles = reg.handles.lock().unwrap();
    let h = handles.get_mut(&id).ok_or_else(|| std::io::Error::other("pty introuvable"))?;
    h.writer.write_all(data)?;
    h.writer.flush()
}

pub fn resize_pty(reg: &PtyRegistry, id: PtyId, cols: u16, rows: u16) -> std::io::Result<()> {
    let handles = reg.handles.lock().unwrap();
    let h = handles.get(&id).ok_or_else(|| std::io::Error::other("pty introuvable"))?;
    h.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| std::io::Error::other(e.to_string()))
}

/// Ferme un PTY : retire le handle du registre. Le drop du child + master ferme le fd
/// esclave → EOF côté reader → le thread lecteur se termine naturellement.
pub fn close_pty(reg: &PtyRegistry, id: PtyId) {
    reg.handles.lock().unwrap().remove(&id);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_assigns_unique_incrementing_ids() {
        let reg = PtyRegistry::new();
        let a = reg.next_id();
        let b = reg.next_id();
        assert_ne!(a, b);
        assert_eq!(b, a + 1);
    }

    #[test]
    fn spawn_write_resize_roundtrip() {
        let reg = PtyRegistry::new();
        let (id, _reader) = spawn_pty(&reg, "/bin/sh", "/", "ws-test", 80, 24, None).unwrap();
        assert!(reg.handles.lock().unwrap().contains_key(&id));
        write_pty(&reg, id, b"echo hi\n").unwrap();
        resize_pty(&reg, id, 100, 30).unwrap();
    }

    #[test]
    fn spawn_injects_workspace_and_pty_ids_in_env() {
        use std::io::Read;
        let reg = PtyRegistry::new();
        let (id, mut reader) = spawn_pty(&reg, "/bin/sh", "/", "ws-test", 80, 24, None).unwrap();
        write_pty(&reg, id, b"echo ID=$TERMINIALS_WORKSPACE_ID:$TERMINIALS_PTY_ID; exit\n")
            .unwrap();
        // `exit` termine le shell → EOF : la boucle de lecture se termine toujours.
        let mut out = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => out.extend_from_slice(&buf[..n]),
            }
        }
        let text = String::from_utf8_lossy(&out);
        // L'écho du terminal contient la forme littérale `$TERMINIALS_…` ; seule la
        // sortie d'echo contient la forme développée `ID=ws-test:<id>`.
        assert!(text.contains(&format!("ID=ws-test:{id}")), "sortie du shell: {text}");
    }

    #[test]
    fn shell_command_declares_color_capable_term() {
        use std::io::Read;
        // Le builder hérite de l'env du process : on installe un env hostile
        // (TERM=dumb, aucun COLORTERM) pour vérifier que la déclaration explicite
        // gagne — sinon le test passerait par simple héritage du TERM du dev.
        std::env::set_var("TERM", "dumb");
        std::env::remove_var("COLORTERM");
        let cmd = build_shell_command("/bin/sh", "/", "ws-test", 7, None);
        assert_eq!(cmd.get_env("TERM").unwrap(), "xterm-256color");
        assert_eq!(cmd.get_env("COLORTERM").unwrap(), "truecolor");

        // Bout en bout : le shell réellement lancé voit bien ces valeurs.
        let reg = PtyRegistry::new();
        let (id, mut reader) = spawn_pty(&reg, "/bin/sh", "/", "ws-test", 80, 24, None).unwrap();
        write_pty(&reg, id, b"echo TERMCHECK=$TERM:$COLORTERM; exit\n").unwrap();
        let mut out = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => out.extend_from_slice(&buf[..n]),
            }
        }
        let text = String::from_utf8_lossy(&out);
        assert!(
            text.contains("TERMCHECK=xterm-256color:truecolor"),
            "sortie du shell: {text}"
        );
    }

    #[test]
    fn shell_command_injects_workspace_and_pty_ids() {
        let cmd = build_shell_command("/bin/sh", "/", "ws-test", 7, None);
        assert_eq!(cmd.get_env("TERMINIALS_WORKSPACE_ID").unwrap(), "ws-test");
        assert_eq!(cmd.get_env("TERMINIALS_PTY_ID").unwrap(), "7");
    }

    #[test]
    fn shell_command_applique_le_lancement_de_l_integration_shell() {
        use terminials_core::activity::shell_integration::launch_for;
        let launch = launch_for("/bin/bash", std::path::Path::new("/run/x")).unwrap();
        let cmd = build_shell_command("/bin/bash", "/", "w", 1, Some(&launch));
        let argv: Vec<String> =
            cmd.get_argv().iter().map(|s| s.to_string_lossy().into_owned()).collect();
        assert!(argv.iter().any(|a| a == "--init-file"), "argv: {argv:?}");
        assert!(argv.iter().any(|a| a == "/run/x/bash-init.sh"), "argv: {argv:?}");
        // Les variables propres à terminials restent posées malgré le lancement dédié.
        assert_eq!(cmd.get_env("TERMINIALS_PTY_ID").unwrap(), "1");
    }

    #[test]
    fn shell_command_applique_l_env_du_lancement_zsh() {
        use terminials_core::activity::shell_integration::launch_for;
        let launch = launch_for("/bin/zsh", std::path::Path::new("/run/x")).unwrap();
        let cmd = build_shell_command("/bin/zsh", "/", "w", 2, Some(&launch));
        assert_eq!(cmd.get_env("ZDOTDIR").unwrap(), "/run/x/zsh");
    }
}
