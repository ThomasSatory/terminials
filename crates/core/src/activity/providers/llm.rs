//! Rédaction des synthèses par le CLI `claude -p` local.
use crate::activity::providers::claude_process::{run_claude_p, ClaudeProcessError};
use std::time::Duration;

/// Modèle imposé à `claude -p`.
pub const MODELE_CLAUDE_CLI: &str = "sonnet";

#[derive(Debug, Clone, PartialEq)]
pub enum LlmError {
    /// `claude` introuvable ou impossible à lancer.
    Spawn(String),
    /// `claude -p` a rendu un code de sortie non nul.
    Failed {
        code: i32,
        stderr: String,
    },
    Timeout,
    Malformed(String),
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LlmError::Spawn(msg) => write!(f, "claude -p : {msg}"),
            LlmError::Failed { code, stderr } => {
                write!(f, "claude -p a échoué (code {code}) : {stderr}")
            }
            LlmError::Timeout => write!(f, "délai dépassé"),
            LlmError::Malformed(msg) => write!(f, "réponse inattendue : {msg}"),
        }
    }
}

impl std::error::Error for LlmError {}

/// Requête : message système + message utilisateur.
pub struct LlmRequest {
    pub system: String,
    pub user: String,
}

pub trait LlmProvider: Send + Sync {
    fn name(&self) -> String;
    fn complete(&self, req: &LlmRequest) -> Result<String, LlmError>;
}

/// Fournisseur basé sur le binaire `claude` en mode non interactif (`claude -p`).
///
/// `binary` permet de pointer vers un exécutable arbitraire (par défaut `"claude"`,
/// résolu via `PATH`) — utile pour les tests, qui évitent ainsi de manipuler la
/// variable d'environnement `PATH` partagée par tout le process de test.
pub struct ClaudeCli {
    pub timeout: Duration,
    pub binary: String,
}

/// Nom du fournisseur, tel qu'étiqueté sur une synthèse.
pub fn provider_name() -> String {
    format!("claude-cli:{MODELE_CLAUDE_CLI}")
}

/// Le fournisseur unique : `claude -p`, délai global de 120 s.
pub fn claude_cli() -> ClaudeCli {
    ClaudeCli {
        timeout: Duration::from_secs(120),
        binary: "claude".to_string(),
    }
}

impl LlmProvider for ClaudeCli {
    fn name(&self) -> String {
        provider_name()
    }

    fn complete(&self, req: &LlmRequest) -> Result<String, LlmError> {
        let input = format!("{}\n\n---\n\n{}", req.system, req.user);
        run_claude_p(
            &self.binary,
            &[
                "-p",
                "--model",
                MODELE_CLAUDE_CLI,
                "--output-format",
                "text",
            ],
            &input,
            self.timeout,
        )
        .map_err(|e| match e {
            ClaudeProcessError::Spawn(msg) => LlmError::Spawn(msg),
            ClaudeProcessError::Timeout => LlmError::Timeout,
            ClaudeProcessError::Failed { code, stderr } => LlmError::Failed { code, stderr },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn req() -> LlmRequest {
        LlmRequest {
            system: "sys".into(),
            user: "bonjour".into(),
        }
    }
    #[test]
    fn claude_cli_binaire_absent() {
        // On évite de manipuler `PATH` (variable globale au process, partagée par
        // tous les tests exécutés en parallèle) : `binary` pointe directement vers
        // un chemin inexistant, ce qui reproduit le même échec de spawn.
        let p = ClaudeCli {
            timeout: std::time::Duration::from_secs(2),
            binary: "/nonexistent/claude".into(),
        };
        assert!(matches!(p.complete(&req()), Err(LlmError::Spawn(_))));
    }
    #[test]
    fn claude_cli_impose_sonnet() {
        // `claude -p` tourne toujours sur Sonnet.
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let chemin = dir.path().join("faux-claude");
        std::fs::write(&chemin, "#!/bin/sh\necho \"$*\"\n").unwrap();
        std::fs::set_permissions(&chemin, std::fs::Permissions::from_mode(0o755)).unwrap();
        let p = ClaudeCli {
            timeout: std::time::Duration::from_secs(10),
            binary: chemin.display().to_string(),
        };
        let mut args = p.complete(&req());
        // Les tests tournent en parallèle : un fils forké ailleurs peut tenir
        // brièvement le descripteur d'écriture du script (`ETXTBSY`).
        for _ in 0..20 {
            match &args {
                Err(LlmError::Spawn(msg)) if msg.contains("os error 26") => {
                    std::thread::sleep(Duration::from_millis(50));
                    args = p.complete(&req());
                }
                _ => break,
            }
        }
        let args = args.unwrap();
        assert!(args.contains("--model sonnet"), "{args}");
        assert_eq!(p.name(), "claude-cli:sonnet");
    }
}
