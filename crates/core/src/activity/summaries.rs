//! Génération et cache des synthèses quotidiennes/hebdomadaires via le LLM configuré
//! (spec §6). Le texte envoyé au LLM est le digest déterministe de `digest.rs` ;
//! la réponse est mise en cache par (jour, type, hash du digest) pour éviter de
//! rappeler le LLM tant que rien n'a changé.

use chrono::{Datelike, Duration, NaiveDate, Offset, TimeZone};
use serde::{Deserialize, Serialize};

use crate::activity::collectors::git;
use crate::activity::digest::{self, Digest};
use crate::activity::providers::llm::{LlmError, LlmProvider, LlmRequest};
use crate::activity::settings::LlmSettings;
use crate::activity::store::{Store, StoredSummary};
use crate::activity::{workspace_name, OpenTask, Summary};

/// Texte renvoyé quand la période à résumer ne contient aucun événement : pas
/// d'appel LLM dans ce cas (spec §6).
pub const EMPTY_TEXT: &str = "Aucune activité enregistrée sur cette période.";

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryKind {
    Bilan,
    ResteAFaire,
    Semaine,
}

impl SummaryKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            SummaryKind::Bilan => "bilan",
            SummaryKind::ResteAFaire => "reste_a_faire",
            SummaryKind::Semaine => "semaine",
        }
    }

    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "bilan" => SummaryKind::Bilan,
            "reste_a_faire" => SummaryKind::ResteAFaire,
            "semaine" => SummaryKind::Semaine,
            _ => return None,
        })
    }
}

/// Entrées supplémentaires (au-delà du digest) utilisées par `user_prompt` pour
/// le type `ResteAFaire`.
pub struct SummaryInputs<'a> {
    pub open_tasks: &'a [OpenTask],
    pub unmerged: &'a [(String, Vec<String>)],
}

/// Bornes epoch (secondes UTC) `[from, to)` du jour local `day` (`YYYY-MM-DD`).
/// `None` si `day` n'est pas une date valide.
pub fn day_range(day: &str, tz: &impl TimeZone) -> Option<(i64, i64)> {
    let date = NaiveDate::parse_from_str(day, "%Y-%m-%d").ok()?;
    let from = local_epoch(date, tz);
    let to = local_epoch(date + Duration::days(1), tz);
    Some((from, to))
}

/// Dernier jour ouvré avant `day` : lundi → vendredi précédent, mardi..vendredi →
/// veille, samedi/dimanche → vendredi de la même semaine.
pub fn last_working_day(day: NaiveDate) -> NaiveDate {
    use chrono::Weekday::*;
    match day.weekday() {
        Mon => day - Duration::days(3),
        Sun => day - Duration::days(2),
        _ => day - Duration::days(1),
    }
}

/// Plage à résumer pour `kind` sur `day` (spec §6) :
/// - Bilan/ResteAFaire un lundi : vendredi 00:00 → lundi 00:00 (couvre le week-end) ;
///   un vendredi : vendredi 00:00 → lundi 00:00 suivant ; les autres jours : le jour seul.
/// - Semaine : lundi 00:00 → samedi 00:00 de la semaine de `day`.
pub fn range_for(day: NaiveDate, kind: SummaryKind, tz: &impl TimeZone) -> (i64, i64) {
    use chrono::Weekday;
    match kind {
        SummaryKind::Semaine => {
            let monday = day - Duration::days(day.weekday().num_days_from_monday() as i64);
            (local_epoch(monday, tz), local_epoch(monday + Duration::days(5), tz))
        }
        SummaryKind::Bilan | SummaryKind::ResteAFaire => match day.weekday() {
            Weekday::Mon => (local_epoch(day - Duration::days(3), tz), local_epoch(day, tz)),
            Weekday::Fri => (local_epoch(day, tz), local_epoch(day + Duration::days(3), tz)),
            _ => (local_epoch(day, tz), local_epoch(day + Duration::days(1), tz)),
        },
    }
}

