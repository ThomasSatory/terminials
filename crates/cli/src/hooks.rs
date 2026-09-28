use std::path::PathBuf;

const HOOK_SCRIPT: &str = r#"#!/bin/bash
# Hook Claude Code -> terminials : notifie quand l'agent a fini / attend.
# Hors d'un terminal terminials (pas de TERMINIALS_WORKSPACE_ID), ne fait rien :
# le hook est déclaré dans la config Claude globale, donc aussi lu ailleurs.
[ -n "$TERMINIALS_WORKSPACE_ID" ] || exit 0
SOCK="${XDG_RUNTIME_DIR:-/tmp}/terminials.sock"
[ -S "$SOCK" ] || exit 0
EVENT=$(cat)
TYPE=$(echo "$EVENT" | jq -r '.hook_event_name // "unknown"' 2>/dev/null)
# Titre : « Claude · projet », le projet étant le dossier où tourne la session.
CWD=$(echo "$EVENT" | jq -r '.cwd // empty' 2>/dev/null)
TITLE="Claude${CWD:+ · ${CWD##*/}}"
case "$TYPE" in
  Stop)
    MSGS=(
      "Claude a terminé"
      "Claude a fini"
      "C'est prêt"
      "Terminé, à toi de jouer"
      "Fini ! Tu peux jeter un œil"
      "Travail terminé"
      "La balle est dans ton camp"
      "Mission accomplie"
    )
    terminials notify --title "$TITLE" --body "${MSGS[RANDOM % ${#MSGS[@]}]}" >/dev/null 2>&1 ;;
  Notification)
    MSG=$(echo "$EVENT" | jq -r '.message // empty' 2>/dev/null)
    # Claude Code écrit en anglais : on traduit les deux messages connus.
    case "$MSG" in
      "Claude needs your permission to use "*) MSG="Claude demande l'autorisation d'utiliser ${MSG#Claude needs your permission to use }" ;;
      "Claude is waiting for your input"|"") MSG="Claude attend ta réponse" ;;
    esac
    terminials notify --title "$TITLE" --body "$MSG" >/dev/null 2>&1 ;;
esac
exit 0
"#;

/// Installe le script de hook Claude Code dans ~/.claude/hooks/terminials-notify.sh (exécutable).
pub fn setup() -> std::io::Result<PathBuf> {
    let home = std::env::var("HOME").map_err(std::io::Error::other)?;
    let dir = PathBuf::from(&home).join(".claude/hooks");
    std::fs::create_dir_all(&dir)?;
    let script = dir.join("terminials-notify.sh");
    std::fs::write(&script, HOOK_SCRIPT)?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))?;
    Ok(script)
}
