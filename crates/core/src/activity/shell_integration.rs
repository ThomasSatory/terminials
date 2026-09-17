//! Intégration shell : shims bash/zsh qui émettent OSC 133 C (pré-exécution) et D (fin).
//! Chargés en base64 pour ne jamais casser le parseur OSC (spec §4).
//! Limite v1 : le trap DEBUG capture la PREMIÈRE commande simple de la ligne
//! (`cd x && npm test` → `cd x`).
use std::path::{Path, PathBuf};

pub const BASH_SHIM: &str = r#"# terminials : intégration shell (bash). Source le rc utilisateur puis pose les hooks.
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
__tm_b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
__tm_preexec() {
  [ -n "$COMP_LINE" ] && return
  [ -n "$__tm_armed" ] || return
  case "$BASH_COMMAND" in __tm_*) return;; esac
  __tm_armed=
  printf '\033]133;C;%s;%s\007' "$(__tm_b64 "$BASH_COMMAND")" "$(__tm_b64 "$PWD")"
}
# Début de PROMPT_COMMAND : capture $? AVANT les hooks utilisateur. Fin : réarme.
__tm_precmd_start() { local code=$?; [ -z "$__tm_armed" ] && printf '\033]133;D;%s\007' "$code"; }
__tm_precmd_end() { __tm_armed=1; }
trap '__tm_preexec' DEBUG
PROMPT_COMMAND="__tm_precmd_start${PROMPT_COMMAND:+;$PROMPT_COMMAND};__tm_precmd_end"
"#;

pub const ZSHENV_SHIM: &str = r#"# terminials : rétablit ZDOTDIR utilisateur puis source son .zshenv
ZDOTDIR="$HOME"
[ -f "$HOME/.zshenv" ] && . "$HOME/.zshenv"
"#;

pub const ZSHRC_SHIM: &str = r#"# terminials : intégration shell (zsh)
[ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc"
__tm_b64() { printf '%s' "$1" | base64 | tr -d '\n' }
__tm_preexec() { printf '\033]133;C;%s;%s\007' "$(__tm_b64 "$1")" "$(__tm_b64 "$PWD")"; __tm_ran=1 }
__tm_precmd() { local code=$?; [ -n "$__tm_ran" ] && printf '\033]133;D;%s\007' "$code"; __tm_ran= }
autoload -Uz add-zsh-hook
add-zsh-hook preexec __tm_preexec
add-zsh-hook precmd __tm_precmd
"#;

/// Commande complète (programme + arguments + variables d'environnement) à lancer pour
/// obtenir un shell interactif avec l'intégration OSC 133 posée.
pub struct ShellLaunch {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// Répertoire par défaut où écrire les shims : `$XDG_RUNTIME_DIR/terminials/shell` si
/// disponible, sinon un dossier temporaire par utilisateur.
pub fn default_shims_dir() -> PathBuf {
    match std::env::var("XDG_RUNTIME_DIR") {
        Ok(d) if !d.is_empty() => PathBuf::from(d).join("terminials").join("shell"),
        _ => std::env::temp_dir()
            .join(format!("terminials-{}", std::env::var("UID").unwrap_or_else(|_| "u".into())))
            .join("shell"),
    }
}

/// Écrit les shims bash et zsh dans `dir` (créé si besoin, y compris le sous-dossier `zsh`).
pub fn install_shims(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir.join("zsh"))?;
    std::fs::write(dir.join("bash-init.sh"), BASH_SHIM)?;
    std::fs::write(dir.join("zsh").join(".zshenv"), ZSHENV_SHIM)?;
    std::fs::write(dir.join("zsh").join(".zshrc"), ZSHRC_SHIM)?;
    Ok(())
}

/// Commande à lancer pour `shell` avec l'intégration posée ; `None` si le shell n'est pas
/// pris en charge (la commande d'origine reste alors inchangée).
pub fn launch_for(shell: &str, shims_dir: &Path) -> Option<ShellLaunch> {
    let name = shell.rsplit('/').next().unwrap_or(shell);
    match name {
        "bash" => Some(ShellLaunch {
            program: shell.into(),
            args: vec![
                "--init-file".into(),
                shims_dir.join("bash-init.sh").to_string_lossy().into_owned(),
            ],
            env: vec![],
        }),
        "zsh" => Some(ShellLaunch {
            program: shell.into(),
            args: vec![],
            env: vec![("ZDOTDIR".into(), shims_dir.join("zsh").to_string_lossy().into_owned())],
        }),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn install_ecrit_les_shims_bash_et_zsh() {
        let d = tempfile::tempdir().unwrap();
        install_shims(d.path()).unwrap();
        let bash = std::fs::read_to_string(d.path().join("bash-init.sh")).unwrap();
        assert!(bash.contains("133;C;"));
        assert!(bash.contains("133;D;"));
        assert!(bash.contains(".bashrc"));
        assert!(d.path().join("zsh/.zshrc").exists());
        assert!(d.path().join("zsh/.zshenv").exists());
    }

    #[test]
    fn launch_bash_utilise_init_file_et_zsh_zdotdir() {
        let d = std::path::Path::new("/run/x");
        let b = launch_for("/bin/bash", d).unwrap();
        assert_eq!(b.program, "/bin/bash");
        assert_eq!(b.args, vec!["--init-file", "/run/x/bash-init.sh"]);
        let z = launch_for("/usr/bin/zsh", d).unwrap();
        assert!(z.args.is_empty());
        assert_eq!(z.env, vec![("ZDOTDIR".to_string(), "/run/x/zsh".to_string())]);
        assert!(launch_for("/usr/bin/fish", d).is_none());
        assert!(launch_for("/bin/sh", d).is_none());
    }

    /// Bout en bout : bash interactif (-i) sur des pipes ; l'avertissement « no job control » est ignoré.
    #[test]
    fn shim_bash_emet_c_puis_d_pour_une_commande() {
        let d = tempfile::tempdir().unwrap();
        install_shims(d.path()).unwrap();
        let mut child = std::process::Command::new("bash")
            .args([
                "--noprofile",
                "--init-file",
                d.path().join("bash-init.sh").to_str().unwrap(),
                "-i",
            ])
            .env("HOME", d.path()) // pas de ~/.bashrc utilisateur : shim seul
            .env("PS1", "$ ")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        {
            use std::io::Write;
            child.stdin.take().unwrap().write_all(b"echo hello\nexit 3\n").unwrap();
        }
        let output = child.wait_with_output().unwrap();
        let all = [output.stdout.as_slice(), output.stderr.as_slice()].concat();
        let mut sc = crate::osc::OscScanner::new();
        let events = sc.feed_events(&all);
        let cmd = events.iter().find_map(|e| match e {
            crate::osc::OscEvent::Command { cmd, .. } => Some(cmd.clone()),
            _ => None,
        });
        assert_eq!(
            cmd.as_deref(),
            Some("echo hello"),
            "événements: {events:?}\nsortie: {}",
            String::from_utf8_lossy(&all)
        );
        assert!(events.contains(&crate::osc::OscEvent::Exit { code: 0 }));
    }
}
