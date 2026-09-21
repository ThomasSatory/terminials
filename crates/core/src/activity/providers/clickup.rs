//! Client de l'API ClickUp (résolution des tickets).

use std::collections::HashMap;
use std::sync::{Mutex, OnceLock};
use std::time::Duration;

use chrono::{Local, NaiveDate};
use serde_json::Value;

use crate::activity::providers::claude_process::{run_claude_p, ClaudeProcessError};
use crate::activity::sprint::est_sprint_actuel;
use crate::activity::settings::{ClickupSettings, ClickupSource as SourceReglee};
use crate::activity::{OpenTask, TicketInfo};

/// Délai maximum d'un `claude -p` de collecte ClickUp.
///
/// Mesuré : 82 s pour une seule liste (test de faisabilité), **248 s** pour les
/// trois listes pleines (50 tâches ouvertes, 50 modifiées sur 30 jours, 2 à
/// résoudre). Dix minutes laissent de la marge à une première collecte, la plus
/// chargée. Le verrou du store est relâché pendant tout ce temps, et la cadence
/// est d'une collecte par heure.
const DELAI_MCP: Duration = Duration::from_secs(600);
/// Bornes annoncées au modèle, pour éviter des réponses interminables.
const MAX_TACHES: usize = 50;

#[derive(Debug, Clone, PartialEq)]
pub enum ClickupError {
    Unauthorized,
    Http { status: u16, body: String },
    Network(String),
    Malformed(String),
}

impl std::fmt::Display for ClickupError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClickupError::Unauthorized => write!(f, "jeton ClickUp refusé"),
            ClickupError::Http { status, body } => write!(f, "HTTP {status} : {body}"),
            ClickupError::Network(msg) => write!(f, "réseau : {msg}"),
            ClickupError::Malformed(msg) => write!(f, "réponse inattendue : {msg}"),
        }
    }
}

impl std::error::Error for ClickupError {}

/// Ce que le collecteur demande, calculé sous verrou du store avant l'appel.
#[derive(Debug, Clone, PartialEq)]
pub struct ClickupQuery {
    pub updated_since_ms: i64,
    pub resolve_ids: Vec<String>,
}

/// Ce que la source rapporte, appliqué au store après l'appel.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct ClickupBatch {
    pub updated: Vec<RawTask>,
    pub open: Vec<RawTask>,
    pub resolved: Vec<RawTask>,
}

/// Un aller-retour complet vers ClickUp, quelle qu'en soit la voie (API HTTP ou
/// outils MCP pilotés par `claude -p`). Un seul appel : le collecteur relâche le
/// verrou du store pendant toute sa durée, qui se compte en minutes côté MCP.
pub trait ClickupSource: Send + Sync {
    fn fetch(&self, q: &ClickupQuery) -> Result<ClickupBatch, ClickupError>;
    fn name(&self) -> &'static str;
}

/// Source correspondant aux réglages. `Off`, ou `Api` sans jeton → aucune source.
pub fn from_settings(s: &ClickupSettings) -> Option<Box<dyn ClickupSource>> {
    match s.source {
        SourceReglee::Off => None,
        SourceReglee::Api if s.token.is_empty() => None,
        SourceReglee::Api => Some(Box::new(ClickupClient::new(&s.token))),
        SourceReglee::ClaudeMcp => Some(Box::new(ClickupMcp::default())),
    }
}

pub struct ClickupClient {
    pub base_url: String,
    pub token: String,
    pub timeout: Duration,
}

impl ClickupClient {
    pub fn new(token: &str) -> Self {
        ClickupClient {
            base_url: "https://api.clickup.com/api/v2".to_string(),
            token: token.to_string(),
            timeout: Duration::from_secs(10),
        }
    }

    fn agent(&self) -> ureq::Agent {
        ureq::Agent::new_with_config(
            ureq::Agent::config_builder()
                .http_status_as_error(false)
                .timeout_global(Some(self.timeout))
                .build(),
        )
    }

    /// Requête GET authentifiée, renvoie le corps parsé en JSON.
    fn get_json(&self, agent: &ureq::Agent, url: &str) -> Result<Value, ClickupError> {
        let mut resp = agent
            .get(url)
            .header("Authorization", &self.token)
            .call()
            .map_err(|e| ClickupError::Network(e.to_string()))?;
        let status = resp.status().as_u16();
        let text = resp
            .body_mut()
            .read_to_string()
            .map_err(|e| ClickupError::Network(e.to_string()))?;
        // 403 = jeton valide mais sans droit sur l'équipe : du point de vue de
        // l'utilisateur c'est le même geste correctif qu'un 401 (revoir le jeton),
        // et le client LLM traite déjà les deux ensemble.
        if status == 401 || status == 403 {
            return Err(ClickupError::Unauthorized);
        }
        if !(200..300).contains(&status) {
            return Err(ClickupError::Http {
                status,
                body: text.chars().take(500).collect(),
            });
        }
        serde_json::from_str(&text).map_err(|e| ClickupError::Malformed(e.to_string()))
    }

