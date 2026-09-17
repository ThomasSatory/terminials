//! Câblage Tauri du dashboard d'activité : état partagé, commandes `activity_*`
//! et planificateur (collecte périodique + synthèses du matin).

use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::mpsc::{Receiver, Sender};
use std::sync::{Arc, Mutex, MutexGuard, RwLock, RwLockReadGuard, RwLockWriteGuard};
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use terminials_core::activity::collectors::shell::ShellPairer;
use terminials_core::activity::collectors::{claude, clickup, git};
use terminials_core::activity::providers::clickup::ClickupClient;
use terminials_core::activity::providers::llm::{self, LlmError};
use terminials_core::activity::settings::{self, ScheduleSettings, Settings};
use terminials_core::activity::shell_integration::{default_shims_dir, install_shims};
use terminials_core::activity::store::{Store, StoreResult};
use terminials_core::activity::summaries::{self, SummaryKind};
use terminials_core::activity::{
    repo_root, ActivityEvent, ActivityStats, CollectReport, NewEvent, OpenTask, Summary,
};

/// Nombre maximum d'erreurs de collecte conservées pour le bandeau du dashboard.
const MAX_ERREURS: usize = 20;
/// Cadence de collecte git + Claude Code (secondes).
const CADENCE_GIT_CLAUDE: i64 = 300;
/// Cadence de collecte ClickUp (secondes) : l'API est distante et bien plus lente.
const CADENCE_CLICKUP: i64 = 900;
/// Période du planificateur.
const PERIODE_TICK: Duration = Duration::from_secs(60);
/// Fenêtre relue à chaque collecte ClickUp (7 jours en arrière, 1 jour en avant).
const FENETRE_CLICKUP_ARRIERE: i64 = 7 * 86_400;
const FENETRE_CLICKUP_AVANT: i64 = 86_400;
/// Nom du curseur mémorisant le dernier jour dont les synthèses ont été lancées.
const CURSEUR_DERNIER_JOUR: &str = "summary_last_day";
/// Délai minimal entre deux tentatives de génération des synthèses (secondes).
/// Le jeton LLM périme toutes les 6 h (spec §5) : un échec à 07:00 est un état
/// normal, qui doit coûter une tentative toutes les 30 min, pas une par minute.
const REPLI_SYNTHESES: i64 = 1800;

/// État partagé du dashboard, géré par Tauri (`.manage`).
///
/// `Store` embarque une connexion rusqlite (`Send` mais pas `Sync`) : un
/// `Mutex<Option<Store>>` suffit et sérialise tous les accès à la base. `None`
/// signifie que la base n'a pas pu s'ouvrir ; la raison est dans `open_error` et
/// toute commande touchant la base répond alors `Err`.
pub struct ActivityState {
    pub store: Mutex<Option<Store>>,
    pub open_error: Mutex<Option<String>>,
    pub settings: RwLock<Settings>,
    pub pairer: Mutex<ShellPairer>,
    /// `None` si l'installation des shims a échoué → intégration shell désactivée.
    pub shims_dir: Option<PathBuf>,
    /// "git" | "claude" | "clickup" → epoch s du dernier passage.
    pub last_collect: Mutex<HashMap<String, i64>>,
    /// Dernières erreurs de collecte (au plus `MAX_ERREURS`).
    pub errors: Mutex<Vec<String>>,
    /// Epoch s de la dernière tentative de génération des synthèses, `0` si aucune.
    /// Remis à `0` par `activity_set_settings` : un jeton fraîchement saisi doit
    /// pouvoir être essayé tout de suite.
    pub dernier_essai_syntheses: Mutex<i64>,
    /// Voie d'écriture des événements shell. Le thread lecteur du PTY ne fait qu'y
    /// pousser : ni verrou du store, ni `git rev-parse`, dans la boucle qui alimente
    /// l'affichage du terminal.
    pub shell_tx: Sender<NewEvent>,
    /// Extrémité de lecture, prise une seule fois par `start_scheduler`.
    shell_rx: Mutex<Option<Receiver<NewEvent>>>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityStatus {
    pub last_collect: HashMap<String, i64>,
    pub errors: Vec<String>,
    pub shell_integration: bool,
    pub db_error: Option<String>,
}

/// Ce qu'un tick du planificateur doit déclencher.
#[derive(Debug, Clone, PartialEq)]
pub struct TickPlan {
    pub collect_git_claude: bool,
    pub collect_clickup: bool,
    pub summaries_for: Option<chrono::NaiveDate>,
}

// ---------------------------------------------------------------------------
// Accès aux verrous, tolérants à l'empoisonnement.
//
// Un `Mutex` empoisonné le reste définitivement : si un collecteur panique verrou
// tenu, un `lock().unwrap()` ferait paniquer *tous* les accès suivants — le
// `catch_unwind` du planificateur ne ferait que répéter la panique chaque minute,
// et surtout le thread lecteur de chaque PTY mourrait dans `on_shell_command` /
// `on_shell_exit` sans jamais émettre `pty-exit`, laissant le front croire le pane
// vivant. Aucune donnée de cet état ne repose sur un invariant qu'une panique
// pourrait casser (la base a ses propres transactions), donc on récupère la valeur
// telle quelle et on continue.
// ---------------------------------------------------------------------------

fn verrou<T>(m: &Mutex<T>) -> MutexGuard<'_, T> {
    m.lock().unwrap_or_else(|e| e.into_inner())
}

