//! Boucle du moteur du superviseur, indépendante de Tauri : file d'événements,
//! cadence (`planif`), tours de `claude` (un à la fois, dans un thread), reprise de
//! session, arrêts. L'hôte (`Hote` : événements vers le front, état des espaces,
//! réglages) et le lancement du process (`Lanceur`) sont des traits : les tests
//! pilotent tout le moteur avec un faux `claude`, sans jamais lancer le vrai.

use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

use crate::activity::providers::claude_process::{
    run_claude_stream, ClaudeProcessError, FinFlux, OptionsFlux,
};
use crate::reglages::Superviseur as ReglagesSuperviseur;

use super::consigne::{arguments, consigne_systeme, invite_reveil, ContexteReveil};
use super::flux::{analyser_ligne, LigneFlux};
use super::planif::{self, Decision, EtatPlanif, ParametresPlanif, Recu};
use super::{session, EtatMoteur, EvenementSuperviseur, FluxSuperviseur};

/// Délai maximal d'un tour : au-delà, `claude` est tué.
pub const DELAI_TOUR: Duration = Duration::from_secs(240);
/// Délai laissé au tour en cours pour s'arrêter quand le moteur s'arrête.
const DELAI_ARRET: Duration = Duration::from_secs(3);

/// Ce que le moteur demande à l'application.
pub trait Hote: Send + Sync {
    /// Événement `superviseur-flux` vers le front.
    fn emettre(&self, flux: FluxSuperviseur);
    /// Réponse de l'outil `espaces.etat` (origine superviseur), pour l'invite.
    fn etat_espaces(&self) -> Result<serde_json::Value, String>;
    /// Réglages du superviseur en vigueur.
    fn reglages(&self) -> ReglagesSuperviseur;
    /// Epoch ms.
    fn maintenant(&self) -> i64 {
        chrono::Utc::now().timestamp_millis()
    }
}

/// Lance un tour de `claude` et en rend la sortie ligne à ligne. Le vrai :
/// `LanceurClaude` ; les tests : un faux qui joue des lignes enregistrées.
pub trait Lanceur: Send + Sync {
    fn lancer(
        &self,
        args: &[String],
        invite: &str,
        delai: Duration,
        arret: &AtomicBool,
        sur_ligne: &mut dyn FnMut(&str),
    ) -> Result<FinFlux, ClaudeProcessError>;
}

/// Le vrai `claude`, lancé par `run_claude_stream`.
pub struct LanceurClaude {
    pub binaire: String,
    /// Répertoire de travail (`session::dossier`), créé au besoin.
    pub dossier: PathBuf,
    pub env: Vec<(String, String)>,
    pub env_retire: Vec<String>,
}

impl Lanceur for LanceurClaude {
    fn lancer(
        &self,
        args: &[String],
        invite: &str,
        delai: Duration,
        arret: &AtomicBool,
        sur_ligne: &mut dyn FnMut(&str),
    ) -> Result<FinFlux, ClaudeProcessError> {
        std::fs::create_dir_all(&self.dossier).map_err(|e| {
            ClaudeProcessError::Spawn(format!("dossier {} : {e}", self.dossier.display()))
        })?;
        let o = OptionsFlux {
            binaire: &self.binaire,
            args,
            entree: invite,
            dossier: Some(&self.dossier),
            env: &self.env,
            env_retire: &self.env_retire,
            delai,
            arret,
        };
        run_claude_stream(&o, sur_ligne)
    }
}

/// Paramètres du moteur.
#[derive(Debug, Clone)]
pub struct ConfigMoteur {
    pub planif: ParametresPlanif,
    pub delai_tour: Duration,
    /// Dossier de la session enregistrée (`session::dossier`).
    pub dossier_session: PathBuf,
}

enum Commande {
    Signaler(EvenementSuperviseur),
    Reglages {
        avant: ReglagesSuperviseur,
        apres: ReglagesSuperviseur,
    },
    Interrompre,
    NouvelleSession,
    FinTour {
        numero: u64,
        erreur: Option<String>,
    },
    Quitter,
}

/// Ce que la boucle et les tours partagent.
struct Partage {
    etat: Mutex<EtatMoteur>,
    session: Mutex<Option<String>>,
    /// Incrémenté par « nouvelle session » : un tour lancé avant n'enregistre pas sa
    /// session (elle serait reprise alors que l'utilisateur l'a oubliée).
    generation: AtomicU64,
}

/// Le moteur : un thread de planification, et au plus un thread de tour.
pub struct Moteur {
    tx: mpsc::Sender<Commande>,
    hote: Arc<dyn Hote>,
    partage: Arc<Partage>,
    boucle: Mutex<Option<JoinHandle<()>>>,
}

impl Moteur {
    /// Démarre la boucle. Aucun process n'est lancé tant qu'aucun événement n'arrive
    /// avec le superviseur actif et hors pause.
    pub fn demarrer(
        hote: Arc<dyn Hote>,
        lanceur: Arc<dyn Lanceur>,
        config: ConfigMoteur,
    ) -> Moteur {
        let (tx, rx) = mpsc::channel();
        let partage = Arc::new(Partage {
            etat: Mutex::new(EtatMoteur::default()),
            session: Mutex::new(session::charger(&config.dossier_session)),
            generation: AtomicU64::new(0),
        });
        let boucle = {
            let ctx = Boucle {
                hote: hote.clone(),
                lanceur,
                config,
                partage: partage.clone(),
                tx: tx.clone(),
            };
            std::thread::Builder::new()
                .name("superviseur".into())
                .spawn(move || ctx.tourner(rx))
                .expect("thread du superviseur")
        };
        Moteur {
            tx,
            hote,
            partage,
            boucle: Mutex::new(Some(boucle)),
        }
    }

