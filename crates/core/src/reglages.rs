//! Réglages de l'application (vue Paramètres) : apparence, terminal, notifications,
//! superviseur.
//!
//! Un seul fichier de réglages pour toute l'app : `~/.config/terminials/settings.json`,
//! déjà écrit par le dashboard d'activité (`activity::settings`). Ces réglages-ci y
//! vivent sous la clé `app` (champ `Settings::app`) : l'utilisateur n'a qu'un fichier
//! à connaître (la vue Paramètres l'affiche), le même verrou en mémoire et la même
//! écriture atomique 0600 servent aux deux. Chaque moitié n'est écrite que par sa
//! commande : `activity_set_settings` conserve `app` tel qu'en mémoire,
//! `reglages_ecrire` ne remplace que `app`.
//!
//! La forme JSON est celle de `ReglagesApp` dans `src/lib/reglages.ts` (camelCase).
//! Un fichier partiel ou ancien se complète par les défauts (serde `default`), et
//! `normaliser` ramène toute valeur hors bornes dans le domaine attendu : le fichier
//! est éditable à la main, il ne doit jamais faire planter l'app.

use serde::de::DeserializeOwned;
use serde::{Deserialize, Deserializer, Serialize};

/// Bornes de la taille de police du terminal (px), comme le pas à pas de la maquette.
pub const TAILLE_POLICE_MIN: u8 = 10;
pub const TAILLE_POLICE_MAX: u8 = 20;
/// Lignes de défilement proposées (xterm `scrollback`).
pub const DEFILEMENTS: [u32; 4] = [1000, 5000, 10_000, 50_000];
/// Longueur maximale du nom du superviseur (champ de la maquette : 16).
pub const NOM_SUPERVISEUR_MAX: usize = 16;
/// Nom par défaut du superviseur.
pub const NOM_SUPERVISEUR_DEFAUT: &str = "Superviseur";
/// Accent par défaut (`--accent` de tokens.css).
pub const ACCENT_DEFAUT: &str = "#8f9bff";
/// Membre d'une paire qui désigne le superviseur lui-même.
pub const PAIRE_SUPERVISEUR: &str = "superviseur";