/// Message système (invariant par type de synthèse), en français, verbatim spec §6.
pub fn system_prompt(kind: SummaryKind) -> &'static str {
    match kind {
        SummaryKind::Bilan => "Tu es l'assistant de Thomas, développeur. À partir du journal d'activité fourni (commits git, prompts envoyés à Claude Code, commandes shell, changements ClickUp), rédige le bilan de la période en 5 à 10 puces markdown groupées par sujet. Cite chaque ticket ClickUp mentionné sous la forme `[id](url)` avec l'URL fournie dans la section « Tickets cités ». N'invente rien qui ne soit pas dans le journal. Pas de préambule ni de conclusion. Réponds en français.",
        SummaryKind::ResteAFaire => "Tu es l'assistant de Thomas, développeur. On te donne son journal d'activité, ses tâches ClickUp ouvertes et ses branches git non fusionnées. Rédige la liste de ce qui reste à faire, priorisée, en trois sections markdown : `## Tickets ClickUp` (échéance la plus proche d'abord, lien `[id](url)`), `## Branches à finir`, `## Pistes vues dans les prompts` (uniquement si le journal en contient). N'invente rien. Réponds en français, sans préambule.",
        SummaryKind::Semaine => "Tu es l'assistant de Thomas, développeur. À partir des journaux d'activité des jours ouvrés de la semaine, rédige une synthèse hebdomadaire en markdown : `## Thèmes de la semaine`, `## Tickets clos`, `## Tickets en cours`, `## Points de friction` (commandes répétées en échec, sessions très longues, allers-retours). Liens tickets `[id](url)`. N'invente rien. Réponds en français, sans préambule.",
    }
}

/// Message utilisateur envoyé au LLM : le digest de la période, précédé d'un
/// en-tête, complété pour `ResteAFaire` par les tâches ClickUp ouvertes et les
/// branches non fusionnées.
pub fn user_prompt(kind: SummaryKind, day: &str, digest_text: &str, inputs: &SummaryInputs) -> String {
    let mut s = format!("# Journal du {day}\n\n{digest_text}");
    if kind == SummaryKind::ResteAFaire {
        s.push_str("\n\n# Tâches ClickUp ouvertes\n");
        s.push_str(&format_tasks(inputs.open_tasks));
        s.push_str("\n# Branches non fusionnées\n");
        s.push_str(&format_unmerged(inputs.unmerged));
    }
    s
}

fn format_tasks(tasks: &[OpenTask]) -> String {
    if tasks.is_empty() {
        return "- (aucune)".to_string();
    }
    tasks.iter().map(format_task).collect::<Vec<_>>().join("\n")
}

fn format_task(t: &OpenTask) -> String {
    let mut s = format!("- [{}]({}) {} — {}", t.id, t.url, t.name, t.status);
    if let Some(due) = t.due_date {
        if let Some(dt) = chrono::DateTime::from_timestamp(due, 0) {
            s.push_str(&format!(" — échéance {}", dt.format("%Y-%m-%d")));
        }
    }
    if let Some(p) = &t.priority {
        s.push_str(&format!(" — priorité {p}"));
    }
    if let Some(l) = &t.list_name {
        s.push_str(&format!(" — {l}"));
    }
    s
}

fn format_unmerged(unmerged: &[(String, Vec<String>)]) -> String {
    if unmerged.is_empty() {
        return "- (aucune)".to_string();
    }
    unmerged
        .iter()
        .map(|(repo, branches)| format!("- {repo} : {}", branches.join(", ")))
        .collect::<Vec<_>>()
        .join("\n")
}

/// Époque (secondes UTC) de minuit locale (`tz`) pour `date`. Gère les heures
/// ambiguës (retour DST, on garde la première occurrence) et inexistantes
/// (avance de bascule DST, on prend la première heure valide qui suit).
fn local_epoch(date: NaiveDate, tz: &impl TimeZone) -> i64 {
    let naive = date.and_hms_opt(0, 0, 0).expect("00:00:00 est toujours une heure valide");
    match tz.from_local_datetime(&naive) {
        chrono::LocalResult::Single(dt) => dt.timestamp(),
        chrono::LocalResult::Ambiguous(dt, _) => dt.timestamp(),
        chrono::LocalResult::None => {
            let mut probe = naive;
            loop {
                probe += Duration::minutes(30);
                if let chrono::LocalResult::Single(dt) = tz.from_local_datetime(&probe) {
                    break dt.timestamp();
                }
            }
        }
    }
}

