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

/// Lundi de la semaine de `day` (un lundi se rend lui-même).
pub fn lundi_de(day: NaiveDate) -> NaiveDate {
    day - Duration::days(day.weekday().num_days_from_monday() as i64)
}

/// Plage à résumer pour `kind` sur `day` (spec §6) :
/// - Bilan/ResteAFaire un vendredi : vendredi 00:00 → lundi 00:00 suivant (le week-end
///   qui suit est rattaché au bilan du vendredi, qui est produit le lundi matin) ;
///   tous les autres jours, lundi compris : le jour seul.
/// - Semaine : lundi 00:00 → samedi 00:00 de la semaine de `day`.
pub fn range_for(day: NaiveDate, kind: SummaryKind, tz: &impl TimeZone) -> (i64, i64) {
    use chrono::Weekday;
    match kind {
        SummaryKind::Semaine => {
            let monday = lundi_de(day);
            (local_epoch(monday, tz), local_epoch(monday + Duration::days(5), tz))
        }
        SummaryKind::Bilan | SummaryKind::ResteAFaire => match day.weekday() {
            Weekday::Fri => (local_epoch(day, tz), local_epoch(day + Duration::days(3), tz)),
            _ => (local_epoch(day, tz), local_epoch(day + Duration::days(1), tz)),
        },
    }
}

/// Version des prompts système : entre dans la clé de cache (`cache_hash`) pour
/// qu'un changement de format (v2 : titre + trois puces ; v3 : titre + une
/// puce par projet, apparie à la frise par le nom du projet, le 2026-09-22 ;
/// v4 : une section `## projet` par projet, sans plafond, et jusqu'à cinq
/// puces chacune, le 2026-09-25)
/// invalide les synthèses générées avec l'ancien prompt, sans migration SQL.
pub const PROMPT_VERSION: &str = "v4";

/// Clé de cache d'une synthèse : hash du digest suffixé par la version du prompt.
pub fn cache_hash(digest_hash: &str) -> String {
    format!("{digest_hash}#{PROMPT_VERSION}")
}

/// Message système (invariant par type de synthèse), en français.
pub fn system_prompt(kind: SummaryKind) -> &'static str {
    match kind {
        SummaryKind::Bilan => "Tu es l'assistant de Thomas, développeur. À partir du journal d'activité fourni (commits git, prompts envoyés à Claude Code, commandes shell, changements ClickUp), rédige le bilan de la journée qui lui servira d'aide-mémoire à la daily du lendemain : il doit pouvoir le relire tel quel sans rien oublier de ce qu'il a fait. Format strict : la première ligne est un titre de la journée, huit mots au plus, sans markdown ni ponctuation finale ; puis une ligne vide ; puis, pour chaque projet ayant eu de l'activité, dans l'ordre des sections `##` du journal et sans en omettre aucun : une ligne `## ` suivie du nom du projet exactement tel qu'il est écrit au début de l'en-tête `##` de sa section, puis une à cinq puces (`- `) d'une phrase courte chacune (vingt-cinq mots au plus), concrète et dite simplement comme à l'oral : ce qui a été fait, ce qui a été réglé, ce qui a bloqué ou reste en cours, sans énumérer les commandes ; une activité brève mérite quand même sa puce, et une tâche distincte, sa propre puce. Pas de section pour « ClickUp » ni pour « Tickets cités » : un changement ClickUp se range sous le projet qu'il concerne, sinon il est omis. Cite chaque ticket ClickUp mentionné sous la forme `[id](url)` avec l'URL fournie dans la section « Tickets cités ». N'invente rien qui ne soit pas dans le journal. Rien d'autre : ni préambule, ni conclusion, ni titre de section. Réponds en français.",
        SummaryKind::ResteAFaire => "Tu es l'assistant de Thomas, développeur. On te donne son journal d'activité, ses tâches ClickUp ouvertes et ses branches git non fusionnées. Rédige la liste de ce qui reste à faire, priorisée, en trois sections markdown : `## Tickets ClickUp` (échéance la plus proche d'abord, lien `[id](url)`), `## Branches à finir`, `## Pistes vues dans les prompts` (uniquement si le journal en contient). N'invente rien. Réponds en français, sans préambule.",
        SummaryKind::Semaine => "Tu es l'assistant de Thomas, développeur. À partir des journaux d'activité des jours ouvrés de la semaine, rédige un bilan court de la semaine qui raconte ce qui a été fait. Format strict : la première ligne est un titre de la semaine, huit mots au plus, sans markdown ni ponctuation finale ; puis une ligne vide ; puis, pour chaque projet ayant eu de l'activité dans la semaine, du plus actif au moins actif et sans en omettre aucun : une ligne `## ` suivie du nom du projet exactement tel qu'il est écrit au début de l'en-tête `##` de ses sections, puis une à cinq puces (`- `) d'une phrase courte chacune (vingt-cinq mots au plus) : ce qui a avancé au fil des jours, les tickets clos, le point de friction s'il y en a un. Pas de section pour « ClickUp » ni pour « Tickets cités ». Liens tickets `[id](url)`. N'invente rien. Rien d'autre : ni préambule, ni conclusion, ni titre de section. Réponds en français.",
    }
}