fn lecture<T>(l: &RwLock<T>) -> RwLockReadGuard<'_, T> {
    l.read().unwrap_or_else(|e| e.into_inner())
}

fn ecriture<T>(l: &RwLock<T>) -> RwLockWriteGuard<'_, T> {
    l.write().unwrap_or_else(|e| e.into_inner())
}

/// Garde du store ouvert, ou le message d'erreur d'ouverture mémorisé. Unique
/// point de repli « base indisponible » de tout le module.
fn store_ouvert(st: &ActivityState) -> Result<MutexGuard<'_, Option<Store>>, String> {
    let guard = verrou(&st.store);
    if guard.is_none() {
        return Err(verrou(&st.open_error)
            .clone()
            .unwrap_or_else(|| "base d'activité indisponible".to_string()));
    }
    Ok(guard)
}

fn now_s() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_secs() as i64).unwrap_or(0)
}

fn now_ms() -> i64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map(|d| d.as_millis() as i64).unwrap_or(0)
}

/// Vrai si la source n'a jamais tourné ou si `cadence` secondes se sont écoulées.
fn du_pour(last: &HashMap<String, i64>, source: &str, now_utc: i64, cadence: i64) -> bool {
    match last.get(source) {
        Some(prev) => now_utc - prev >= cadence,
        None => true,
    }
}

/// Décision pure d'un tick du planificateur.
///
/// `now_local` sert uniquement à décider des synthèses (heure et jour locaux) ;
/// les cadences de collecte se comparent en epoch UTC. Le rattrapage au démarrage
/// est implicite : au premier tick passé l'heure prévue, `last_summary_day` vaut
/// la veille (ou rien), donc les synthèses partent immédiatement.
///
/// `last_summary_attempt` (epoch s, `None` si aucune tentative) impose le repli de
/// `REPLI_SYNTHESES` : le curseur `summary_last_day` n'avançant que sur un succès,
/// une cause d'échec durable (jeton expiré, réseau coupé) relancerait sinon deux
/// appels LLM à chaque tick de 60 s jusqu'à minuit.
pub fn plan_tick(
    now_utc: i64,
    now_local: chrono::NaiveDateTime,
    last: &HashMap<String, i64>,
    last_summary_day: Option<&str>,
    last_summary_attempt: Option<i64>,
    schedule: &ScheduleSettings,
) -> TickPlan {
    use chrono::{Datelike, Timelike, Weekday};

    let today = now_local.date();
    let jour_ouvre = !matches!(today.weekday(), Weekday::Sat | Weekday::Sun);
    let heure_atteinte =
        (now_local.hour(), now_local.minute()) >= (schedule.hour as u32, schedule.minute as u32);
    let deja_fait = last_summary_day == Some(today.format("%Y-%m-%d").to_string().as_str());
    let repli_ecoule = match last_summary_attempt {
        Some(essai) => now_utc - essai >= REPLI_SYNTHESES,
        None => true,
    };

    let summaries_for =
        if (jour_ouvre || !schedule.weekdays_only) && heure_atteinte && !deja_fait && repli_ecoule {
            Some(summaries::last_working_day(today))
        } else {
            None
        };

    TickPlan {
        collect_git_claude: du_pour(last, "git", now_utc, CADENCE_GIT_CLAUDE),
        collect_clickup: du_pour(last, "clickup", now_utc, CADENCE_CLICKUP),
        summaries_for,
    }
}

/// Construit l'état au démarrage. Aucune erreur n'est fatale : réglages illisibles
/// → défauts, base inouvrable → commandes en erreur mais l'app démarre.
pub fn init() -> ActivityState {
    let mut errors = Vec::new();

    let settings = match settings::load(&settings::default_path()) {
        Ok(s) => s,
        Err(e) => {
            errors.push(format!("réglages illisibles, défauts appliqués : {e}"));
            Settings::default()
        }
    };

    let (store, open_error) = match Store::open(&db_path()) {
        Ok(s) => (Some(s), None),
        Err(e) => (None, Some(format!("base d'activité inutilisable : {e}"))),
    };
    if let Some(msg) = &open_error {
        errors.push(msg.clone());
    }

    // Les shims sont posés une fois pour toutes, indépendamment de
    // `shell.integration` : ce sont trois petits fichiers dans le répertoire
    // runtime, et les garder disponibles permet d'activer l'intégration depuis
    // les réglages sans redémarrer l'application. C'est `spawn_pty` qui consulte
    // le drapeau pour décider de s'en servir ou non.
    let dir = default_shims_dir();
    let shims_dir = match install_shims(&dir) {
        Ok(()) => Some(dir),
        Err(e) => {
            errors.push(format!("intégration shell indisponible : {e}"));
            None
        }
    };

    let (shell_tx, shell_rx) = std::sync::mpsc::channel();

    ActivityState {
        store: Mutex::new(store),
        open_error: Mutex::new(open_error),
        settings: RwLock::new(settings),
        pairer: Mutex::new(ShellPairer::new()),
        shims_dir,
        last_collect: Mutex::new(HashMap::new()),
        errors: Mutex::new(errors),
        dernier_essai_syntheses: Mutex::new(0),
        shell_tx,
        shell_rx: Mutex::new(Some(shell_rx)),
    }
}

