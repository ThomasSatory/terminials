//! `terminials hooks setup|etat` : même installation que le bouton des Paramètres
//! (`terminials_core::hooks`), pour qui préfère la ligne de commande.

use std::path::PathBuf;

pub use terminials_core::hooks::EtatHooks;
use terminials_core::hooks::{self, EVENEMENTS};

fn home() -> std::io::Result<PathBuf> {
    match std::env::var("HOME") {
        Ok(h) if !h.is_empty() => Ok(PathBuf::from(h)),
        _ => Err(std::io::Error::other("HOME introuvable")),
    }
}

/// Installe le script et déclare les hooks dans `~/.claude/settings.json` (idempotent,
/// original sauvegardé, reste du fichier conservé).
pub fn setup() -> std::io::Result<EtatHooks> {
    hooks::installer(&home()?)
}

/// État courant, sans rien modifier.
pub fn etat() -> std::io::Result<EtatHooks> {
    Ok(hooks::etat(&home()?))
}

/// Résumé lisible de l'état.
pub fn decrire(e: &EtatHooks) -> String {
    if e.installes {
        return format!("Hooks Claude Code installés ({}).", e.chemin_script);
    }
    let mut lignes = vec!["Hooks Claude Code à installer (terminials hooks setup).".to_string()];
    if !e.script_a_jour {
        lignes.push(format!("  script absent ou ancien : {}", e.chemin_script));
    }
    let manquants: Vec<&str> = EVENEMENTS
        .iter()
        .copied()
        .filter(|ev| !e.evenements_declares.iter().any(|d| d == ev))
        .collect();
    if !manquants.is_empty() {
        lignes.push(format!(
            "  événements non déclarés : {}",
            manquants.join(", ")
        ));
    }
    lignes.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn description_de_l_etat() {
        let mut e = EtatHooks {
            script_a_jour: false,
            chemin_script: "/h/x.sh".into(),
            evenements_declares: vec!["Stop".into()],
            installes: false,
        };
        let d = decrire(&e);
        assert!(
            d.contains("à installer")
                && d.contains("/h/x.sh")
                && d.contains("PostToolUse")
                && !d.contains(" Stop")
        );
        e.installes = true;
        assert_eq!(decrire(&e), "Hooks Claude Code installés (/h/x.sh).");
    }
}