    pub fn current_user_id(&self) -> Result<u64, ClickupError> {
        let agent = self.agent();
        let url = format!("{}/user", self.base_url);
        let v = self.get_json(&agent, &url)?;
        v["user"]["id"]
            .as_u64()
            .ok_or_else(|| ClickupError::Malformed("user.id manquant".to_string()))
    }

    pub fn first_team_id(&self) -> Result<u64, ClickupError> {
        let agent = self.agent();
        let url = format!("{}/team", self.base_url);
        let v = self.get_json(&agent, &url)?;
        v["teams"][0]["id"]
            .as_u64()
            .ok_or_else(|| ClickupError::Malformed("teams[0].id manquant".to_string()))
    }

    /// Récupère les tâches page par page tant que `last_page == false` (max 20 pages).
    fn fetch_tasks(&self, url_for_page: impl Fn(u32) -> String) -> Result<Vec<RawTask>, ClickupError> {
        let agent = self.agent();
        let mut all = Vec::new();
        for page in 0..20u32 {
            let url = url_for_page(page);
            let v = self.get_json(&agent, &url)?;
            let tasks = v["tasks"].as_array().cloned().unwrap_or_default();
            for t in &tasks {
                if let Some(rt) = RawTask::from_json(t) {
                    all.push(rt);
                }
            }
            let last_page = v["last_page"].as_bool().unwrap_or(true);
            if last_page {
                break;
            }
        }
        Ok(all)
    }

    pub fn tasks_updated_since(
        &self,
        team: u64,
        user: u64,
        since_ms: i64,
    ) -> Result<Vec<RawTask>, ClickupError> {
        self.fetch_tasks(|page| {
            format!(
                "{}/team/{}/task?assignees[]={}&date_updated_gt={}&include_closed=true&subtasks=true&page={}",
                self.base_url, team, user, since_ms, page
            )
        })
    }

    pub fn open_tasks(&self, team: u64, user: u64) -> Result<Vec<RawTask>, ClickupError> {
        self.fetch_tasks(|page| {
            format!(
                "{}/team/{}/task?assignees[]={}&include_closed=false&order_by=due_date&subtasks=true&page={}",
                self.base_url, team, user, page
            )
        })
    }

    /// (utilisateur, équipe), résolus une seule fois par jeton et mémorisés.
    fn ids(&self) -> Result<(u64, u64), ClickupError> {
        if let Some(v) = ids_caches().lock().ok().and_then(|c| c.get(&self.token).copied()) {
            return Ok(v);
        }
        let v = (self.current_user_id()?, self.first_team_id()?);
        if let Ok(mut c) = ids_caches().lock() {
            c.insert(self.token.clone(), v);
        }
        Ok(v)
    }

    pub fn task(&self, id: &str) -> Result<RawTask, ClickupError> {
        let agent = self.agent();
        let url = format!("{}/task/{}", self.base_url, id);
        let v = self.get_json(&agent, &url)?;
        RawTask::from_json(&v).ok_or_else(|| ClickupError::Malformed("tâche invalide".to_string()))
    }
}

/// Collecte ClickUp par les outils MCP de Claude Code : un seul `claude -p`,
/// modèle Sonnet imposé, qui rend les trois listes en JSON.
///
/// C'est la voie par défaut : générer une clé API ClickUp demande des droits que
/// tout le monde n'a pas, alors que le serveur MCP `clickup` est déjà connecté
/// dans la configuration Claude Code de l'utilisateur.
pub struct ClickupMcp {
    pub binary: String,
    pub timeout: Duration,
}

impl Default for ClickupMcp {
    fn default() -> Self {
        ClickupMcp { binary: "claude".to_string(), timeout: DELAI_MCP }
    }
}

/// Arguments de `claude -p` pour la collecte ClickUp. `--allowedTools mcp__clickup`
/// autorise tous les outils du serveur `clickup` sans question interactive ; le
/// prompt part par stdin parce que cette option est variadique et avalerait un
/// prompt passé en argument positionnel.
pub const ARGS_MCP: [&str; 7] = [
    "-p",
    "--output-format",
    "text",
    "--model",
    "sonnet",
    "--allowedTools",
    "mcp__clickup",
];