/// `$XDG_DATA_HOME/terminials/activity.db`, défaut `~/.local/share/terminials/activity.db`.
pub fn db_path() -> PathBuf {
    db_path_depuis(std::env::var("XDG_DATA_HOME").ok(), std::env::var("HOME").ok())
}

/// Cœur pur de `db_path` : les deux variables d'environnement sont passées en
/// paramètres, ce qui rend la règle testable sans toucher à l'environnement du
/// process (partagé par tous les tests, qui tournent en parallèle).
pub fn db_path_depuis(xdg_data_home: Option<String>, home: Option<String>) -> PathBuf {
    let base = xdg_data_home
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(home.unwrap_or_else(|| "/tmp".into())).join(".local").join("share")
        });
    base.join("terminials").join("activity.db")
}

/// Ajoute des erreurs à l'état en ne gardant que les `MAX_ERREURS` plus récentes.
///
/// Un message déjà présent est ignoré : une cause durable (jeton expiré) se
/// répétant à chaque tentative, sans cette garde le plafond était atteint en dix
/// passages et le bandeau ne contenait plus que la même phrase, les erreurs de
/// collecte git/claude/clickup ayant été chassées de la liste.
fn pousser_erreurs(st: &ActivityState, nouvelles: &[String]) {
    if nouvelles.is_empty() {
        return;
    }
    let mut errors = verrou(&st.errors);
    for msg in nouvelles {
        if !errors.iter().any(|e| e == msg) {
            errors.push(msg.clone());
        }
    }
    let trop = errors.len().saturating_sub(MAX_ERREURS);
    if trop > 0 {
        errors.drain(0..trop);
    }
}

/// Exécute les collecteurs demandés, met à jour l'horodatage de chaque source et
/// émet `activity-updated` après chacune.
///
/// Le verrou du store est pris source par source (et relâché entre deux) : la
/// collecte ClickUp fait des appels réseau verrou tenu, mais elle est la seule
/// écrivain de sa table et le reste de l'app ne fait que lire — acceptable en v1,
/// le client HTTP a son propre délai maximum.
pub fn run_collect(app: &AppHandle, st: &ActivityState, sources: &[&str]) -> CollectReport {
    let now = now_s();
    let mut report = CollectReport::default();

    let (patterns, author, token) = {
        let s = lecture(&st.settings);
        (s.ticket_patterns.clone(), s.git.author_email.clone(), s.clickup.token.clone())
    };
    let client = if token.is_empty() { None } else { Some(ClickupClient::new(&token)) };

    for source in sources {
        {
            let guard = match store_ouvert(st) {
                Ok(g) => g,
                Err(msg) => {
                    report.errors.push(msg);
                    break;
                }
            };
            let store = guard.as_ref().expect("store présent : garanti par store_ouvert");
            match *source {
                "git" => {
                    let (n, errs) = git::collect(store, author.as_deref(), &patterns, now);
                    report.git += n;
                    report.errors.extend(errs);
                }
                "claude" => {
                    match claude::collect(store, &claude::default_projects_dir(), &patterns, now) {
                        Ok(n) => report.claude += n,
                        Err(e) => report.errors.push(format!("collecte Claude Code : {e}")),
                    }
                }
                "clickup" => {
                    let from = now - FENETRE_CLICKUP_ARRIERE;
                    let to = now + FENETRE_CLICKUP_AVANT;
                    match clickup::collect(store, client.as_ref(), from, to, now) {
                        Ok(n) => report.clickup += n,
                        Err(e) => report.errors.push(format!("collecte ClickUp : {e}")),
                    }
                }
                autre => report.errors.push(format!("source de collecte inconnue : {autre}")),
            }
        }
        verrou(&st.last_collect).insert((*source).to_string(), now);
        let _ = app.emit("activity-updated", serde_json::json!({ "source": source }));
    }

    pousser_erreurs(st, &report.errors);
    report
}

/// Génère les synthèses du jour `day` (bilan + reste à faire, plus la synthèse
/// hebdomadaire le lundi) et émet `summary-ready` pour chaque succès.
///
/// Le verrou du store n'est **jamais** tenu pendant l'appel au fournisseur :
/// `summaries::prepare` fait toutes les lectures, le verrou est relâché, l'appel
/// part, puis `summaries::finish` le reprend pour le seul `put_summary`.
///
/// Écart assumé avec la spec §6, qui demandait la synthèse hebdomadaire le
/// vendredi : on la produit le **lundi**, pour `last_working_day(lundi)` = le
/// vendredi écoulé. C'est le seul moment où la semaine est complète ; produite le
/// vendredi matin, elle aurait ignoré le vendredi lui-même. Elle est rangée sous
/// la date du lundi de cette semaine (cf. `summaries::cache_day_for`).
pub fn run_summaries(app: &AppHandle, st: &ActivityState, day: chrono::NaiveDate) {
    use chrono::{Datelike, Weekday};

    let llm_settings = lecture(&st.settings).llm.clone();
    let provider = llm::from_settings(&llm_settings);
    let day_str = day.format("%Y-%m-%d").to_string();

    let mut kinds = vec![SummaryKind::Bilan, SummaryKind::ResteAFaire];
    if day.weekday() == Weekday::Fri {
        kinds.push(SummaryKind::Semaine);
    }

    let mut resultats: Vec<Result<(), String>> = Vec::new();
    for kind in kinds {
        let res = synthese_hors_verrou(st, provider.as_ref(), &llm_settings, &day_str, kind, false)
            .map(|_| ())
            .map_err(|e| format!("synthèse {} du {day_str} : {e}", kind.as_str()));
        if res.is_ok() {
            let _ = app.emit(
                "summary-ready",
                serde_json::json!({ "day": day_str, "kind": kind.as_str() }),
            );
        }
        resultats.push(res);
    }

    let erreurs: Vec<String> = resultats.iter().filter_map(|r| r.as_ref().err().cloned()).collect();
    pousser_erreurs(st, &erreurs);

    if doit_avancer_curseur(&resultats) {
        // Le curseur porte le jour *courant* (et non `day`, qui est le jour résumé) :
        // c'est lui que `plan_tick` compare pour ne lancer les synthèses qu'une fois.
        let aujourdhui = chrono::Local::now().date_naive().format("%Y-%m-%d").to_string();
        if let Some(store) = verrou(&st.store).as_ref() {
            let _ = store.set_cursor(CURSEUR_DERNIER_JOUR, &aujourdhui);
        }
    }
}