/// Décalage fixe de `tz` à l'instant `ts` (début de plage), pour l'affichage des
/// heures locales dans le digest.
fn fixed_offset_at(ts: i64, tz: &impl TimeZone) -> chrono::FixedOffset {
    let naive = chrono::DateTime::from_timestamp(ts, 0)
        .expect("timestamp epoch valide")
        .naive_utc();
    tz.offset_from_utc_datetime(&naive).fix()
}

fn db_err(e: rusqlite::Error) -> LlmError {
    LlmError::Malformed(format!("base de données : {e}"))
}

/// Digest d'une plage `[from, to)`, tickets cités résolus depuis le store.
fn range_digest(store: &Store, from: i64, to: i64, offset: chrono::FixedOffset) -> Result<Digest, LlmError> {
    let events = store.query(from, to, None).map_err(db_err)?;
    let ticket_ids = store.ticket_ids_in_range(from, to).map_err(db_err)?;
    let tickets = store.tickets_by_ids(&ticket_ids).map_err(db_err)?;
    Ok(digest::build_digest(&events, &tickets, offset))
}

/// Digest de la synthèse hebdomadaire : concaténation des digests des 5 jours
/// ouvrés de la semaine de `day`, chacun précédé de `# {day}`. Les jours sans
/// activité sont omis.
fn week_digest(store: &Store, day: NaiveDate, tz: &impl TimeZone) -> Result<Digest, LlmError> {
    let monday = day - Duration::days(day.weekday().num_days_from_monday() as i64);
    let mut sections = Vec::new();
    let mut event_count = 0usize;
    for i in 0..5 {
        let d = monday + Duration::days(i);
        let from = local_epoch(d, tz);
        let to = local_epoch(d + Duration::days(1), tz);
        let offset = fixed_offset_at(from, tz);
        let digest = range_digest(store, from, to, offset)?;
        event_count += digest.event_count;
        if !digest.text.is_empty() {
            sections.push(format!("# {}\n{}", d.format("%Y-%m-%d"), digest.text));
        }
    }
    let text = sections.join("\n");
    let hash = sha256_hex(&text);
    Ok(Digest { text, hash, event_count })
}

fn sha256_hex(text: &str) -> String {
    use sha2::{Digest as _, Sha256};
    Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect()
}

