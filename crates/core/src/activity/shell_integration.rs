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

pub const ZSHENV_SHIM: &str = r#"# terminials : source le .zshenv utilisateur, puis REMET ZDOTDIR sur le dossier
# des shims. zsh résout chaque fichier de démarrage avec la valeur courante de
# ZDOTDIR : le laisser sur $HOME ici ferait lire $HOME/.zshrc à la place du shim,
# et l'intégration ne serait jamais posée. C'est le .zshrc du shim qui rétablit
# le ZDOTDIR utilisateur, juste avant de sourcer son .zshrc.
__tm_shim_zdotdir="$ZDOTDIR"
ZDOTDIR="$HOME"
[ -f "$ZDOTDIR/.zshenv" ] && . "$ZDOTDIR/.zshenv"
__tm_user_zdotdir="$ZDOTDIR"
ZDOTDIR="$__tm_shim_zdotdir"
"#;

pub const ZPROFILE_SHIM: &str = r#"# terminials : .zprofile utilisateur, pour les shells de connexion (zsh -l), que
# zsh cherche dans ZDOTDIR entre le .zshenv et le .zshrc.
[ -f "${__tm_user_zdotdir:-$HOME}/.zprofile" ] && . "${__tm_user_zdotdir:-$HOME}/.zprofile"
"#;

pub const ZSHRC_SHIM: &str = r#"# terminials : intégration shell (zsh)
# Rétablit le ZDOTDIR utilisateur (retenu par le .zshenv du shim) : à partir d'ici
# et pour .zlogin/.zlogout, le shell voit un environnement normal.
ZDOTDIR="${__tm_user_zdotdir:-$HOME}"
unset __tm_shim_zdotdir __tm_user_zdotdir
[ -f "$ZDOTDIR/.zshrc" ] && . "$ZDOTDIR/.zshrc"
__tm_b64() { printf '%s' "$1" | base64 | tr -d '\n' }
__tm_preexec() { printf '\033]133;C;%s;%s\007' "$(__tm_b64 "$1")" "$(__tm_b64 "$PWD")"; __tm_ran=1 }
__tm_precmd() { local code=$?; [ -n "$__tm_ran" ] && printf '\033]133;D;%s\007' "$code"; __tm_ran= }
autoload -Uz add-zsh-hook
add-zsh-hook preexec __tm_preexec
# __tm_precmd doit passer en TETE de precmd_functions : `add-zsh-hook` l'ajoute en
# queue, et les hooks precmd de l'utilisateur (deja poses par le .zshrc source
# ci-dessus) ecraseraient alors $? avant qu'on le lise. Meme precaution que le
# shim bash, qui place __tm_precmd_start en debut de PROMPT_COMMAND.
precmd_functions=(__tm_precmd $precmd_functions)
"#;

/// Commande complète (programme + arguments + variables d'environnement) à lancer pour
/// obtenir un shell interactif avec l'intégration OSC 133 posée.
pub struct ShellLaunch {
    pub program: String,
    pub args: Vec<String>,
    pub env: Vec<(String, String)>,
}

/// UID réel du process, lu sur `/proc/self`. `UID` n'est **pas** une variable
/// d'environnement (c'est une variable de shell) : s'en servir donnait le même
/// chemin de repli `/tmp/terminials-u/shell` pour tous les utilisateurs de la
/// machine, et donc un dossier de shims qu'un autre utilisateur pouvait créer en
/// premier puis remplir — ces fichiers étant ensuite exécutés dans le shell de la
/// victime. Repli sur le PID (unique, même s'il n'est pas stable) si `/proc` est
/// indisponible.
fn uid_reel() -> String {
    use std::os::unix::fs::MetadataExt;
    match std::fs::metadata("/proc/self") {
        Ok(m) => m.uid().to_string(),
        Err(_) => std::process::id().to_string(),
    }
}

/// Répertoire par défaut où écrire les shims : `$XDG_RUNTIME_DIR/terminials/shell` si
/// disponible, sinon un dossier temporaire propre à l'utilisateur.
pub fn default_shims_dir() -> PathBuf {
    match std::env::var("XDG_RUNTIME_DIR") {
        Ok(d) if !d.is_empty() => PathBuf::from(d).join("terminials").join("shell"),
        _ => std::env::temp_dir().join(format!("terminials-{}", uid_reel())).join("shell"),
    }
}