/// Enchaîne `prepare` → fournisseur → `finish` en ne tenant le verrou du store que
/// pour les deux accès à la base. C'est le seul chemin de génération de synthèse de
/// la couche Tauri : tenir le verrou pendant les 120 s d'un appel LLM figeait le
/// thread lecteur des PTY (donc l'affichage des panes) et les commandes synchrones
/// du dashboard, qui s'exécutent sur le thread principal.
///
/// Une base indisponible est remontée telle quelle (`String`) : la déguiser en
/// `LlmError::Disabled` afficherait « fournisseur désactivé » alors que la cause
/// est le store.
fn synthese_hors_verrou(
    st: &ActivityState,
    provider: &dyn llm::LlmProvider,
    llm_settings: &terminials_core::activity::settings::LlmSettings,
    day: &str,
    kind: SummaryKind,
    force: bool,
) -> Result<Summary, String> {
    let preparation = {
        let guard = store_ouvert(st)?;
        let store = guard.as_ref().expect("store présent : garanti par store_ouvert");
        summaries::prepare(store, llm_settings, day, kind, force, now_s(), &chrono::Local)
            .map_err(erreur_llm)?
    };

    let prep = match preparation {
        summaries::Preparation::Cached(summary) => return Ok(summary),
        summaries::Preparation::ToGenerate(prep) => prep,
    };

    let texte = provider.complete(&prep.request).map_err(erreur_llm)?;

    let guard = store_ouvert(st)?;
    let store = guard.as_ref().expect("store présent : garanti par store_ouvert");
    summaries::finish(store, &prep, texte, provider.name(), now_s()).map_err(erreur_llm)
}

/// Une erreur d'autorisation est préfixée `unauthorized: ` — le front s'en sert
/// pour proposer de renouveler le jeton (`isUnauthorized`).
fn erreur_llm(e: LlmError) -> String {
    match e {
        LlmError::Unauthorized => format!("unauthorized: {e}"),
        autre => autre.to_string(),
    }
}

/// Le curseur `summary_last_day` n'avance que si au moins une synthèse du tick a
/// abouti (génération ou cache). Sinon une coupure réseau ou un jeton expiré à
/// 07:00 marquerait la journée comme faite et supprimerait tout rattrapage jusqu'au
/// lendemain. Une liste vide (rien de tenté) n'avance pas non plus le curseur.
pub fn doit_avancer_curseur(resultats: &[Result<(), String>]) -> bool {
    resultats.iter().any(|r| r.is_ok())
}

/// Un passage du planificateur : décide puis exécute.
fn tick(app: &AppHandle) {
    let st = app.state::<Arc<ActivityState>>().inner().clone();

    let schedule = lecture(&st.settings).schedule.clone();
    let last = verrou(&st.last_collect).clone();
    let dernier_jour =
        verrou(&st.store).as_ref().and_then(|s| s.get_cursor(CURSEUR_DERNIER_JOUR).ok().flatten());
    let dernier_essai = match *verrou(&st.dernier_essai_syntheses) {
        0 => None,
        v => Some(v),
    };

    let plan = plan_tick(
        now_s(),
        chrono::Local::now().naive_local(),
        &last,
        dernier_jour.as_deref(),
        dernier_essai,
        &schedule,
    );

    let mut sources: Vec<&str> = Vec::new();
    if plan.collect_git_claude {
        sources.push("git");
        sources.push("claude");
    }
    if plan.collect_clickup {
        sources.push("clickup");
    }
    if !sources.is_empty() {
        run_collect(app, &st, &sources);
    }
    if let Some(day) = plan.summaries_for {
        // Horodaté avant l'exécution : même si la génération dure (deux appels de
        // 120 s au pire), le tick suivant ne doit pas la relancer.
        *verrou(&st.dernier_essai_syntheses) = now_s();
        run_summaries(app, &st, day);
    }
}

