//! Périmètre « sprint actuel » des tâches ClickUp.
//!
//! Les listes de sprint encodent leur période dans leur nom : `API 180 (8/25 -
//! 9/21)`, `Web 180 (9/1 - 9/28)`, `Billing 178 (9/1 - 9/28)`… L'année n'y figure
//! pas. Une liste est « du sprint actuel » quand la date du jour tombe dans sa
//! période, ce qui suffit : plusieurs produits (API, Web, Mobile, Data, Ops)
//! tiennent chacun leur liste, et le filtre par assigné fait le reste.
//!
//! Tout ici est pur — aucun accès réseau, aucune horloge implicite : la date du
//! jour est toujours passée en argument.

use chrono::{Datelike, NaiveDate};

/// Jour de l'année sans l'année : `(mois, jour)`.
type MoisJour = (u32, u32);

/// Période extraite d'un nom de liste, bornes incluses.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Periode {
    pub debut: MoisJour,
    pub fin: MoisJour,
}

impl Periode {
    /// Vrai si `jour` tombe dans la période, bornes incluses. Une période qui
    /// franchit le 31 décembre (`12/22 - 1/18`) est reconnue comme telle :
    /// début > fin veut dire qu'elle enjambe le nouvel an.
    pub fn contient(&self, jour: MoisJour) -> bool {
        if self.debut <= self.fin {
            self.debut <= jour && jour <= self.fin
        } else {
            jour >= self.debut || jour <= self.fin
        }
    }
}

/// Extrait la période d'un nom de liste ClickUp. `None` si le nom n'en porte
/// pas — un backlog (`Backlog API / Backend`) ou un kanban n'est jamais un
/// sprint. Pur.
pub fn periode_liste(nom: &str) -> Option<Periode> {
    // `(8/25 - 9/21)` : on part de la dernière parenthèse ouvrante, pour qu'un
    // nom qui en contiendrait une autre (« Billing (legacy) 178 (9/1 - 9/28) »)
    // reste lisible.
    let debut_paren = nom.rfind('(')?;
    let fin_paren = nom[debut_paren..].find(')')? + debut_paren;
    let dedans = &nom[debut_paren + 1..fin_paren];
    let (gauche, droite) = dedans.split_once('-')?;
    Some(Periode { debut: mois_jour(gauche)?, fin: mois_jour(droite)? })
}

/// `" 8/25 "` → `(8, 25)`. Pur.
fn mois_jour(s: &str) -> Option<MoisJour> {
    let (m, j) = s.trim().split_once('/')?;
    let mois: u32 = m.trim().parse().ok()?;
    let jour: u32 = j.trim().parse().ok()?;
    if !(1..=12).contains(&mois) || !(1..=31).contains(&jour) {
        return None;
    }
    Some((mois, jour))
}

/// Vrai si le nom de liste désigne le sprint en cours à la date `aujourd_hui`.
/// Un nom sans période (backlog, kanban, roadmap) est toujours faux. Pur.
pub fn est_sprint_actuel(nom: &str, aujourd_hui: NaiveDate) -> bool {
    periode_liste(nom).is_some_and(|p| p.contient((aujourd_hui.month(), aujourd_hui.day())))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn jour(a: i32, m: u32, j: u32) -> NaiveDate {
        NaiveDate::from_ymd_opt(a, m, j).unwrap()
    }

    #[test]
    fn periode_extraite_des_vrais_noms_de_listes() {
        assert_eq!(
            periode_liste("API 180 (8/25 - 9/21)"),
            Some(Periode { debut: (8, 25), fin: (9, 21) })
        );
        assert_eq!(
            periode_liste("Web Admin 181 (9/29 - 10/26)"),
            Some(Periode { debut: (9, 29), fin: (10, 26) })
        );
        assert_eq!(
            periode_liste("Billing 178 (9/1 - 9/28)"),
            Some(Periode { debut: (9, 1), fin: (9, 28) })
        );
    }

    #[test]
    fn listes_sans_periode_ne_sont_pas_des_sprints() {
        for nom in [
            "Backlog API / Backend",
            "Kanban Opaline",
            "Roadmap billing",
            "Versions",
            "API 180 (8/25 9/21)", // tiret manquant
            "API 180 (huit/25 - 9/21)",
            "API 180 (13/25 - 9/21)", // mois hors bornes
        ] {
            assert_eq!(periode_liste(nom), None, "{nom}");
            assert!(!est_sprint_actuel(nom, jour(2026, 9, 21)), "{nom}");
        }
    }

    #[test]
    fn bornes_incluses() {
        let n = "API 180 (8/25 - 9/21)";
        assert!(est_sprint_actuel(n, jour(2026, 8, 25)), "premier jour");
        assert!(est_sprint_actuel(n, jour(2026, 9, 21)), "dernier jour");
        assert!(est_sprint_actuel(n, jour(2026, 9, 1)));
        assert!(!est_sprint_actuel(n, jour(2026, 8, 24)));
        assert!(!est_sprint_actuel(n, jour(2026, 9, 22)));
    }

    #[test]
    fn sprint_a_cheval_sur_le_nouvel_an() {
        let n = "API 186 (12/22 - 1/18)";
        assert!(est_sprint_actuel(n, jour(2026, 12, 31)));
        assert!(est_sprint_actuel(n, jour(2027, 1, 5)));
        assert!(est_sprint_actuel(n, jour(2026, 12, 22)));
        assert!(est_sprint_actuel(n, jour(2027, 1, 18)));
        assert!(!est_sprint_actuel(n, jour(2026, 12, 21)));
        assert!(!est_sprint_actuel(n, jour(2027, 1, 19)));
    }

    #[test]
    fn plusieurs_produits_partagent_la_meme_date() {
        let aujourd_hui = jour(2026, 9, 21);
        for n in ["API 180 (8/25 - 9/21)", "Web 180 (9/1 - 9/28)", "Mobile 180 (9/7 - 10/5)"] {
            assert!(est_sprint_actuel(n, aujourd_hui), "{n}");
        }
        assert!(!est_sprint_actuel("API 181 (9/22 - 10/19)", aujourd_hui), "sprint suivant");
        assert!(!est_sprint_actuel("Mobile 179 (8/11 - 9/7)", aujourd_hui), "sprint précédent");
    }

    #[test]
    fn parenthese_supplementaire_avant_la_periode() {
        assert_eq!(
            periode_liste("Billing (legacy) 178 (9/1 - 9/28)"),
            Some(Periode { debut: (9, 1), fin: (9, 28) })
        );
    }
}
