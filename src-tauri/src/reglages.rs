//! Commandes Tauri des réglages de l'application (vue Paramètres).
//!
//! Un seul fichier de réglages (`~/.config/terminials/settings.json`), partagé avec le
//! dashboard d'activité : ces réglages vivent sous la clé `app` (cf.
//! `terminials_core::reglages`). Lus au démarrage avec le reste (`activity::init`),
//! normalisés et réécrits à chaque changement ; le front les applique en direct.
//!
//! Propriétaire : agent (d) « front des paramètres + persistance des réglages ».

use std::path::Path;
use std::sync::Arc;

use serde::Serialize;
use tauri::{AppHandle, Manager, State};
use terminials_core::reglages::{normaliser, ReglagesApp};

use crate::activity::{self, ActivityState};

/// Réglages tels que l'app les applique : normalisés à la lecture aussi, un fichier
/// édité à la main (taille 99, accent « rouge ») ne doit rien casser côté front.
#[tauri::command]
pub fn reglages_lire(st: State<'_, Arc<ActivityState>>) -> ReglagesApp {
    normaliser(activity::reglages_app(&st))
}

/// Normalise, enregistre et rend les réglages tels qu'écrits. Prévient le moteur du
/// superviseur (activation, pause, nom…).
#[tauri::command]
pub fn reglages_ecrire(app: AppHandle, reglages: ReglagesApp) -> Result<ReglagesApp, String> {
    let st = app.state::<Arc<ActivityState>>().inner().clone();
    let nouveaux = normaliser(reglages);
    let avant = activity::remplacer_reglages_app(&st, nouveaux.clone())?;
    if avant != nouveaux {
        crate::superviseur::reglages_changes(&app, &avant, &nouveaux);
    }
    Ok(nouveaux)
}

/// Ce que la section « À propos » affiche, et le shell de la session (choix « $SHELL »).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InfosApp {
    pub version: String,
    pub fichier_reglages: String,
    pub dossier_config: String,
    /// Dossier des données (base d'activité, session du superviseur) :
    /// `$XDG_DATA_HOME/terminials`, défaut `~/.local/share/terminials`.
    pub dossier_donnees: String,
    /// `$SHELL`, ou `/bin/bash` s'il est absent.
    pub shell_session: String,
    /// Shells installés (`/etc/shells`, un chemin existant par nom) : le choix « Shell par
    /// défaut » ne propose que ce qui peut vraiment se lancer.
    pub shells_disponibles: Vec<String>,
}

#[tauri::command]
pub fn reglages_infos(app: AppHandle) -> InfosApp {
    let fichier = terminials_core::activity::settings::default_path();
    let dossier = fichier
        .parent()
        .map(|p| p.display().to_string())
        .unwrap_or_default();
    let etc_shells = std::fs::read_to_string("/etc/shells").unwrap_or_default();
    InfosApp {
        version: app.package_info().version.to_string(),
        fichier_reglages: fichier.display().to_string(),
        dossier_config: dossier,
        dossier_donnees: activity::db_path()
            .parent()
            .map(|p| p.display().to_string())
            .unwrap_or_default(),
        shell_session: std::env::var("SHELL")
            .ok()
            .filter(|s| !s.is_empty())
            .unwrap_or_else(|| "/bin/bash".into()),
        shells_disponibles: shells_disponibles(&etc_shells, |p| p.is_file()),
    }
}

/// Shells interactifs proposés, lus dans le contenu de `/etc/shells` : commentaires,
/// lignes vides, shells de service (`nologin`, `false`, `git-shell`…) et shells minimaux
/// sans édition de ligne (`sh`, `dash` : un agent de code y est inutilisable) écartés, un seul
/// chemin par nom (le premier qui existe : `/bin/bash` et `/usr/bin/bash` sont le même
/// shell sur un système fusionné). Pure, l'existence est injectée pour les tests.
pub fn shells_disponibles(etc_shells: &str, existe: impl Fn(&Path) -> bool) -> Vec<String> {
    const ECARTES: [&str; 8] = [
        "nologin",
        "false",
        "true",
        "git-shell",
        "rbash",
        "screen",
        "sh",
        "dash",
    ];
    let mut vus: Vec<String> = Vec::new();
    let mut shells = Vec::new();
    for ligne in etc_shells.lines() {
        let chemin = ligne.split('#').next().unwrap_or("").trim();
        if !chemin.starts_with('/') {
            continue;
        }
        let Some(nom) = Path::new(chemin).file_name().and_then(|n| n.to_str()) else {
            continue;
        };
        if ECARTES.contains(&nom) || vus.iter().any(|v| v == nom) || !existe(Path::new(chemin)) {
            continue;
        }
        vus.push(nom.to_string());
        shells.push(chemin.to_string());
    }
    shells
}

#[cfg(test)]
mod tests {
    use super::*;
    use terminials_core::activity::settings::{self, Settings};
    use terminials_core::reglages::{Densite, NiveauAutonomie, PaireAutorisee};

    /// Dossier temporaire propre au test (pas de dépendance `tempfile` dans ce crate).
    struct Temp(std::path::PathBuf);
    impl Temp {
        fn new(nom: &str) -> Self {
            let d = std::env::temp_dir().join(format!(
                "terminials-reglages-{nom}-{}-{}",
                std::process::id(),
                std::time::SystemTime::now()
                    .duration_since(std::time::UNIX_EPOCH)
                    .unwrap()
                    .as_nanos()
            ));
            std::fs::create_dir_all(&d).unwrap();
            Temp(d)
        }
        fn fichier(&self) -> std::path::PathBuf {
            self.0.join("terminials").join("settings.json")
        }
    }
    impl Drop for Temp {
        fn drop(&mut self) {
            let _ = std::fs::remove_dir_all(&self.0);
        }
    }

