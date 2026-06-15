use std::path::PathBuf;

const HOOK_SCRIPT: &str = r#"#!/bin/bash
# Hook Claude Code -> terminials : notifie quand l'agent s'arrête / attend.
SOCK="${XDG_RUNTIME_DIR:-/tmp}/terminials.sock"
[ -S "$SOCK" ] || exit 0
EVENT=$(cat)
TYPE=$(echo "$EVENT" | jq -r '.hook_event_name // "unknown"' 2>/dev/null)
case "$TYPE" in
  Stop)         terminials notify --title "Claude Code" --body "Session terminée" ;;
  Notification) terminials notify --title "Claude Code" --body "En attente d'une entrée" ;;
esac
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
