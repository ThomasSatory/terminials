//! Câblage Tauri du dashboard d'activité : état partagé, commandes `activity_*`
//! et planificateur (collecte périodique + synthèses du matin).

use std::collections::HashMap;
use std::panic::AssertUnwindSafe;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, RwLock};
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
    repo_root, ActivityEvent, ActivityStats, CollectReport, OpenTask, Summary,
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
pub fn plan_tick(
    now_utc: i64,
    now_local: chrono::NaiveDateTime,
    last: &HashMap<String, i64>,
    last_summary_day: Option<&str>,
    schedule: &ScheduleSettings,
) -> TickPlan {
    use chrono::{Datelike, Timelike, Weekday};

    let today = now_local.date();
    let jour_ouvre = !matches!(today.weekday(), Weekday::Sat | Weekday::Sun);
    let heure_atteinte =
        (now_local.hour(), now_local.minute()) >= (schedule.hour as u32, schedule.minute as u32);
    let deja_fait = last_summary_day == Some(today.format("%Y-%m-%d").to_string().as_str());

    let summaries_for = if (jour_ouvre || !schedule.weekdays_only) && heure_atteinte && !deja_fait {
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

    ActivityState {
        store: Mutex::new(store),
        open_error: Mutex::new(open_error),
        settings: RwLock::new(settings),
        pairer: Mutex::new(ShellPairer::new()),
        shims_dir,
        last_collect: Mutex::new(HashMap::new()),
        errors: Mutex::new(errors),
    }
}

/// `$XDG_DATA_HOME/terminials/activity.db`, défaut `~/.local/share/terminials/activity.db`.
pub fn db_path() -> PathBuf {
    let base = std::env::var("XDG_DATA_HOME")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into()))
                .join(".local")
                .join("share")
        });
    base.join("terminials").join("activity.db")
}

/// Ajoute des erreurs à l'état en ne gardant que les `MAX_ERREURS` plus récentes.
fn pousser_erreurs(st: &ActivityState, nouvelles: &[String]) {
    if nouvelles.is_empty() {
        return;
    }
    let mut errors = st.errors.lock().unwrap();
    errors.extend(nouvelles.iter().cloned());
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
        let s = st.settings.read().unwrap();
        (s.ticket_patterns.clone(), s.git.author_email.clone(), s.clickup.token.clone())
    };
    let client = if token.is_empty() { None } else { Some(ClickupClient::new(&token)) };

    for source in sources {
        {
            let guard = st.store.lock().unwrap();
            let store = match guard.as_ref() {
                Some(s) => s,
                None => {
                    let msg = st
                        .open_error
                        .lock()
                        .unwrap()
                        .clone()
                        .unwrap_or_else(|| "base d'activité indisponible".into());
                    report.errors.push(msg);
                    break;
                }
            };
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
        st.last_collect.lock().unwrap().insert((*source).to_string(), now);
        let _ = app.emit("activity-updated", serde_json::json!({ "source": source }));
    }

    pousser_erreurs(st, &report.errors);
    report
}

/// Génère les synthèses du jour `day` (bilan + reste à faire, plus la synthèse
/// hebdomadaire le vendredi) et émet `summary-ready` pour chaque succès.
///
/// Le verrou du store est tenu pendant l'appel LLM : `summaries::generate` lit le
/// journal et écrit le cache sous ce même verrou. Assumé en v1 — le fournisseur
/// impose un délai maximum, et la génération n'a lieu qu'une fois par jour.
pub fn run_summaries(app: &AppHandle, st: &ActivityState, day: chrono::NaiveDate) {
    use chrono::{Datelike, Weekday};

    let llm_settings = st.settings.read().unwrap().llm.clone();
    let provider = llm::from_settings(&llm_settings);
    let day_str = day.format("%Y-%m-%d").to_string();

    let mut kinds = vec![SummaryKind::Bilan, SummaryKind::ResteAFaire];
    if day.weekday() == Weekday::Fri {
        kinds.push(SummaryKind::Semaine);
    }

    let mut erreurs = Vec::new();
    for kind in kinds {
        let res = {
            let guard = st.store.lock().unwrap();
            match guard.as_ref() {
                Some(store) => summaries::generate(
                    store,
                    provider.as_ref(),
                    &llm_settings,
                    &day_str,
                    kind,
                    false,
                    now_s(),
                    &chrono::Local,
                ),
                None => Err(LlmError::Disabled),
            }
        };
        match res {
            Ok(_) => {
                let _ = app.emit(
                    "summary-ready",
                    serde_json::json!({ "day": day_str, "kind": kind.as_str() }),
                );
            }
            Err(e) => {
                erreurs.push(format!("synthèse {} du {day_str} : {e}", kind.as_str()));
            }
        }
    }
    pousser_erreurs(st, &erreurs);

    // Le curseur porte le jour *courant* (et non `day`, qui est le jour résumé) :
    // c'est lui que `plan_tick` compare pour ne lancer les synthèses qu'une fois.
    let aujourdhui = chrono::Local::now().date_naive().format("%Y-%m-%d").to_string();
    if let Some(store) = st.store.lock().unwrap().as_ref() {
        let _ = store.set_cursor(CURSEUR_DERNIER_JOUR, &aujourdhui);
    }
}