    /// Ce que fait `remplacer_reglages_app`, sur un chemin de test : relire le fichier
    /// commun, ne remplacer que `app`, réécrire.
    fn ecrire_app(chemin: &Path, app: ReglagesApp) {
        let mut complet = settings::load(chemin).unwrap();
        complet.app = normaliser(app);
        settings::save(chemin, &complet).unwrap();
    }

    #[test]
    fn fichier_absent_donne_les_defauts() {
        let t = Temp::new("absent");
        let lus = settings::load(&t.fichier()).unwrap();
        assert_eq!(normaliser(lus.app), ReglagesApp::default());
    }

    #[test]
    fn fichier_corrompu_est_signale_sans_planter_et_reecrit_proprement() {
        let t = Temp::new("corrompu");
        let f = t.fichier();
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(&f, "{ pas du json").unwrap();
        // `activity::init` prend les défauts sur cette erreur : rien ne panique.
        assert!(settings::load(&f).is_err());
        // La première écriture des réglages repart des défauts et rend un fichier lisible.
        let mut complet = Settings::default();
        complet.app.terminal.taille_police = 15;
        settings::save(&f, &complet).unwrap();
        assert_eq!(settings::load(&f).unwrap().app.terminal.taille_police, 15);
    }

    #[test]
    fn ancien_fichier_sans_cle_app_migre_vers_les_defauts_sans_perdre_l_activite() {
        let t = Temp::new("migration");
        let f = t.fichier();
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(
            &f,
            r#"{"schedule":{"hour":9,"minute":30},"ticketPatterns":["T-\\d+"]}"#,
        )
        .unwrap();
        assert_eq!(settings::load(&f).unwrap().app, ReglagesApp::default());

        let mut app = ReglagesApp::default();
        app.apparence.densite = Densite::Compacte;
        ecrire_app(&f, app);
        let relus = settings::load(&f).unwrap();
        assert_eq!(relus.app.apparence.densite, Densite::Compacte);
        assert_eq!(relus.schedule.hour, 9, "la moitié activité est conservée");
        assert_eq!(relus.schedule.minute, 30);
        assert_eq!(relus.ticket_patterns, vec!["T-\\d+".to_string()]);
    }

    #[test]
    fn bloc_app_partiel_est_complete_et_les_valeurs_hors_bornes_ramenees_a_la_lecture() {
        let t = Temp::new("partiel");
        let f = t.fichier();
        std::fs::create_dir_all(f.parent().unwrap()).unwrap();
        std::fs::write(
            &f,
            r#"{"app":{"terminal":{"taillePolice":99,"defilement":7000},"apparence":{"accent":"rouge"},
                "superviseur":{"nom":"  Vigie  ","niveau":"agir"}}}"#,
        )
        .unwrap();
        let app = normaliser(settings::load(&f).unwrap().app);
        assert_eq!(app.terminal.taille_police, 20);
        assert_eq!(app.terminal.defilement, 5000);
        assert_eq!(app.apparence.accent, "#8f9bff");
        assert_eq!(app.superviseur.nom, "Vigie");
        assert_eq!(app.superviseur.niveau, NiveauAutonomie::Agir);
        assert!(app.terminal.reprendre_sessions, "champ absent : défaut");
        assert!(app.notifications.bulle);
    }

    #[test]
    fn ecriture_puis_lecture_rend_les_memes_reglages_en_0600() {
        use std::os::unix::fs::PermissionsExt;
        let t = Temp::new("aller-retour");
        let f = t.fichier();
        let mut app = ReglagesApp::default();
        app.apparence.accent = "#B4F461".into();
        app.terminal.shell = "/usr/bin/fish".into();
        app.terminal.dossier_depart = "~/dev".into();
        app.notifications.son = true;
        app.superviseur.actif = true;
        app.superviseur.paires = vec![PaireAutorisee {
            a: "/x/site".into(),
            b: "/x/api".into(),
            depuis: 1_700_000_000_000,
            echanges: 2,
        }];
        ecrire_app(&f, app.clone());
        let relus = settings::load(&f).unwrap().app;
        assert_eq!(relus, normaliser(app));
        assert_eq!(relus.apparence.accent, "#b4f461");
        let mode = std::fs::metadata(&f).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }

    #[test]
    fn forme_json_des_infos_en_camel_case() {
        let infos = InfosApp {
            version: "0.1.0".into(),
            fichier_reglages: "/h/.config/terminials/settings.json".into(),
            dossier_config: "/h/.config/terminials".into(),
            dossier_donnees: "/h/.local/share/terminials".into(),
            shell_session: "/bin/zsh".into(),
            shells_disponibles: vec!["/bin/bash".into()],
        };
        let v = serde_json::to_value(&infos).unwrap();
        for cle in [
            "version",
            "fichierReglages",
            "dossierConfig",
            "dossierDonnees",
            "shellSession",
            "shellsDisponibles",
        ] {
            assert!(v.get(cle).is_some(), "clé {cle} absente");
        }
    }

    #[test]
    fn shells_disponibles_un_par_nom_sans_shell_de_service() {
        let etc = "# /etc/shells: valid login shells\n/bin/sh\n/usr/bin/dash\n/bin/bash\n/usr/bin/bash\n\n/usr/sbin/nologin\n/bin/zsh # commentaire\n/usr/bin/fish\n/usr/bin/git-shell\nrelatif/ksh\n";
        let existe = |p: &Path| p != Path::new("/bin/zsh");
        assert_eq!(
            shells_disponibles(etc, existe),
            vec!["/bin/bash", "/usr/bin/fish"]
        );
        assert!(shells_disponibles("", |_| true).is_empty());
    }
}