/// Consomme les événements shell poussés par les threads lecteurs des PTY : résout
/// la racine du dépôt (`git rev-parse`, un sous-processus), insère, et ne notifie le
/// front que si quelque chose a réellement été écrit. Un seul thread, donc les
/// insertions restent sérialisées sans faire attendre les PTY.
fn demarrer_ecrivain_shell(app: AppHandle, st: Arc<ActivityState>) {
    let Some(rx) = verrou(&st.shell_rx).take() else { return };
    std::thread::spawn(move || {
        for mut evenement in rx {
            evenement.workspace_dir = evenement.workspace_dir.map(|d| repo_root(&d));
            let insere = verrou(&st.store)
                .as_ref()
                .and_then(|store| store.insert_events(std::slice::from_ref(&evenement)).ok())
                .unwrap_or(0);
            if insere > 0 {
                let _ = app.emit("activity-updated", serde_json::json!({ "source": "shell" }));
            }
        }
    });
}

/// Démarre le planificateur : premier tick immédiat, puis toutes les minutes.
/// Le corps de chaque tick est isolé par `catch_unwind` pour qu'une panique d'un
/// collecteur n'arrête pas définitivement la boucle.
pub fn start_scheduler(app: AppHandle) {
    let st = app.state::<Arc<ActivityState>>().inner().clone();
    demarrer_ecrivain_shell(app.clone(), st);

    std::thread::spawn(move || loop {
        if std::panic::catch_unwind(AssertUnwindSafe(|| tick(&app))).is_err() {
            eprintln!("tick du planificateur d'activité interrompu par une panique");
        }
        std::thread::sleep(PERIODE_TICK);
    });
}

/// Exécute `f` avec le store ouvert, ou rend l'erreur d'ouverture mémorisée.
fn avec_store<T>(
    st: &ActivityState,
    f: impl FnOnce(&Store) -> StoreResult<T>,
) -> Result<T, String> {
    let guard = store_ouvert(st)?;
    let store = guard.as_ref().expect("store présent : garanti par store_ouvert");
    f(store).map_err(|e| e.to_string())
}

// ---------------------------------------------------------------------------
// Commandes Tauri (contrat §7). Les arguments camelCase du front sont convertis
// automatiquement vers les paramètres snake_case.
// ---------------------------------------------------------------------------

/// Enregistre les dossiers des workspaces comme dépôts suivis (racine git déduite).
#[tauri::command]
pub fn activity_register_workspaces(
    st: State<'_, Arc<ActivityState>>,
    dirs: Vec<String>,
) -> Result<(), String> {
    // `repo_root` lance `git rev-parse` : calculé hors du verrou du store.
    let roots: Vec<String> = dirs.iter().map(|d| repo_root(d)).collect();
    let now = now_s();
    avec_store(&st, |store| store.register_repos(&roots, now))
}

/// Collecte immédiate des trois sources. Exécutée hors du thread principal pour
/// ne pas figer l'interface : les collecteurs font des appels réseau et git.
#[tauri::command]
pub async fn activity_collect_now(app: AppHandle) -> Result<CollectReport, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<Arc<ActivityState>>().inner().clone();
        run_collect(&app, &st, &["git", "claude", "clickup"])
    })
    .await
    .map_err(|e| format!("collecte interrompue : {e}"))
}

#[tauri::command]
pub fn activity_query(
    st: State<'_, Arc<ActivityState>>,
    from: i64,
    to: i64,
    workspace_dir: Option<String>,
) -> Result<Vec<ActivityEvent>, String> {
    avec_store(&st, |store| store.query(from, to, workspace_dir.as_deref()))
}

#[tauri::command]
pub fn activity_stats(
    st: State<'_, Arc<ActivityState>>,
    from: i64,
    to: i64,
) -> Result<ActivityStats, String> {
    let offset = *chrono::Local::now().offset();
    avec_store(&st, |store| store.stats(from, to, offset))
}

/// Synthèse d'un jour. Hors thread principal : l'appel LLM peut durer jusqu'à 120 s.
/// Une erreur d'autorisation est préfixée `unauthorized: ` — le front s'en sert
/// pour proposer de renouveler le jeton.
#[tauri::command]
pub async fn activity_summary(
    app: AppHandle,
    day: String,
    kind: String,
    force: bool,
) -> Result<Summary, String> {
    let kind = SummaryKind::parse(&kind)
        .ok_or_else(|| format!("type de synthèse inconnu : {kind}"))?;

    tauri::async_runtime::spawn_blocking(move || {
        let st = app.state::<Arc<ActivityState>>().inner().clone();
        let llm_settings = lecture(&st.settings).llm.clone();
        let provider = llm::from_settings(&llm_settings);

        let resultat =
            synthese_hors_verrou(&st, provider.as_ref(), &llm_settings, &day, kind, force)?;

        if !resultat.cached {
            let _ = app.emit(
                "summary-ready",
                serde_json::json!({ "day": day, "kind": kind.as_str() }),
            );
        }
        Ok(resultat)
    })
    .await
    .map_err(|e| format!("synthèse interrompue : {e}"))?
}