/// Message utilisateur envoyé au LLM : le digest de la période, précédé d'un
/// en-tête, complété pour `ResteAFaire` par les tâches ClickUp ouvertes et les
/// branches non fusionnées.
pub fn user_prompt(
    kind: SummaryKind,
    day: &str,
    digest_text: &str,
    inputs: &SummaryInputs,
    offset: chrono::FixedOffset,
) -> String {
    let mut s = format!("# Journal du {day}\n\n{digest_text}");
    if kind == SummaryKind::ResteAFaire {
        s.push_str("\n\n# Tâches ClickUp ouvertes\n");
        s.push_str(&format_tasks(inputs.open_tasks, offset));
        s.push_str("\n# Branches non fusionnées\n");
        s.push_str(&format_unmerged(inputs.unmerged));
    }
    s
}

fn format_tasks(tasks: &[OpenTask], offset: chrono::FixedOffset) -> String {
    if tasks.is_empty() {
        return "- (aucune)".to_string();
    }
    tasks.iter().map(|t| format_task(t, offset)).collect::<Vec<_>>().join("\n")
}

/// Une tâche en une ligne. L'échéance est rendue au **jour local** (`offset`) :
/// en UTC, une échéance fixée en fin de journée locale s'afficherait la veille et
/// le LLM annoncerait une date fausse (spec §7 : les jours sont locaux).
fn format_task(t: &OpenTask, offset: chrono::FixedOffset) -> String {
    let mut s = format!("- [{}]({}) {} — {}", t.id, t.url, t.name, t.status);
    if let Some(due) = t.due_date {
        if let Some(dt) = chrono::DateTime::from_timestamp(due, 0) {
            s.push_str(&format!(" — échéance {}", dt.with_timezone(&offset).format("%Y-%m-%d")));
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
    let monday = lundi_de(day);
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

/// Jour servant de clé de cache pour `(day, kind)`. Le contenu d'une synthèse
/// `Semaine` ne dépend que de la semaine : toutes les journées d'une même semaine
/// partagent donc **une seule** ligne, datée du lundi. Sans cette normalisation,
/// naviguer du lundi au mardi en mode Semaine créait une seconde ligne au contenu
/// identique, au prix d'un appel LLM complet.
pub fn cache_day_for(day: NaiveDate, kind: SummaryKind) -> String {
    let d = if kind == SummaryKind::Semaine { lundi_de(day) } else { day };
    d.format("%Y-%m-%d").to_string()
}

/// Tout ce qu'il faut pour appeler le fournisseur puis écrire le résultat, sans
/// jamais relire le store : la couche Tauri peut donc relâcher le verrou entre
/// `prepare` et `finish` (l'appel LLM dure jusqu'à 120 s).
pub struct ToGenerate {
    pub request: LlmRequest,
    pub digest_hash: String,
    pub event_count: usize,
    /// Clé `day` de la ligne `summaries` à écrire (cf. `cache_day_for`).
    pub cache_day: String,
    pub kind: SummaryKind,
}

/// Résultat de `prepare` : soit une synthèse déjà disponible (cache valide, ou
/// période vide), soit la requête à soumettre au fournisseur.
pub enum Preparation {
    Cached(Summary),
    ToGenerate(ToGenerate),
}

/// Première moitié de `generate`, **sans appel LLM** : lit le store (événements,
/// tickets, tâches, branches non fusionnées), construit le digest et consulte le
/// cache. Tous les accès à la base sont ici ; l'appelant peut relâcher son verrou
/// dès le retour.
pub fn prepare(
    store: &Store,
    settings: &LlmSettings,
    day: &str,
    kind: SummaryKind,
    force: bool,
    now: i64,
    tz: &impl TimeZone,
) -> Result<Preparation, LlmError> {
    let date = NaiveDate::parse_from_str(day, "%Y-%m-%d")
        .map_err(|e| LlmError::Malformed(format!("jour invalide {day:?} : {e}")))?;
    let cache_day = cache_day_for(date, kind);

    let (digest, offset) = if kind == SummaryKind::Semaine {
        let debut = local_epoch(lundi_de(date), tz);
        (week_digest(store, date, tz)?, fixed_offset_at(debut, tz))
    } else {
        let (from, to) = range_for(date, kind, tz);
        let offset = fixed_offset_at(from, tz);
        (range_digest(store, from, to, offset)?, offset)
    };

    // Le nom du fournisseur est déduit des réglages : `prepare` ne reçoit pas de
    // `LlmProvider` puisqu'elle n'en appelle aucun.
    let model = crate::activity::providers::llm::provider_name(settings);

    if digest.text.is_empty() {
        return Ok(Preparation::Cached(Summary {
            day: cache_day,
            text: EMPTY_TEXT.to_string(),
            model,
            generated_at: now,
            cached: false,
        }));
    }

    if !force {
        if let Some(stored) = store.get_summary(&cache_day, kind.as_str()).map_err(db_err)? {
            if stored.digest_hash == cache_hash(&digest.hash) {
                return Ok(Preparation::Cached(Summary {
                    day: cache_day,
                    text: stored.text,
                    model: stored.model,
                    generated_at: stored.generated_at,
                    cached: true,
                }));
            }
        }
    }

    // Tâches ouvertes et branches non fusionnées ne servent qu'à « reste à faire » :
    // un `branch --no-merged` par dépôt actif est un sous-processus, inutile de le
    // payer pour un bilan ou une synthèse hebdomadaire.
    let (open_tasks, unmerged) = if kind == SummaryKind::ResteAFaire {
        let tasks = store.open_tasks().map_err(db_err)?;
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
        (tasks, unmerged)
    } else {
        (Vec::new(), Vec::new())
    };
    let inputs = SummaryInputs { open_tasks: &open_tasks, unmerged: &unmerged };

    let request = LlmRequest {
        system: system_prompt(kind).to_string(),
        // En-tête daté de la clé de cache : le prompt d'une synthèse hebdomadaire
        // est ainsi le même quel que soit le jour de la semaine demandé.
        user: user_prompt(kind, &cache_day, &digest.text, &inputs, offset),
        max_tokens: settings.max_tokens,
        temperature: settings.temperature,
    };

    Ok(Preparation::ToGenerate(ToGenerate {
        request,
        digest_hash: cache_hash(&digest.hash),
        event_count: digest.event_count,
        cache_day,
        kind,
    }))
}

/// Seconde moitié de `generate` : écrit la réponse du fournisseur dans le cache et
/// construit la `Summary` renvoyée au front. Reprend le verrou du store le temps
/// d'un `INSERT`, pas plus.
pub fn finish(
    store: &Store,
    prep: &ToGenerate,
    text: String,
    model: String,
    now: i64,
) -> Result<Summary, LlmError> {
    store
        .put_summary(&StoredSummary {
            day: prep.cache_day.clone(),
            kind: prep.kind.as_str().to_string(),
            model: model.clone(),
            digest_hash: prep.digest_hash.clone(),
            text: text.clone(),
            generated_at: now,
        })
        .map_err(db_err)?;

    Ok(Summary { day: prep.cache_day.clone(), text, model, generated_at: now, cached: false })
}

/// Génère (ou récupère du cache) la synthèse `kind` du jour `day` : composition de
/// `prepare`, de l'appel au fournisseur et de `finish`. Le cache est tenu par
/// (jour de cache, type, hash du digest) : tant que le digest ne change pas et que
/// `force` n'est pas demandé, la synthèse stockée est réutilisée sans appeler le
/// LLM. Un digest vide court-circuite l'appel LLM et n'écrit rien en cache. Un
/// échec du LLM est propagé sans toucher au cache.
///
/// La couche Tauri n'utilise **pas** cette fonction : elle enchaîne `prepare` et
/// `finish` elle-même pour ne pas tenir le verrou du store pendant l'appel réseau.
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
    match prepare(store, settings, day, kind, force, now, tz)? {
        Preparation::Cached(summary) => Ok(summary),
        Preparation::ToGenerate(prep) => {
            let text = provider.complete(&prep.request)?;
            finish(store, &prep, text, provider.name(), now)
        }
    }
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
        // Lundi : le jour lui-même, et lui seul. Le week-end écoulé est couvert par
        // le bilan *du vendredi* (bras `Fri` ci-dessus), pas par celui du lundi.
        let (f, t) = range_for(d("2026-09-21"), SummaryKind::Bilan, &utc);
        assert_eq!(
            (f, t),
            (local_epoch(d("2026-09-21"), &utc), local_epoch(d("2026-09-22"), &utc)),
            "le bilan d'un lundi couvre le lundi, du lundi 00:00 au mardi 00:00"
        );
        assert_eq!(t - f, 86400);
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
    fn synthese_de_l_ancien_prompt_est_regeneree() {
        // Une ligne `summaries` écrite avant PROMPT_VERSION porte le hash nu du
        // digest : elle ne doit plus passer pour un cache valide.
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
        let (f, t) = day_range("2026-09-16", &chrono::Utc).unwrap();
        let digest = range_digest(&store, f, t, fixed_offset_at(f, &chrono::Utc)).unwrap();
        store
            .put_summary(&crate::activity::store::StoredSummary {
                day: "2026-09-16".into(),
                kind: "bilan".into(),
                model: "ancien".into(),
                digest_hash: digest.hash.clone(),
                text: "## Bilan long".into(),
                generated_at: 1,
            })
            .unwrap();
        let fake = Fake { calls: Default::default(), reply: "Titre\n\n- c".into() };
        let r = generate(&store, &fake, &LlmSettings::default(), "2026-09-16", SummaryKind::Bilan, false, 1_789_600_000, &chrono::Utc).unwrap();
        assert!(!r.cached, "ancien prompt → régénéré");
        assert_eq!(r.text, "Titre\n\n- c");
        assert_eq!(*fake.calls.lock().unwrap(), 1);
    }

    #[test]
    fn prompts_v4_demandent_une_section_par_projet_sans_plafond() {
        // Format v4 (2026-09-25) : une section `## projet` par projet, appariée à
        // sa ligne de frise par le nom tel qu'écrit dans l'en-tête `##` du digest ;
        // le plafond porte sur les puces d'un projet, plus sur le nombre de projets.
        assert_eq!(PROMPT_VERSION, "v4");
        for kind in [SummaryKind::Bilan, SummaryKind::Semaine] {
            let p = system_prompt(kind);
            assert!(p.contains("pour chaque projet"), "{}", kind.as_str());
            assert!(p.contains("sans en omettre aucun"), "{}", kind.as_str());
            assert!(p.contains("une à cinq puces"), "{}", kind.as_str());
            assert!(!p.contains("cinq puces au plus"), "{}", kind.as_str());
            assert!(!p.contains("trois puces"), "{}", kind.as_str());
        }
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
    fn lundi_de_ramene_au_lundi_de_la_semaine() {
        assert_eq!(lundi_de(d("2026-09-21")), d("2026-09-21"), "un lundi reste lui-même");
        assert_eq!(lundi_de(d("2026-09-16")), d("2026-09-14"), "mercredi → lundi précédent");
        assert_eq!(lundi_de(d("2026-09-20")), d("2026-09-14"), "dimanche → lundi de la même semaine");
    }

    #[test]
    fn semaine_partage_une_seule_ligne_de_cache_pour_toute_la_semaine() {
        let store = Store::open_in_memory().unwrap();
        store
            .insert_events(&[NewEvent {
                ts: 1_789_466_400, // mardi 15/09/2026 10:00 UTC
                kind: EventKind::Commit,
                workspace_dir: Some("/a".into()),
                branch: None,
                title: "c".into(),
                body: None,
                ticket_ids: vec![],
                source_ref: "1".into(),
            }])
            .unwrap();
        let fake = Fake { calls: Default::default(), reply: "## Semaine".into() };
        let s = LlmSettings::default();
        let mardi = generate(&store, &fake, &s, "2026-09-15", SummaryKind::Semaine, false, 10, &chrono::Utc).unwrap();
        assert!(!mardi.cached);
        assert_eq!(mardi.day, "2026-09-14", "la synthèse hebdomadaire est datée du lundi");
        // Jour différent, même semaine : la ligne de cache doit être réutilisée.
        let jeudi = generate(&store, &fake, &s, "2026-09-17", SummaryKind::Semaine, false, 11, &chrono::Utc).unwrap();
        assert!(jeudi.cached, "un autre jour de la même semaine réutilise la synthèse");
        assert_eq!(jeudi.day, "2026-09-14");
        assert_eq!(*fake.calls.lock().unwrap(), 1, "un seul appel LLM pour toute la semaine");
        assert!(store.get_summary("2026-09-14", "semaine").unwrap().is_some());
        assert!(store.get_summary("2026-09-17", "semaine").unwrap().is_none(), "aucune ligne parasite");
    }

    #[test]
    fn echeance_formatee_en_heure_locale_et_non_en_utc() {
        // 2026-09-21 21:30 UTC = 2026-09-22 06:30 à Tokyo (UTC+9) : l'échéance doit
        // s'afficher au jour local, sinon le LLM annonce une date fausse (la veille).
        let tokyo = chrono::FixedOffset::east_opt(9 * 3600).unwrap();
        let tasks = vec![OpenTask {
            id: "86c1abc".into(),
            name: "Dashboard".into(),
            status: "en cours".into(),
            url: "https://app.clickup.com/t/86c1abc".into(),
            due_date: Some(1_790_026_200),
            priority: None,
            list_name: None,
        }];
        let p = user_prompt(
            SummaryKind::ResteAFaire,
            "2026-09-21",
            "## digest",
            &SummaryInputs { open_tasks: &tasks, unmerged: &[] },
            tokyo,
        );
        assert!(p.contains("échéance 2026-09-22"), "prompt produit : {p}");
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
        let p = user_prompt(
            SummaryKind::ResteAFaire,
            "2026-09-16",
            "## digest",
            &SummaryInputs { open_tasks: &tasks, unmerged: &unmerged },
            chrono::FixedOffset::east_opt(0).unwrap(),
        );
        assert!(p.contains("[86c1abc](https://app.clickup.com/t/86c1abc) Dashboard — en cours — échéance 2026-09-21 — priorité high — Sprint 42"));
        assert!(p.contains("- terminals : feat/dashboard"));
        assert!(p.contains("## digest"));
    }
}