    /// Un événement du front. Ignoré si le superviseur est inactif ou en pause.
    pub fn signaler(&self, evenement: EvenementSuperviseur) {
        let _ = self.tx.send(Commande::Signaler(evenement));
    }

    /// Les réglages ont changé : désactiver ou mettre en pause arrête tout.
    pub fn reglages_changes(&self, avant: ReglagesSuperviseur, apres: ReglagesSuperviseur) {
        let _ = self.tx.send(Commande::Reglages { avant, apres });
    }

    /// Tue le tour en cours et vide la file.
    pub fn interrompre(&self) {
        let _ = self.tx.send(Commande::Interrompre);
    }

    /// Oublie la session : le prochain tour repart d'une conversation neuve.
    pub fn nouvelle_session(&self) {
        let _ = self.tx.send(Commande::NouvelleSession);
    }

    /// Demande l'arrêt sans l'attendre (fermeture de la fenêtre).
    pub fn quitter(&self) {
        let _ = self.tx.send(Commande::Quitter);
    }

    /// Arrête le moteur et attend la fin de la boucle (le tour en cours est tué).
    pub fn arreter(&self) {
        self.quitter();
        let fil = self.boucle.lock().unwrap_or_else(|e| e.into_inner()).take();
        if let Some(fil) = fil {
            let _ = fil.join();
        }
    }

    pub fn etat(&self) -> EtatMoteur {
        let mut e = self
            .partage
            .etat
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        let r = self.hote.reglages();
        e.actif = r.actif && !r.pause;
        e.session_id = self
            .partage
            .session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        e
    }
}

impl Drop for Moteur {
    fn drop(&mut self) {
        self.arreter();
    }
}

struct TourEnCours {
    numero: u64,
    arret: Arc<AtomicBool>,
    fil: JoinHandle<()>,
}

struct Boucle {
    hote: Arc<dyn Hote>,
    lanceur: Arc<dyn Lanceur>,
    config: ConfigMoteur,
    partage: Arc<Partage>,
    tx: mpsc::Sender<Commande>,
}

impl Boucle {
    fn tourner(self, rx: mpsc::Receiver<Commande>) {
        let mut planif = EtatPlanif::default();
        let mut omis: u32 = 0;
        let mut tour: Option<TourEnCours> = None;
        let mut numero: u64 = 0;
        let mut derniere_erreur: Option<String> = None;

        loop {
            let maintenant = self.hote.maintenant();
            planif::purger(&mut planif, maintenant);
            let attente = match planif::decider(&planif, maintenant, &self.config.planif) {
                Decision::Lancer => {
                    // Revérifié au moment de lancer, pas seulement à la mise en file : si
                    // l'avis de désactivation n'est pas arrivé (réglages changés par un
                    // autre chemin), aucun process ne part quand même.
                    let r = self.hote.reglages();
                    if !r.actif || r.pause {
                        planif.file.clear();
                        omis = 0;
                        continue;
                    }
                    numero += 1;
                    let evenements = planif::noter_lancement(&mut planif, maintenant);
                    tour = Some(self.lancer_tour(numero, evenements, std::mem::take(&mut omis)));
                    self.publier(&planif, derniere_erreur.clone());
                    continue;
                }
                Decision::Attendre(ms) => ms.map(|ms| Duration::from_millis(ms.max(1) as u64)),
            };
            self.publier(&planif, derniere_erreur.clone());

            let commande = match attente {
                Some(d) => match rx.recv_timeout(d) {
                    Ok(c) => c,
                    Err(mpsc::RecvTimeoutError::Timeout) => continue,
                    Err(mpsc::RecvTimeoutError::Disconnected) => break,
                },
                None => match rx.recv() {
                    Ok(c) => c,
                    Err(_) => break,
                },
            };
            let maintenant = self.hote.maintenant();
            match commande {
                Commande::Signaler(evenement) => {
                    let r = self.hote.reglages();
                    // Inactif ou en pause : rien en file, aucun jeton ne sera consommé.
                    if r.actif && !r.pause {
                        omis += planif::ajouter(
                            &mut planif.file,
                            Recu {
                                a: maintenant,
                                evenement,
                            },
                        );
                    }
                }
                Commande::Reglages { avant, apres } => {
                    let desactive = avant.actif && !apres.actif;
                    let en_pause = apres.actif && apres.pause && !avant.pause;
                    if desactive || en_pause {
                        let raison = if desactive {
                            "Superviseur désactivé."
                        } else {
                            "En pause."
                        };
                        self.arreter_tout(&mut planif, &mut omis, tour.as_ref(), raison);
                    }
                }
                Commande::Interrompre => {
                    self.arreter_tout(&mut planif, &mut omis, tour.as_ref(), "Interrompu.");
                }
                Commande::NouvelleSession => {
                    self.partage.generation.fetch_add(1, Ordering::SeqCst);
                    *self
                        .partage
                        .session
                        .lock()
                        .unwrap_or_else(|e| e.into_inner()) = None;
                    if let Err(e) = session::enregistrer(&self.config.dossier_session, None) {
                        eprintln!("superviseur : session non oubliée sur disque : {e}");
                    }
                }
                Commande::FinTour { numero: n, erreur } => {
                    if tour.as_ref().is_some_and(|t| t.numero == n) {
                        if let Some(t) = tour.take() {
                            let _ = t.fil.join();
                        }
                        planif::noter_fin(&mut planif, maintenant);
                        derniere_erreur = erreur;
                    }
                }
                Commande::Quitter => break,
            }
        }

        // Arrêt du moteur : le tour en cours est tué, et on lui laisse un instant pour
        // finir (le process est de toute façon lié à la vie de son thread).
        if let Some(t) = tour {
            t.arret.store(true, Ordering::SeqCst);
            let debut = std::time::Instant::now();
            while !t.fil.is_finished() && debut.elapsed() < DELAI_ARRET {
                std::thread::sleep(Duration::from_millis(20));
            }
            if t.fil.is_finished() {
                let _ = t.fil.join();
            }
        }
    }

