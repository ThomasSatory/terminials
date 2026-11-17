//! Moteur du superviseur : une session du CLI `claude` local, pilotée en mode non
//! interactif (`-p --output-format stream-json --verbose`, reprise par `--resume`),
//! réveillée par les événements que le front signale, regroupés et limités en fréquence
//! (`terminials_core::superviseur::planif`). Ses outils sont les sous-commandes de la CLI
//! `terminials`, qui passent par le socket et le pont vers le front, où s'applique le
//! garde-fou. DÉSACTIVÉ par défaut : tant que `superviseur.actif` est faux (ou en pause),
//! aucun process n'est lancé, aucun jeton n'est consommé.
//!
//! Ce fichier ne fait que brancher le moteur (`terminials_core::superviseur::moteur`,
//! testé avec un faux `claude`) sur Tauri : événements vers la webview, état des
//! espaces demandé au front par le pont, réglages en mémoire.

use std::sync::{Arc, OnceLock};

use protocol::{Origine, Outil};
use tauri::{AppHandle, Emitter, Manager, State};
use terminials_core::reglages::{ReglagesApp, Superviseur as ReglagesSuperviseur};
use terminials_core::superviseur::moteur::{ConfigMoteur, Hote, LanceurClaude, Moteur, DELAI_TOUR};
use terminials_core::superviseur::planif::ParametresPlanif;
use terminials_core::superviseur::{session, EtatMoteur, EvenementSuperviseur, FluxSuperviseur};

use crate::activity::{self, ActivityState};

/// Événement émis vers la webview (charge : `FluxSuperviseur`).
pub const EVENEMENT_FLUX: &str = "superviseur-flux";

/// Variables d'environnement à ne pas transmettre au `claude` du superviseur : celles
/// d'un terminal d'espace (ses appels prendraient l'origine de cet espace) et celle qui
/// fait refuser à `claude` de démarrer « dans » une autre session Claude Code (app
/// lancée depuis un terminal où tourne un agent).
const ENV_RETIREES: [&str; 3] = ["TERMINIALS_WORKSPACE_ID", "TERMINIALS_PTY_ID", "CLAUDECODE"];

/// État du moteur, géré par Tauri (`.manage(Arc<EtatSuperviseur>)`).
pub struct EtatSuperviseur {
    /// Secret de ce lancement de l'app, passé au `claude` du superviseur par
    /// `TERMINIALS_SUPERVISEUR_JETON` : seul un appel d'outil qui le présente a
    /// l'origine « superviseur ». Jamais montré au front ni écrit sur disque.
    jeton: String,
    /// Créé par `demarrer` (il lui faut l'`AppHandle`).
    moteur: OnceLock<Moteur>,
}

/// 128 bits aléatoires du noyau, en hexadécimal. Repli (lecture impossible) : horloge
/// et pid, moins imprévisible mais jamais vide.
fn nouveau_jeton() -> String {
    use std::io::Read;
    let mut octets = [0u8; 16];
    let lu = std::fs::File::open("/dev/urandom").and_then(|mut f| f.read_exact(&mut octets));
    if lu.is_err() {
        let t = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let graine = t ^ (u128::from(std::process::id()) << 64);
        octets = graine.to_le_bytes();
    }
    octets.iter().map(|o| format!("{o:02x}")).collect()
}

pub fn init() -> EtatSuperviseur {
    EtatSuperviseur {
        jeton: nouveau_jeton(),
        moteur: OnceLock::new(),
    }
}

/// Jeton de ce lancement, pour reconnaître les processus lancés par le superviseur
/// (socket.rs, `lignee_porte_jeton`). Ne quitte jamais le backend.
pub fn jeton(app: &AppHandle) -> String {
    app.state::<Arc<EtatSuperviseur>>().jeton.clone()
}

/// Vrai si `candidat` est le jeton du superviseur de ce lancement (socket.rs).
pub fn jeton_valide(app: &AppHandle, candidat: &str) -> bool {
    let st = app.state::<Arc<EtatSuperviseur>>();
    !candidat.is_empty() && candidat == st.jeton
}

/// L'application vue par le moteur.
struct HoteTauri {
    app: AppHandle,
}

impl Hote for HoteTauri {
    fn emettre(&self, flux: FluxSuperviseur) {
        if let Err(e) = self.app.emit(EVENEMENT_FLUX, &flux) {
            eprintln!("superviseur : événement non émis : {e}");
        }
    }

    /// Même réponse que `terminials espaces` pour le superviseur. Appelé depuis le
    /// thread d'un tour (jamais depuis le runtime async) : `block_on` est sûr.
    /// `interne` : lecture du moteur pour l'invite, pas une action du superviseur ; le
    /// front ne l'inscrit pas au fil (la CLI ne peut pas poser ce drapeau, et il ne
    /// change rien au garde-fou : c'est un outil d'observation).
    fn etat_espaces(&self) -> Result<serde_json::Value, String> {
        let reponse = tauri::async_runtime::block_on(crate::pont::requete_front(
            &self.app,
            Outil::EspacesEtat,
            serde_json::json!({ "interne": true }),
            Origine::Superviseur,
            crate::pont::DELAI_REPONSE,
        ));
        if reponse.ok {
            Ok(reponse.data)
        } else {
            Err(reponse.erreur.unwrap_or_else(|| "réponse vide".into()))
        }
    }

