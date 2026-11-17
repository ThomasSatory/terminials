//! Commandes Tauri de la section « Agents et notifications » des Paramètres : état et
//! installation des hooks Claude Code en un clic. Toute la logique (script embarqué,
//! fusion de `~/.claude/settings.json`, sauvegarde, idempotence) est dans
//! `terminials_core::hooks`, partagée avec `terminials hooks setup`.

use std::path::PathBuf;

use terminials_core::hooks::{self, EtatHooks};

fn home() -> Result<PathBuf, String> {
    match std::env::var("HOME") {
        Ok(h) if !h.is_empty() => Ok(PathBuf::from(h)),
        _ => Err("HOME introuvable".to_string()),
    }
}

/// « Installés » / « À installer » : lecture seule.
#[tauri::command]
pub fn hooks_etat() -> Result<EtatHooks, String> {
    Ok(hooks::etat(&home()?))
}

/// Écrit le script et déclare les hooks dans `~/.claude/settings.json` (le reste du
/// fichier est conservé, l'original sauvegardé à côté). Hors du thread principal :
/// écriture disque.
#[tauri::command]
pub async fn hooks_installer() -> Result<EtatHooks, String> {
    let home = home()?;
    tauri::async_runtime::spawn_blocking(move || hooks::installer(&home).map_err(|e| e.to_string()))
        .await
        .map_err(|e| format!("installation interrompue : {e}"))?
}
