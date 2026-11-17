//! Quand réveiller le superviseur : les événements sont regroupés (un tour pour une
//! rafale) et la cadence est bornée, pour ne pas brûler de jetons. Pur et testé.
//!
//! Règles : un seul tour à la fois ; un message de l'utilisateur part presque aussitôt
//! (0,3 s) et n'est soumis ni à l'écart minimal ni au plafond horaire ; les événements
//! automatiques attendent la fin de la rafale (4 s), au moins 30 s depuis le dernier
//! tour automatique, et pas plus de 20 tours automatiques par heure glissante.

use super::{EvenementSuperviseur, GenreEvenement};

/// Une heure, en ms.
pub const HEURE_MS: i64 = 3_600_000;
/// Événements gardés en file au plus : au-delà, les plus anciens événements
/// automatiques sont oubliés (l'invite dit combien), jamais les messages.
pub const MAX_FILE: usize = 30;

/// Réglage de la cadence (valeurs par défaut : `Default`).
#[derive(Debug, Clone, PartialEq)]
pub struct ParametresPlanif {
    /// Attente après le premier événement automatique, pour regrouper la rafale.
    pub regroupement_ms: i64,
    /// Attente après un message de l'utilisateur (quasi immédiat).
    pub regroupement_message_ms: i64,
    /// Écart minimal entre deux tours déclenchés par des événements automatiques.
    pub intervalle_min_ms: i64,
    /// Plafond de tours automatiques sur une heure glissante (les messages de
    /// l'utilisateur n'y sont pas soumis).
    pub max_tours_heure: u32,
}

impl Default for ParametresPlanif {
    fn default() -> Self {
        Self {
            regroupement_ms: 4_000,
            regroupement_message_ms: 300,
            intervalle_min_ms: 30_000,
            max_tours_heure: 20,
        }
    }
}

/// Un événement reçu, horodaté (epoch ms).
#[derive(Debug, Clone, PartialEq)]
pub struct Recu {
    pub a: i64,
    pub evenement: EvenementSuperviseur,
}

/// Ce que le planificateur sait.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct EtatPlanif {
    pub file: Vec<Recu>,
    pub en_cours: bool,
    /// Epoch ms du début des tours automatiques de la dernière heure.
    pub tours_auto: Vec<i64>,
    pub dernier_tour: Option<i64>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Decision {
    /// Rien à lancer ; réexaminer dans `Some(ms)`, ou au prochain événement si `None`.
    Attendre(Option<i64>),
    /// Lancer un tour avec toute la file.
    Lancer,
}

/// Vrai si la file contient un message de l'utilisateur.
pub fn contient_message(file: &[Recu]) -> bool {
    file.iter()
        .any(|r| r.evenement.genre == GenreEvenement::Message)
}

/// Met un événement en file. Un événement automatique identique à un autre déjà en file
/// (même genre, même texte, même espace) n'y entre pas : une rafale de notifications
/// répétées ne coûte qu'une ligne. Rend le nombre d'événements oubliés pour tenir dans
/// `MAX_FILE`.
pub fn ajouter(file: &mut Vec<Recu>, recu: Recu) -> u32 {
    let auto = recu.evenement.genre != GenreEvenement::Message;
    if auto && file.iter().any(|r| r.evenement == recu.evenement) {
        return 0;
    }
    file.push(recu);
    let mut oublies = 0;
    while file.len() > MAX_FILE {
        match file
            .iter()
            .position(|r| r.evenement.genre != GenreEvenement::Message)
        {
            Some(i) => {
                file.remove(i);
                oublies += 1;
            }
            // Que des messages : l'utilisateur écrit beaucoup, on garde tout.
            None => break,
        }
    }
    oublies
}

/// Oublie les tours automatiques sortis de l'heure glissante.
pub fn purger(etat: &mut EtatPlanif, maintenant: i64) {
    etat.tours_auto.retain(|&t| maintenant - t < HEURE_MS);
}