/// Prompt envoyé sur stdin. Pur : testable sans sous-processus.
///
/// La recette du périmètre « sprint en cours » est donnée explicitement : les US
/// vivent dans un backlog et sont *rattachées* à une liste de sprint, si bien
/// qu'un filtre par liste ne les retrouve pas — seule la recherche par
/// emplacement les voit. `retenir_us` revérifie ensuite type et sprint sur la
/// réponse, le prompt n'est pas le seul garde-fou.
pub fn prompt_mcp(q: &ClickupQuery, aujourd_hui: NaiveDate) -> String {
    let resolus = if q.resolve_ids.is_empty() {
        "aucun identifiant n'est demandé, rends une liste vide".to_string()
    } else {
        format!("les tâches dont voici les identifiants : {}", q.resolve_ids.join(", "))
    };
    format!(
        "Tu as accès aux outils MCP ClickUp. Réponds UNIQUEMENT avec un objet JSON, \
sans texte autour ni balises markdown.\n\n\
Nous sommes le {date}.\n\n\
Trois listes à remplir :\n\
- \"open\" : MES user stories du sprint en cours, non terminées, au plus {max}. \
Marche à suivre, à respecter :\n\
  1. Liste les listes de l'espace de travail. Les listes de sprint portent leur \
période dans leur nom, par exemple « API 180 (8/25 - 9/21) » ou « Web 180 (9/1 - 9/28) ». \
Retiens TOUTES celles dont la période contient le {date} — il y en a une par produit.\n\
  2. Pour chacune, cherche les tâches qui m'y sont assignées. Ces tâches vivent \
dans un backlog et sont rattachées au sprint : un filtre par liste ne les rend PAS, \
il faut une recherche filtrée sur l'emplacement de la liste de sprint et sur mon \
identifiant d'assigné.\n\
  3. Écarte les tâches dont le type ClickUp est « Tâche » (le type par défaut, \
souvent rendu `null`) : daily, réunions, grooming, sous-tâches de documentation. \
Garde les « Story », « Bug », « Anomalie », « Technical story », etc.\n\
  4. Écarte les tâches fermées ou terminées.\n\
- \"updated\" : mes tâches modifiées depuis l'instant {since} (epoch millisecondes), \
tâches fermées incluses, au plus {max}. Aucun filtre de sprint ni de type ici : \
cette liste alimente la chronologie.\n\
- \"resolved\" : {resolus}, tâches fermées incluses. Aucun filtre non plus.\n\n\
Forme exacte de la réponse :\n\
{{\"open\":[…],\"updated\":[…],\"resolved\":[…]}}\n\
Chaque tâche est un objet plat :\n\
{{\"id\":\"…\",\"name\":\"…\",\"status\":\"…\",\"closed\":true ou false,\"url\":\"…\",\
\"dueDate\":epoch millisecondes ou null,\"priority\":\"…\" ou null,\"listName\":\"…\" ou null,\
\"taskType\":\"…\" ou null,\"sprint\":\"…\" ou null,\"updatedAt\":epoch millisecondes}}\n\
`closed` vaut true si le statut de la tâche est un statut fermé ou terminé.\n\
`taskType` est le nom du type ClickUp de la tâche, `null` pour le type par défaut.\n\
`sprint` est le nom COMPLET de la liste de sprint où la tâche a été trouvée, \
période comprise (« API 180 (8/25 - 9/21) ») ; `null` pour \"updated\" et \"resolved\".",
        date = aujourd_hui.format("%d/%m/%Y"),
        max = MAX_TACHES,
        since = q.updated_since_ms,
        resolus = resolus,
    )
}

/// Isole l'objet JSON d'une sortie qui peut être entourée de texte ou de balises
/// ```` ```json ````. Pur.
pub fn extraire_json(sortie: &str) -> Option<&str> {
    let debut = sortie.find('{')?;
    let fin = sortie.rfind('}')?;
    if fin < debut {
        return None;
    }
    Some(&sortie[debut..=fin])
}

/// Parse la réponse du modèle en trois listes. Une tâche mal formée est ignorée ;
/// une sortie sans objet JSON ou illisible est une erreur. Pur.
pub fn parse_batch(sortie: &str) -> Result<ClickupBatch, ClickupError> {
    let brut = extraire_json(sortie)
        .ok_or_else(|| ClickupError::Malformed(format!("aucun objet JSON dans : {}", apercu(sortie))))?;
    let v: Value = serde_json::from_str(brut)
        .map_err(|e| ClickupError::Malformed(format!("{e} dans : {}", apercu(brut))))?;
    let liste = |cle: &str| -> Vec<RawTask> {
        v[cle]
            .as_array()
            .map(|a| a.iter().filter_map(RawTask::from_flat_json).collect())
            .unwrap_or_default()
    };
    Ok(ClickupBatch { updated: liste("updated"), open: liste("open"), resolved: liste("resolved") })
}

