//! Images collées / déposées dans un pane : écriture d'un fichier temporaire dont le
//! chemin est ensuite injecté dans le PTY (Claude Code lit le fichier).
//!
//! Les fichiers vivent dans `$TMPDIR/terminials-images` : pas de nettoyage explicite,
//! /tmp est purgé au reboot et écrire dans le cwd du workspace polluerait le repo.

use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

/// Formats acceptés — ce sont ceux que Claude Code sait lire.
const ALLOWED_EXTS: [&str; 6] = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

/// Dossier des images collées.
fn images_dir() -> PathBuf {
    std::env::temp_dir().join("terminials-images")
}

/// Valide l'extension venue du front. Allowlist et pas simple assainissement : `ext`
/// est concaténé dans un nom de fichier, un `../` y suffirait à sortir du dossier.
fn sanitize_ext(ext: &str) -> Result<&'static str, String> {
    let lower = ext.to_ascii_lowercase();
    ALLOWED_EXTS
        .iter()
        .copied()
        .find(|allowed| *allowed == lower)
        .ok_or_else(|| format!("extension d'image non supportée : {ext}"))
}

/// Écrit `bytes` dans `dir/pasted-<stamp_ms>.<ext>` et retourne le chemin absolu.
/// `create_new` : deux collages dans la même milliseconde ne s'écrasent pas, le second
/// prend un suffixe `-1`. `dir` n'est créé que si l'écriture a lieu.
fn save_image_in(dir: &Path, bytes: &[u8], ext: &str, stamp_ms: u128) -> Result<String, String> {
    if bytes.is_empty() {
        return Err("aucune image dans le presse-papier".to_string());
    }
    let ext = sanitize_ext(ext)?;
    std::fs::create_dir_all(dir).map_err(|e| format!("création de {}: {e}", dir.display()))?;

    for n in 0..100u32 {
        let name = if n == 0 {
            format!("pasted-{stamp_ms}.{ext}")
        } else {
            format!("pasted-{stamp_ms}-{n}.{ext}")
        };
        let path = dir.join(name);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut file) => {
                file.write_all(bytes)
                    .map_err(|e| format!("écriture de {}: {e}", path.display()))?;
                return Ok(path.to_string_lossy().into_owned());
            }
            Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(format!("ouverture de {}: {e}", path.display())),
        }
    }
    Err("trop de collisions de noms dans le dossier d'images".to_string())
}

/// Commande front : sauve une image collée/déposée et retourne son chemin absolu.
#[tauri::command]
pub fn save_pasted_image(bytes: Vec<u8>, ext: String) -> Result<String, String> {
    let stamp_ms = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_err(|e| format!("horloge système: {e}"))?
        .as_millis();
    save_image_in(&images_dir(), &bytes, &ext, stamp_ms)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    #[test]
    fn sanitize_ext_accepte_les_formats_images() {
        for ext in ["png", "jpg", "jpeg", "gif", "webp", "bmp"] {
            assert_eq!(sanitize_ext(ext).unwrap(), ext);
        }
    }

    #[test]
    fn sanitize_ext_normalise_la_casse() {
        assert_eq!(sanitize_ext("PNG").unwrap(), "png");
    }

    #[test]
    fn sanitize_ext_refuse_une_extension_hors_allowlist() {
        assert!(sanitize_ext("exe").is_err());
    }

    #[test]
    fn sanitize_ext_refuse_une_traversee_de_chemin() {
        // Un `ext` arbitraire venu du front ne doit jamais pouvoir sortir du dossier.
        assert!(sanitize_ext("../../.bashrc").is_err());
        assert!(sanitize_ext("png/../..").is_err());
    }

    #[test]
    fn save_image_in_ecrit_le_fichier_et_retourne_son_chemin() {
        let dir = std::env::temp_dir().join(format!("terminials-test-{}", std::process::id()));
        let path = save_image_in(&dir, b"\x89PNG-data", "png", 1_700_000_000_000).unwrap();

        assert!(path.ends_with("/pasted-1700000000000.png"), "chemin: {path}");
        assert_eq!(fs::read(&path).unwrap(), b"\x89PNG-data");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_image_in_ne_perd_pas_une_image_collee_dans_la_meme_milliseconde() {
        let dir = std::env::temp_dir().join(format!("terminials-test-dup-{}", std::process::id()));
        let first = save_image_in(&dir, b"un", "png", 42).unwrap();
        let second = save_image_in(&dir, b"deux", "png", 42).unwrap();

        assert_ne!(first, second);
        assert_eq!(fs::read(&first).unwrap(), b"un");
        assert_eq!(fs::read(&second).unwrap(), b"deux");
        fs::remove_dir_all(&dir).unwrap();
    }

    #[test]
    fn save_image_in_refuse_un_presse_papier_vide() {
        let dir = std::env::temp_dir().join("terminials-test-vide");
        assert!(save_image_in(&dir, b"", "png", 1).is_err());
        assert!(!dir.exists(), "aucun dossier ne doit être créé pour rien");
    }
}