/// Un tour démarre (avec la file entière, rendue). `en_cours` jusqu'à `noter_fin`.
pub fn noter_lancement(etat: &mut EtatPlanif, maintenant: i64) -> Vec<Recu> {
    if !contient_message(&etat.file) {
        etat.tours_auto.push(maintenant);
    }
    etat.en_cours = true;
    std::mem::take(&mut etat.file)
}

/// Le tour en cours est fini (réussi, en échec ou interrompu).
pub fn noter_fin(etat: &mut EtatPlanif, maintenant: i64) {
    etat.en_cours = false;
    etat.dernier_tour = Some(maintenant);
}

/// Décision du planificateur à l'instant `maintenant`.
pub fn decider(etat: &EtatPlanif, maintenant: i64, p: &ParametresPlanif) -> Decision {
    // Un seul tour à la fois : la fin du tour réexamine la file.
    if etat.en_cours || etat.file.is_empty() {
        return Decision::Attendre(None);
    }
    let attendre_jusqu_a = |echeance: i64| {
        if maintenant >= echeance {
            Decision::Lancer
        } else {
            Decision::Attendre(Some(echeance - maintenant))
        }
    };

    if contient_message(&etat.file) {
        // L'utilisateur attend une réponse : seul un court regroupement (ce qu'il
        // tape en plusieurs envois part en un tour).
        let premier = etat
            .file
            .iter()
            .filter(|r| r.evenement.genre == GenreEvenement::Message)
            .map(|r| r.a)
            .min()
            .unwrap_or(maintenant);
        return attendre_jusqu_a(premier + p.regroupement_message_ms);
    }

    let premier = etat.file.iter().map(|r| r.a).min().unwrap_or(maintenant);
    let mut echeance = premier + p.regroupement_ms;
    if let Some(&dernier_auto) = etat.tours_auto.iter().max() {
        echeance = echeance.max(dernier_auto + p.intervalle_min_ms);
    }
    let dans_l_heure: Vec<i64> = etat
        .tours_auto
        .iter()
        .copied()
        .filter(|&t| maintenant - t < HEURE_MS)
        .collect();
    if dans_l_heure.len() as u32 >= p.max_tours_heure {
        // Plafond atteint : on attend que le plus ancien sorte de l'heure glissante.
        let ancien = dans_l_heure.iter().copied().min().unwrap_or(maintenant);
        echeance = echeance.max(ancien + HEURE_MS);
    }
    attendre_jusqu_a(echeance)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(genre: GenreEvenement, texte: &str) -> EvenementSuperviseur {
        EvenementSuperviseur {
            genre,
            texte: texte.into(),
            ws_id: None,
        }
    }
    fn recu(a: i64, genre: GenreEvenement, texte: &str) -> Recu {
        Recu {
            a,
            evenement: ev(genre, texte),
        }
    }
    fn p() -> ParametresPlanif {
        ParametresPlanif::default()
    }

    #[test]
    fn file_vide_ou_tour_en_cours_attend_le_prochain_evenement() {
        let mut e = EtatPlanif::default();
        assert_eq!(decider(&e, 0, &p()), Decision::Attendre(None));
        e.file.push(recu(0, GenreEvenement::Message, "salut"));
        e.en_cours = true;
        assert_eq!(decider(&e, 10_000, &p()), Decision::Attendre(None));
    }

    #[test]
    fn rafale_automatique_regroupee_quatre_secondes() {
        let mut e = EtatPlanif::default();
        e.file
            .push(recu(1_000, GenreEvenement::Attente, "a attend"));
        e.file
            .push(recu(2_500, GenreEvenement::Termine, "b a fini"));
        assert_eq!(decider(&e, 2_500, &p()), Decision::Attendre(Some(2_500)));
        assert_eq!(decider(&e, 5_000, &p()), Decision::Lancer);
    }

    #[test]
    fn message_quasi_immediat_meme_juste_apres_un_tour() {
        let mut e = EtatPlanif {
            tours_auto: vec![9_000],
            dernier_tour: Some(9_500),
            ..Default::default()
        };
        e.file
            .push(recu(10_000, GenreEvenement::Message, "où en est api ?"));
        assert_eq!(decider(&e, 10_100, &p()), Decision::Attendre(Some(200)));
        assert_eq!(decider(&e, 10_300, &p()), Decision::Lancer);
    }

    #[test]
    fn trente_secondes_entre_deux_tours_automatiques() {
        let mut e = EtatPlanif {
            tours_auto: vec![100_000],
            ..Default::default()
        };
        e.file
            .push(recu(110_000, GenreEvenement::Termine, "b a fini"));
        assert_eq!(decider(&e, 114_000, &p()), Decision::Attendre(Some(16_000)));
        assert_eq!(decider(&e, 130_000, &p()), Decision::Lancer);
    }

    #[test]
    fn plafond_horaire_pour_l_automatique_seulement() {
        let tours: Vec<i64> = (0..20).map(|i| 1_000 + i * 60_000).collect();
        let mut e = EtatPlanif {
            tours_auto: tours,
            ..Default::default()
        };
        let maintenant = 1_000 + 19 * 60_000 + 100_000;
        e.file
            .push(recu(maintenant - 10_000, GenreEvenement::Attente, "x"));
        // Le plus ancien (1 000) sort de l'heure à 3 601 000.
        assert_eq!(
            decider(&e, maintenant, &p()),
            Decision::Attendre(Some(1_000 + HEURE_MS - maintenant))
        );
        assert_eq!(decider(&e, 1_000 + HEURE_MS, &p()), Decision::Lancer);
        // Un message passe malgré le plafond.
        e.file.push(recu(maintenant, GenreEvenement::Message, "?"));
        assert_eq!(decider(&e, maintenant + 300, &p()), Decision::Lancer);
    }

    #[test]
    fn lancement_et_fin() {
        let mut e = EtatPlanif::default();
        e.file.push(recu(0, GenreEvenement::Attente, "a"));
        let pris = noter_lancement(&mut e, 5_000);
        assert_eq!(pris.len(), 1);
        assert!(e.file.is_empty() && e.en_cours);
        assert_eq!(e.tours_auto, vec![5_000]);
        noter_fin(&mut e, 9_000);
        assert!(!e.en_cours);
        assert_eq!(e.dernier_tour, Some(9_000));
        // Un tour déclenché par un message ne compte pas dans le plafond.
        e.file.push(recu(10_000, GenreEvenement::Message, "?"));
        noter_lancement(&mut e, 10_300);
        assert_eq!(e.tours_auto, vec![5_000]);
        purger(&mut e, 5_000 + HEURE_MS);
        assert!(e.tours_auto.is_empty());
    }

    #[test]
    fn doublons_ignores_et_file_bornee_sans_perdre_de_message() {
        let mut f = Vec::new();
        assert_eq!(
            ajouter(&mut f, recu(0, GenreEvenement::Attente, "a attend")),
            0
        );
        assert_eq!(
            ajouter(&mut f, recu(1, GenreEvenement::Attente, "a attend")),
            0
        );
        assert_eq!(f.len(), 1);
        // Deux messages identiques sont deux messages.
        ajouter(&mut f, recu(2, GenreEvenement::Message, "ok"));
        ajouter(&mut f, recu(3, GenreEvenement::Message, "ok"));
        assert_eq!(f.len(), 3);
        let mut oublies = 0;
        for i in 0..MAX_FILE as i64 {
            oublies += ajouter(
                &mut f,
                recu(10 + i, GenreEvenement::Termine, &format!("t{i}")),
            );
        }
        assert_eq!(f.len(), MAX_FILE);
        assert_eq!(oublies, 3);
        assert_eq!(
            f.iter()
                .filter(|r| r.evenement.genre == GenreEvenement::Message)
                .count(),
            2
        );
        assert!(!f.iter().any(|r| r.evenement.texte == "a attend"));
    }
}