    /// Désactivation, pause, interruption : la file est vidée, le tour tué, le front
    /// prévenu. Le tour reste « en cours » jusqu'à ce que son thread rende la main,
    /// pour qu'un nouveau ne démarre jamais à côté d'un process qui meurt.
    fn arreter_tout(
        &self,
        planif: &mut EtatPlanif,
        omis: &mut u32,
        tour: Option<&TourEnCours>,
        raison: &str,
    ) {
        planif.file.clear();
        *omis = 0;
        if let Some(t) = tour {
            t.arret.store(true, Ordering::SeqCst);
        }
        self.hote.emettre(FluxSuperviseur::Arret {
            raison: raison.into(),
        });
    }

    fn publier(&self, planif: &EtatPlanif, derniere_erreur: Option<String>) {
        let mut e = self.partage.etat.lock().unwrap_or_else(|e| e.into_inner());
        e.en_cours = planif.en_cours;
        e.en_file = planif.file.len() as u32;
        e.dernier_tour = planif.dernier_tour;
        e.derniere_erreur = derniere_erreur;
        e.tours_heure = planif.tours_auto.len() as u32;
    }

    fn lancer_tour(&self, numero: u64, evenements: Vec<Recu>, omis: u32) -> TourEnCours {
        let arret = Arc::new(AtomicBool::new(false));
        let tour = Tour {
            hote: self.hote.clone(),
            lanceur: self.lanceur.clone(),
            partage: self.partage.clone(),
            dossier_session: self.config.dossier_session.clone(),
            delai: self.config.delai_tour,
            arret: arret.clone(),
        };
        let tx = self.tx.clone();
        let evenements: Vec<EvenementSuperviseur> =
            evenements.into_iter().map(|r| r.evenement).collect();
        let fil = std::thread::Builder::new()
            .name("superviseur-tour".into())
            .spawn(move || {
                let erreur = tour.executer(&evenements, omis);
                let _ = tx.send(Commande::FinTour { numero, erreur });
            })
            .expect("thread d'un tour du superviseur");
        TourEnCours { numero, arret, fil }
    }
}

/// Un tour : invite, process, lecture du flux, reprise de session.
struct Tour {
    hote: Arc<dyn Hote>,
    lanceur: Arc<dyn Lanceur>,
    partage: Arc<Partage>,
    dossier_session: PathBuf,
    delai: Duration,
    arret: Arc<AtomicBool>,
}

/// Ce qu'un essai a vu passer.
#[derive(Default)]
struct Recolte {
    init: bool,
    fin: Option<(bool, Option<String>, Option<f64>)>,
}

impl Tour {
    fn arrete(&self) -> bool {
        self.arret.load(Ordering::SeqCst)
    }

    fn noter_session(&self, generation: u64, id: &str) {
        if self.partage.generation.load(Ordering::SeqCst) != generation || !session::id_valide(id) {
            return;
        }
        let mut s = self
            .partage
            .session
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if s.as_deref() != Some(id) {
            *s = Some(id.to_string());
            if let Err(e) = session::enregistrer(&self.dossier_session, Some(id)) {
                eprintln!("superviseur : session non enregistrée : {e}");
            }
        }
    }

    fn oublier_session(&self, generation: u64) {
        if self.partage.generation.load(Ordering::SeqCst) != generation {
            return;
        }
        *self
            .partage
            .session
            .lock()
            .unwrap_or_else(|e| e.into_inner()) = None;
        let _ = session::enregistrer(&self.dossier_session, None);
    }