/// Écrit les shims bash et zsh dans `dir` (créé si besoin, y compris le sous-dossier
/// `zsh`). Les dossiers sont créés en 0700 : leur contenu est sourcé par le shell de
/// l'utilisateur, personne d'autre ne doit pouvoir y écrire.
pub fn install_shims(dir: &Path) -> std::io::Result<()> {
    use std::os::unix::fs::{DirBuilderExt, PermissionsExt};
    std::fs::DirBuilder::new().recursive(true).mode(0o700).create(dir.join("zsh"))?;
    // Si le dossier préexistait (permissions plus larges), on les resserre. Échec
    // ignoré : un dossier appartenant à quelqu'un d'autre n'est pas modifiable, et
    // c'est l'écriture des shims juste après qui échouera alors bruyamment.
    let _ = std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700));
    std::fs::write(dir.join("bash-init.sh"), BASH_SHIM)?;
    std::fs::write(dir.join("zsh").join(".zshenv"), ZSHENV_SHIM)?;
    std::fs::write(dir.join("zsh").join(".zprofile"), ZPROFILE_SHIM)?;
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
        assert!(d.path().join("zsh/.zprofile").exists());
    }

    #[test]
    fn les_dossiers_de_shims_sont_en_0700() {
        use std::os::unix::fs::PermissionsExt;
        let d = tempfile::tempdir().unwrap();
        let dir = d.path().join("shell");
        install_shims(&dir).unwrap();
        let mode = |p: &std::path::Path| {
            std::fs::metadata(p).unwrap().permissions().mode() & 0o777
        };
        assert_eq!(mode(&dir), 0o700, "dossier des shims accessible au seul utilisateur");
        assert_eq!(mode(&dir.join("zsh")), 0o700);
    }

    #[test]
    fn le_repli_du_dossier_de_shims_porte_un_identifiant_utilisateur_numerique() {
        // Sans XDG_RUNTIME_DIR le chemin doit être propre à l'utilisateur : le
        // segment doit être `terminials-<nombre>`, jamais `terminials-u`.
        let suffixe = super::uid_reel();
        assert!(!suffixe.is_empty());
        assert!(suffixe.chars().all(|c| c.is_ascii_digit()), "identifiant obtenu : {suffixe}");
    }

    #[test]
    fn le_hook_precmd_zsh_est_pose_en_tete() {
        assert!(
            ZSHRC_SHIM.contains("precmd_functions=(__tm_precmd $precmd_functions)"),
            "le hook precmd doit précéder ceux de l'utilisateur pour lire le vrai $?"
        );
        assert!(!ZSHRC_SHIM.contains("add-zsh-hook precmd"));
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

    /// Bout en bout zsh : le shim doit être réellement chargé (c'est lui que zsh lit
    /// comme `.zshrc`, grâce au ZDOTDIR conservé par son `.zshenv`) et émettre le
    /// **vrai** code de retour, même quand l'utilisateur a déjà un hook `precmd`.
    /// Ignoré silencieusement si zsh n'est pas installé sur la machine.
    #[test]
    fn shim_zsh_emet_c_puis_d_avec_le_vrai_code_de_retour() {
        if std::process::Command::new("zsh").arg("--version").output().is_err() {
            return;
        }
        let d = tempfile::tempdir().unwrap();
        let shims = d.path().join("shims");
        let home = d.path().join("home");
        std::fs::create_dir_all(&home).unwrap();
        install_shims(&shims).unwrap();
        // .zshrc utilisateur avec son propre hook precmd : s'il passait avant le
        // nôtre, `local code=$?` lirait *son* code de retour (0) et jamais celui de
        // la commande.
        std::fs::write(
            home.join(".zshrc"),
            "autoload -Uz add-zsh-hook\n__user_precmd() { true }\nadd-zsh-hook precmd __user_precmd\n",
        )
        .unwrap();

        let mut child = std::process::Command::new("zsh")
            .arg("-i")
            .env("HOME", &home)
            .env("ZDOTDIR", shims.join("zsh"))
            .env("PS1", "$ ")
            .stdin(std::process::Stdio::piped())
            .stdout(std::process::Stdio::piped())
            .stderr(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        {
            use std::io::Write;
            child.stdin.take().unwrap().write_all(b"(exit 7)\nexit 0\n").unwrap();
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
            Some("(exit 7)"),
            "événements: {events:?}\nsortie: {}",
            String::from_utf8_lossy(&all)
        );
        assert!(
            events.contains(&crate::osc::OscEvent::Exit { code: 7 }),
            "le code de retour doit être celui de la commande, pas celui du hook utilisateur — événements: {events:?}"
        );
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