/// Génère (ou récupère du cache) la synthèse `kind` du jour `day`. Le cache est
/// tenu par (jour, type, hash du digest) : tant que le digest ne change pas et
/// que `force` n'est pas demandé, la synthèse stockée est réutilisée sans
/// appeler le LLM. Un digest vide court-circuite complètement l'appel LLM et
/// n'écrit rien en cache. Un échec du LLM est propagé sans toucher au cache.
#[allow(clippy::too_many_arguments)]
pub fn generate(
    store: &Store,
    provider: &dyn LlmProvider,
    settings: &LlmSettings,
    day: &str,
    kind: SummaryKind,
    force: bool,
    now: i64,
    tz: &impl TimeZone,
) -> Result<Summary, LlmError> {
    let date = NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .map_err(|e| LlmError::Malformed(format!("jour invalide {day:?} : {e}")))?;

    let digest = if kind == SummaryKind::Semaine {
        week_digest(store, date, tz)?
    } else {
        let (from, to) = range_for(date, kind, tz);
        let offset = fixed_offset_at(from, tz);
        range_digest(store, from, to, offset)?
    };

    if digest.text.is_empty() {
        return Ok(Summary { text: EMPTY_TEXT.to_string(), model: provider.name(), generated_at: now, cached: false });
    }

    if !force {
        if let Some(stored) = store.get_summary(day, kind.as_str()).map_err(db_err)? {
            if stored.digest_hash == digest.hash {
                return Ok(Summary {
                    text: stored.text,
                    model: stored.model,
                    generated_at: stored.generated_at,
                    cached: true,
                });
            }
        }
    }

    let open_tasks = store.open_tasks().map_err(db_err)?;
    let unmerged: Vec<(String, Vec<String>)> = store
        .active_repos()
        .map_err(db_err)?
        .into_iter()
        .filter_map(|dir| {
            let branches = git::unmerged_branches(&dir);
            if branches.is_empty() {
                None
            } else {
                Some((workspace_name(&dir), branches))
            }
        })
        .collect();
    let inputs = SummaryInputs { open_tasks: &open_tasks, unmerged: &unmerged };

    let request = LlmRequest {
        system: system_prompt(kind).to_string(),
        user: user_prompt(kind, day, &digest.text, &inputs),
        max_tokens: settings.max_tokens,
        temperature: settings.temperature,
    };
    let text = provider.complete(&request)?;

    store
        .put_summary(&StoredSummary {
            day: day.to_string(),
            kind: kind.as_str().to_string(),
            model: provider.name(),
            digest_hash: digest.hash,
            text: text.clone(),
            generated_at: now,
        })
        .map_err(db_err)?;

    Ok(Summary { text, model: provider.name(), generated_at: now, cached: false })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::{EventKind, NewEvent, OpenTask};

    struct Fake {
        calls: std::sync::Mutex<u32>,
        reply: String,
    }
    impl LlmProvider for Fake {
        fn name(&self) -> String {
            "fake".into()
        }
        fn complete(&self, _r: &LlmRequest) -> Result<String, LlmError> {
            *self.calls.lock().unwrap() += 1;
            Ok(self.reply.clone())
        }
    }

    fn d(s: &str) -> NaiveDate {
        NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap()
    }

    #[test]
    fn dernier_jour_ouvre() {
        assert_eq!(last_working_day(d("2026-09-21")), d("2026-09-18"), "lundi → vendredi");
        assert_eq!(last_working_day(d("2026-09-22")), d("2026-09-21"), "mardi → lundi");
        assert_eq!(last_working_day(d("2026-09-19")), d("2026-09-18"), "samedi → vendredi");
        assert_eq!(last_working_day(d("2026-09-20")), d("2026-09-18"), "dimanche → vendredi");
    }

    #[test]
    fn plages() {
        let utc = chrono::Utc;
        let (f, t) = range_for(d("2026-09-16"), SummaryKind::Bilan, &utc);
        assert_eq!((f, t), (1_789_516_800, 1_789_603_200));
        let (f, t) = range_for(d("2026-09-18"), SummaryKind::Bilan, &utc); // vendredi → couvre jusqu'au lundi 00:00
        assert_eq!(t - f, 3 * 86400);
        let (f, t) = range_for(d("2026-09-16"), SummaryKind::Semaine, &utc); // mercredi → lundi 14 00:00 → samedi 19 00:00
        assert_eq!(f, 1_789_344_000);
        assert_eq!(t - f, 5 * 86400);
        assert_eq!(day_range("2026-09-16", &utc), Some((1_789_516_800, 1_789_603_200)));
        assert_eq!(day_range("n'importe", &utc), None);
    }

    #[test]
    fn generate_met_en_cache_par_hash_et_force_regenere() {
        let store = Store::open_in_memory().unwrap();
        store
            .insert_events(&[NewEvent {
                ts: 1_789_550_000,
                kind: EventKind::Commit,
                workspace_dir: Some("/a".into()),
                branch: None,
                title: "c".into(),
                body: None,
                ticket_ids: vec![],
                source_ref: "1".into(),
            }])
            .unwrap();
        let fake = Fake { calls: Default::default(), reply: "## Bilan\n- c".into() };
        let s = LlmSettings::default();
        let a = generate(&store, &fake, &s, "2026-09-16", SummaryKind::Bilan, false, 1_789_600_000, &chrono::Utc).unwrap();
        assert_eq!(a.text, "## Bilan\n- c");
        assert!(!a.cached);
        assert_eq!(a.model, "fake");
        let b = generate(&store, &fake, &s, "2026-09-16", SummaryKind::Bilan, false, 1_789_600_001, &chrono::Utc).unwrap();
        assert!(b.cached);
        assert_eq!(*fake.calls.lock().unwrap(), 1);
        store
            .insert_events(&[NewEvent {
                ts: 1_789_551_000,
                kind: EventKind::Commit,
                workspace_dir: Some("/a".into()),
                branch: None,
                title: "d".into(),
                body: None,
                ticket_ids: vec![],
                source_ref: "2".into(),
            }])
            .unwrap();
        let c = generate(&store, &fake, &s, "2026-09-16", SummaryKind::Bilan, false, 1_789_600_002, &chrono::Utc).unwrap();
        assert!(!c.cached, "nouveau digest → régénéré");
        assert_eq!(*fake.calls.lock().unwrap(), 2);
        generate(&store, &fake, &s, "2026-09-16", SummaryKind::Bilan, true, 1_789_600_003, &chrono::Utc).unwrap();
        assert_eq!(*fake.calls.lock().unwrap(), 3);
    }

    #[test]
    fn digest_vide_sans_appel_llm() {
        let store = Store::open_in_memory().unwrap();
        let fake = Fake { calls: Default::default(), reply: "x".into() };
        let r = generate(&store, &fake, &LlmSettings::default(), "2026-09-16", SummaryKind::Bilan, false, 1, &chrono::Utc).unwrap();
        assert_eq!(r.text, EMPTY_TEXT);
        assert_eq!(*fake.calls.lock().unwrap(), 0);
    }

    #[test]
    fn echec_llm_n_ecrase_pas_le_cache() {
        struct Fail;
        impl LlmProvider for Fail {
            fn name(&self) -> String {
                "f".into()
            }
            fn complete(&self, _: &LlmRequest) -> Result<String, LlmError> {
                Err(LlmError::Unauthorized)
            }
        }
        let store = Store::open_in_memory().unwrap();
        store
            .insert_events(&[NewEvent {
                ts: 1_789_550_000,
                kind: EventKind::Commit,
                workspace_dir: Some("/a".into()),
                branch: None,
                title: "c".into(),
                body: None,
                ticket_ids: vec![],
                source_ref: "1".into(),
            }])
            .unwrap();
        let fake = Fake { calls: Default::default(), reply: "ok".into() };
        generate(&store, &fake, &LlmSettings::default(), "2026-09-16", SummaryKind::Bilan, false, 1, &chrono::Utc).unwrap();
        assert_eq!(
            generate(&store, &Fail, &LlmSettings::default(), "2026-09-16", SummaryKind::Bilan, true, 2, &chrono::Utc),
            Err(LlmError::Unauthorized)
        );
        assert_eq!(store.get_summary("2026-09-16", "bilan").unwrap().unwrap().text, "ok");
    }

    #[test]
    fn user_prompt_reste_a_faire_inclut_taches_et_branches() {
        let tasks = vec![OpenTask {
            id: "86c1abc".into(),
            name: "Dashboard".into(),
            status: "en cours".into(),
            url: "https://app.clickup.com/t/86c1abc".into(),
            due_date: Some(1_789_950_000),
            priority: Some("high".into()),
            list_name: Some("Sprint 42".into()),
        }];
        let unmerged = vec![("terminals".to_string(), vec!["feat/dashboard".to_string()])];
        let p = user_prompt(SummaryKind::ResteAFaire, "2026-09-16", "## digest", &SummaryInputs { open_tasks: &tasks, unmerged: &unmerged });
        assert!(p.contains("[86c1abc](https://app.clickup.com/t/86c1abc) Dashboard — en cours — échéance 2026-09-21 — priorité high — Sprint 42"));
        assert!(p.contains("- terminals : feat/dashboard"));
        assert!(p.contains("## digest"));
    }
}
