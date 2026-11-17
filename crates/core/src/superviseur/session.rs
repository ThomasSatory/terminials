//! Session `claude` du superviseur, reprise d'un tour à l'autre (`--resume`) et d'un
//! lancement de l'app à l'autre : `$XDG_DATA_HOME/terminials/superviseur/session.json`.
//! Le même dossier sert de répertoire de travail au `claude` du superviseur (aucun
//! CLAUDE.md de projet n'y est chargé).

use std::path::{Path, PathBuf};

const FICHIER: &str = "session.json";

/// `$XDG_DATA_HOME/terminials/superviseur`, défaut `~/.local/share/terminials/superviseur`.
pub fn dossier(xdg_data_home: Option<String>, home: Option<String>) -> PathBuf {
    let base = xdg_data_home
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(home.unwrap_or_else(|| "/tmp".into()))
                .join(".local")
                .join("share")
        });
    base.join("terminials").join("superviseur")
}

/// Un identifiant passé à `--resume` : jamais vide, jamais pris pour une option
/// (`-…`), sans caractère exotique. Le fichier est éditable à la main : on ne passe
/// au CLI que ce qui ressemble à un identifiant de session.
pub fn id_valide(id: &str) -> bool {
    !id.is_empty()
        && id.len() <= 128
        && !id.starts_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '-' || c == '_')
}

/// Identifiant de session enregistré, s'il y en a un lisible.
pub fn charger(dossier: &Path) -> Option<String> {
    let texte = std::fs::read_to_string(dossier.join(FICHIER)).ok()?;
    let v: serde_json::Value = serde_json::from_str(&texte).ok()?;
    let id = v.get("sessionId")?.as_str()?;
    id_valide(id).then(|| id.to_string())
}

/// Enregistre (Some) ou oublie (None) la session. Écriture atomique (fichier
/// temporaire puis renommage) : une coupure ne laisse jamais un fichier tronqué.
pub fn enregistrer(dossier: &Path, session_id: Option<&str>) -> std::io::Result<()> {
    let chemin = dossier.join(FICHIER);
    match session_id.filter(|id| id_valide(id)) {
        None => match std::fs::remove_file(&chemin) {
            Err(e) if e.kind() != std::io::ErrorKind::NotFound => Err(e),
            _ => Ok(()),
        },
        Some(id) => {
            std::fs::create_dir_all(dossier)?;
            let tmp = dossier.join(format!("{FICHIER}.tmp"));
            std::fs::write(&tmp, serde_json::json!({ "sessionId": id }).to_string())?;
            std::fs::rename(&tmp, &chemin)
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn dossier_suit_xdg_sinon_home() {
        assert_eq!(
            dossier(Some("/x".into()), Some("/h".into())),
            PathBuf::from("/x/terminials/superviseur")
        );
        assert_eq!(
            dossier(Some(String::new()), Some("/h".into())),
            PathBuf::from("/h/.local/share/terminials/superviseur")
        );
    }

    #[test]
    fn enregistrer_charger_oublier() {
        let d = tempfile::tempdir().unwrap();
        let sous = d.path().join("superviseur");
        assert_eq!(charger(&sous), None);
        enregistrer(&sous, Some("0b7c4f1e-9a2d-4c1b-8f00-3e5d2a1b9c77")).unwrap();
        assert_eq!(
            charger(&sous).as_deref(),
            Some("0b7c4f1e-9a2d-4c1b-8f00-3e5d2a1b9c77")
        );
        enregistrer(&sous, None).unwrap();
        assert_eq!(charger(&sous), None);
        // Oublier ce qui n'existe pas n'est pas une erreur.
        enregistrer(&sous, None).unwrap();
    }

    #[test]
    fn fichier_abime_ou_id_douteux_ignores() {
        let d = tempfile::tempdir().unwrap();
        std::fs::write(d.path().join(FICHIER), "{pas du json").unwrap();
        assert_eq!(charger(d.path()), None);
        std::fs::write(
            d.path().join(FICHIER),
            r#"{"sessionId":"--dangerously-skip-permissions"}"#,
        )
        .unwrap();
        assert_eq!(charger(d.path()), None);
        std::fs::write(d.path().join(FICHIER), r#"{"sessionId":"a b"}"#).unwrap();
        assert_eq!(charger(d.path()), None);
        assert!(!id_valide(""));
        assert!(id_valide("abc-123_x"));
    }
}