    /// Joue le tour. Rend l'erreur affichée (None si réussi ou interrompu).
    fn executer(&self, evenements: &[EvenementSuperviseur], omis: u32) -> Option<String> {
        let r = self.hote.reglages();
        let etat_espaces = self.hote.etat_espaces();
        if self.arrete() {
            return None;
        }
        let contexte = ContexteReveil {
            nom: r.nom.clone(),
            niveau: r.niveau,
            paires: r.paires.clone(),
            etat_espaces,
            omis,
        };
        let invite = invite_reveil(&contexte, evenements);
        let consigne = consigne_systeme();
        self.hote.emettre(FluxSuperviseur::TourDebut {
            nb_evenements: evenements.len() as u32,
        });

        let generation = self.partage.generation.load(Ordering::SeqCst);
        let mut reprise = self
            .partage
            .session
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .clone();
        loop {
            let args = arguments(&consigne, reprise.as_deref());
            let mut recolte = Recolte::default();
            let hote = self.hote.clone();
            let arret = self.arret.clone();
            // Dernier texte reçu, émis à la ligne suivante seulement : quand le tour échoue
            // (limite d'usage atteinte…), `claude` envoie l'erreur d'abord comme un texte de
            // l'assistant puis dans le `result` en erreur. Relayé tout de suite, le message
            // s'affichait deux fois dans le fil (texte brut, puis « Tour interrompu »).
            let mut texte_en_attente: Option<String> = None;
            let emettre_texte = |t: String| {
                if !arret.load(Ordering::SeqCst) {
                    hote.emettre(FluxSuperviseur::Texte { texte: t });
                }
            };
            let resultat =
                self.lanceur
                    .lancer(&args, &invite, self.delai, &self.arret, &mut |ligne| {
                        for l in analyser_ligne(ligne) {
                            match &l {
                                LigneFlux::Fin { ok: false, erreur, .. } => {
                                    // Le texte n'était que l'erreur du tour : le bilan la dira.
                                    if let Some(t) = texte_en_attente.take() {
                                        let doublon = erreur.as_deref().is_some_and(|e| {
                                            e.trim() == t.trim() || e.contains(t.trim())
                                        });
                                        if !doublon {
                                            emettre_texte(t);
                                        }
                                    }
                                }
                                LigneFlux::Autre => {}
                                _ => {
                                    if let Some(t) = texte_en_attente.take() {
                                        emettre_texte(t);
                                    }
                                }
                            }
                            match l {
                                LigneFlux::Init { session_id } => {
                                    recolte.init = true;
                                    self.noter_session(generation, &session_id);
                                }
                                LigneFlux::Texte(texte) => {
                                    texte_en_attente = Some(texte);
                                }
                                LigneFlux::ResultatOutil {
                                    erreur: true,
                                    texte,
                                    ..
                                } => {
                                    // Commande refusée par les permissions (hors `terminials`) :
                                    // le front ne la voit pas passer, on la garde au journal.
                                    eprintln!(
                                        "superviseur : appel refusé ou en échec : {}",
                                        court(&texte, 200)
                                    );
                                }
                                LigneFlux::Fin {
                                    session_id,
                                    ok,
                                    erreur,
                                    cout_usd,
                                } => {
                                    if let Some(id) = session_id {
                                        self.noter_session(generation, &id);
                                    }
                                    recolte.fin = Some((ok, erreur, cout_usd));
                                }
                                LigneFlux::Outil { .. }
                                | LigneFlux::ResultatOutil { .. }
                                | LigneFlux::Autre => {}
                            }
                        }
                    });
            if self.arrete() || matches!(resultat, Ok(FinFlux::Interrompu)) {
                // Le front a déjà reçu `arret` : pas de fin de tour à afficher.
                return None;
            }
            // Flux coupé sans `result` : le dernier texte reste à montrer.
            if let Some(t) = texte_en_attente.take() {
                emettre_texte(t);
            }
            // Reprise impossible (session effacée, autre machine…) : on l'oublie et on
            // recommence une seule fois dans une conversation neuve.
            if reprise.is_some() && !recolte.init && session_introuvable(&resultat, &recolte) {
                self.oublier_session(generation);
                reprise = None;
                continue;
            }
            let (ok, erreur, cout_usd) = bilan(resultat, recolte);
            self.hote.emettre(FluxSuperviseur::TourFin {
                ok,
                erreur: erreur.clone(),
                cout_usd,
            });
            return erreur;
        }
    }
}

fn court(s: &str, max: usize) -> String {
    let t = s.trim();
    if t.chars().count() <= max {
        t.to_string()
    } else {
        format!("{}…", t.chars().take(max).collect::<String>())
    }
}

/// Message d'erreur de `claude` (texte du `result` ou stderr) quand la session à
/// reprendre n'existe plus.
fn session_introuvable(resultat: &Result<FinFlux, ClaudeProcessError>, recolte: &Recolte) -> bool {
    let mut textes = Vec::new();
    if let Some((false, Some(e), _)) = &recolte.fin {
        textes.push(e.to_lowercase());
    }
    if let Err(ClaudeProcessError::Failed { stderr, .. }) = resultat {
        textes.push(stderr.to_lowercase());
    }
    textes.iter().any(|t| {
        t.contains("no conversation found")
            || (t.contains("session") && (t.contains("not found") || t.contains("introuvable")))
    })
}

/// Erreur brute de `claude` rendue lisible : non connecté, ou message court.
pub fn erreur_lisible(brut: &str) -> String {
    let b = brut.to_lowercase();
    let auth = [
        "not logged in",
        "/login",
        "invalid api key",
        "authentication",
        "oauth token",
        "unauthorized",
    ];
    if auth.iter().any(|m| b.contains(m)) {
        return "Claude Code n'est pas connecté : lancez « claude » dans un terminal et connectez-vous (/login).".into();
    }
    if b.contains("credit balance")
        || b.contains("usage limit")
        || b.contains("rate limit")
        || b.contains("spend limit")
    {
        // Message en français ; seule l'heure de remise à zéro est reprise du texte brut.
        let remise = brut
            .split(['·', '|', '\n'])
            .map(str::trim)
            .find_map(|p| {
                p.strip_prefix("resets ")
                    .or_else(|| p.strip_prefix("Resets "))
            })
            .map(|h| format!(" (remise à zéro : {})", court(h, 40)));
        return format!(
            "Limite d'utilisation de Claude atteinte{}. Le superviseur reprendra au prochain réveil.",
            remise.unwrap_or_default()
        );
    }
    format!("claude a échoué : {}", court(brut, 300))
}