/// Un passage du planificateur : décide puis exécute.
fn tick(app: &AppHandle) {
    let st = app.state::<Arc<ActivityState>>().inner().clone();

    let schedule = st.settings.read().unwrap().schedule.clone();
    let last = st.last_collect.lock().unwrap().clone();
    let dernier_jour = st
        .store
        .lock()
        .unwrap()
        .as_ref()
        .and_then(|s| s.get_cursor(CURSEUR_DERNIER_JOUR).ok().flatten());

    let plan = plan_tick(
        now_s(),
        chrono::Local::now().naive_local(),
        &last,
        dernier_jour.as_deref(),
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
        run_summaries(app, &st, day);
    }
}

/// Démarre le planificateur : premier tick immédiat, puis toutes les minutes.
/// Le corps de chaque tick est isolé par `catch_unwind` pour qu'une panique d'un
/// collecteur n'arrête pas définitivement la boucle.
pub fn start_scheduler(app: AppHandle) {
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
    let guard = st.store.lock().unwrap();
    let store = guard.as_ref().ok_or_else(|| {
        st.open_error
            .lock()
            .unwrap()
            .clone()
            .unwrap_or_else(|| "base d'activité indisponible".to_string())
    })?;
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
        let llm_settings = st.settings.read().unwrap().llm.clone();
        let provider = llm::from_settings(&llm_settings);

        let resultat = {
            let guard = st.store.lock().unwrap();
            let store = guard.as_ref().ok_or_else(|| {
                st.open_error
                    .lock()
                    .unwrap()
                    .clone()
                    .unwrap_or_else(|| "base d'activité indisponible".to_string())
            })?;
            summaries::generate(
                store,
                provider.as_ref(),
                &llm_settings,
                &day,
                kind,
                force,
                now_s(),
                &chrono::Local,
            )
            .map_err(|e| match e {
                LlmError::Unauthorized => format!("unauthorized: {e}"),
                autre => autre.to_string(),
            })?
        };

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

#[tauri::command]
pub fn activity_open_tasks(st: State<'_, Arc<ActivityState>>) -> Result<Vec<OpenTask>, String> {
    avec_store(&st, |store| store.open_tasks())
}

#[tauri::command]
pub fn activity_status(st: State<'_, Arc<ActivityState>>) -> ActivityStatus {
    let integration = st.settings.read().unwrap().shell.integration;
    ActivityStatus {
        last_collect: st.last_collect.lock().unwrap().clone(),
        errors: st.errors.lock().unwrap().clone(),
        shell_integration: integration && st.shims_dir.is_some(),
        db_error: st.open_error.lock().unwrap().clone(),
    }
}

#[tauri::command]
pub fn activity_get_settings(st: State<'_, Arc<ActivityState>>) -> Settings {
    st.settings.read().unwrap().clone()
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

    let etait_active = st.settings.read().unwrap().shell.integration;
    let devient_active = settings.shell.integration;
    *st.settings.write().unwrap() = settings;

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

/// Marqueur OSC 133 C : mémorise la commande en cours pour ce PTY.
pub fn on_shell_command(st: &ActivityState, pty: u32, cmd: &str, pwd: &str) {
    st.pairer.lock().unwrap().on_command(pty, cmd, pwd, now_ms());
}

/// Marqueur OSC 133 D : apparie, enregistre l'événement `shell_cmd` et notifie le front.
pub fn on_shell_exit(app: &AppHandle, st: &ActivityState, pty: u32, code: i32) {
    let ignored = st.settings.read().unwrap().shell.ignored_commands.clone();
    let evenement = st.pairer.lock().unwrap().on_exit(pty, code, now_ms(), &ignored);
    let Some(mut evenement) = evenement else { return };

    // `repo_root` lance un sous-process : calculé avant de prendre le verrou du store.
    evenement.workspace_dir = evenement.workspace_dir.map(|d| repo_root(&d));

    if let Some(store) = st.store.lock().unwrap().as_ref() {
        let _ = store.insert_events(std::slice::from_ref(&evenement));
    }
    let _ = app.emit("activity-updated", serde_json::json!({ "source": "shell" }));
}

/// Le PTY est terminé : oublier toute commande restée en attente.
pub fn on_pty_closed(st: &ActivityState, pty: u32) {
    st.pairer.lock().unwrap().forget(pty);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn at(h: u32, m: u32, day: &str) -> chrono::NaiveDateTime {
        chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").unwrap().and_hms_opt(h, m, 0).unwrap()
    }

    #[test]
    fn premier_tick_collecte_tout_et_ne_resume_pas_avant_l_heure() {
        let p = plan_tick(0, at(6, 59, "2026-09-16"), &HashMap::new(), None, &ScheduleSettings::default());
        assert!(p.collect_git_claude && p.collect_clickup && p.summaries_for.is_none());
    }

    #[test]
    fn a_7h_un_mercredi_resume_la_veille_une_seule_fois() {
        let p = plan_tick(0, at(7, 0, "2026-09-16"), &HashMap::new(), None, &ScheduleSettings::default());
        assert_eq!(p.summaries_for, Some(chrono::NaiveDate::from_ymd_opt(2026, 9, 15).unwrap()));
        let p2 = plan_tick(0, at(7, 1, "2026-09-16"), &HashMap::new(), Some("2026-09-16"), &ScheduleSettings::default());
        assert!(p2.summaries_for.is_none());
    }

    #[test]
    fn lundi_resume_vendredi_et_weekend_ne_resume_pas() {
        let p = plan_tick(0, at(9, 0, "2026-09-21"), &HashMap::new(), None, &ScheduleSettings::default());
        assert_eq!(p.summaries_for, Some(chrono::NaiveDate::from_ymd_opt(2026, 9, 18).unwrap()));
        assert!(plan_tick(0, at(9, 0, "2026-09-19"), &HashMap::new(), None, &ScheduleSettings::default()).summaries_for.is_none());
    }

    #[test]
    fn cadences_de_collecte() {
        let mut last = HashMap::new();
        last.insert("git".to_string(), 1000);
        last.insert("clickup".to_string(), 1000);
        let p = plan_tick(1200, at(10, 0, "2026-09-16"), &last, Some("2026-09-16"), &ScheduleSettings::default());
        assert!(!p.collect_git_claude && !p.collect_clickup);
        let p = plan_tick(1400, at(10, 0, "2026-09-16"), &last, Some("2026-09-16"), &ScheduleSettings::default());
        assert!(p.collect_git_claude && !p.collect_clickup);
    }

    #[test]
    fn le_weekend_resume_quand_weekdays_only_est_faux() {
        let schedule = ScheduleSettings { hour: 7, minute: 0, weekdays_only: false };
        let p = plan_tick(0, at(9, 0, "2026-09-19"), &HashMap::new(), None, &schedule);
        // Samedi 19/09 → dernier jour ouvré = vendredi 18/09.
        assert_eq!(p.summaries_for, Some(chrono::NaiveDate::from_ymd_opt(2026, 9, 18).unwrap()));
    }

    #[test]
    fn les_erreurs_sont_bornees_a_vingt() {
        let st = ActivityState {
            store: Mutex::new(None),
            open_error: Mutex::new(None),
            settings: RwLock::new(Settings::default()),
            pairer: Mutex::new(ShellPairer::new()),
            shims_dir: None,
            last_collect: Mutex::new(HashMap::new()),
            errors: Mutex::new(Vec::new()),
        };
        let lot: Vec<String> = (0..25).map(|i| format!("erreur {i}")).collect();
        pousser_erreurs(&st, &lot);
        let errors = st.errors.lock().unwrap();
        assert_eq!(errors.len(), MAX_ERREURS);
        assert_eq!(errors.first().unwrap(), "erreur 5");
        assert_eq!(errors.last().unwrap(), "erreur 24");
    }

    #[test]
    fn le_chemin_de_la_base_suit_xdg_data_home() {
        // `db_path` lit l'environnement : on vérifie seulement la forme du chemin.
        let p = db_path();
        assert!(p.ends_with("terminials/activity.db"), "chemin: {p:?}");
    }
}
