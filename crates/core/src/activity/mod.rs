//! Historique d'activité (dashboard) : types partagés entre store, collecteurs,
//! digest et couche Tauri. Aucune dépendance à Tauri ici.

pub mod collectors;
pub mod digest;
pub mod providers;
pub mod saisie;
pub mod settings;
pub mod shell_integration;
pub mod sprint;
pub mod store;
pub mod summaries;
pub mod tickets;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    Commit,
    ClaudePrompt,
    ClaudeSession,
    ShellCmd,
    ClickupChange,
}

impl EventKind {
    pub fn as_str(&self) -> &'static str {
        match self {
            EventKind::Commit => "commit",
            EventKind::ClaudePrompt => "claude_prompt",
            EventKind::ClaudeSession => "claude_session",
            EventKind::ShellCmd => "shell_cmd",
            EventKind::ClickupChange => "clickup_change",
        }
    }
    pub fn parse(s: &str) -> Option<Self> {
        Some(match s {
            "commit" => EventKind::Commit,
            "claude_prompt" => EventKind::ClaudePrompt,
            "claude_session" => EventKind::ClaudeSession,
            "shell_cmd" => EventKind::ShellCmd,
            "clickup_change" => EventKind::ClickupChange,
            _ => return None,
        })
    }
}

/// Événement à insérer (pas encore d'id). `source_ref` = clé d'idempotence (spec §4).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct NewEvent {
    pub ts: i64,
    pub kind: EventKind,
    pub workspace_dir: Option<String>,
    pub branch: Option<String>,
    pub title: String,
    pub body: Option<String>,
    pub ticket_ids: Vec<String>,
    pub source_ref: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketRef {
    pub id: String,
    pub name: Option<String>,
    pub status: Option<String>,
    pub url: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityEvent {
    pub id: i64,
    pub ts: i64,
    pub kind: EventKind,
    pub workspace_dir: Option<String>,
    pub branch: Option<String>,
    pub title: String,
    pub body: Option<String>,
    pub ticket_ids: Vec<String>,
    pub tickets: Vec<TicketRef>,
    /// US sur laquelle on travaillait, déduite de la branche ou du worktree
    /// (`tickets::us_id`) et résolue dans les tickets connus : base du temps à saisir.
    pub us_ticket: Option<TicketRef>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketInfo {
    pub id: String,
    pub name: String,
    pub status: String,
    pub status_type: String,
    pub url: String,
    pub due_date: Option<i64>,
    pub list_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTask {
    pub id: String,
    pub name: String,
    pub status: String,
    pub url: String,
    pub due_date: Option<i64>,
    pub priority: Option<String>,
    pub list_name: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals {
    pub commits: u32,
    pub prompts: u32,
    pub commands: u32,
    pub tickets: u32,
    pub active_minutes: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct KindCounts {
    pub commit: u32,
    pub claude_prompt: u32,
    pub shell_cmd: u32,
    pub clickup_change: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HourCounts {
    pub hour: u8,
    #[serde(flatten)]
    pub counts: KindCounts,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DayCounts {
    pub day: String,
    #[serde(flatten)]
    pub counts: KindCounts,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceCount {
    pub dir: String,
    pub name: String,
    pub events: u32,
    pub commits: u32,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ActivityStats {
    pub totals: Totals,
    pub by_hour: Vec<HourCounts>,
    pub by_day: Vec<DayCounts>,
    pub by_workspace: Vec<WorkspaceCount>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Summary {
    /// Jour sous lequel la synthèse est rangée (`YYYY-MM-DD`, heure locale). Il
    /// vaut le jour demandé, sauf pour `semaine` où c'est le **lundi** de la
    /// semaine : c'est la clé de cache, et le front s'en sert pour savoir à quelle
    /// période correspond réellement le texte affiché.
    pub day: String,
    pub text: String,
    pub model: String,
    pub generated_at: i64,
    pub cached: bool,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct CollectReport {
    pub git: usize,
    pub claude: usize,
    pub clickup: usize,
    pub errors: Vec<String>,
}

/// Racine du dépôt git contenant `dir`, ou `dir` lui-même hors git / dossier absent.
pub fn repo_root(dir: &str) -> String {
    std::process::Command::new("git")
        .args(["rev-parse", "--show-toplevel"])
        .current_dir(dir)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
        .unwrap_or_else(|| dir.to_string())
}

/// `~/dev/terminals` → `terminals`.
pub fn workspace_name(dir: &str) -> String {
    dir.trim_end_matches('/')
        .rsplit('/')
        .next()
        .filter(|s| !s.is_empty())
        .unwrap_or(dir)
        .to_string()
}
