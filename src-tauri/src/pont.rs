//! Pont requête/réponse entre le backend et le front.
//!
//! L'état des espaces, des onglets et des terminaux vit dans les stores React : pour
//! répondre à un appel d'outil (CLI `terminials …`, moteur du superviseur), le backend
//! émet l'événement `outil-requete` avec un identifiant, puis attend que le front
//! réponde par la commande `outil_repondre(id, reponse)`. Sans réponse dans le délai
//! (webview pas encore prête, rechargée), l'appel échoue proprement.

// Tant que socket.rs (agent a) et le moteur (agent b) ne s'en servent pas encore.
#![allow(dead_code)]

use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use protocol::{Origine, Outil, ReponseOutil, RequeteOutil};
use tauri::{AppHandle, Emitter, Manager, State};
use tokio::sync::oneshot;

/// Nom de l'événement émis vers la webview.
pub const EVENEMENT_REQUETE: &str = "outil-requete";

/// Délai par défaut d'une réponse du front. Une écriture qui demande validation ne
/// l'attend pas : le front répond aussitôt « en attente » (carte « À valider »).
pub const DELAI_REPONSE: Duration = Duration::from_secs(20);

/// Requêtes en vol, géré par Tauri (`.manage(Arc<Pont>)`).
#[derive(Default)]
pub struct Pont {
    suivant: AtomicU64,
    en_vol: Mutex<HashMap<u64, oneshot::Sender<ReponseOutil>>>,
}

impl Pont {
    pub fn new() -> Self {
        Self::default()
    }

    /// Réserve un identifiant et l'emplacement de sa réponse.
    fn ouvrir(&self) -> (u64, oneshot::Receiver<ReponseOutil>) {
        let id = self.suivant.fetch_add(1, Ordering::SeqCst) + 1;
        let (tx, rx) = oneshot::channel();
        self.en_vol
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .insert(id, tx);
        (id, rx)
    }

    fn oublier(&self, id: u64) {
        self.en_vol
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
    }

    /// Livre la réponse du front. Faux si personne n'attendait plus cet id (délai
    /// dépassé, id inconnu).
    pub fn livrer(&self, id: u64, reponse: ReponseOutil) -> bool {
        let tx = self
            .en_vol
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .remove(&id);
        match tx {
            Some(tx) => tx.send(reponse).is_ok(),
            None => false,
        }
    }
}

/// Envoie un appel d'outil au front et attend sa réponse (au plus `delai`).
/// Utilisable depuis un thread non async par `tauri::async_runtime::block_on`.
pub async fn requete_front(
    app: &AppHandle,
    outil: Outil,
    args: serde_json::Value,
    origine: Origine,
    delai: Duration,
) -> ReponseOutil {
    let pont = app.state::<Arc<Pont>>().inner().clone();
    let (id, rx) = pont.ouvrir();
    let requete = RequeteOutil {
        id,
        outil,
        args,
        origine,
    };
    if let Err(e) = app.emit(EVENEMENT_REQUETE, &requete) {
        pont.oublier(id);
        return ReponseOutil::err(format!("l'interface est injoignable : {e}"));
    }
    match tokio::time::timeout(delai, rx).await {
        Ok(Ok(reponse)) => reponse,
        Ok(Err(_)) => ReponseOutil::err("l'interface a abandonné la requête"),
        Err(_) => {
            pont.oublier(id);
            ReponseOutil::err("l'interface n'a pas répondu à temps")
        }
    }
}

/// Réponse du front à un `outil-requete`.
#[tauri::command]
pub fn outil_repondre(pont: State<'_, Arc<Pont>>, id: u64, reponse: ReponseOutil) {
    // Réponse tardive (délai dépassé) : l'appelant a déjà reçu une erreur, rien à faire.
    let _ = pont.livrer(id, reponse);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn livre_la_reponse_a_celui_qui_attend() {
        let pont = Pont::new();
        let (id, rx) = pont.ouvrir();
        assert!(pont.livrer(id, ReponseOutil::ok(serde_json::json!({"x": 1}))));
        let rep = tauri::async_runtime::block_on(rx).unwrap();
        assert!(rep.ok);
        // Une seconde livraison du même id ne trouve plus personne.
        assert!(!pont.livrer(id, ReponseOutil::err("tard")));
    }

    #[test]
    fn identifiants_distincts_et_id_inconnu_ignore() {
        let pont = Pont::new();
        let (a, _ra) = pont.ouvrir();
        let (b, _rb) = pont.ouvrir();
        assert_ne!(a, b);
        assert!(!pont.livrer(999, ReponseOutil::ok(serde_json::Value::Null)));
    }
}
