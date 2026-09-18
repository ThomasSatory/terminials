//! Exécution partagée du binaire `claude` en mode non interactif (`claude -p`).
//!
//! Deux fournisseurs s'en servent : les synthèses (`llm::ClaudeCli`) et la
//! collecte ClickUp via les outils MCP (`clickup::ClickupMcp`). Le prompt part
//! **toujours** par stdin : plusieurs options de `claude` sont variadiques
//! (`--allowedTools`) et avaleraient un prompt passé en argument positionnel.

use std::time::Duration;

#[derive(Debug, Clone, PartialEq)]
pub enum ClaudeProcessError {
    /// Le binaire n'a pas pu être lancé (absent du `PATH`, non exécutable…).
    Spawn(String),
    /// Le délai maximum a été atteint ; le process a été tué.
    Timeout,
    /// Code de sortie non nul. `stderr` est tronqué à 500 caractères.
    Failed { code: i32, stderr: String },
}

impl std::fmt::Display for ClaudeProcessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClaudeProcessError::Spawn(msg) => write!(f, "claude introuvable : {msg}"),
            ClaudeProcessError::Timeout => write!(f, "délai dépassé"),
            ClaudeProcessError::Failed { code, stderr } => write!(f, "claude a échoué (code {code}) : {stderr}"),
        }
    }
}

impl std::error::Error for ClaudeProcessError {}

/// Lance `binary args…`, écrit `input` sur son stdin, et rend son stdout écourté
/// des espaces de bord.
///
/// `stderr` n'est lu que pour être rapporté en cas d'échec : `claude` y écrit un
/// avertissement « MCP servers blocked by enterprise policy » même quand tout va
/// bien, qu'il ne faut pas confondre avec une erreur.
pub fn run_claude_p(
    binary: &str,
    args: &[&str],
    input: &str,
    timeout: Duration,
) -> Result<String, ClaudeProcessError> {
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};

    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ClaudeProcessError::Spawn(e.to_string()))?;

    if let Some(mut stdin) = child.stdin.take() {
        // Écriture dans un thread séparé : un prompt plus gros que le tampon du
        // tube (64 Kio) bloquerait sinon le parent pendant que l'enfant attend,
        // lui, que son propre stdout soit lu.
        let bytes = input.as_bytes().to_vec();
        std::thread::spawn(move || {
            let _ = stdin.write_all(&bytes);
        });
    }
    let lecteur = |flux: Option<std::process::ChildStdout>| {
        flux.map(|mut f| {
            std::thread::spawn(move || {
                let mut buf = String::new();
                let _ = f.read_to_string(&mut buf);
                buf
            })
        })
    };
    let stdout_lu = lecteur(child.stdout.take());
    let stderr_lu = child.stderr.take().map(|mut f| {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = f.read_to_string(&mut buf);
            buf
        })
    });

    let debut = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if debut.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(ClaudeProcessError::Timeout);
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(ClaudeProcessError::Spawn(e.to_string())),
        }
    };

    let stdout = stdout_lu.and_then(|h| h.join().ok()).unwrap_or_default();
    let stderr = stderr_lu.and_then(|h| h.join().ok()).unwrap_or_default();

    if !status.success() {
        return Err(ClaudeProcessError::Failed {
            code: status.code().unwrap_or(-1),
            stderr: stderr.chars().take(500).collect(),
        });
    }
    Ok(stdout.trim().to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Écrit un script shell exécutable dans `dir` et rend son chemin.
    fn faux_binaire(dir: &std::path::Path, nom: &str, corps: &str) -> String {
        use std::os::unix::fs::PermissionsExt;
        let chemin = dir.join(nom);
        std::fs::write(&chemin, format!("#!/bin/sh\n{corps}\n")).unwrap();
        std::fs::set_permissions(&chemin, std::fs::Permissions::from_mode(0o755)).unwrap();
        chemin.display().to_string()
    }

    /// `run_claude_p` en réessayant sur `ETXTBSY` (« Text file busy »). Les tests
    /// tournent en parallèle : un autre thread peut être en train de forker
    /// pendant que nous écrivons un faux binaire, et le fils hérite brièvement du
    /// descripteur en écriture, ce qui interdit d'exécuter ce fichier. Le cas ne
    /// concerne que les faux binaires créés à la volée, jamais le vrai `claude`.
    fn lancer(bin: &str, args: &[&str], input: &str, timeout: Duration) -> Result<String, ClaudeProcessError> {
        for _ in 0..20 {
            match run_claude_p(bin, args, input, timeout) {
                Err(ClaudeProcessError::Spawn(msg)) if msg.contains("os error 26") => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                autre => return autre,
            }
        }
        run_claude_p(bin, args, input, timeout)
    }

    #[test]
    fn transmet_les_arguments_et_le_prompt_par_stdin() {
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_binaire(dir.path(), "faux-claude", r#"echo "args=$*"; echo "stdin=$(cat)""#);
        let sortie = lancer(&bin, &["-p", "--model", "sonnet"], "bonjour", Duration::from_secs(10)).unwrap();
        assert!(sortie.contains("args=-p --model sonnet"), "{sortie}");
        assert!(sortie.contains("stdin=bonjour"), "{sortie}");
    }

    #[test]
    fn code_de_sortie_non_nul_devient_failed_avec_stderr() {
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_binaire(dir.path(), "faux-claude", "echo 'boum' >&2; exit 3");
        match lancer(&bin, &[], "", Duration::from_secs(10)) {
            Err(ClaudeProcessError::Failed { code, stderr }) => {
                assert_eq!(code, 3);
                assert!(stderr.contains("boum"), "{stderr}");
            }
            autre => panic!("attendu Failed, obtenu {autre:?}"),
        }
    }

    #[test]
    fn stderr_bavard_avec_code_zero_reste_un_succes() {
        // `claude` écrit « MCP servers blocked by enterprise policy » sur stderr
        // même quand la commande réussit : ce n'est pas une erreur.
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_binaire(dir.path(), "faux-claude", "echo 'MCP servers blocked by enterprise policy' >&2; echo '{\"ok\":1}'");
        assert_eq!(lancer(&bin, &[], "", Duration::from_secs(10)).unwrap(), "{\"ok\":1}");
    }

    #[test]
    fn binaire_absent_devient_spawn() {
        // On évite de manipuler `PATH` (global au process de test) : un chemin
        // inexistant reproduit le même échec de lancement.
        assert!(matches!(
            run_claude_p("/nonexistent/claude", &[], "", Duration::from_secs(2)),
            Err(ClaudeProcessError::Spawn(_))
        ));
    }

    #[test]
    fn depassement_du_delai_tue_le_process() {
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_binaire(dir.path(), "faux-claude", "sleep 30");
        assert_eq!(
            lancer(&bin, &[], "", Duration::from_millis(300)),
            Err(ClaudeProcessError::Timeout)
        );
    }

    #[test]
    fn un_gros_prompt_ne_bloque_pas_sur_le_tube() {
        // Prompt plus gros que le tampon d'un tube (64 Kio) : l'écriture doit se
        // faire dans un thread, sinon parent et enfant s'attendent mutuellement.
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_binaire(dir.path(), "faux-claude", "wc -c");
        let prompt = "x".repeat(300_000);
        let sortie = lancer(&bin, &[], &prompt, Duration::from_secs(10)).unwrap();
        assert_eq!(sortie.trim(), "300000");
    }
}