/// Début d'une sortie, pour les messages d'erreur. Aucun jeton ne transite par
/// cette voie (le MCP est authentifié côté Claude Code), mais on borne quand même.
fn apercu(s: &str) -> String {
    s.chars().take(200).collect()
}

impl ClickupSource for ClickupMcp {
    fn fetch(&self, q: &ClickupQuery) -> Result<ClickupBatch, ClickupError> {
        let args: Vec<&str> = ARGS_MCP.to_vec();
        let aujourd_hui = Local::now().date_naive();
        let sortie = run_claude_p(&self.binary, &args, &prompt_mcp(q, aujourd_hui), self.timeout).map_err(|e| match e {
            ClaudeProcessError::Spawn(msg) => ClickupError::Network(format!("claude introuvable : {msg}")),
            ClaudeProcessError::Timeout => ClickupError::Network("claude -p : délai dépassé".to_string()),
            ClaudeProcessError::Failed { code, stderr } => ClickupError::Http { status: code.max(0) as u16, body: stderr },
        })?;
        let mut batch = parse_batch(&sortie)?;
        batch.open = retenir_us(batch.open, aujourd_hui, true);
        Ok(batch)
    }

    fn name(&self) -> &'static str {
        "clickup-mcp"
    }
}

/// Cache mémoire des identifiants (utilisateur, équipe) par jeton : deux appels
/// HTTP de moins à chaque collecte, et plus de curseurs `clickup:user` /
/// `clickup:team` dans la base. Clé par jeton pour qu'un changement de jeton
/// dans les réglages reparte d'une résolution propre, sans redémarrage.
fn ids_caches() -> &'static Mutex<HashMap<String, (u64, u64)>> {
    static CACHE: OnceLock<Mutex<HashMap<String, (u64, u64)>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

impl ClickupSource for ClickupClient {
    fn fetch(&self, q: &ClickupQuery) -> Result<ClickupBatch, ClickupError> {
        let (user, team) = self.ids()?;
        let updated = self.tasks_updated_since(team, user, q.updated_since_ms)?;
        // Périmètre sprint impossible ici : `/team/{id}/task` ne rend que la
        // liste principale de la tâche, jamais la liste de sprint à laquelle
        // elle est rattachée. Seul le type est filtré.
        let open = retenir_us(self.open_tasks(team, user)?, Local::now().date_naive(), false);
        // Une erreur de résolution individuelle est ignorée : le ticket peut être
        // transitoirement indisponible, et le reste du lot reste exploitable.
        let resolved = q.resolve_ids.iter().filter_map(|id| self.task(id).ok()).collect();
        Ok(ClickupBatch { updated, open, resolved })
    }

    fn name(&self) -> &'static str {
        "clickup-api"
    }
}

/// Libellés du type ClickUp par défaut, tels qu'ils peuvent revenir de la voie
/// MCP quand le modèle rend le nom affiché plutôt que `null`.
const TYPES_PAR_DEFAUT: [&str; 2] = ["tâche", "task"];

/// Ne garde que ce qui doit apparaître dans « Reste à faire » : les US du sprint
/// en cours.
///
/// Deux critères, tous deux vérifiés ici plutôt que laissés à la source — la
/// voie MCP passe par un modèle, qui peut élargir le périmètre demandé :
/// - le type ClickUp n'est pas le type par défaut « Tâche » (daily, réunions,
///   grooming, sous-tâches de documentation… n'ont rien à faire dans la liste) ;
/// - avec `exiger_sprint`, la tâche vient d'une liste de sprint dont la période
///   contient `aujourd_hui`. L'API HTTP ne sait pas rattacher une tâche à son
///   sprint (elle ne rend que la liste principale) : elle passe `false` et se
///   contente du filtre de type.
///
/// Pur.
pub fn retenir_us(taches: Vec<RawTask>, aujourd_hui: NaiveDate, exiger_sprint: bool) -> Vec<RawTask> {
    taches
        .into_iter()
        .filter(|t| match &t.task_type {
            None => false,
            Some(nom) => !TYPES_PAR_DEFAUT.contains(&nom.trim().to_lowercase().as_str()),
        })
        .filter(|t| {
            !exiger_sprint
                || t.sprint.as_deref().is_some_and(|s| est_sprint_actuel(s, aujourd_hui))
        })
        .collect()
}

