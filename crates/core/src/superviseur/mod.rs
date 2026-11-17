//! Logique pure du moteur du superviseur : regroupement et cadence des réveils
//! (`planif`), lecture du flux JSON de `claude -p --output-format stream-json`
//! (`flux`), consigne et invite de réveil (`consigne`), session à reprendre
//! (`session`). Le câblage Tauri (thread, process, événements) est dans
//! `src-tauri/src/superviseur.rs`.
//!
//! Propriétaire : agent (b) « moteur Rust du superviseur ». Les TYPES de ce fichier
//! sont le contrat avec le front (`src/lib/outilsProtocole.ts`) : ne pas les changer
//! sans changer les deux.

use serde::{Deserialize, Serialize};

pub mod consigne;
pub mod flux;
pub mod moteur;
pub mod planif;
pub mod session;

/// Ce qui réveille le superviseur. Envoyé par le front (commande `superviseur_signaler`),
/// qui seul connaît les noms d'espaces et les transitions d'état des agents.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum GenreEvenement {
    /// L'utilisateur écrit au superviseur (panneau, palette) : réveil immédiat.
    Message,
    /// Un agent attend (fin de tour avec question, demande d'autorisation).
    Attente,
    /// Un agent a terminé son tour.
    Termine,
    /// Une session pose une question (`terminials demander`), ou un échange a reçu sa réponse.
    Question,
    /// L'utilisateur a autorisé ou refusé une écriture proposée.
    Validation,
    /// Fin de la pause : résumé de ce qui a été manqué.
    Reprise,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvenementSuperviseur {
    pub genre: GenreEvenement,
    /// Phrase en français, prête à entrer dans l'invite (« api-paiements attend une
    /// autorisation : npm run migrate »). Rédigée par le front.
    pub texte: String,
    /// Espace concerné, s'il y en a un.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub ws_id: Option<String>,
}

/// Événement `superviseur-flux` (backend → front) : ce que le moteur fait.
/// Les appels d'outils n'y figurent pas : le front les voit passer lui-même
/// (événement `outil-requete`, origine superviseur) et les inscrit au fil.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "kebab-case")]
pub enum FluxSuperviseur {
    /// Un tour commence (réveil par `nbEvenements` événements regroupés).
    #[serde(rename_all = "camelCase")]
    TourDebut { nb_evenements: u32 },
    /// Texte adressé à l'utilisateur (bloc texte d'un message assistant).
    Texte { texte: String },
    /// Fin du tour.
    #[serde(rename_all = "camelCase")]
    TourFin {
        ok: bool,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        erreur: Option<String>,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        cout_usd: Option<f64>,
    },
    /// Le moteur s'arrête (désactivé, pause, interruption) : la file est vidée.
    Arret { raison: String },
}

/// Réponse de `superviseur_etat`.
#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EtatMoteur {
    /// Réglage `superviseur.actif` ET pas en pause.
    pub actif: bool,
    /// Un `claude` tourne.
    pub en_cours: bool,
    /// Événements en attente de réveil.
    pub en_file: u32,
    /// Session reprise au prochain tour (`--resume`).
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    /// Epoch ms de la fin du dernier tour.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub dernier_tour: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub derniere_erreur: Option<String>,
    /// Tours automatiques lancés dans la dernière heure.
    pub tours_heure: u32,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn evenement_en_json() {
        let e: EvenementSuperviseur =
            serde_json::from_str(r#"{"genre":"attente","texte":"api attend","wsId":"ws:2"}"#)
                .unwrap();
        assert_eq!(e.genre, GenreEvenement::Attente);
        assert_eq!(e.ws_id.as_deref(), Some("ws:2"));
    }

    #[test]
    fn flux_en_json() {
        let v = serde_json::to_value(FluxSuperviseur::TourDebut { nb_evenements: 2 }).unwrap();
        assert_eq!(v, serde_json::json!({"type":"tour-debut","nbEvenements":2}));
        let v = serde_json::to_value(FluxSuperviseur::TourFin {
            ok: true,
            erreur: None,
            cout_usd: Some(0.01),
        })
        .unwrap();
        assert_eq!(
            v,
            serde_json::json!({"type":"tour-fin","ok":true,"coutUsd":0.01})
        );
        let v = serde_json::to_value(FluxSuperviseur::Texte { texte: "x".into() }).unwrap();
        assert_eq!(v, serde_json::json!({"type":"texte","texte":"x"}));
    }
}