/// Synthèse **déjà en cache** pour ce jour et ce type, ou `None` s'il n'y en a pas.
/// N'appelle jamais le LLM et ne construit même pas le digest : c'est le chemin du
/// chargement automatique du dashboard (montage, changement de jour, rafraîchissement
/// après collecte), qui déclenchait sinon un appel LLM par événement collecté.
/// Seuls le bouton « Générer maintenant », le ↻ et le planificateur passent par
/// `activity_summary`.
///
/// Le `day` interrogé est normalisé comme à l'écriture : lundi de la semaine pour
/// `semaine`, le jour lui-même sinon. La `Summary` rendue porte ce jour normalisé
/// dans son champ `day` et `cached: true`.
#[tauri::command]
pub fn activity_summary_cached(
    st: State<'_, Arc<ActivityState>>,
    day: String,
    kind: String,
) -> Result<Option<Summary>, String> {
    let kind_parse =
        SummaryKind::parse(&kind).ok_or_else(|| format!("type de synthèse inconnu : {kind}"))?;
    let date = chrono::NaiveDate::parse_from_str(&day, "%Y-%m-%d")
        .map_err(|e| format!("jour invalide {day:?} : {e}"))?;
    let cache_day = summaries::cache_day_for(date, kind_parse);

    let stored = avec_store(&st, |store| store.get_summary(&cache_day, kind_parse.as_str()))?;
    Ok(stored.map(|s| Summary {
        day: s.day,
        text: s.text,
        model: s.model,
        generated_at: s.generated_at,
        cached: true,
    }))
}

#[tauri::command]
pub fn activity_open_tasks(st: State<'_, Arc<ActivityState>>) -> Result<Vec<OpenTask>, String> {
    avec_store(&st, |store| store.open_tasks())
}

#[tauri::command]
pub fn activity_status(st: State<'_, Arc<ActivityState>>) -> ActivityStatus {
    let integration = lecture(&st.settings).shell.integration;
    ActivityStatus {
        last_collect: verrou(&st.last_collect).clone(),
        errors: verrou(&st.errors).clone(),
        shell_integration: integration && st.shims_dir.is_some(),
        db_error: verrou(&st.open_error).clone(),
    }
}

#[tauri::command]
pub fn activity_get_settings(st: State<'_, Arc<ActivityState>>) -> Settings {
    lecture(&st.settings).clone()
}

/// Enregistre les réglages puis les remplace en mémoire. Si l'intégration shell
/// vient d'être activée, les shims sont réécrits ; la bascule ne concerne que les
/// PTY lancés ensuite.
#[tauri::command]
pub fn activity_set_settings(
    st: State<'_, Arc<ActivityState>>,
    settings: Settings,
) -> Result<(), String> {
    settings::save(&settings::default_path(), &settings).map_err(|e| e.to_string())?;

    let etait_active = lecture(&st.settings).shell.integration;
    let devient_active = settings.shell.integration;
    *ecriture(&st.settings) = settings;

    // Nouveaux réglages (typiquement un jeton renouvelé) : on libère le repli pour
    // que le prochain tick retente les synthèses immédiatement.
    *verrou(&st.dernier_essai_syntheses) = 0;

    if devient_active && !etait_active {
        if let Some(dir) = &st.shims_dir {
            if let Err(e) = install_shims(dir) {
                pousser_erreurs(&st, &[format!("réinstallation des shims : {e}")]);
            }
        }
    }
    Ok(())
}

// ---------------------------------------------------------------------------
// Intégration shell : appelée depuis le thread lecteur du PTY (`lib.rs`).
// ---------------------------------------------------------------------------

/// Drapeau d'intégration shell, lu sans risque d'empoisonnement (appelé par
/// `lib.rs` à chaque `spawn_pty`).
pub fn integration_shell_active(st: &ActivityState) -> bool {
    lecture(&st.settings).shell.integration
}

/// Marqueur OSC 133 C : mémorise la commande en cours pour ce PTY.
pub fn on_shell_command(st: &ActivityState, pty: u32, cmd: &str, pwd: &str) {
    verrou(&st.pairer).on_command(pty, cmd, pwd, now_ms());
}

/// Marqueur OSC 133 D : apparie la commande et pousse l'événement vers l'écrivain.
///
/// Appelée **en ligne dans la boucle de lecture du PTY**, avant que le morceau de
/// sortie ne soit transmis au front : tout ce qui est lent (racine du dépôt via
/// `git rev-parse`, verrou du store, insertion) est déporté sur le thread
/// `demarrer_ecrivain_shell`. Ici, rien qu'un `send` sur un canal non borné.
pub fn on_shell_exit(st: &ActivityState, pty: u32, code: i32) {
    let ignored = lecture(&st.settings).shell.ignored_commands.clone();
    let evenement = verrou(&st.pairer).on_exit(pty, code, now_ms(), &ignored);
    let Some(evenement) = evenement else { return };
    // Échec = écrivain disparu (arrêt de l'application) : rien à signaler ici.
    let _ = st.shell_tx.send(evenement);
}

/// Le PTY est terminé : oublier toute commande restée en attente.
pub fn on_pty_closed(st: &ActivityState, pty: u32) {
    verrou(&st.pairer).forget(pty);
}

#[cfg(test)]
mod tests {
    use super::*;

    /// État minimal (sans base, sans shims) pour les tests purs.
    fn etat_de_test() -> ActivityState {
        let (shell_tx, shell_rx) = std::sync::mpsc::channel();
        ActivityState {
            store: Mutex::new(None),
            open_error: Mutex::new(None),
            settings: RwLock::new(Settings::default()),
            pairer: Mutex::new(ShellPairer::new()),
            shims_dir: None,
            last_collect: Mutex::new(HashMap::new()),
            errors: Mutex::new(Vec::new()),
            dernier_essai_syntheses: Mutex::new(0),
            shell_tx,
            shell_rx: Mutex::new(Some(shell_rx)),
        }
    }