/// Tâche réduite, parsée depuis le JSON ClickUp. Pur : `RawTask::from_json(&Value) -> Option<RawTask>`.
#[derive(Debug, Clone, PartialEq)]
pub struct RawTask {
    pub id: String,
    pub name: String,
    pub status: String,
    pub status_type: String,
    pub url: String,
    pub date_updated_ms: i64,
    pub due_date_ms: Option<i64>,
    pub priority: Option<String>,
    pub list_name: Option<String>,
    /// Nom du type ClickUp (« Story », « Bug », « Anomalie »…). `None` désigne
    /// le type par défaut, affiché « Tâche » dans l'interface — c'est lui qu'on
    /// écarte du « Reste à faire ». L'API HTTP ne rend que `custom_item_id`,
    /// sans le nom : elle renseigne alors `Some("personnalisé")`.
    pub task_type: Option<String>,
    /// Nom de la liste de sprint où la tâche a été trouvée, quand la source sait
    /// le dire (voie MCP). `None` côté API HTTP, qui ne rend que la liste
    /// principale — souvent un backlog.
    pub sprint: Option<String>,
}

impl RawTask {
    pub fn from_json(v: &Value) -> Option<RawTask> {
        let id = v["id"].as_str()?.to_string();
        let name = v["name"].as_str()?.to_string();
        let status = v["status"]["status"].as_str()?.to_string();
        let status_type = v["status"]["type"].as_str()?.to_string();
        let url = v["url"].as_str()?.to_string();
        let date_updated_ms = v["date_updated"].as_str()?.parse::<i64>().ok()?;
        let due_date_ms = v["due_date"].as_str().and_then(|s| s.parse::<i64>().ok());
        let priority = v["priority"]["priority"].as_str().map(str::to_string);
        let list_name = v["list"]["name"].as_str().map(str::to_string);
        // `custom_item_id` absent ou 0 = type par défaut « Tâche ». L'API v2 ne
        // rend pas le nom des types personnalisés, d'où le libellé générique.
        let task_type = match v["custom_item_id"].as_i64().unwrap_or(0) {
            0 => None,
            _ => Some("personnalisé".to_string()),
        };
        Some(RawTask {
            id,
            name,
            status,
            status_type,
            url,
            date_updated_ms,
            due_date_ms,
            priority,
            list_name,
            task_type,
            // La liste rendue par l'API est la liste principale de la tâche (le
            // backlog, le plus souvent) : elle ne dit rien du sprint.
            sprint: None,
        })
    }

    /// Forme « plate » rendue par le modèle via les outils MCP : `closed` remplace
    /// `status.type`. Pur.
    pub fn from_flat_json(v: &Value) -> Option<RawTask> {
        Some(RawTask {
            id: v["id"].as_str()?.to_string(),
            name: v["name"].as_str()?.to_string(),
            status: v["status"].as_str()?.to_string(),
            status_type: if v["closed"].as_bool().unwrap_or(false) { "closed" } else { "open" }.to_string(),
            url: v["url"].as_str()?.to_string(),
            date_updated_ms: v["updatedAt"].as_i64()?,
            due_date_ms: v["dueDate"].as_i64(),
            priority: v["priority"].as_str().map(str::to_string),
            list_name: v["listName"].as_str().map(str::to_string),
            task_type: v["taskType"].as_str().map(str::to_string),
            sprint: v["sprint"].as_str().map(str::to_string),
        })
    }

    /// Dates converties en secondes (le store travaille en epoch secondes UTC).
    pub fn to_ticket_info(&self) -> TicketInfo {
        TicketInfo {
            id: self.id.clone(),
            name: self.name.clone(),
            status: self.status.clone(),
            status_type: self.status_type.clone(),
            url: self.url.clone(),
            due_date: self.due_date_ms.map(|ms| ms / 1000),
            list_name: self.list_name.clone(),
        }
    }