/// Lecture d'un champ qui ne fait jamais échouer celle du fichier : une valeur illisible
/// (variante inconnue comme `"densite": "enorme"`, mauvais type) prend le défaut du champ.
/// Sans cela, une seule faute de frappe dans `settings.json` rendait tout le fichier
/// illisible : l'app repartait des défauts et sa prochaine écriture effaçait aussi les
/// réglages d'activité (jetons, motifs). Le défaut est toujours le choix prudent (niveau
/// Observer, superviseur désactivé).
pub fn tolerant<'de, D, T>(d: D) -> Result<T, D::Error>
where
    D: Deserializer<'de>,
    T: DeserializeOwned + Default,
{
    let brut = serde_json::Value::deserialize(d)?;
    Ok(T::deserialize(brut).unwrap_or_default())
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Densite {
    Compacte,
    #[default]
    Normale,
    Ample,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum PoliceTerminal {
    /// JetBrains Mono embarquée.
    #[default]
    Integree,
    /// Monospace du système.
    Systeme,
}

/// Ce que le superviseur a le droit de faire (comparé à la classe de chaque outil).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum NiveauAutonomie {
    #[default]
    Observer,
    Reorganiser,
    Agir,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Apparence {
    /// `#rrggbb`.
    pub accent: String,
    #[serde(deserialize_with = "tolerant")]
    pub densite: Densite,
    pub reduire_animations: bool,
}
impl Default for Apparence {
    fn default() -> Self {
        Self {
            accent: ACCENT_DEFAUT.into(),
            densite: Densite::Normale,
            reduire_animations: false,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Terminal {
    pub taille_police: u8,
    #[serde(deserialize_with = "tolerant")]
    pub police: PoliceTerminal,
    /// Programme du shell des nouveaux terminaux ; vide : `$SHELL` de la session.
    pub shell: String,
    /// Dossier d'un nouvel espace créé sans formulaire (Ctrl+Maj+Entrée) ; `~` accepté.
    pub dossier_depart: String,
    /// Lignes conservées par terminal (une valeur de `DEFILEMENTS`).
    pub defilement: u32,
    pub copier_selection: bool,
    /// Relancer `claude --resume` dans chaque onglet au démarrage de l'app.
    pub reprendre_sessions: bool,
}
impl Default for Terminal {
    fn default() -> Self {
        Self {
            taille_police: 13,
            police: PoliceTerminal::Integree,
            shell: String::new(),
            dossier_depart: "~".into(),
            defilement: 1000,
            copier_selection: false,
            reprendre_sessions: true,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Notifications {
    /// Notification du bureau quand un agent attend et que la fenêtre n'a pas le focus.
    pub systeme: bool,
    /// Bulle « vous attend » au-dessus du dock.
    pub bulle: bool,
    /// Son bref quand un agent passe en attente.
    pub son: bool,
}
impl Default for Notifications {
    fn default() -> Self {
        Self {
            systeme: true,
            bulle: true,
            son: false,
        }
    }
}

/// Deux espaces (désignés par leur DOSSIER, seul identifiant stable d'un lancement à
/// l'autre) ou un espace et le superviseur (`"superviseur"`), qui peuvent échanger par
/// le superviseur sans validation. Paire non orientée.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase", default)]
pub struct PaireAutorisee {
    pub a: String,
    pub b: String,
    /// Epoch ms de l'autorisation.
    pub depuis: i64,
    /// Échanges passés sans validation depuis.
    pub echanges: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Superviseur {
    /// Désactivé par défaut : rien ne tourne, aucun jeton n'est consommé.
    pub actif: bool,
    pub nom: String,
    #[serde(deserialize_with = "tolerant")]
    pub niveau: NiveauAutonomie,
    pub pause: bool,
    pub paires: Vec<PaireAutorisee>,
}
impl Default for Superviseur {
    fn default() -> Self {
        Self {
            actif: false,
            nom: NOM_SUPERVISEUR_DEFAUT.into(),
            niveau: NiveauAutonomie::Observer,
            pause: false,
            paires: Vec::new(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ReglagesApp {
    // Une section illisible (mauvais type) repart de ses défauts, sans emporter les autres.
    #[serde(deserialize_with = "tolerant")]
    pub apparence: Apparence,
    #[serde(deserialize_with = "tolerant")]
    pub terminal: Terminal,
    #[serde(deserialize_with = "tolerant")]
    pub notifications: Notifications,
    #[serde(deserialize_with = "tolerant")]
    pub superviseur: Superviseur,
}

fn est_hex_couleur(s: &str) -> bool {
    s.len() == 7 && s.starts_with('#') && s[1..].chars().all(|c| c.is_ascii_hexdigit())
}

/// Clé d'une paire, indépendante de l'ordre de ses membres. Pure.
pub fn cle_paire(a: &str, b: &str) -> (String, String) {
    if a <= b {
        (a.to_string(), b.to_string())
    } else {
        (b.to_string(), a.to_string())
    }
}

/// Ramène chaque valeur dans son domaine. Pure et idempotente : le front applique la
/// même règle (`normaliserReglages`), le backend la réapplique avant d'écrire.
pub fn normaliser(mut r: ReglagesApp) -> ReglagesApp {
    let d = ReglagesApp::default();

    r.apparence.accent = r.apparence.accent.trim().to_lowercase();
    if !est_hex_couleur(&r.apparence.accent) {
        r.apparence.accent = d.apparence.accent;
    }

    r.terminal.taille_police = r
        .terminal
        .taille_police
        .clamp(TAILLE_POLICE_MIN, TAILLE_POLICE_MAX);
    r.terminal.shell = r.terminal.shell.trim().to_string();
    r.terminal.dossier_depart = r.terminal.dossier_depart.trim().to_string();
    if r.terminal.dossier_depart.is_empty() {
        r.terminal.dossier_depart = d.terminal.dossier_depart;
    }
    if !DEFILEMENTS.contains(&r.terminal.defilement) {
        // La valeur proposée la plus proche : un fichier édité à la main garde son intention.
        r.terminal.defilement = *DEFILEMENTS
            .iter()
            .min_by_key(|v| (i64::from(**v) - i64::from(r.terminal.defilement)).abs())
            .expect("liste non vide");
    }

    let nom: String = r
        .superviseur
        .nom
        .trim()
        .chars()
        .take(NOM_SUPERVISEUR_MAX)
        .collect();
    r.superviseur.nom = if nom.is_empty() {
        d.superviseur.nom
    } else {
        nom
    };

    // Paires : sans membre vide, sans paire réflexive, sans doublon (ordre ignoré) ; la
    // première occurrence l'emporte.
    let mut vues: Vec<(String, String)> = Vec::new();
    r.superviseur.paires.retain(|p| {
        let (a, b) = (p.a.trim(), p.b.trim());
        if a.is_empty() || b.is_empty() || a == b {
            return false;
        }
        let cle = cle_paire(a, b);
        if vues.contains(&cle) {
            return false;
        }
        vues.push(cle);
        true
    });
    for p in &mut r.superviseur.paires {
        p.a = p.a.trim().to_string();
        p.b = p.b.trim().to_string();
    }
    r
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn defauts_de_la_maquette() {
        let r = ReglagesApp::default();
        assert_eq!(r.apparence.accent, "#8f9bff");
        assert_eq!(r.apparence.densite, Densite::Normale);
        assert_eq!(r.terminal.taille_police, 13);
        assert_eq!(r.terminal.shell, "");
        assert_eq!(r.terminal.dossier_depart, "~");
        assert_eq!(r.terminal.defilement, 1000);
        assert!(r.terminal.reprendre_sessions);
        assert!(r.notifications.systeme && r.notifications.bulle && !r.notifications.son);
        // Désactivé par défaut : rien ne tourne tant que l'utilisateur ne l'a pas voulu.
        assert!(!r.superviseur.actif);
        assert_eq!(r.superviseur.niveau, NiveauAutonomie::Observer);
        assert_eq!(r.superviseur.nom, "Superviseur");
    }

    #[test]
    fn forme_json_camel_case() {
        let v = serde_json::to_value(ReglagesApp::default()).unwrap();
        assert_eq!(v["apparence"]["reduireAnimations"], false);
        assert_eq!(v["terminal"]["taillePolice"], 13);
        assert_eq!(v["terminal"]["dossierDepart"], "~");
        assert_eq!(v["terminal"]["copierSelection"], false);
        assert_eq!(v["terminal"]["police"], "integree");
        assert_eq!(v["superviseur"]["niveau"], "observer");
        assert_eq!(v["apparence"]["densite"], "normale");
    }

    #[test]
    fn json_partiel_complete_par_les_defauts() {
        let r: ReglagesApp =
            serde_json::from_str(r#"{"superviseur":{"actif":true,"niveau":"agir"}}"#).unwrap();
        assert!(r.superviseur.actif);
        assert_eq!(r.superviseur.niveau, NiveauAutonomie::Agir);
        assert_eq!(r.superviseur.nom, "Superviseur");
        assert_eq!(r.terminal, Terminal::default());
    }

    #[test]
    fn valeur_illisible_remplacee_par_son_defaut_sans_perdre_le_reste() {
        let r: ReglagesApp = serde_json::from_str(
            r##"{"apparence":{"densite":"enorme","accent":"#ff0000"},
                "terminal":{"police":3,"taillePolice":15},
                "notifications":"oui",
                "superviseur":{"actif":true,"niveau":"tout","nom":"Vigie"}}"##,
        )
        .unwrap();
        assert_eq!(r.apparence.densite, Densite::Normale);
        assert_eq!(r.apparence.accent, "#ff0000");
        assert_eq!(r.terminal.police, PoliceTerminal::Integree);
        assert_eq!(r.terminal.taille_police, 15);
        assert_eq!(r.notifications, Notifications::default());
        // Niveau inconnu : le plus prudent, sans perdre le reste de la section.
        assert_eq!(r.superviseur.niveau, NiveauAutonomie::Observer);
        assert!(r.superviseur.actif);
        assert_eq!(r.superviseur.nom, "Vigie");
        // Section au mauvais type interne : ses défauts (superviseur désactivé).
        let r: ReglagesApp = serde_json::from_str(
            r#"{"superviseur":{"actif":"oui"},"terminal":{"taillePolice":14}}"#,
        )
        .unwrap();
        assert_eq!(r.superviseur, Superviseur::default());
        assert_eq!(r.terminal.taille_police, 14);
    }

    #[test]
    fn normaliser_ramene_dans_les_bornes() {
        let mut r = ReglagesApp::default();
        r.apparence.accent = "rouge".into();
        r.terminal.taille_police = 99;
        r.terminal.defilement = 4000;
        r.terminal.dossier_depart = "   ".into();
        r.superviseur.nom = "   ".into();
        let n = normaliser(r);
        assert_eq!(n.apparence.accent, "#8f9bff");
        assert_eq!(n.terminal.taille_police, 20);
        assert_eq!(n.terminal.defilement, 5000);
        assert_eq!(n.terminal.dossier_depart, "~");
        assert_eq!(n.superviseur.nom, "Superviseur");

        let mut r = ReglagesApp::default();
        r.terminal.taille_police = 3;
        r.apparence.accent = " #B4F461 ".into();
        r.superviseur.nom = "Une vigie au nom bien trop long".into();
        let n = normaliser(r);
        assert_eq!(n.terminal.taille_police, 10);
        assert_eq!(n.apparence.accent, "#b4f461");
        assert_eq!(n.superviseur.nom.chars().count(), NOM_SUPERVISEUR_MAX);
    }

    #[test]
    fn normaliser_dedoublonne_les_paires_sans_ordre() {
        let mut r = ReglagesApp::default();
        let p = |a: &str, b: &str| PaireAutorisee {
            a: a.into(),
            b: b.into(),
            depuis: 1,
            echanges: 0,
        };
        r.superviseur.paires = vec![
            p("/a", "/b"),
            p("/b", "/a"),
            p("/a", "/a"),
            p("", "/c"),
            p("/c", "superviseur"),
        ];
        let n = normaliser(r);
        assert_eq!(
            n.superviseur.paires,
            vec![p("/a", "/b"), p("/c", "superviseur")]
        );
    }

    #[test]
    fn normaliser_est_idempotent() {
        let mut r = ReglagesApp::default();
        r.terminal.defilement = 12;
        r.superviseur.nom = " Vigie ".into();
        let une = normaliser(r);
        assert_eq!(normaliser(une.clone()), une);
    }
}
