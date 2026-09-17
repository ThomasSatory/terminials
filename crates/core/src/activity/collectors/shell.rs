//! Collecteur d'événements `shell_cmd` à partir de l'intégration shell : apparie les
//! marqueurs OSC 133 C (pré-exécution) et D (fin) émis par les shims bash/zsh.
use std::collections::HashMap;

use crate::activity::{EventKind, NewEvent};

struct Pending {
    cmd: String,
    pwd: String,
    started_ms: i64,
}

/// Apparie, par pty, un marqueur C (commande + répertoire) avec le D (code de sortie)
/// suivant, et produit l'événement `shell_cmd` correspondant.
pub struct ShellPairer {
    pending: HashMap<u32, Pending>,
}

impl ShellPairer {
    pub fn new() -> Self {
        Self { pending: HashMap::new() }
    }

    /// Marqueur C reçu : remplace toute commande en attente non appariée pour ce pty.
    pub fn on_command(&mut self, pty: u32, cmd: &str, pwd: &str, now_ms: i64) {
        self.pending.insert(
            pty,
            Pending { cmd: cmd.to_string(), pwd: pwd.to_string(), started_ms: now_ms },
        );
    }

    /// Marqueur D reçu : apparie avec le C en attente du même pty. `None` si D orphelin
    /// (aucun C en attente) ou si la commande est vide/ignorée (premier mot dans `ignored`).
    pub fn on_exit(&mut self, pty: u32, code: i32, now_ms: i64, ignored: &[String]) -> Option<NewEvent> {
        let pending = self.pending.remove(&pty)?;
        let cmd = pending.cmd.trim();
        if cmd.is_empty() {
            return None;
        }
        if let Some(first) = cmd.split_whitespace().next() {
            if ignored.iter().any(|i| i == first) {
                return None;
            }
        }
        let duration_ms = now_ms - pending.started_ms;
        let body = serde_json::json!({ "exit": code, "durationMs": duration_ms }).to_string();
        Some(NewEvent {
            ts: pending.started_ms / 1000,
            kind: EventKind::ShellCmd,
            workspace_dir: Some(pending.pwd),
            branch: None,
            title: cmd.to_string(),
            body: Some(body),
            ticket_ids: vec![],
            source_ref: format!("{pty}:{}", pending.started_ms),
        })
    }

    /// Oublie toute commande en attente pour ce pty (ex. fermeture de l'onglet).
    pub fn forget(&mut self, pty: u32) {
        self.pending.remove(&pty);
    }
}

impl Default for ShellPairer {
    fn default() -> Self {
        Self::new()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn apparie_c_puis_d_et_calcule_la_duree() {
        let mut p = ShellPairer::new();
        p.on_command(3, "npm test", "/home/t/dev/a", 1_000_000);
        let e = p.on_exit(3, 1, 1_004_500, &[]).unwrap();
        assert_eq!(e.title, "npm test");
        assert_eq!(e.ts, 1000);
        assert_eq!(e.workspace_dir.as_deref(), Some("/home/t/dev/a"));
        assert_eq!(e.source_ref, "3:1000000");
        assert_eq!(e.body.as_deref(), Some(r#"{"durationMs":4500,"exit":1}"#));
        assert!(p.on_exit(3, 0, 1_005_000, &[]).is_none(), "D orphelin ignoré");
    }

    #[test]
    fn commande_ignoree_par_premier_mot_et_par_pty() {
        let mut p = ShellPairer::new();
        p.on_command(1, "ls -la", "/x", 10);
        p.on_command(2, "git status", "/x", 10);
        assert!(p.on_exit(1, 0, 20, &["ls".into()]).is_none());
        assert_eq!(p.on_exit(2, 0, 20, &["ls".into()]).unwrap().title, "git status");
    }

    #[test]
    fn commande_vide_ou_espaces_ignoree() {
        let mut p = ShellPairer::new();
        p.on_command(1, "   ", "/x", 10);
        assert!(p.on_exit(1, 0, 20, &[]).is_none());
    }
}