    pub fn to_open_task(&self) -> OpenTask {
        OpenTask {
            id: self.id.clone(),
            name: self.name.clone(),
            status: self.status.clone(),
            url: self.url.clone(),
            due_date: self.due_date_ms.map(|ms| ms / 1000),
            priority: self.priority.clone(),
            list_name: self.list_name.clone(),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const TASK: &str = r#"{"id":"86c1abc","name":"Dashboard activité","status":{"status":"en cours","type":"custom"},"custom_item_id":1003,
 "date_updated":"1789550000000","due_date":"1789900000000","url":"https://app.clickup.com/t/86c1abc",
 "priority":{"priority":"high"},"list":{"name":"Sprint 42"}}"#;

    #[test]
    fn raw_task_depuis_json_clickup() {
        let t = RawTask::from_json(&serde_json::from_str(TASK).unwrap()).unwrap();
        assert_eq!(t.id, "86c1abc");
        assert_eq!(t.status, "en cours");
        assert_eq!(t.date_updated_ms, 1789550000000);
        assert_eq!(t.priority.as_deref(), Some("high"));
        assert_eq!(t.list_name.as_deref(), Some("Sprint 42"));
        let info = t.to_ticket_info();
        assert_eq!(info.due_date, Some(1789900000));
        let open = t.to_open_task();
        assert_eq!(open.name, "Dashboard activité");
    }

    /// Sortie réelle de `claude -p` (tâche 18), remise à la forme à trois listes.
    /// Copie suivie par git de `task-18-exemple-mcp-3listes.json` : le dossier
    /// `.superpowers/` est ignoré, la fixture ne peut donc pas y rester seule.
    const FIXTURE_MCP: &str = include_str!(concat!(env!("CARGO_MANIFEST_DIR"), "/tests/fixtures/clickup-mcp-3listes.json"));

    /// Date fixe des tests : dernier jour du sprint « API 180 (8/25 - 9/21) ».
    fn jour_test() -> NaiveDate {
        NaiveDate::from_ymd_opt(2026, 9, 21).unwrap()
    }

    fn requete() -> ClickupQuery {
        ClickupQuery { updated_since_ms: 1_789_000_000_000, resolve_ids: vec!["86cx00001".into(), "86cx00002".into()] }
    }

    #[test]
    fn prompt_mcp_annonce_les_trois_listes_la_borne_et_les_identifiants() {
        let p = prompt_mcp(&requete(), jour_test());
        assert!(p.contains("\"open\"") && p.contains("\"updated\"") && p.contains("\"resolved\""), "{p}");
        assert!(p.contains("1789000000000"), "la borne de modification doit être dans le prompt : {p}");
        assert!(p.contains("86cx00001") && p.contains("86cx00002"), "{p}");
        assert!(p.contains("closed"), "le champ closed doit être demandé : {p}");
        assert!(p.contains(&MAX_TACHES.to_string()), "{p}");
    }

    /// Construit une tâche brute de test, type et sprint paramétrables.
    fn us(id: &str, task_type: Option<&str>, sprint: Option<&str>) -> RawTask {
        RawTask {
            id: id.into(),
            name: format!("US {id}"),
            status: "en cours".into(),
            status_type: "open".into(),
            url: format!("https://app.clickup.com/t/{id}"),
            date_updated_ms: 1,
            due_date_ms: None,
            priority: None,
            list_name: None,
            task_type: task_type.map(str::to_string),
            sprint: sprint.map(str::to_string),
        }
    }

    fn ids(taches: &[RawTask]) -> Vec<&str> {
        taches.iter().map(|t| t.id.as_str()).collect()
    }

    #[test]
    fn retenir_us_ecarte_le_type_par_defaut() {
        let sprint = Some("API 180 (8/25 - 9/21)");
        let lot = vec![
            us("story", Some("Story"), sprint),
            us("bug", Some("Bug"), sprint),
            us("anomalie", Some("Anomalie"), sprint),
            us("null", None, sprint),
            us("tache", Some("Tâche"), sprint),
            us("task", Some("task"), sprint),
            us("tache-espacee", Some("  TÂCHE  "), sprint),
        ];
        assert_eq!(ids(&retenir_us(lot, jour_test(), true)), ["story", "bug", "anomalie"]);
    }

    #[test]
    fn retenir_us_ecarte_ce_qui_n_est_pas_du_sprint_en_cours() {
        let lot = vec![
            us("courant", Some("Story"), Some("API 180 (8/25 - 9/21)")),
            us("autre-produit", Some("Story"), Some("Mobile 180 (9/7 - 10/5)")),
            us("suivant", Some("Story"), Some("API 181 (9/22 - 10/19)")),
            us("precedent", Some("Story"), Some("Mobile 179 (8/11 - 9/7)")),
            us("backlog", Some("Story"), Some("Backlog API / Backend")),
            us("sans-sprint", Some("Story"), None),
        ];
        assert_eq!(ids(&retenir_us(lot, jour_test(), true)), ["courant", "autre-produit"]);
    }

    #[test]
    fn retenir_us_sans_exigence_de_sprint_ne_filtre_que_le_type() {
        // Voie API HTTP : la liste de sprint est inconnue, on ne peut pas s'en servir.
        let lot = vec![
            us("story", Some("personnalisé"), None),
            us("backlog", Some("Story"), Some("Backlog API / Backend")),
            us("tache", None, None),
        ];
        assert_eq!(ids(&retenir_us(lot, jour_test(), false)), ["story", "backlog"]);
    }

    #[test]
    fn raw_task_plate_lit_le_type_et_le_sprint() {
        let t = RawTask::from_flat_json(&serde_json::json!({
            "id":"x","name":"n","status":"s","closed":false,"url":"u","updatedAt":5_i64,
            "taskType":"Story","sprint":"API 180 (8/25 - 9/21)"
        }))
        .unwrap();
        assert_eq!(t.task_type.as_deref(), Some("Story"));
        assert_eq!(t.sprint.as_deref(), Some("API 180 (8/25 - 9/21)"));
    }

    #[test]
    fn raw_task_http_deduit_le_type_de_custom_item_id() {
        let sans = |v| RawTask::from_json(&v).unwrap();
        let base = |item: serde_json::Value| {
            serde_json::json!({"id":"x","name":"n","status":{"status":"s","type":"open"},
                "date_updated":"5","url":"u","custom_item_id":item})
        };
        assert_eq!(sans(base(serde_json::json!(0))).task_type, None, "0 = type « Tâche »");
        assert_eq!(sans(base(serde_json::json!(null))).task_type, None, "absent = type « Tâche »");
        assert_eq!(sans(base(serde_json::json!(1003))).task_type.as_deref(), Some("personnalisé"));
        assert_eq!(sans(base(serde_json::json!(1003))).sprint, None, "l'API ne rend pas le sprint");
    }

    #[test]
    fn prompt_mcp_cadre_le_perimetre_sprint_et_le_type() {
        let p = prompt_mcp(&requete(), jour_test());
        assert!(p.contains("21/09/2026"), "la date du jour doit être dans le prompt : {p}");
        assert!(p.contains("taskType") && p.contains("sprint"), "{p}");
        assert!(p.to_lowercase().contains("sprint en cours"), "{p}");
        assert!(p.contains("« Tâche »"), "le type à écarter doit être nommé : {p}");
    }

    #[test]
    fn prompt_mcp_sans_identifiant_a_resoudre_demande_une_liste_vide() {
        let p = prompt_mcp(&ClickupQuery { updated_since_ms: 1, resolve_ids: vec![] }, jour_test());
        assert!(p.to_lowercase().contains("vide"), "{p}");
    }

    #[test]
    fn extraire_json_tolere_le_texte_autour_et_les_balises_markdown() {
        assert_eq!(extraire_json(r#"{"a":1}"#), Some(r#"{"a":1}"#));
        assert_eq!(extraire_json("Voici :\n```json\n{\"a\":1}\n```\nVoilà."), Some(r#"{"a":1}"#));
        assert_eq!(extraire_json("blabla {\"a\":{\"b\":2}} fin"), Some(r#"{"a":{"b":2}}"#));
        assert_eq!(extraire_json("aucun objet ici"), None);
    }

    #[test]
    fn parse_batch_sur_la_fixture_reelle() {
        let b = parse_batch(FIXTURE_MCP).unwrap();
        assert_eq!(b.open.len(), 5);
        assert_eq!(b.updated.len(), 3);
        assert_eq!(b.resolved.len(), 1);
        let t = &b.open[0];
        assert_eq!(t.id, "86cx00001");
        assert_eq!(t.status, "code review");
        assert_eq!(t.status_type, "open");
        assert_eq!(t.date_updated_ms, 1_789_722_228_496);
        assert_eq!(t.due_date_ms, None);
        assert_eq!(t.priority.as_deref(), Some("normal"));
        assert_eq!(t.list_name.as_deref(), Some("Backlog API / Backend"));
        assert_eq!(b.updated[2].status_type, "closed", "closed:true → status_type closed");
        assert_eq!(b.resolved[0].status_type, "closed");
    }

    #[test]
    fn parse_batch_listes_absentes_et_sortie_illisible() {
        let b = parse_batch(r#"{"open":[]}"#).unwrap();
        assert!(b.open.is_empty() && b.updated.is_empty() && b.resolved.is_empty());
        assert!(matches!(parse_batch("je n'ai pas pu joindre ClickUp"), Err(ClickupError::Malformed(_))));
        assert!(matches!(parse_batch("{ceci n'est pas du json}"), Err(ClickupError::Malformed(_))));
    }

    #[test]
    fn parse_batch_ignore_les_taches_incompletes() {
        let b = parse_batch(r#"{"open":[{"id":"a"},{"id":"b","name":"n","status":"s","closed":false,"url":"u","updatedAt":5}]}"#).unwrap();
        assert_eq!(b.open.len(), 1);
        assert_eq!(b.open[0].id, "b");
    }

    #[test]
    fn raw_task_plate_due_date_et_priorite_nulles() {
        let t = RawTask::from_flat_json(&serde_json::json!({
            "id":"x","name":"n","status":"s","closed":false,"url":"u",
            "dueDate":null,"priority":null,"listName":null,"updatedAt":5_i64
        }))
        .unwrap();
        assert_eq!(t.due_date_ms, None);
        assert_eq!(t.priority, None);
        assert_eq!(t.list_name, None);
        assert_eq!(t.status_type, "open");
        assert_eq!(t.date_updated_ms, 5);
    }

    /// Écrit un faux `claude` exécutable qui rend `sortie` et termine sur `code`.
    fn faux_claude(dir: &std::path::Path, corps: &str) -> String {
        use std::os::unix::fs::PermissionsExt;
        let chemin = dir.join("faux-claude");
        std::fs::write(&chemin, format!("#!/bin/sh\n{corps}\n")).unwrap();
        std::fs::set_permissions(&chemin, std::fs::Permissions::from_mode(0o755)).unwrap();
        chemin.display().to_string()
    }

    /// `fetch` en réessayant sur `ETXTBSY` : les tests tournent en parallèle et un
    /// fils forké ailleurs peut tenir brièvement le descripteur du faux binaire.
    fn fetch_reessaye(mcp: &ClickupMcp, q: &ClickupQuery) -> Result<ClickupBatch, ClickupError> {
        for _ in 0..20 {
            match mcp.fetch(q) {
                Err(ClickupError::Network(msg)) if msg.contains("os error 26") => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                autre => return autre,
            }
        }
        mcp.fetch(q)
    }

    #[test]
    fn mcp_fetch_passe_les_bonnes_options_et_lit_le_json() {
        let dir = tempfile::tempdir().unwrap();
        // Le faux binaire recrache ses arguments dans le champ `name` de la seule
        // tâche rendue : un seul script vérifie à la fois la ligne de commande et
        // le parsing. La période du sprint couvre l'année entière — `fetch` filtre
        // sur la date RÉELLE du jour, le test doit passer n'importe quand.
        let bin = faux_claude(
            dir.path(),
            r#"cat > /dev/null; printf '{"open":[{"id":"1","name":"%s","status":"s","closed":false,"url":"u","dueDate":null,"priority":null,"listName":null,"taskType":"Story","sprint":"TEST 1 (1/1 - 12/31)","updatedAt":1}],"updated":[],"resolved":[]}' "$*""#,
        );
        let mcp = ClickupMcp { binary: bin, timeout: Duration::from_secs(20) };
        let b = fetch_reessaye(&mcp, &requete()).unwrap();
        assert_eq!(b.open.len(), 1);
        let args = &b.open[0].name;
        assert!(args.contains("--model sonnet"), "{args}");
        assert!(args.contains("--allowedTools mcp__clickup"), "{args}");
        assert!(args.contains("--output-format text"), "{args}");
        assert_eq!(mcp.name(), "clickup-mcp");
    }

    #[test]
    fn mcp_fetch_tolere_du_texte_autour_du_json() {
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_claude(
            dir.path(),
            r#"cat > /dev/null; echo 'Voici le résultat :'; echo '```json'; echo '{"open":[],"updated":[],"resolved":[]}'; echo '```'"#,
        );
        let mcp = ClickupMcp { binary: bin, timeout: Duration::from_secs(20) };
        assert_eq!(fetch_reessaye(&mcp, &requete()).unwrap(), ClickupBatch::default());
    }

    #[test]
    fn mcp_fetch_en_echec_rend_une_erreur() {
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_claude(dir.path(), "cat > /dev/null; echo 'boum' >&2; exit 1");
        let mcp = ClickupMcp { binary: bin, timeout: Duration::from_secs(20) };
        assert!(matches!(fetch_reessaye(&mcp, &requete()), Err(ClickupError::Http { .. })));

        let mcp = ClickupMcp { binary: "/nonexistent/claude".into(), timeout: Duration::from_secs(5) };
        assert!(matches!(mcp.fetch(&requete()), Err(ClickupError::Network(_))));
    }

    #[test]
    fn from_settings_choisit_la_source() {
        use crate::activity::settings::ClickupSource as S;
        let source = |source, token: &str| from_settings(&ClickupSettings { source, token: token.into() }).map(|s| s.name());
        assert_eq!(source(S::ClaudeMcp, ""), Some("clickup-mcp"));
        assert_eq!(source(S::Api, "pk_1"), Some("clickup-api"));
        assert_eq!(source(S::Api, ""), None, "clé API sans jeton : aucune source");
        assert_eq!(source(S::Off, "pk_1"), None);
    }

    #[test]
    fn raw_task_sans_due_date_ni_priorite() {
        let t = RawTask::from_json(&serde_json::json!({"id":"x","name":"n","status":{"status":"s","type":"open"},"date_updated":"5","url":"u","priority":null})).unwrap();
        assert_eq!(t.due_date_ms, None);
        assert_eq!(t.priority, None);
        assert_eq!(t.list_name, None);
    }
}