    fn reglages(&self) -> ReglagesSuperviseur {
        let st = self.app.state::<Arc<ActivityState>>();
        activity::reglages_app(&st).superviseur
    }
}

/// `PATH` hérité, précédé du dossier de l'exécutable : la CLI `terminials` est
/// installée à côté de `terminials-app`, et c'est elle que le superviseur appelle.
fn path_avec_cli() -> String {
    let herite = std::env::var("PATH").unwrap_or_default();
    let dossier_exe = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(|d| d.display().to_string()));
    match dossier_exe {
        Some(d) if herite.is_empty() => d,
        Some(d) => format!("{d}:{herite}"),
        None => herite,
    }
}

/// Démarre le thread du moteur (appelé une fois, dans `setup`). Ne lance aucun
/// `claude` tant que le superviseur n'est pas activé.
pub fn demarrer(app: AppHandle) {
    let st = app.state::<Arc<EtatSuperviseur>>().inner().clone();
    let dossier = session::dossier(
        std::env::var("XDG_DATA_HOME").ok(),
        std::env::var("HOME").ok(),
    );
    let lanceur = LanceurClaude {
        binaire: "claude".into(),
        dossier: dossier.clone(),
        env: vec![
            (
                protocol::ENV_JETON_SUPERVISEUR.to_string(),
                st.jeton.clone(),
            ),
            ("PATH".to_string(), path_avec_cli()),
        ],
        env_retire: ENV_RETIREES.iter().map(|s| s.to_string()).collect(),
    };
    let config = ConfigMoteur {
        planif: ParametresPlanif::default(),
        delai_tour: DELAI_TOUR,
        dossier_session: dossier,
    };
    let moteur = Moteur::demarrer(
        Arc::new(HoteTauri { app: app.clone() }),
        Arc::new(lanceur),
        config,
    );
    if st.moteur.set(moteur).is_err() {
        return;
    }
    // Fenêtre fermée : le tour en cours est tué tout de suite. (Si l'app est tuée
    // sans passer par là, le `claude` meurt avec le thread qui l'a lancé.)
    if let Some(fenetre) = app.get_webview_window("main") {
        let st = st.clone();
        fenetre.on_window_event(move |e| {
            if matches!(e, tauri::WindowEvent::Destroyed) {
                if let Some(m) = st.moteur.get() {
                    m.quitter();
                }
            }
        });
    }
}

/// Arrêt de l'application : le tour en cours est tué et le moteur attend sa fin (au plus
/// quelques secondes), pour qu'aucun `claude` ne survive à l'app.
pub fn arreter(app: &AppHandle) {
    if let Some(m) = app.state::<Arc<EtatSuperviseur>>().moteur.get() {
        m.arreter();
    }
}

/// Les réglages viennent de changer (reglages.rs) : activation, désactivation, pause,
/// nom ou niveau. Désactiver ou mettre en pause arrête le tour en cours et vide la file.
pub fn reglages_changes(app: &AppHandle, avant: &ReglagesApp, apres: &ReglagesApp) {
    if avant.superviseur == apres.superviseur {
        return;
    }
    if let Some(m) = app.state::<Arc<EtatSuperviseur>>().moteur.get() {
        m.reglages_changes(avant.superviseur.clone(), apres.superviseur.clone());
    }
}

/// Un événement à prendre en compte (front). Ignoré si le superviseur est inactif ou en
/// pause : rien n'est mis en file, aucun jeton ne sera consommé.
#[tauri::command]
pub fn superviseur_signaler(
    st: State<'_, Arc<EtatSuperviseur>>,
    evenement: EvenementSuperviseur,
) -> Result<(), String> {
    match st.moteur.get() {
        Some(m) => {
            m.signaler(evenement);
            Ok(())
        }
        None => Err("le moteur du superviseur n'est pas démarré".into()),
    }
}

#[tauri::command]
pub fn superviseur_etat(st: State<'_, Arc<EtatSuperviseur>>) -> EtatMoteur {
    st.moteur.get().map(Moteur::etat).unwrap_or_default()
}

/// Interrompt le tour en cours (process tué) et vide la file.
#[tauri::command]
pub fn superviseur_interrompre(st: State<'_, Arc<EtatSuperviseur>>) {
    if let Some(m) = st.moteur.get() {
        m.interrompre();
    }
}

/// Oublie la session : le prochain tour repart d'une conversation neuve.
#[tauri::command]
pub fn superviseur_nouvelle_session(st: State<'_, Arc<EtatSuperviseur>>) -> Result<(), String> {
    match st.moteur.get() {
        Some(m) => {
            m.nouvelle_session();
            Ok(())
        }
        None => Err("le moteur du superviseur n'est pas démarré".into()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn le_jeton_est_long_et_change_a_chaque_lancement() {
        let a = nouveau_jeton();
        let b = nouveau_jeton();
        assert_eq!(a.len(), 32);
        assert!(a.chars().all(|c| c.is_ascii_hexdigit()));
        assert_ne!(a, b);
    }

    #[test]
    fn le_path_commence_par_le_dossier_de_l_executable() {
        let p = path_avec_cli();
        let exe = std::env::current_exe().unwrap();
        assert!(p.starts_with(&exe.parent().unwrap().display().to_string()));
    }
}