    /// Comme `etat_de_test`, avec une base en mémoire réelle.
    fn etat_de_test_avec_store() -> ActivityState {
        let st = etat_de_test();
        *verrou(&st.store) = Some(Store::open_in_memory().expect("base en mémoire"));
        st
    }

    /// Le cœur du correctif de concurrence : pendant `provider.complete()`, qui dure
    /// jusqu'à 120 s, le verrou du store doit être **libre**. Sinon le thread lecteur
    /// de chaque PTY se bloque dans l'écriture des événements shell, et les commandes
    /// synchrones du dashboard figent le thread principal de la fenêtre.
    #[test]
    fn le_verrou_du_store_est_libre_pendant_l_appel_au_fournisseur() {
        use terminials_core::activity::providers::llm::{LlmProvider, LlmRequest};
        use terminials_core::activity::{EventKind, NewEvent};

        struct Sonde<'a> {
            st: &'a ActivityState,
            verrou_libre: Mutex<Option<bool>>,
        }
        impl LlmProvider for Sonde<'_> {
            fn name(&self) -> String {
                "sonde".to_string()
            }
            fn complete(&self, _r: &LlmRequest) -> Result<String, LlmError> {
                *self.verrou_libre.lock().unwrap() = Some(self.st.store.try_lock().is_ok());
                Ok("## Bilan\n- ok".to_string())
            }
        }

        let st = etat_de_test_avec_store();
        let maintenant = now_s();
        let jour = chrono::Local::now().date_naive().format("%Y-%m-%d").to_string();
        verrou(&st.store)
            .as_ref()
            .unwrap()
            .insert_events(&[NewEvent {
                ts: maintenant,
                kind: EventKind::Commit,
                workspace_dir: Some("/a".to_string()),
                branch: None,
                title: "un commit".to_string(),
                body: None,
                ticket_ids: vec![],
                source_ref: "sha".to_string(),
            }])
            .unwrap();

        let sonde = Sonde { st: &st, verrou_libre: Mutex::new(None) };
        let reglages = lecture(&st.settings).llm.clone();
        let resultat =
            synthese_hors_verrou(&st, &sonde, &reglages, &jour, SummaryKind::Bilan, false).unwrap();

        assert_eq!(resultat.text, "## Bilan\n- ok");
        assert_eq!(resultat.day, jour);
        assert!(!resultat.cached);
        assert_eq!(
            *sonde.verrou_libre.lock().unwrap(),
            Some(true),
            "le verrou du store ne doit pas être tenu pendant l'appel au fournisseur"
        );

        // Et la synthèse a bien été écrite : le second passage la rend depuis le cache,
        // sans repasser par le fournisseur.
        let sonde2 = Sonde { st: &st, verrou_libre: Mutex::new(None) };
        let relu =
            synthese_hors_verrou(&st, &sonde2, &reglages, &jour, SummaryKind::Bilan, false).unwrap();
        assert!(relu.cached);
        assert_eq!(*sonde2.verrou_libre.lock().unwrap(), None, "aucun appel au fournisseur");
    }

    /// `activity_summary_cached` passe par la même normalisation de clé que
    /// l'écriture : une synthèse `semaine` écrite sous le lundi doit être retrouvée
    /// depuis n'importe quel jour de cette semaine.
    #[test]
    fn la_lecture_de_cache_normalise_le_jour_de_la_semaine() {
        use terminials_core::activity::store::StoredSummary;

        let st = etat_de_test_avec_store();
        verrou(&st.store)
            .as_ref()
            .unwrap()
            .put_summary(&StoredSummary {
                day: "2026-09-14".to_string(), // lundi
                kind: "semaine".to_string(),
                model: "m".to_string(),
                digest_hash: "h".to_string(),
                text: "## Semaine".to_string(),
                generated_at: 42,
            })
            .unwrap();

        let lire = |jour: &str, kind: &str| {
            let k = SummaryKind::parse(kind).unwrap();
            let date = chrono::NaiveDate::parse_from_str(jour, "%Y-%m-%d").unwrap();
            let cle = summaries::cache_day_for(date, k);
            avec_store(&st, |store| store.get_summary(&cle, k.as_str())).unwrap()
        };

        assert_eq!(lire("2026-09-17", "semaine").unwrap().text, "## Semaine", "jeudi → lundi");
        assert_eq!(lire("2026-09-14", "semaine").unwrap().text, "## Semaine");
        assert!(lire("2026-09-17", "bilan").is_none(), "un bilan n'est pas normalisé");
    }

    fn at(h: u32, m: u32, day: &str) -> chrono::NaiveDateTime {
        chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").unwrap().and_hms_opt(h, m, 0).unwrap()
    }

    #[test]
    fn premier_tick_collecte_tout_et_ne_resume_pas_avant_l_heure() {
        let p = plan_tick(0, at(6, 59, "2026-09-16"), &HashMap::new(), None, None, &ScheduleSettings::default());
        assert!(p.collect_git_claude && p.collect_clickup && p.summaries_for.is_none());
    }

    #[test]
    fn a_7h_un_mercredi_resume_la_veille_une_seule_fois() {
        let p = plan_tick(0, at(7, 0, "2026-09-16"), &HashMap::new(), None, None, &ScheduleSettings::default());
        assert_eq!(p.summaries_for, Some(chrono::NaiveDate::from_ymd_opt(2026, 9, 15).unwrap()));
        let p2 = plan_tick(0, at(7, 1, "2026-09-16"), &HashMap::new(), Some("2026-09-16"), None, &ScheduleSettings::default());
        assert!(p2.summaries_for.is_none());
    }

    #[test]
    fn lundi_resume_vendredi_et_weekend_ne_resume_pas() {
        let p = plan_tick(0, at(9, 0, "2026-09-21"), &HashMap::new(), None, None, &ScheduleSettings::default());
        assert_eq!(p.summaries_for, Some(chrono::NaiveDate::from_ymd_opt(2026, 9, 18).unwrap()));
        assert!(plan_tick(0, at(9, 0, "2026-09-19"), &HashMap::new(), None, None, &ScheduleSettings::default()).summaries_for.is_none());
    }

    #[test]
    fn cadences_de_collecte() {
        let mut last = HashMap::new();
        last.insert("git".to_string(), 1000);
        last.insert("clickup".to_string(), 1000);
        let p = plan_tick(1200, at(10, 0, "2026-09-16"), &last, Some("2026-09-16"), None, &ScheduleSettings::default());
        assert!(!p.collect_git_claude && !p.collect_clickup);
        let p = plan_tick(1400, at(10, 0, "2026-09-16"), &last, Some("2026-09-16"), None, &ScheduleSettings::default());
        assert!(p.collect_git_claude && !p.collect_clickup);
    }

    #[test]
    fn le_weekend_resume_quand_weekdays_only_est_faux() {
        let schedule = ScheduleSettings { hour: 7, minute: 0, weekdays_only: false };
        let p = plan_tick(0, at(9, 0, "2026-09-19"), &HashMap::new(), None, None, &schedule);
        // Samedi 19/09 → dernier jour ouvré = vendredi 18/09.
        assert_eq!(p.summaries_for, Some(chrono::NaiveDate::from_ymd_opt(2026, 9, 18).unwrap()));
    }


    #[test]
    fn une_tentative_de_synthese_recente_bloque_le_tick_suivant() {
        // Jeton expiré à 07:00 : sans repli, `plan_tick` relançait deux appels LLM
        // de 120 s toutes les 60 s jusqu'à minuit (le curseur n'avance que sur un
        // succès). Une tentative toutes les 30 min suffit au rattrapage.
        let maintenant = 1_000_000;
        let plan = |essai: Option<i64>| {
            plan_tick(maintenant, at(7, 30, "2026-09-16"), &HashMap::new(), None, essai, &ScheduleSettings::default())
                .summaries_for
        };
        assert!(plan(None).is_some(), "aucune tentative encore : on lance");
        assert!(plan(Some(maintenant - 60)).is_none(), "tentative il y a 1 min : on attend");
        assert!(plan(Some(maintenant - 1799)).is_none(), "1799 s : toujours trop tôt");
        assert!(plan(Some(maintenant - 1800)).is_some(), "30 min écoulées : on retente");
    }

    #[test]
    fn les_erreurs_identiques_ne_sont_pas_dupliquees() {
        let st = etat_de_test();
        pousser_erreurs(&st, &["jeton LLM refusé".to_string()]);
        pousser_erreurs(&st, &["jeton LLM refusé".to_string()]);
        pousser_erreurs(&st, &["collecte git".to_string(), "jeton LLM refusé".to_string()]);
        let errors = verrou(&st.errors);
        assert_eq!(
            *errors,
            vec!["jeton LLM refusé".to_string(), "collecte git".to_string()],
            "un message déjà présent ne doit pas chasser les autres du bandeau"
        );
    }

    #[test]
    fn les_erreurs_sont_bornees_a_vingt() {
        let st = etat_de_test();
        let lot: Vec<String> = (0..25).map(|i| format!("erreur {i}")).collect();
        pousser_erreurs(&st, &lot);
        let errors = verrou(&st.errors);
        assert_eq!(errors.len(), MAX_ERREURS);
        assert_eq!(errors.first().unwrap(), "erreur 5");
        assert_eq!(errors.last().unwrap(), "erreur 24");
    }

    #[test]
    fn le_chemin_de_la_base_suit_xdg_data_home() {
        assert_eq!(
            db_path_depuis(Some("/xdg".into()), Some("/home/t".into())),
            PathBuf::from("/xdg/terminials/activity.db")
        );
        // Variable absente ou vide → repli sur ~/.local/share.
        assert_eq!(
            db_path_depuis(None, Some("/home/t".into())),
            PathBuf::from("/home/t/.local/share/terminials/activity.db")
        );
        assert_eq!(
            db_path_depuis(Some(String::new()), Some("/home/t".into())),
            PathBuf::from("/home/t/.local/share/terminials/activity.db")
        );
    }

    #[test]
    fn le_curseur_n_avance_qu_apres_au_moins_un_succes() {
        assert!(!doit_avancer_curseur(&[]));
        assert!(!doit_avancer_curseur(&[Err("réseau".into()), Err("réseau".into())]));
        assert!(doit_avancer_curseur(&[Err("réseau".into()), Ok(())]));
        assert!(doit_avancer_curseur(&[Ok(()), Ok(())]));
    }
}