/// (ok, erreur, coût) d'un essai terminé (ni interrompu, ni à recommencer).
fn bilan(
    resultat: Result<FinFlux, ClaudeProcessError>,
    recolte: Recolte,
) -> (bool, Option<String>, Option<f64>) {
    let cout = recolte.fin.as_ref().and_then(|f| f.2);
    match (resultat, recolte.fin) {
        (Err(ClaudeProcessError::Spawn(msg)), _) => (
            false,
            Some(format!(
                "Le CLI « claude » est introuvable ({msg}) : installez Claude Code, ou rendez-le accessible dans le PATH de l'app."
            )),
            None,
        ),
        (Err(ClaudeProcessError::Timeout), _) => (
            false,
            Some(format!("Tour interrompu : plus de {} s sans conclure.", DELAI_TOUR.as_secs())),
            cout,
        ),
        // Le `result` dit mieux que le code de sortie ce qui s'est passé.
        (Err(ClaudeProcessError::Failed { .. }), Some((false, Some(e), _))) => (false, Some(erreur_lisible(&e)), cout),
        (Err(ClaudeProcessError::Failed { code, stderr }), _) => {
            let brut = if stderr.trim().is_empty() { format!("code de sortie {code}") } else { stderr };
            (false, Some(erreur_lisible(&brut)), cout)
        }
        (Ok(_), Some((true, _, c))) => (true, None, c),
        (Ok(_), Some((false, e, c))) => (false, Some(erreur_lisible(e.as_deref().unwrap_or("erreur"))), c),
        (Ok(_), None) => (false, Some("claude s'est arrêté sans conclure le tour.".into()), None),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::reglages::NiveauAutonomie;
    use crate::superviseur::GenreEvenement;
    use std::collections::VecDeque;

    /// Hôte de test : réglages modifiables, événements émis relevés.
    struct FauxHote {
        reglages: Mutex<ReglagesSuperviseur>,
        emis: Mutex<Vec<FluxSuperviseur>>,
        etat: Mutex<Result<serde_json::Value, String>>,
    }

    impl FauxHote {
        fn new(actif: bool) -> Arc<FauxHote> {
            let r = ReglagesSuperviseur {
                actif,
                nom: "Vigie".into(),
                ..ReglagesSuperviseur::default()
            };
            Arc::new(FauxHote {
                reglages: Mutex::new(r),
                emis: Mutex::new(Vec::new()),
                etat: Mutex::new(Ok(serde_json::json!({"espaces":[],"groupes":[]}))),
            })
        }
        fn emis(&self) -> Vec<FluxSuperviseur> {
            self.emis.lock().unwrap().clone()
        }
        fn regler(
            &self,
            f: impl FnOnce(&mut ReglagesSuperviseur),
        ) -> (ReglagesSuperviseur, ReglagesSuperviseur) {
            let mut r = self.reglages.lock().unwrap();
            let avant = r.clone();
            f(&mut r);
            (avant, r.clone())
        }
    }

    impl Hote for FauxHote {
        fn emettre(&self, flux: FluxSuperviseur) {
            self.emis.lock().unwrap().push(flux);
        }
        fn etat_espaces(&self) -> Result<serde_json::Value, String> {
            self.etat.lock().unwrap().clone()
        }
        fn reglages(&self) -> ReglagesSuperviseur {
            self.reglages.lock().unwrap().clone()
        }
    }

    /// Ce qu'un faux `claude` fait pour un lancement.
    #[derive(Clone)]
    enum Script {
        /// Écrit ces lignes puis se termine avec ce résultat.
        Lignes(Vec<String>, Result<(), ClaudeProcessError>),
        /// Écrit ces lignes puis attend qu'on l'arrête (tour long).
        Bloque(Vec<String>),
    }

    /// Lanceur de test : rejoue des scripts, relève les arguments et invites.
    struct FauxLanceur {
        scripts: Mutex<VecDeque<Script>>,
        appels: Mutex<Vec<(Vec<String>, String)>>,
        vivants: AtomicU64,
    }

    impl FauxLanceur {
        fn new(scripts: Vec<Script>) -> Arc<FauxLanceur> {
            Arc::new(FauxLanceur {
                scripts: Mutex::new(scripts.into()),
                appels: Mutex::new(Vec::new()),
                vivants: AtomicU64::new(0),
            })
        }
        fn appels(&self) -> Vec<(Vec<String>, String)> {
            self.appels.lock().unwrap().clone()
        }
    }

    impl Lanceur for FauxLanceur {
        fn lancer(
            &self,
            args: &[String],
            invite: &str,
            _delai: Duration,
            arret: &AtomicBool,
            sur_ligne: &mut dyn FnMut(&str),
        ) -> Result<FinFlux, ClaudeProcessError> {
            self.appels
                .lock()
                .unwrap()
                .push((args.to_vec(), invite.to_string()));
            let script = self
                .scripts
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Script::Lignes(vec![fin_ok()], Ok(())));
            self.vivants.fetch_add(1, Ordering::SeqCst);
            let res = match script {
                Script::Lignes(lignes, res) => {
                    for l in lignes {
                        sur_ligne(&l);
                    }
                    res.map(|_| FinFlux::Termine)
                }
                Script::Bloque(lignes) => {
                    for l in lignes {
                        sur_ligne(&l);
                    }
                    while !arret.load(Ordering::SeqCst) {
                        std::thread::sleep(Duration::from_millis(5));
                    }
                    Ok(FinFlux::Interrompu)
                }
            };
            self.vivants.fetch_sub(1, Ordering::SeqCst);
            res
        }
    }

    fn init(id: &str) -> String {
        format!(r#"{{"type":"system","subtype":"init","session_id":"{id}"}}"#)
    }
    fn texte(t: &str) -> String {
        serde_json::json!({"type":"assistant","message":{"content":[{"type":"text","text":t}]},"parent_tool_use_id":null})
            .to_string()
    }
    fn fin_ok() -> String {
        r#"{"type":"result","subtype":"success","is_error":false,"result":"","total_cost_usd":0.01}"#.into()
    }

    fn config(dossier: &std::path::Path) -> ConfigMoteur {
        ConfigMoteur {
            planif: ParametresPlanif {
                regroupement_ms: 30,
                regroupement_message_ms: 5,
                intervalle_min_ms: 0,
                max_tours_heure: 100,
            },
            delai_tour: Duration::from_secs(5),
            dossier_session: dossier.to_path_buf(),
        }
    }

    fn message(t: &str) -> EvenementSuperviseur {
        EvenementSuperviseur {
            genre: GenreEvenement::Message,
            texte: t.into(),
            ws_id: None,
        }
    }
    fn attente(t: &str) -> EvenementSuperviseur {
        EvenementSuperviseur {
            genre: GenreEvenement::Attente,
            texte: t.into(),
            ws_id: Some("ws:1".into()),
        }
    }

    /// Attend qu'une condition devienne vraie (au plus 3 s).
    fn attendre(mut f: impl FnMut() -> bool) {
        let debut = std::time::Instant::now();
        while !f() {
            assert!(
                debut.elapsed() < Duration::from_secs(3),
                "condition jamais remplie"
            );
            std::thread::sleep(Duration::from_millis(5));
        }
    }

    fn nb_fins(h: &FauxHote) -> usize {
        h.emis()
            .iter()
            .filter(|f| matches!(f, FluxSuperviseur::TourFin { .. }))
            .count()
    }

    #[test]
    fn desactive_par_defaut_aucun_process() {
        let d = tempfile::tempdir().unwrap();
        let hote = FauxHote::new(false);
        let lanceur = FauxLanceur::new(vec![]);
        let m = Moteur::demarrer(hote.clone(), lanceur.clone(), config(d.path()));
        m.signaler(message("bonjour"));
        m.signaler(attente("api attend"));
        std::thread::sleep(Duration::from_millis(120));
        assert!(lanceur.appels().is_empty());
        assert!(hote.emis().is_empty());
        assert_eq!(m.etat().en_file, 0);
        assert!(!m.etat().actif);
        // En pause : pareil.
        hote.regler(|r| {
            r.actif = true;
            r.pause = true;
        });
        m.signaler(message("bonjour"));
        std::thread::sleep(Duration::from_millis(80));
        assert!(lanceur.appels().is_empty());
        assert!(!m.etat().actif);
    }

    #[test]
    fn un_tour_emet_debut_textes_fin_et_garde_la_session() {
        let d = tempfile::tempdir().unwrap();
        let hote = FauxHote::new(true);
        let lanceur = FauxLanceur::new(vec![
            Script::Lignes(
                vec![init("sess-1"), texte("Tout va bien."), fin_ok()],
                Ok(()),
            ),
            Script::Lignes(vec![init("sess-1"), fin_ok()], Ok(())),
        ]);
        let m = Moteur::demarrer(hote.clone(), lanceur.clone(), config(d.path()));
        m.signaler(message("Où en sont mes agents ?"));
        attendre(|| nb_fins(&hote) == 1);
        assert_eq!(
            hote.emis(),
            vec![
                FluxSuperviseur::TourDebut { nb_evenements: 1 },
                FluxSuperviseur::Texte {
                    texte: "Tout va bien.".into()
                },
                FluxSuperviseur::TourFin {
                    ok: true,
                    erreur: None,
                    cout_usd: Some(0.01)
                },
            ]
        );
        let (args, invite) = lanceur.appels()[0].clone();
        assert!(!args.contains(&"--resume".to_string()));
        assert!(invite.contains("Ton nom : Vigie."));
        assert!(invite.contains("« Où en sont mes agents ? »"));
        assert_eq!(session::charger(d.path()).as_deref(), Some("sess-1"));
        attendre(|| !m.etat().en_cours);
        assert_eq!(m.etat().session_id.as_deref(), Some("sess-1"));

        // Le tour suivant reprend la session.
        m.signaler(message("Et maintenant ?"));
        attendre(|| nb_fins(&hote) == 2);
        let (args, _) = lanceur.appels()[1].clone();
        let i = args.iter().position(|a| a == "--resume").expect("--resume");
        assert_eq!(args[i + 1], "sess-1");
    }

    #[test]
    fn rafale_regroupee_en_un_seul_tour() {
        let d = tempfile::tempdir().unwrap();
        let hote = FauxHote::new(true);
        let lanceur = FauxLanceur::new(vec![]);
        let m = Moteur::demarrer(hote.clone(), lanceur.clone(), config(d.path()));
        m.signaler(attente("api attend"));
        m.signaler(attente("site attend"));
        m.signaler(attente("api attend")); // doublon
        attendre(|| nb_fins(&hote) == 1);
        std::thread::sleep(Duration::from_millis(60));
        assert_eq!(lanceur.appels().len(), 1);
        assert_eq!(
            hote.emis()[0],
            FluxSuperviseur::TourDebut { nb_evenements: 2 }
        );
        let invite = &lanceur.appels()[0].1;
        assert!(invite.contains("- Attente : api attend [ws:1]"));
        assert!(invite.contains("- Attente : site attend [ws:1]"));
    }

    #[test]
    fn un_seul_tour_a_la_fois_le_reste_attend() {
        let d = tempfile::tempdir().unwrap();
        let hote = FauxHote::new(true);
        let lanceur = FauxLanceur::new(vec![Script::Bloque(vec![texte("Je regarde.")])]);
        let m = Moteur::demarrer(hote.clone(), lanceur.clone(), config(d.path()));
        m.signaler(message("un"));
        attendre(|| lanceur.vivants.load(Ordering::SeqCst) == 1);
        m.signaler(message("deux"));
        std::thread::sleep(Duration::from_millis(60));
        assert_eq!(lanceur.appels().len(), 1);
        assert_eq!(m.etat().en_file, 1);
        assert!(m.etat().en_cours);
        // Le tour bloqué est interrompu : file vidée, arret émis, rien d'autre lancé.
        m.interrompre();
        attendre(|| lanceur.vivants.load(Ordering::SeqCst) == 0);
        attendre(|| !m.etat().en_cours);
        std::thread::sleep(Duration::from_millis(60));
        assert_eq!(lanceur.appels().len(), 1);
        assert_eq!(m.etat().en_file, 0);
        let emis = hote.emis();
        assert!(emis.contains(&FluxSuperviseur::Arret {
            raison: "Interrompu.".into()
        }));
        assert!(!emis
            .iter()
            .any(|f| matches!(f, FluxSuperviseur::TourFin { .. })));
    }

    #[test]
    fn desactiver_ou_mettre_en_pause_tue_le_tour() {
        for pause in [false, true] {
            let d = tempfile::tempdir().unwrap();
            let hote = FauxHote::new(true);
            let lanceur = FauxLanceur::new(vec![Script::Bloque(vec![])]);
            let m = Moteur::demarrer(hote.clone(), lanceur.clone(), config(d.path()));
            m.signaler(message("un"));
            attendre(|| lanceur.vivants.load(Ordering::SeqCst) == 1);
            let (avant, apres) = hote.regler(|r| {
                if pause {
                    r.pause = true
                } else {
                    r.actif = false
                }
            });
            m.reglages_changes(avant, apres);
            attendre(|| lanceur.vivants.load(Ordering::SeqCst) == 0);
            let raison = if pause {
                "En pause."
            } else {
                "Superviseur désactivé."
            };
            attendre(|| {
                hote.emis().contains(&FluxSuperviseur::Arret {
                    raison: raison.into(),
                })
            });
            // Les événements suivants sont ignorés.
            m.signaler(message("deux"));
            std::thread::sleep(Duration::from_millis(60));
            assert_eq!(lanceur.appels().len(), 1);
        }
    }

    #[test]
    fn desactive_sans_avis_rien_ne_part_de_la_file() {
        // Événement mis en file superviseur actif, puis réglages coupés sans que
        // `reglages_changes` soit appelé : au moment de lancer, rien ne part.
        let d = tempfile::tempdir().unwrap();
        let hote = FauxHote::new(true);
        let lanceur = FauxLanceur::new(vec![]);
        let mut c = config(d.path());
        c.planif.regroupement_ms = 250;
        let m = Moteur::demarrer(hote.clone(), lanceur.clone(), c);
        m.signaler(attente("api attend"));
        attendre(|| m.etat().en_file == 1);
        hote.regler(|r| r.actif = false);
        std::thread::sleep(Duration::from_millis(400));
        assert!(lanceur.appels().is_empty());
        assert_eq!(m.etat().en_file, 0);
        assert!(hote.emis().is_empty());
    }

    #[test]
    fn changer_de_nom_ou_de_niveau_n_arrete_rien() {
        let d = tempfile::tempdir().unwrap();
        let hote = FauxHote::new(true);
        let lanceur = FauxLanceur::new(vec![
            Script::Lignes(vec![fin_ok()], Ok(())),
            Script::Lignes(vec![fin_ok()], Ok(())),
        ]);
        let m = Moteur::demarrer(hote.clone(), lanceur.clone(), config(d.path()));
        let (avant, apres) = hote.regler(|r| {
            r.nom = "Phare".into();
            r.niveau = NiveauAutonomie::Agir;
        });
        m.reglages_changes(avant, apres);
        m.signaler(message("salut"));
        attendre(|| nb_fins(&hote) == 1);
        assert!(!hote
            .emis()
            .iter()
            .any(|f| matches!(f, FluxSuperviseur::Arret { .. })));
        // Le nom et le niveau à jour arrivent dans l'invite (la consigne est figée).
        let invite = &lanceur.appels()[0].1;
        assert!(invite.contains("Ton nom : Phare."));
        assert!(invite.contains("Niveau d'autonomie : Agir"));
    }

    #[test]
    fn reprise_introuvable_oubliee_puis_nouvel_essai() {
        let d = tempfile::tempdir().unwrap();
        session::enregistrer(d.path(), Some("ancienne")).unwrap();
        let hote = FauxHote::new(true);
        let lanceur = FauxLanceur::new(vec![
            Script::Lignes(
                vec![],
                Err(ClaudeProcessError::Failed {
                    code: 1,
                    stderr: "No conversation found with session ID: ancienne".into(),
                }),
            ),
            Script::Lignes(vec![init("neuve"), texte("Me revoilà."), fin_ok()], Ok(())),
        ]);
        let m = Moteur::demarrer(hote.clone(), lanceur.clone(), config(d.path()));
        m.signaler(message("salut"));
        attendre(|| nb_fins(&hote) == 1);
        let appels = lanceur.appels();
        assert_eq!(appels.len(), 2);
        assert!(appels[0].0.contains(&"ancienne".to_string()));
        assert!(!appels[1].0.contains(&"--resume".to_string()));
        assert_eq!(session::charger(d.path()).as_deref(), Some("neuve"));
        assert!(hote.emis().contains(&FluxSuperviseur::TourFin {
            ok: true,
            erreur: None,
            cout_usd: Some(0.01)
        }));
    }

    #[test]
    fn nouvelle_session_oublie_la_reprise() {
        let d = tempfile::tempdir().unwrap();
        session::enregistrer(d.path(), Some("vieille")).unwrap();
        let hote = FauxHote::new(true);
        let lanceur = FauxLanceur::new(vec![]);
        let m = Moteur::demarrer(hote.clone(), lanceur.clone(), config(d.path()));
        assert_eq!(m.etat().session_id.as_deref(), Some("vieille"));
        m.nouvelle_session();
        attendre(|| m.etat().session_id.is_none());
        assert_eq!(session::charger(d.path()), None);
        m.signaler(message("salut"));
        attendre(|| nb_fins(&hote) == 1);
        assert!(!lanceur.appels()[0].0.contains(&"--resume".to_string()));
    }

    #[test]
    fn erreurs_lisibles_cli_absent_ou_non_connecte() {
        let d = tempfile::tempdir().unwrap();
        let hote = FauxHote::new(true);
        let lanceur = FauxLanceur::new(vec![
            Script::Lignes(vec![], Err(ClaudeProcessError::Spawn("No such file or directory (os error 2)".into()))),
            Script::Lignes(
                vec![
                    init("s"),
                    r#"{"type":"result","subtype":"success","is_error":true,"result":"Not logged in · Please run /login"}"#
                        .into(),
                ],
                Err(ClaudeProcessError::Failed { code: 1, stderr: String::new() }),
            ),
        ]);
        let m = Moteur::demarrer(hote.clone(), lanceur.clone(), config(d.path()));
        m.signaler(message("un"));
        attendre(|| nb_fins(&hote) == 1);
        m.signaler(message("deux"));
        attendre(|| nb_fins(&hote) == 2);
        let erreurs: Vec<String> = hote
            .emis()
            .into_iter()
            .filter_map(|f| match f {
                FluxSuperviseur::TourFin {
                    ok: false,
                    erreur: Some(e),
                    ..
                } => Some(e),
                _ => None,
            })
            .collect();
        assert!(erreurs[0].contains("introuvable"), "{}", erreurs[0]);
        assert!(erreurs[1].contains("pas connecté"), "{}", erreurs[1]);
        attendre(|| {
            m.etat()
                .derniere_erreur
                .as_deref()
                .is_some_and(|e| e.contains("pas connecté"))
        });
    }

    #[test]
    fn etat_des_espaces_dans_l_invite_ou_indisponible() {
        let d = tempfile::tempdir().unwrap();
        let hote = FauxHote::new(true);
        *hote.etat.lock().unwrap() = Err("l'interface n'a pas répondu à temps".into());
        let lanceur = FauxLanceur::new(vec![]);
        let m = Moteur::demarrer(hote.clone(), lanceur.clone(), config(d.path()));
        m.signaler(message("?"));
        attendre(|| nb_fins(&hote) == 1);
        assert!(lanceur.appels()[0]
            .1
            .contains("indisponible (l'interface n'a pas répondu à temps)"));
    }

    #[test]
    fn arreter_le_moteur_tue_le_tour_en_cours() {
        let d = tempfile::tempdir().unwrap();
        let hote = FauxHote::new(true);
        let lanceur = FauxLanceur::new(vec![Script::Bloque(vec![])]);
        let m = Moteur::demarrer(hote.clone(), lanceur.clone(), config(d.path()));
        m.signaler(message("un"));
        attendre(|| lanceur.vivants.load(Ordering::SeqCst) == 1);
        m.arreter();
        assert_eq!(lanceur.vivants.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn bilan_des_cas_limites() {
        let (ok, e, _) = bilan(Err(ClaudeProcessError::Timeout), Recolte::default());
        assert!(!ok && e.unwrap().contains("240 s"));
        let (ok, e, _) = bilan(Ok(FinFlux::Termine), Recolte::default());
        assert!(!ok && e.unwrap().contains("sans conclure"));
        let (ok, e, _) = bilan(
            Err(ClaudeProcessError::Failed {
                code: 2,
                stderr: "boum".into(),
            }),
            Recolte::default(),
        );
        assert!(!ok && e.unwrap().contains("boum"));
        assert!(erreur_lisible("Invalid API key · Fix external API key").contains("pas connecté"));
        let limite = erreur_lisible("You've hit your individual spend limit · resets 8:10pm");
        assert!(limite.starts_with("Limite d'utilisation de Claude atteinte (remise à zéro : 8:10pm)"), "{limite}");
        assert!(!limite.contains("You've"));
    }

    #[test]
    fn tour_en_erreur_ne_relaie_pas_son_message_comme_un_texte() {
        let d = tempfile::tempdir().unwrap();
        let hote = FauxHote::new(true);
        let lanceur = FauxLanceur::new(vec![Script::Lignes(
            vec![
                init("s"),
                texte("You've hit your individual spend limit · resets 8:10pm"),
                r#"{"type":"result","subtype":"success","is_error":true,"result":"You've hit your individual spend limit · resets 8:10pm"}"#
                    .into(),
            ],
            Ok(()),
        )]);
        let m = Moteur::demarrer(hote.clone(), lanceur.clone(), config(d.path()));
        m.signaler(message("un"));
        attendre(|| nb_fins(&hote) == 1);
        let emis = hote.emis();
        assert!(
            !emis.iter().any(|f| matches!(f, FluxSuperviseur::Texte { .. })),
            "le message d'erreur ne passe qu'une fois, en fin de tour : {emis:?}"
        );
    }
}
