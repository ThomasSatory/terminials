# Dashboard d'activité — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Une vue Dashboard (Ctrl+Shift+H) qui restitue l'activité de l'utilisateur (commits, prompts Claude, commandes shell, ClickUp) par jour/semaine, avec graphiques SVG et trois résumés LLM (Gemma via API OpenAI-compatible) générés à 07:00 en semaine ou à la demande.

**Architecture:** Module pur `crates/core/src/activity/` (SQLite via rusqlite, collecteurs, digest, fournisseurs HTTP via ureq) ; câblage Tauri + planificateur dans `src-tauri/src/activity.rs` ; overlay React `DashboardOverlay` calqué sur `DiffOverlay`, store zustand `dashboard.ts`. Le front n'agrège rien : il affiche `activity_stats` / `activity_query`.

**Tech Stack:** Rust 2021 (rusqlite 0.40 bundled, ureq 3 json, chrono 0.4, sha2 0.11, base64 0.23, regex 1, serde), Tauri v2, React 19, zustand 5, vitest 4, SVG maison.

**Spec:** `docs/superpowers/specs/2026-09-17-dashboard-activite-design.md`

## Global Constraints

- Tout code, commentaire, message de commit et libellé UI en **français** (convention du dépôt).
- Timestamps : epoch **secondes UTC** (`i64`) ; jours : chaînes `YYYY-MM-DD` en heure locale.
- Kinds d'événement : `commit | claude_prompt | claude_session | shell_cmd | clickup_change` (snake_case, aussi en JSON).
- `activity/*` ne dépend **jamais** de Tauri ; `src-tauri/src/activity.rs` ne fait que du câblage.
- Aucune nouvelle dépendance npm. Graphiques en SVG maison. Markdown rendu en nœuds React, jamais `innerHTML`.
- Réglages : `~/.config/terminials/settings.json` en mode `0600`, écrit atomiquement. Aucun jeton dans les logs, la spec, le dépôt.
- Sérialisation JSON côté IPC en `camelCase` (`#[serde(rename_all = "camelCase")]`), kinds exceptés.
- Commandes : `cargo test -p terminials-core` pour Rust (utiliser `CARGO_TARGET_DIR=/home/user/dev/terminals/target` pour réutiliser le cache), `npx vitest run` pour le front, `npx tsc --noEmit` pour le typage.
- Commits fréquents, format `feat(core|front|tauri): …`, terminés par `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`.

## Structure des fichiers

| Fichier | Responsabilité |
|---|---|
| `crates/core/src/activity/mod.rs` | types partagés (`EventKind`, `NewEvent`, `ActivityEvent`, `TicketRef`, `TicketInfo`, `OpenTask`, stats, `Summary`, `CollectReport`), `repo_root()` |
| `crates/core/src/activity/settings.rs` | `Settings` + défauts, `load`/`save` 0600 |
| `crates/core/src/activity/tickets.rs` | `extract_ticket_ids`, `ticket_url` |
| `crates/core/src/activity/store.rs` | `Store` SQLite : schéma, insert idempotent, query, stats, repos, cursors, summaries, tickets, open_tasks |
| `crates/core/src/osc.rs` (modif) | `OscEvent::{Notification, Command, Exit}`, `OscScanner::feed_events` |
| `crates/core/src/activity/shell_integration.rs` | shims bash/zsh, `ShellLaunch` |
| `crates/core/src/activity/collectors/shell.rs` | `ShellPairer` (C puis D → `shell_cmd`) |
| `crates/core/src/activity/collectors/claude.rs` | scan des `.jsonl` |
| `crates/core/src/activity/collectors/git.rs` | `git log` par repo, `unmerged_branches` |
| `crates/core/src/activity/providers/llm.rs` | `LlmProvider`, `OpenAiCompatible`, `Ollama`, `ClaudeCli`, `from_settings` |
| `crates/core/src/activity/providers/clickup.rs` | client REST ClickUp |
| `crates/core/src/activity/collectors/clickup.rs` | collecte changements + open_tasks + résolution tickets |
| `crates/core/src/activity/digest.rs` | `build_digest` |
| `crates/core/src/activity/summaries.rs` | `SummaryKind`, prompts, `last_working_day`, `generate` |
| `src-tauri/src/activity.rs` | `ActivityState`, commandes Tauri, planificateur |
| `src-tauri/src/lib.rs`, `pty.rs` (modif) | shim shell au spawn, OSC → pairer, enregistrement des commandes |
| `src/lib/shortcuts.ts` (modif), `src/lib/shortcutDispatch.ts` (modif) | `toggle-dashboard` |
| `src/store/dashboard.ts` | état UI du dashboard |
| `src/lib/dashboardDay.ts` | jours locaux, plages, dernier jour ouvré |
| `src/lib/markdownLite.tsx` | rendu markdown restreint |
| `src/lib/activityApi.ts` | wrappers `invoke` typés (types TS du contrat IPC §7) |
| `src/components/dashboard/{StatTiles,HourChart,WorkspaceBars,Timeline,SummaryPanel,OpenTasks,SettingsPanel}.tsx` | blocs de l'overlay |
| `src/components/DashboardOverlay.tsx` | assemblage, barre du haut, clavier |
| `src/components/Sidebar.tsx`, `src/App.tsx`, `src/App.css` (modif) | entrée sidebar + pastille, montage overlay, écoute des events, CSS |
| `README.md` (modif) | section Dashboard |

Ordre : Tâches 1→3 d'abord (types, réglages, store). Puis 4→10 (Rust, indépendantes entre elles) et 12→15 (front, indépendantes du Rust grâce au contrat IPC) peuvent tourner en parallèle. Tâche 11 après 3→10. Tâche 16 en dernier.

---

### Task 1 : Dépendances, squelette du module, réglages

**Files:**
- Modify: `Cargo.toml` (workspace deps), `crates/core/Cargo.toml`, `crates/core/src/lib.rs`
- Create: `crates/core/src/activity/mod.rs`, `crates/core/src/activity/settings.rs`, `crates/core/src/activity/collectors/mod.rs`, `crates/core/src/activity/providers/mod.rs`

**Interfaces:**
- Produces : tous les types de `mod.rs` ci-dessous ; `Settings::default()`, `settings::load(path)`, `settings::save(path, &Settings)`, `settings::default_path()`.

- [ ] **Step 1 : Ajouter les dépendances**

Dans `Cargo.toml` (racine), sous `[workspace.dependencies]` :
```toml
chrono = { version = "0.4", features = ["serde"] }
```
Dans `crates/core/Cargo.toml` :
```toml
[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
chrono = { workspace = true }
rusqlite = { version = "0.40", features = ["bundled"] }
ureq = { version = "3", features = ["json"] }
sha2 = "0.11"
base64 = "0.23"
regex = "1"

[dev-dependencies]
tempfile = "3"
```
Dans `crates/core/src/lib.rs`, ajouter `pub mod activity;`.

- [ ] **Step 2 : Écrire `activity/mod.rs`**

```rust
//! Historique d'activité (dashboard) : types partagés entre store, collecteurs,
//! digest et couche Tauri. Aucune dépendance à Tauri ici.

pub mod collectors;
pub mod digest;
pub mod providers;
pub mod settings;
pub mod shell_integration;
pub mod store;
pub mod summaries;
pub mod tickets;

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind { Commit, ClaudePrompt, ClaudeSession, ShellCmd, ClickupChange }

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
pub struct TicketRef { pub id: String, pub name: Option<String>, pub status: Option<String>, pub url: String }

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
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TicketInfo {
    pub id: String, pub name: String, pub status: String, pub status_type: String,
    pub url: String, pub due_date: Option<i64>, pub list_name: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenTask {
    pub id: String, pub name: String, pub status: String, pub url: String,
    pub due_date: Option<i64>, pub priority: Option<String>, pub list_name: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Totals { pub commits: u32, pub prompts: u32, pub commands: u32, pub tickets: u32, pub active_minutes: u32 }

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct KindCounts { pub commit: u32, pub claude_prompt: u32, pub shell_cmd: u32, pub clickup_change: u32 }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct HourCounts { pub hour: u8, #[serde(flatten)] pub counts: KindCounts }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DayCounts { pub day: String, #[serde(flatten)] pub counts: KindCounts }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct WorkspaceCount { pub dir: String, pub name: String, pub events: u32, pub commits: u32 }

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
pub struct Summary { pub text: String, pub model: String, pub generated_at: i64, pub cached: bool }

#[derive(Debug, Clone, Default, PartialEq, Serialize, Deserialize)]
pub struct CollectReport { pub git: usize, pub claude: usize, pub clickup: usize, pub errors: Vec<String> }

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
    dir.trim_end_matches('/').rsplit('/').next().filter(|s| !s.is_empty()).unwrap_or(dir).to_string()
}
```

`collectors/mod.rs` : `pub mod claude; pub mod clickup; pub mod git; pub mod shell;` — `providers/mod.rs` : `pub mod clickup; pub mod llm;`. Créer chaque fichier référencé avec seulement un commentaire `//!` pour que ça compile (les tâches suivantes les remplissent).

- [ ] **Step 3 : Test des réglages (échoue)**

`crates/core/src/activity/settings.rs`, bloc `#[cfg(test)]` :
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defauts_pointent_sur_gemma_openai_compatible() {
        let s = Settings::default();
        assert_eq!(s.llm.provider, LlmProviderKind::Openai);
        assert_eq!(s.llm.base_url, "https://llm.example.com/gemma4-31b");
        assert_eq!(s.llm.model, "google/gemma-4-31B-it");
        assert_eq!(s.llm.extra_headers.get("x-env").map(String::as_str), Some("dev"));
        assert!(s.llm.token.is_empty());
        assert_eq!(s.schedule.hour, 7);
        assert!(s.schedule.weekdays_only);
        assert!(s.shell.ignored_commands.contains(&"ls".to_string()));
    }
    #[test]
    fn save_puis_load_roundtrip_en_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut s = Settings::default();
        s.llm.token = "secret".into();
        s.clickup.token = "cu".into();
        save(&path, &s).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert_eq!(load(&path).unwrap(), s);
    }
    #[test]
    fn load_fichier_absent_rend_les_defauts() {
        assert_eq!(load(std::path::Path::new("/nonexistent/x.json")).unwrap(), Settings::default());
    }
    #[test]
    fn load_json_partiel_complete_avec_les_defauts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.json");
        std::fs::write(&path, r#"{"llm":{"token":"abc"}}"#).unwrap();
        let s = load(&path).unwrap();
        assert_eq!(s.llm.token, "abc");
        assert_eq!(s.llm.model, "google/gemma-4-31B-it");
    }
}
```

- [ ] **Step 4 : Vérifier l'échec** — `cargo test -p terminials-core activity::settings` → erreurs de compilation (types absents).

- [ ] **Step 5 : Implémenter `settings.rs`**

```rust
//! Réglages du dashboard : ~/.config/terminials/settings.json (0600, écriture atomique).
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmProviderKind { Openai, Ollama, ClaudeCli }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LlmSettings {
    pub provider: LlmProviderKind,
    pub base_url: String,
    pub model: String,
    pub token: String,
    pub extra_headers: BTreeMap<String, String>,
    pub temperature: f32,
    pub max_tokens: u32,
    pub token_command: Option<String>,
}
impl Default for LlmSettings {
    fn default() -> Self {
        let mut extra_headers = BTreeMap::new();
        extra_headers.insert("x-env".to_string(), "dev".to_string());
        Self {
            provider: LlmProviderKind::Openai,
            base_url: "https://llm.example.com/gemma4-31b".into(),
            model: "google/gemma-4-31B-it".into(),
            token: String::new(),
            extra_headers,
            temperature: 0.3,
            max_tokens: 1500,
            token_command: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClickupSettings { pub token: String }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScheduleSettings { pub hour: u8, pub minute: u8, pub weekdays_only: bool }
impl Default for ScheduleSettings { fn default() -> Self { Self { hour: 7, minute: 0, weekdays_only: true } } }

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ShellSettings { pub integration: bool, pub ignored_commands: Vec<String> }
impl Default for ShellSettings {
    fn default() -> Self {
        Self { integration: true, ignored_commands: ["ls", "ll", "la", "cd", "pwd", "clear", "exit"].iter().map(|s| s.to_string()).collect() }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GitSettings { pub author_email: Option<String> }

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub llm: LlmSettings,
    pub clickup: ClickupSettings,
    pub schedule: ScheduleSettings,
    pub shell: ShellSettings,
    pub git: GitSettings,
    pub ticket_patterns: Vec<String>,
}

/// `$XDG_CONFIG_HOME/terminials/settings.json`, défaut `~/.config/terminials/settings.json`.
pub fn default_path() -> PathBuf {
    let base = std::env::var("XDG_CONFIG_HOME").ok().filter(|s| !s.is_empty()).map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())).join(".config"));
    base.join("terminials").join("settings.json")
}

/// Fichier absent → défauts. JSON partiel → complété par les défauts (serde `default`).
pub fn load(path: &Path) -> std::io::Result<Settings> {
    match std::fs::read_to_string(path) {
        Ok(raw) => serde_json::from_str(&raw).map_err(|e| std::io::Error::other(format!("settings.json invalide : {e}"))),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(e),
    }
}

/// Écriture atomique (tmp + rename) en 0600 : le fichier contient des jetons.
pub fn save(path: &Path, settings: &Settings) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    if let Some(parent) = path.parent() { std::fs::create_dir_all(parent)?; }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
    {
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp)?;
        use std::io::Write;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::set_permissions(&tmp, std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    std::fs::rename(&tmp, path)
}
```

- [ ] **Step 6 : Vérifier** — `cargo test -p terminials-core activity::settings` → 4 tests PASS ; `cargo build -p terminials-core` sans warning.

- [ ] **Step 7 : Commit** — `git add Cargo.toml Cargo.lock crates/core && git commit -m "feat(core): squelette du module activity, types partagés et réglages 0600"`

---

### Task 2 : Extraction des identifiants de tickets

**Files:**
- Create: `crates/core/src/activity/tickets.rs`

**Interfaces:**
- Produces : `pub fn extract_ticket_ids(texts: &[&str], custom_patterns: &[String]) -> Vec<String>` (dédupliqués, ordre d'apparition, ids ClickUp en minuscules, ids custom tels quels) ; `pub fn ticket_url(id: &str) -> String`.

- [ ] **Step 1 : Tests (échouent)**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cu_prefixe_dans_une_branche() {
        assert_eq!(extract_ticket_ids(&["feature/CU-86c1abc_dashboard"], &[]), vec!["86c1abc"]);
    }
    #[test]
    fn diese_avec_lettres_et_chiffres() {
        assert_eq!(extract_ticket_ids(&["fix: relance #86c1abcd"], &[]), vec!["86c1abcd"]);
        assert!(extract_ticket_ids(&["voir #1234567"], &[]).is_empty(), "chiffres seuls = numéro d'issue, pas ClickUp");
    }
    #[test]
    fn url_clickup_avec_ou_sans_team() {
        assert_eq!(extract_ticket_ids(&["https://app.clickup.com/t/86c1abc"], &[]), vec!["86c1abc"]);
        assert_eq!(extract_ticket_ids(&["https://app.clickup.com/t/9012/ABC-42"], &[]), vec!["ABC-42"]);
    }
    #[test]
    fn motif_custom_et_dedup() {
        let custom = vec![r"\bABC-\d+\b".to_string()];
        assert_eq!(extract_ticket_ids(&["ABC-1234 puis ABC-1234", "CU-86c1abc"], &custom), vec!["ABC-1234", "86c1abc"]);
    }
    #[test]
    fn aucun_faux_positif_sur_un_sha() {
        assert!(extract_ticket_ids(&["Revert 3be757f4 (see 0c71fca)"], &[]).is_empty());
    }
    #[test]
    fn motif_custom_invalide_ignore() {
        assert_eq!(extract_ticket_ids(&["CU-abc1234"], &["(".to_string()]), vec!["abc1234"]);
    }
    #[test]
    fn url_construite() {
        assert_eq!(ticket_url("86c1abc"), "https://app.clickup.com/t/86c1abc");
    }
}
```

- [ ] **Step 2 : Échec** — `cargo test -p terminials-core activity::tickets` → compilation KO.

- [ ] **Step 3 : Implémentation**

```rust
//! Repérage des identifiants de tickets ClickUp dans branches, sujets et corps (spec §3).
use regex::Regex;
use std::sync::OnceLock;

fn defaults() -> &'static [Regex] {
    static RE: OnceLock<Vec<Regex>> = OnceLock::new();
    RE.get_or_init(|| vec![
        Regex::new(r"(?i)\bCU-([a-z0-9]{6,12})\b").unwrap(),
        Regex::new(r"app\.clickup\.com/t/(?:\d+/)?([A-Za-z0-9-]+)").unwrap(),
        Regex::new(r"#([a-z0-9]{7,9})\b").unwrap(),
    ])
}

fn is_clickup_like(id: &str) -> bool {
    id.chars().any(|c| c.is_ascii_digit()) && id.chars().any(|c| c.is_ascii_alphabetic())
}

pub fn extract_ticket_ids(texts: &[&str], custom_patterns: &[String]) -> Vec<String> {
    let custom: Vec<Regex> = custom_patterns.iter().filter_map(|p| Regex::new(p).ok()).collect();
    let mut out: Vec<String> = Vec::new();
    let mut push = |id: String| { if !out.contains(&id) { out.push(id); } };
    for text in texts {
        for re in &custom {
            for m in re.find_iter(text) { push(m.as_str().to_string()); }
        }
        let [cu, url, hash] = [&defaults()[0], &defaults()[1], &defaults()[2]];
        for c in cu.captures_iter(text) { push(c[1].to_ascii_lowercase()); }
        for c in url.captures_iter(text) {
            let id = &c[1];
            // ID custom (ABC-42) conservé tel quel ; ID ClickUp natif en minuscules.
            push(if id.contains('-') { id.to_string() } else { id.to_ascii_lowercase() });
        }
        for c in hash.captures_iter(text) { if is_clickup_like(&c[1]) { push(c[1].to_ascii_lowercase()); } }
    }
    out
}

pub fn ticket_url(id: &str) -> String { format!("https://app.clickup.com/t/{id}") }
```

Note : le motif `#…` exige au moins une lettre **et** un chiffre ; le test `#1234567` reste vide, le test `#86c1abcd` passe. Le sha `3be757f4` n'est précédé ni de `CU-` ni de `#`.

- [ ] **Step 4 : Vérifier** — 7 tests PASS.
- [ ] **Step 5 : Commit** — `git commit -am "feat(core): extraction des identifiants de tickets ClickUp"`

---

### Task 3 : Store SQLite

**Files:**
- Create: `crates/core/src/activity/store.rs`

**Interfaces:**
- Consumes : types de `mod.rs`, `tickets::ticket_url`.
- Produces :
```rust
pub struct Store { conn: rusqlite::Connection }
pub type StoreResult<T> = Result<T, rusqlite::Error>;
impl Store {
    pub fn open(path: &Path) -> StoreResult<Store>;            // crée dossier parent, WAL, migre
    pub fn open_in_memory() -> StoreResult<Store>;
    pub fn insert_events(&self, events: &[NewEvent]) -> StoreResult<usize>;   // INSERT OR IGNORE, retourne nb insérés
    pub fn upsert_event(&self, e: &NewEvent) -> StoreResult<()>;             // remplace title/body/ts sur (kind, source_ref)
    pub fn query(&self, from: i64, to: i64, workspace_dir: Option<&str>) -> StoreResult<Vec<ActivityEvent>>; // [from, to), ordre ts, tickets joints
    pub fn stats(&self, from: i64, to: i64, offset: chrono::FixedOffset) -> StoreResult<ActivityStats>;
    pub fn register_repos(&self, dirs: &[String], now: i64) -> StoreResult<()>;
    pub fn active_repos(&self) -> StoreResult<Vec<String>>;
    pub fn deactivate_repo(&self, dir: &str) -> StoreResult<()>;
    pub fn get_cursor(&self, name: &str) -> StoreResult<Option<String>>;
    pub fn set_cursor(&self, name: &str, value: &str) -> StoreResult<()>;
    pub fn get_summary(&self, day: &str, kind: &str) -> StoreResult<Option<StoredSummary>>;
    pub fn put_summary(&self, s: &StoredSummary) -> StoreResult<()>;
    pub fn upsert_tickets(&self, tickets: &[TicketInfo], fetched_at: i64) -> StoreResult<()>;
    pub fn tickets_by_ids(&self, ids: &[String]) -> StoreResult<Vec<TicketInfo>>;
    pub fn stale_ticket_ids(&self, from: i64, to: i64, older_than: i64, limit: usize) -> StoreResult<Vec<String>>;
    pub fn replace_open_tasks(&self, tasks: &[OpenTask], fetched_at: i64) -> StoreResult<()>;
    pub fn open_tasks(&self) -> StoreResult<Vec<OpenTask>>;
    pub fn ticket_ids_in_range(&self, from: i64, to: i64) -> StoreResult<Vec<String>>;
}
#[derive(Debug, Clone, PartialEq)]
pub struct StoredSummary { pub day: String, pub kind: String, pub model: String, pub digest_hash: String, pub text: String, pub generated_at: i64 }
```

- [ ] **Step 1 : Tests (échouent)**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::{EventKind, NewEvent};
    use chrono::FixedOffset;

    fn ev(ts: i64, kind: EventKind, dir: &str, title: &str, sref: &str) -> NewEvent {
        NewEvent { ts, kind, workspace_dir: Some(dir.into()), branch: Some("master".into()), title: title.into(),
                   body: None, ticket_ids: vec![], source_ref: sref.into() }
    }
    const T0: i64 = 1_758_067_200; // 2025-09-17 00:00:00 UTC (peu importe : les tests utilisent offset 0)

    #[test]
    fn insert_est_idempotent_par_kind_et_source_ref() {
        let s = Store::open_in_memory().unwrap();
        let e = ev(T0 + 3600, EventKind::Commit, "/r", "c1", "sha1");
        assert_eq!(s.insert_events(&[e.clone(), e.clone()]).unwrap(), 1);
        assert_eq!(s.insert_events(&[e]).unwrap(), 0);
        assert_eq!(s.query(T0, T0 + 86400, None).unwrap().len(), 1);
    }
    #[test]
    fn query_borne_haute_exclusive_et_filtre_workspace() {
        let s = Store::open_in_memory().unwrap();
        s.insert_events(&[
            ev(T0, EventKind::Commit, "/a", "a", "1"),
            ev(T0 + 86400, EventKind::Commit, "/a", "b", "2"),
            ev(T0 + 10, EventKind::ShellCmd, "/b", "ls", "3"),
        ]).unwrap();
        assert_eq!(s.query(T0, T0 + 86400, None).unwrap().len(), 2);
        assert_eq!(s.query(T0, T0 + 86400, Some("/b")).unwrap()[0].title, "ls");
    }
    #[test]
    fn query_joint_les_tickets_connus_et_construit_l_url_sinon() {
        let s = Store::open_in_memory().unwrap();
        let mut e = ev(T0, EventKind::Commit, "/a", "fix", "1");
        e.ticket_ids = vec!["abc1234".into(), "zzz9999".into()];
        s.insert_events(&[e]).unwrap();
        s.upsert_tickets(&[TicketInfo { id: "abc1234".into(), name: "Dashboard".into(), status: "en cours".into(),
            status_type: "custom".into(), url: "https://app.clickup.com/t/abc1234".into(), due_date: None, list_name: None }], T0).unwrap();
        let got = s.query(T0, T0 + 1, None).unwrap();
        assert_eq!(got[0].tickets[0].name.as_deref(), Some("Dashboard"));
        assert_eq!(got[0].tickets[1].url, "https://app.clickup.com/t/zzz9999");
        assert!(got[0].tickets[1].name.is_none());
    }
    #[test]
    fn stats_par_heure_workspace_et_minutes_actives() {
        let s = Store::open_in_memory().unwrap();
        s.insert_events(&[
            ev(T0 + 9 * 3600, EventKind::Commit, "/home/t/dev/a", "c", "1"),
            ev(T0 + 9 * 3600 + 60, EventKind::ShellCmd, "/home/t/dev/a", "npm test", "2"),
            ev(T0 + 14 * 3600, EventKind::ClaudePrompt, "/home/t/dev/b", "p", "3"),
            ev(T0 + 14 * 3600 + 20 * 60, EventKind::ClaudePrompt, "/home/t/dev/b", "p2", "4"),
        ]).unwrap();
        let st = s.stats(T0, T0 + 86400, FixedOffset::east_opt(0).unwrap()).unwrap();
        assert_eq!(st.by_hour.len(), 24);
        assert_eq!(st.by_hour[9].counts.commit, 1);
        assert_eq!(st.by_hour[9].counts.shell_cmd, 1);
        assert_eq!(st.by_hour[14].counts.claude_prompt, 2);
        assert_eq!(st.totals.commits, 1);
        assert_eq!(st.totals.prompts, 2);
        assert_eq!(st.totals.commands, 1);
        // tranches de 15 min occupées : 09:00, 14:00, 14:15 → 45 min
        assert_eq!(st.totals.active_minutes, 45);
        assert_eq!(st.by_day.len(), 1);
        assert_eq!(st.by_workspace[0].name, "a");
        assert_eq!(st.by_workspace[0].commits, 1);
        assert_eq!(st.by_workspace[1].events, 2);
    }
    #[test]
    fn stats_decale_l_heure_selon_l_offset() {
        let s = Store::open_in_memory().unwrap();
        s.insert_events(&[ev(T0 + 9 * 3600, EventKind::Commit, "/a", "c", "1")]).unwrap();
        let st = s.stats(T0, T0 + 86400, FixedOffset::east_opt(7200).unwrap()).unwrap();
        assert_eq!(st.by_hour[11].counts.commit, 1);
    }
    #[test]
    fn repos_cursors_summaries_open_tasks() {
        let s = Store::open_in_memory().unwrap();
        s.register_repos(&["/a".into(), "/b".into()], 1).unwrap();
        s.deactivate_repo("/b").unwrap();
        assert_eq!(s.active_repos().unwrap(), vec!["/a".to_string()]);
        assert_eq!(s.get_cursor("git").unwrap(), None);
        s.set_cursor("git", "42").unwrap();
        s.set_cursor("git", "43").unwrap();
        assert_eq!(s.get_cursor("git").unwrap().as_deref(), Some("43"));
        let sum = StoredSummary { day: "2026-09-16".into(), kind: "bilan".into(), model: "m".into(), digest_hash: "h".into(), text: "t".into(), generated_at: 5 };
        s.put_summary(&sum).unwrap();
        assert_eq!(s.get_summary("2026-09-16", "bilan").unwrap(), Some(sum));
        let task = OpenTask { id: "x".into(), name: "n".into(), status: "à faire".into(), url: "u".into(), due_date: Some(9), priority: None, list_name: None };
        s.replace_open_tasks(&[task.clone()], 1).unwrap();
        s.replace_open_tasks(&[task.clone()], 2).unwrap();
        assert_eq!(s.open_tasks().unwrap(), vec![task]);
    }
    #[test]
    fn stale_ticket_ids_cites_dans_la_plage() {
        let s = Store::open_in_memory().unwrap();
        let mut e = ev(T0, EventKind::Commit, "/a", "fix", "1");
        e.ticket_ids = vec!["abc1234".into(), "old1234".into(), "fresh12".into()];
        s.insert_events(&[e]).unwrap();
        let mk = |id: &str| TicketInfo { id: id.into(), name: "".into(), status: "".into(), status_type: "".into(), url: "".into(), due_date: None, list_name: None };
        s.upsert_tickets(&[mk("old1234")], T0 - 100_000).unwrap();
        s.upsert_tickets(&[mk("fresh12")], T0).unwrap();
        let mut stale = s.stale_ticket_ids(T0, T0 + 1, T0 - 86400, 10).unwrap();
        stale.sort();
        assert_eq!(stale, vec!["abc1234", "old1234"]);
    }
    #[test]
    fn upsert_event_remplace_le_contenu() {
        let s = Store::open_in_memory().unwrap();
        let mut e = ev(T0, EventKind::ClaudeSession, "/a", "1 prompt", "file.jsonl");
        s.upsert_event(&e).unwrap();
        e.title = "3 prompts".into();
        s.upsert_event(&e).unwrap();
        let got = s.query(T0, T0 + 1, None).unwrap();
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].title, "3 prompts");
    }
}
```

- [ ] **Step 2 : Échec** — compilation KO.

- [ ] **Step 3 : Implémentation**

Schéma exact de la spec §3, appliqué si `PRAGMA user_version = 0` puis `user_version = 1`. Points d'implémentation :

```rust
pub fn open(path: &Path) -> StoreResult<Store> {
    if let Some(p) = path.parent() { let _ = std::fs::create_dir_all(p); }
    let conn = Connection::open(path)?;
    conn.pragma_update(None, "journal_mode", "WAL")?;
    let s = Store { conn };
    s.migrate()?;
    Ok(s)
}
fn migrate(&self) -> StoreResult<()> {
    let v: i64 = self.conn.query_row("PRAGMA user_version", [], |r| r.get(0))?;
    if v < 1 {
        self.conn.execute_batch(SCHEMA_V1)?;   // constante avec le SQL de la spec §3 + `PRAGMA user_version = 1;`
    }
    Ok(())
}
```

`insert_events` : transaction, `INSERT OR IGNORE INTO events (ts, kind, workspace_dir, branch, title, body, ticket_ids, source_ref) VALUES (?1..?8)`, `ticket_ids` = `join(",")`, compter `changes()`.

`upsert_event` : `INSERT INTO events (...) VALUES (...) ON CONFLICT(kind, source_ref) DO UPDATE SET ts=excluded.ts, title=excluded.title, body=excluded.body, branch=excluded.branch, ticket_ids=excluded.ticket_ids`.

`query` : `SELECT id, ts, kind, workspace_dir, branch, title, body, ticket_ids FROM events WHERE ts >= ?1 AND ts < ?2 [AND workspace_dir = ?3] ORDER BY ts, id`. Puis collecter tous les ids de tickets, `tickets_by_ids`, et construire `tickets: Vec<TicketRef>` dans l'ordre de `ticket_ids` (`url` = info.url si connue sinon `ticket_url(id)`).

`stats` : `query(from, to, None)` puis agrégation en Rust :
```rust
let mut by_hour: Vec<HourCounts> = (0..24).map(|h| HourCounts { hour: h, counts: KindCounts::default() }).collect();
let mut by_day: BTreeMap<String, KindCounts> = BTreeMap::new();
let mut by_ws: BTreeMap<String, (u32, u32)> = BTreeMap::new();
let mut slots: BTreeSet<i64> = BTreeSet::new();   // ts / 900
let mut tickets: BTreeSet<String> = BTreeSet::new();
for e in &events {
    let local = chrono::DateTime::from_timestamp(e.ts, 0).unwrap().with_timezone(&offset);
    let day = local.format("%Y-%m-%d").to_string();
    let bump = |c: &mut KindCounts| match e.kind { Commit => c.commit += 1, ClaudePrompt => c.claude_prompt += 1, ShellCmd => c.shell_cmd += 1, ClickupChange => c.clickup_change += 1, ClaudeSession => {} };
    bump(&mut by_hour[local.hour() as usize].counts);
    bump(by_day.entry(day).or_default());
    if e.kind != EventKind::ClaudeSession {
        slots.insert(e.ts.div_euclid(900));
        if let Some(d) = &e.workspace_dir { let w = by_ws.entry(d.clone()).or_default(); w.0 += 1; if e.kind == EventKind::Commit { w.1 += 1; } }
    }
    tickets.extend(e.ticket_ids.iter().cloned());
}
```
Totaux : `commits`, `prompts` (claude_prompt), `commands` (shell_cmd), `tickets = tickets.len()`, `active_minutes = slots.len() * 15`. `by_workspace` trié par `events` décroissant puis `dir` ; `name = workspace_name(dir)`. Attention : `bump` capture `e.kind` — écrire une fonction `fn bump(c: &mut KindCounts, kind: EventKind)` plutôt qu'une closure pour éviter l'emprunt double.

`stale_ticket_ids` : ids de `ticket_ids_in_range(from, to)` (split des colonnes `ticket_ids` non vides) filtrés par `SELECT fetched_at FROM tickets WHERE id = ?` absent ou `< older_than`, tronqué à `limit`.

`replace_open_tasks` : transaction `DELETE FROM open_tasks` puis inserts. `open_tasks` : `ORDER BY due_date IS NULL, due_date, name`.

- [ ] **Step 4 : Vérifier** — `cargo test -p terminials-core activity::store` → 8 PASS.
- [ ] **Step 5 : Commit** — `git commit -am "feat(core): store SQLite du dashboard (événements, stats, tickets, résumés)"`

---

### Task 4 : OSC 133, shims shell et appariement des commandes

**Files:**
- Modify: `crates/core/src/osc.rs` (lire le fichier entier d'abord : `OscScanner`, `interpret`, `parse_notifications`)
- Create: `crates/core/src/activity/shell_integration.rs`, `crates/core/src/activity/collectors/shell.rs`

**Interfaces:**
- Produces (osc.rs) :
```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OscEvent { Notification(OscNotification), Command { cmd: String, pwd: String }, Exit { code: i32 } }
impl OscScanner { pub fn feed_events(&mut self, chunk: &[u8]) -> Vec<OscEvent>; }
// `feed` existant conservé : `feed_events(...).into_iter().filter_map(Notification)`.
```
- Produces (shell_integration.rs) :
```rust
pub struct ShellLaunch { pub program: String, pub args: Vec<String>, pub env: Vec<(String, String)> }
/// Écrit les shims dans `dir` (créé si besoin). Retourne Err si non inscriptible.
pub fn install_shims(dir: &Path) -> std::io::Result<()>;
/// Commande à lancer pour `shell` avec intégration ; `None` si shell non pris en charge (→ commande inchangée).
pub fn launch_for(shell: &str, shims_dir: &Path) -> Option<ShellLaunch>;
pub fn default_shims_dir() -> PathBuf;   // $XDG_RUNTIME_DIR/terminials/shell ou <tmp>/terminials-<uid>/shell
```
- Produces (collectors/shell.rs) :
```rust
pub struct ShellPairer { pending: HashMap<u32, Pending> }
impl ShellPairer {
    pub fn new() -> Self;
    pub fn on_command(&mut self, pty: u32, cmd: &str, pwd: &str, now_ms: i64);
    /// D reçu : apparie avec le C en attente du même pty. `None` si D orphelin ou commande ignorée.
    pub fn on_exit(&mut self, pty: u32, code: i32, now_ms: i64, ignored: &[String]) -> Option<NewEvent>;
    pub fn forget(&mut self, pty: u32);
}
```
L'événement produit : `kind = ShellCmd`, `ts = started_ms / 1000`, `workspace_dir = Some(pwd)` (la couche Tauri le normalise via `repo_root`), `branch = None`, `title = cmd`, `body = {"exit": code, "durationMs": d}`, `ticket_ids = []`, `source_ref = "<pty>:<started_ms>"`.

- [ ] **Step 1 : Tests osc (échouent)** — ajouter au bloc tests de `osc.rs` :

```rust
#[test]
fn feed_events_decode_commande_et_sortie_base64() {
    // "npm test" / "/home/t" en base64 standard
    let seq = b"\x1b]133;C;bnBtIHRlc3Q=;L2hvbWUvdA==\x07sortie\x1b]133;D;0\x07";
    let mut sc = OscScanner::new();
    let ev = sc.feed_events(seq);
    assert_eq!(ev, vec![
        OscEvent::Command { cmd: "npm test".into(), pwd: "/home/t".into() },
        OscEvent::Exit { code: 0 },
    ]);
}
#[test]
fn feed_events_sequence_133_fragmentee_et_notification_conservee() {
    let full = b"\x1b]133;D;130\x07\x1b]9;Claude Code;fini\x07";
    let mut sc = OscScanner::new();
    let mut ev = sc.feed_events(&full[..5]);
    ev.extend(sc.feed_events(&full[5..]));
    assert_eq!(ev.len(), 2);
    assert_eq!(ev[0], OscEvent::Exit { code: 130 });
    assert!(matches!(&ev[1], OscEvent::Notification(n) if n.body == "fini"));
    let mut sc2 = OscScanner::new();
    assert_eq!(sc2.feed(full).len(), 1, "feed reste l'API des notifications seules");
}
#[test]
fn feed_events_ignore_133_mal_forme() {
    let mut sc = OscScanner::new();
    assert!(sc.feed_events(b"\x1b]133;C;%%%pas-du-base64\x07\x1b]133;D;abc\x07\x1b]133;A\x07").is_empty());
}
```

- [ ] **Step 2 : Implémenter dans osc.rs** — factoriser l'interprétation d'un payload en `fn interpret_event(payload: &str) -> Option<OscEvent>` : si le payload commence par `133;` → parser `C;<b64cmd>;<b64pwd>` (décodage `base64::prelude::BASE64_STANDARD.decode`, UTF-8 lossy ; pwd optionnel = "") et `D;<code>` (`i32` parse) ; sinon déléguer à l'`interpret` existant et emballer en `Notification`. `feed_events` reprend la machine à états de `feed` et appelle `interpret_event`. `feed` devient un filtre sur `feed_events`. Vérifier : `cargo test -p terminials-core osc` → tous PASS (anciens inclus).

- [ ] **Step 3 : Tests shell_integration (échouent)**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn install_ecrit_les_shims_bash_et_zsh() {
        let d = tempfile::tempdir().unwrap();
        install_shims(d.path()).unwrap();
        let bash = std::fs::read_to_string(d.path().join("bash-init.sh")).unwrap();
        assert!(bash.contains("133;C;"));
        assert!(bash.contains("133;D;"));
        assert!(bash.contains(".bashrc"));
        assert!(d.path().join("zsh/.zshrc").exists());
        assert!(d.path().join("zsh/.zshenv").exists());
    }
    #[test]
    fn launch_bash_utilise_init_file_et_zsh_zdotdir() {
        let d = std::path::Path::new("/run/x");
        let b = launch_for("/bin/bash", d).unwrap();
        assert_eq!(b.program, "/bin/bash");
        assert_eq!(b.args, vec!["--init-file", "/run/x/bash-init.sh"]);
        let z = launch_for("/usr/bin/zsh", d).unwrap();
        assert!(z.args.is_empty());
        assert_eq!(z.env, vec![("ZDOTDIR".to_string(), "/run/x/zsh".to_string())]);
        assert!(launch_for("/usr/bin/fish", d).is_none());
        assert!(launch_for("/bin/sh", d).is_none());
    }
    /// Bout en bout : bash interactif (-i) sur des pipes ; l'avertissement « no job control » est ignoré.
    #[test]
    fn shim_bash_emet_c_puis_d_pour_une_commande() {
        let d = tempfile::tempdir().unwrap();
        install_shims(d.path()).unwrap();
        let mut child = std::process::Command::new("bash")
            .args(["--noprofile", "--init-file", d.path().join("bash-init.sh").to_str().unwrap(), "-i"])
            .env("HOME", d.path()) // pas de ~/.bashrc utilisateur : shim seul
            .env("PS1", "$ ")
            .stdin(std::process::Stdio::piped()).stdout(std::process::Stdio::piped()).stderr(std::process::Stdio::piped())
            .spawn().unwrap();
        { use std::io::Write; child.stdin.take().unwrap().write_all(b"echo hello\nexit 3\n").unwrap(); }
        let output = child.wait_with_output().unwrap();
        let all = [output.stdout.as_slice(), output.stderr.as_slice()].concat();
        let mut sc = crate::osc::OscScanner::new();
        let events = sc.feed_events(&all);
        let cmd = events.iter().find_map(|e| match e { crate::osc::OscEvent::Command { cmd, .. } => Some(cmd.clone()), _ => None });
        assert_eq!(cmd.as_deref(), Some("echo hello"), "événements: {events:?}\nsortie: {}", String::from_utf8_lossy(&all));
        assert!(events.contains(&crate::osc::OscEvent::Exit { code: 0 }));
    }
}
```

- [ ] **Step 4 : Implémenter shell_integration.rs**

```rust
//! Intégration shell : shims bash/zsh qui émettent OSC 133 C (pré-exécution) et D (fin).
//! Charges en base64 pour ne jamais casser le parseur OSC (spec §4).
//! Limite v1 : le trap DEBUG capture la PREMIÈRE commande simple de la ligne
//! (`cd x && npm test` → `cd x`).
use std::path::{Path, PathBuf};

pub const BASH_SHIM: &str = r#"# terminials : intégration shell (bash). Source le rc utilisateur puis pose les hooks.
[ -f "$HOME/.bashrc" ] && . "$HOME/.bashrc"
__tm_b64() { printf '%s' "$1" | base64 | tr -d '\n'; }
__tm_preexec() {
  [ -n "$COMP_LINE" ] && return
  [ -n "$__tm_armed" ] || return
  case "$BASH_COMMAND" in __tm_*) return;; esac
  __tm_armed=
  printf '\033]133;C;%s;%s\007' "$(__tm_b64 "$BASH_COMMAND")" "$(__tm_b64 "$PWD")"
}
# Début de PROMPT_COMMAND : capture $? AVANT les hooks utilisateur. Fin : réarme.
__tm_precmd_start() { local code=$?; [ -z "$__tm_armed" ] && printf '\033]133;D;%s\007' "$code"; }
__tm_precmd_end() { __tm_armed=1; }
trap '__tm_preexec' DEBUG
PROMPT_COMMAND="__tm_precmd_start${PROMPT_COMMAND:+;$PROMPT_COMMAND};__tm_precmd_end"
"#;

pub const ZSHENV_SHIM: &str = r#"# terminials : rétablit ZDOTDIR utilisateur puis source son .zshenv
ZDOTDIR="$HOME"
[ -f "$HOME/.zshenv" ] && . "$HOME/.zshenv"
"#;

pub const ZSHRC_SHIM: &str = r#"# terminials : intégration shell (zsh)
[ -f "$HOME/.zshrc" ] && . "$HOME/.zshrc"
__tm_b64() { printf '%s' "$1" | base64 | tr -d '\n' }
__tm_preexec() { printf '\033]133;C;%s;%s\007' "$(__tm_b64 "$1")" "$(__tm_b64 "$PWD")"; __tm_ran=1 }
__tm_precmd() { local code=$?; [ -n "$__tm_ran" ] && printf '\033]133;D;%s\007' "$code"; __tm_ran= }
autoload -Uz add-zsh-hook
add-zsh-hook preexec __tm_preexec
add-zsh-hook precmd __tm_precmd
"#;

pub struct ShellLaunch { pub program: String, pub args: Vec<String>, pub env: Vec<(String, String)> }

pub fn default_shims_dir() -> PathBuf {
    match std::env::var("XDG_RUNTIME_DIR") {
        Ok(d) if !d.is_empty() => PathBuf::from(d).join("terminials").join("shell"),
        _ => std::env::temp_dir().join(format!("terminials-{}", std::env::var("UID").unwrap_or_else(|_| "u".into()))).join("shell"),
    }
}

pub fn install_shims(dir: &Path) -> std::io::Result<()> {
    std::fs::create_dir_all(dir.join("zsh"))?;
    std::fs::write(dir.join("bash-init.sh"), BASH_SHIM)?;
    std::fs::write(dir.join("zsh").join(".zshenv"), ZSHENV_SHIM)?;
    std::fs::write(dir.join("zsh").join(".zshrc"), ZSHRC_SHIM)?;
    Ok(())
}

pub fn launch_for(shell: &str, shims_dir: &Path) -> Option<ShellLaunch> {
    let name = shell.rsplit('/').next().unwrap_or(shell);
    match name {
        "bash" => Some(ShellLaunch { program: shell.into(), args: vec!["--init-file".into(), shims_dir.join("bash-init.sh").to_string_lossy().into_owned()], env: vec![] }),
        "zsh" => Some(ShellLaunch { program: shell.into(), args: vec![], env: vec![("ZDOTDIR".into(), shims_dir.join("zsh").to_string_lossy().into_owned())] }),
        _ => None,
    }
}
```

- [ ] **Step 5 : Tests ShellPairer (échouent)**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn apparie_c_puis_d_et_calcule_la_duree() {
        let mut p = ShellPairer::new();
        p.on_command(3, "npm test", "/home/t/dev/a", 1_000_000);
        let e = p.on_exit(3, 1, 1_004_500, &[]).unwrap();
        assert_eq!(e.title, "npm test");
        assert_eq!(e.ts, 1000);
        assert_eq!(e.workspace_dir.as_deref(), Some("/home/t/dev/a"));
        assert_eq!(e.source_ref, "3:1000000");
        assert_eq!(e.body.as_deref(), Some(r#"{"durationMs":4500,"exit":1}"#));
        assert!(p.on_exit(3, 0, 1_005_000, &[]).is_none(), "D orphelin ignoré");
    }
    #[test]
    fn commande_ignoree_par_premier_mot_et_par_pty() {
        let mut p = ShellPairer::new();
        p.on_command(1, "ls -la", "/x", 10);
        p.on_command(2, "git status", "/x", 10);
        assert!(p.on_exit(1, 0, 20, &["ls".into()]).is_none());
        assert_eq!(p.on_exit(2, 0, 20, &["ls".into()]).unwrap().title, "git status");
    }
    #[test]
    fn commande_vide_ou_espaces_ignoree() {
        let mut p = ShellPairer::new();
        p.on_command(1, "   ", "/x", 10);
        assert!(p.on_exit(1, 0, 20, &[]).is_none());
    }
}
```
(`serde_json::json!` sérialise les clés triées : `durationMs` avant `exit`.)

- [ ] **Step 6 : Implémenter collectors/shell.rs** — HashMap `pty → Pending { cmd, pwd, started_ms }` ; `on_command` remplace un C non apparié ; `on_exit` retire l'entrée, retourne `None` si `cmd.trim()` vide ou si `cmd.split_whitespace().next()` ∈ `ignored` ; body via `serde_json::json!({"exit": code, "durationMs": now_ms - started_ms}).to_string()`.

- [ ] **Step 7 : Vérifier** — `cargo test -p terminials-core osc activity::shell_integration activity::collectors::shell` → PASS. Si le test bout-en-bout bash échoue à cause de l'environnement, le signaler dans le rapport sans le supprimer.
- [ ] **Step 8 : Commit** — `feat(core): OSC 133, shims bash/zsh et appariement des commandes shell`

---

### Task 5 : Collecteur Claude Code

**Files:**
- Create: `crates/core/src/activity/collectors/claude.rs`

**Interfaces:**
- Consumes : `Store::{get_cursor,set_cursor,insert_events,upsert_event,register_repos}`, `repo_root`, `tickets::extract_ticket_ids`.
- Produces :
```rust
/// Scanne `projects_dir` (défaut ~/.claude/projects). Retourne le nombre de prompts insérés.
pub fn collect(store: &Store, projects_dir: &Path, ticket_patterns: &[String], now: i64) -> Result<usize, String>;
pub fn default_projects_dir() -> PathBuf;   // $HOME/.claude/projects
/// Pur : parse un transcript. Exposé pour les tests.
pub fn parse_transcript(path_label: &str, content: &str, ticket_patterns: &[String]) -> Parsed;
pub struct Parsed { pub prompts: Vec<NewEvent>, pub session: Option<NewEvent> }
```

- [ ] **Step 1 : Tests (échouent)**

```rust
#[cfg(test)]
mod tests {
    use super::*;
    const FIXTURE: &str = r#"{"type":"last-prompt","leafUuid":"x","sessionId":"s1"}
{"type":"user","uuid":"u1","timestamp":"2026-09-16T09:12:57.374Z","cwd":"/home/t/dev/a","gitBranch":"feature/CU-86c1abc","message":{"role":"user","content":"<local-command-caveat>bla</local-command-caveat>"}}
{"type":"user","uuid":"u2","timestamp":"2026-09-16T09:14:30.111Z","cwd":"/home/t/dev/a","gitBranch":"feature/CU-86c1abc","message":{"role":"user","content":"Ajoute un dashboard\navec des graphiques"}}
{"type":"user","uuid":"u3","timestamp":"2026-09-16T09:14:36.309Z","cwd":"/home/t/dev/a","gitBranch":"feature/CU-86c1abc","message":{"role":"user","content":[{"type":"tool_result","tool_use_id":"t","content":"ok"}]}}
{"type":"assistant","uuid":"a1","timestamp":"2026-09-16T09:15:00.000Z","message":{"role":"assistant","content":[{"type":"text","text":"ok"}]}}
{"type":"user","uuid":"u4","timestamp":"2026-09-16T10:44:00.000Z","cwd":"/home/t/dev/a","gitBranch":"feature/CU-86c1abc","message":{"role":"user","content":"Corrige le test #86c1abd"}}
ligne invalide
"#;
    #[test]
    fn ne_garde_que_les_prompts_humains() {
        let p = parse_transcript("/p/s1.jsonl", FIXTURE, &[]);
        assert_eq!(p.prompts.len(), 2);
        assert_eq!(p.prompts[0].title, "Ajoute un dashboard avec des graphiques");
        let expected = chrono::DateTime::parse_from_rfc3339("2026-09-16T09:14:30.111Z").unwrap().timestamp();
        assert_eq!(p.prompts[0].ts, expected);
        assert_eq!(p.prompts[0].source_ref, "u2");
        assert_eq!(p.prompts[0].branch.as_deref(), Some("feature/CU-86c1abc"));
        assert_eq!(p.prompts[0].ticket_ids, vec!["86c1abc"]);
        assert_eq!(p.prompts[1].ticket_ids, vec!["86c1abc", "86c1abd"]);
    }
    #[test]
    fn session_porte_duree_et_nombre_de_prompts() {
        let p = parse_transcript("/p/s1.jsonl", FIXTURE, &[]);
        let s = p.session.unwrap();
        assert_eq!(s.kind, crate::activity::EventKind::ClaudeSession);
        assert_eq!(s.source_ref, "/p/s1.jsonl");
        assert_eq!(s.title, "Session Claude Code · 2 prompts · 1 h 31 min");
        let body: serde_json::Value = serde_json::from_str(s.body.as_deref().unwrap()).unwrap();
        assert_eq!(body["prompts"], 2);
        assert_eq!(body["durationSec"], 5463);   // 09:12:57 → 10:44:00
        assert_eq!(body["sessionId"], "s1");
    }
    #[test]
    fn transcript_sans_prompt_n_a_pas_de_session() {
        assert!(parse_transcript("/p/x.jsonl", "{\"type\":\"summary\"}\n", &[]).session.is_none());
    }
    #[test]
    fn collect_utilise_le_cursor_mtime_et_enregistre_le_repo() {
        let dir = tempfile::tempdir().unwrap();
        let proj = dir.path().join("-home-t-dev-a");
        std::fs::create_dir_all(&proj).unwrap();
        std::fs::write(proj.join("s1.jsonl"), FIXTURE).unwrap();
        let store = Store::open_in_memory().unwrap();
        assert_eq!(collect(&store, dir.path(), &[], 1_800_000_000).unwrap(), 2);
        assert_eq!(collect(&store, dir.path(), &[], 1_800_000_000).unwrap(), 0, "deuxième passe : rien de neuf");
        assert!(store.get_cursor("claude").unwrap().is_some());
        // /home/t/dev/a n'existe pas → repo_root rend le cwd tel quel, enregistré comme repo
        assert!(store.active_repos().unwrap().contains(&"/home/t/dev/a".to_string()));
    }
}
```

- [ ] **Step 2 : Échec**, puis **Step 3 : Implémenter**

`parse_transcript` : pour chaque ligne, `serde_json::from_str::<Value>` (erreur → skip) ; garder `type == "user"`, `message.content` de type `String`, non vide après trim, ne commençant pas par `<local-command`, `<command-name`, `<system-reminder` ; `ts` = `DateTime::parse_from_rfc3339(timestamp).timestamp()` ; `title` = contenu avec `\n`/`\r`/tabulations remplacés par des espaces, espaces multiples réduits, tronqué à 200 caractères (`chars().take(200)`) ; `workspace_dir` = `repo_root(cwd)` (dossier inexistant → `cwd` tel quel) ; `ticket_ids = extract_ticket_ids(&[branch, contenu complet], patterns)` ; `source_ref = uuid`. Session : si ≥ 1 prompt, `ts` = min de tous les timestamps du fichier (assistant inclus), `durationSec` = max − min, `sessionId` = du premier objet portant `sessionId`, sinon nom du fichier sans extension ; `title` = `format!("Session Claude Code · {n} prompt{s} · {}", fmt_duration(sec))` avec `fmt_duration` → `"12 min"` si < 1 h, sinon `"1 h 31 min"`. `workspace_dir`/`branch` de la session = ceux du premier prompt.

`collect` : cursor `claude` = mtime max (secondes) déjà vu ; parcourir `projects_dir/*/*.jsonl`, `metadata.modified()` > cursor → lire, parser, `insert_events(prompts)` (compter), `upsert_event(session)`, `register_repos(dirs distincts, now)` ; à la fin `set_cursor("claude", max_mtime)`. Erreur de lecture d'un fichier → ignorer ce fichier, continuer.

- [ ] **Step 4 : Vérifier** — 4 tests PASS. **Step 5 : Commit** — `feat(core): collecteur des sessions Claude Code`

---

### Task 6 : Collecteur git

**Files:**
- Create: `crates/core/src/activity/collectors/git.rs`

**Interfaces:**
```rust
/// Scanne tous les repos actifs du store. Retourne (insérés, erreurs).
pub fn collect(store: &Store, author_email: Option<&str>, ticket_patterns: &[String], now: i64) -> (usize, Vec<String>);
/// Commits d'un dépôt depuis `since` (epoch s) par `author` (None → `git config user.email`).
pub fn commits_since(dir: &str, since: i64, author: Option<&str>, ticket_patterns: &[String]) -> Result<Vec<NewEvent>, String>;
/// Branches locales non fusionnées dans HEAD (pour « reste à faire »).
pub fn unmerged_branches(dir: &str) -> Vec<String>;
```
Événement : `kind = Commit`, `ts = %at`, `workspace_dir = Some(dir)`, `branch` = première branche de `git branch --all --contains <sha> --format=%(refname:short)` qui n'est pas `HEAD` et ne finit pas par `/HEAD` (préférer une branche locale ; sinon `origin/x` → `x`), `title = %s`, `body = {"files": n, "added": a, "deleted": d, "branches": [...], "body": "<corps ≤ 400 chars>"}`, `ticket_ids = extract_ticket_ids(&[branch, sujet, corps])`, `source_ref = sha`.

- [ ] **Step 1 : Tests (échouent)** — copier dans le module de test les helpers de `crates/core/src/git.rs` (`tmp_repo`, `git(&dir, &[...])`, `write_file` ; `tmp_repo` doit poser `user.email = moi@x.fr`, `user.name`, `init.defaultBranch = main`).

```rust
#[test]
fn commits_since_filtre_auteur_et_lit_toutes_les_branches() {
    let dir = tmp_repo("act-git");
    write_file(&dir, "a.txt", b"1\n"); git(&dir, &["add", "."]); git(&dir, &["commit", "-qm", "feat: a CU-86c1abc"]);
    git(&dir, &["checkout", "-qb", "feature/CU-86c1abd_x"]);
    write_file(&dir, "b.txt", b"1\n2\n"); git(&dir, &["add", "."]); git(&dir, &["commit", "-qm", "fix: b"]);
    git(&dir, &["-c", "user.email=autre@x.fr", "-c", "user.name=Autre", "commit", "-q", "--allow-empty", "-m", "pas moi"]);
    let evs = commits_since(dir.to_str().unwrap(), 0, Some("moi@x.fr"), &[]).unwrap();
    assert_eq!(evs.len(), 2);
    let b = evs.iter().find(|e| e.title == "fix: b").unwrap();
    assert_eq!(b.branch.as_deref(), Some("feature/CU-86c1abd_x"));
    assert_eq!(b.ticket_ids, vec!["86c1abd"]);
    let body: serde_json::Value = serde_json::from_str(b.body.as_deref().unwrap()).unwrap();
    assert_eq!(body["files"], 1); assert_eq!(body["added"], 2);
    let a = evs.iter().find(|e| e.title.starts_with("feat: a")).unwrap();
    assert_eq!(a.ticket_ids, vec!["86c1abc"]);
    assert!(unmerged_branches(dir.to_str().unwrap()).is_empty(), "sur la feature branch tout est fusionné dans HEAD");
    git(&dir, &["checkout", "-q", "main"]);
    assert_eq!(unmerged_branches(dir.to_str().unwrap()), vec!["feature/CU-86c1abd_x"]);
    let _ = std::fs::remove_dir_all(&dir);
}
#[test]
fn commits_since_hors_repo_rend_err() { assert!(commits_since("/", 0, Some("x@y"), &[]).is_err()); }
#[test]
fn collect_avance_le_cursor_par_repo_et_desactive_les_dossiers_disparus() {
    let dir = tmp_repo("act-git2");
    write_file(&dir, "a.txt", b"1\n"); git(&dir, &["add", "."]); git(&dir, &["commit", "-qm", "c"]);
    let store = Store::open_in_memory().unwrap();
    store.register_repos(&[dir.to_str().unwrap().to_string(), "/nonexistent/repo".into()], 1).unwrap();
    let (n, errs) = collect(&store, Some("moi@x.fr"), &[], 2_000_000_000);
    assert_eq!(n, 1); assert!(errs.is_empty(), "un dossier disparu n'est pas une erreur : {errs:?}");
    assert_eq!(store.active_repos().unwrap().len(), 1);
    assert!(store.get_cursor(&format!("git:{}", dir.display())).unwrap().is_some());
    assert_eq!(collect(&store, Some("moi@x.fr"), &[], 2_000_000_000).0, 0);
    let _ = std::fs::remove_dir_all(&dir);
}
```

- [ ] **Step 2 : Implémenter** — `git log --all --since=@<since> --author=<email> --format=%x1e%H%x00%at%x00%s%x00%b --numstat`. Séparer sur `\x1e` ; dans chaque bloc, split `\x00` en 4 : sha, ts, sujet, reste. Dans `reste`, les lignes matchant `^(\d+|-)\t(\d+|-)\t` sont le numstat (`-` = binaire → 0), les autres forment le corps (trim). Auteur : `author` ou `git config user.email` dans le dépôt (vide → pas de filtre `--author`). Cursor `git:<dir>` : lu comme epoch (absent → 0), écrit `now - 3600` après le scan. Dossier absent (`!Path::is_dir`) → `deactivate_repo`, pas d'erreur ; `git log` en échec → message dans `errors`.

- [ ] **Step 3 : Vérifier** — PASS. **Step 4 : Commit** — `feat(core): collecteur des commits git par dépôt connu`

---

### Task 7 : Fournisseurs LLM

**Files:**
- Create: `crates/core/src/activity/providers/llm.rs`

**Interfaces:**
```rust
#[derive(Debug, Clone, PartialEq)]
pub enum LlmError { Unauthorized, Http { status: u16, body: String }, Network(String), Timeout, Malformed(String), Disabled }
impl std::fmt::Display for LlmError { /* messages FR : "jeton LLM refusé (401/403)", "HTTP 500 : …", "réseau : …", "délai dépassé", "réponse inattendue : …", "fournisseur désactivé" */ }
pub struct LlmRequest { pub system: String, pub user: String, pub max_tokens: u32, pub temperature: f32 }
pub trait LlmProvider: Send + Sync {
    fn name(&self) -> String;
    fn complete(&self, req: &LlmRequest) -> Result<String, LlmError>;
}
pub struct OpenAiCompatible { pub base_url: String, pub model: String, pub token: String, pub extra_headers: Vec<(String, String)>, pub timeout: Duration }
pub struct Ollama { pub base_url: String, pub model: String, pub timeout: Duration }
pub struct ClaudeCli { pub model: String, pub timeout: Duration }
pub fn from_settings(s: &LlmSettings) -> Box<dyn LlmProvider>;
/// Pur : corps JSON envoyé (testable sans réseau).
pub fn openai_body(model: &str, req: &LlmRequest) -> serde_json::Value;
pub fn ollama_body(model: &str, req: &LlmRequest) -> serde_json::Value;
```
`OpenAiCompatible::name()` = `format!("openai:{model}")`, Ollama `ollama:{model}`, ClaudeCli `claude-cli:{model}`.

- [ ] **Step 1 : Tests (échouent)** — serveur HTTP minimal sur `127.0.0.1:0` avec `std::net::TcpListener` dans un thread : lit la requête jusqu'à `\r\n\r\n` + `Content-Length` octets, la pousse dans un `mpsc::Sender<String>`, répond une réponse canned.

```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;
    use std::sync::mpsc;

    /// Serveur d'un seul coup : renvoie (url de base, récepteur de la requête brute).
    fn stub(status: &'static str, body: &'static str) -> (String, mpsc::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let (tx, rx) = mpsc::channel();
        std::thread::spawn(move || {
            let (mut s, _) = listener.accept().unwrap();
            let mut buf = Vec::new();
            let mut tmp = [0u8; 4096];
            loop {
                let n = s.read(&mut tmp).unwrap();
                buf.extend_from_slice(&tmp[..n]);
                let text = String::from_utf8_lossy(&buf).to_string();
                if let Some(idx) = text.find("\r\n\r\n") {
                    let len: usize = text.lines().find_map(|l| l.strip_prefix("Content-Length: ")).or_else(|| text.lines().find_map(|l| l.strip_prefix("content-length: "))).and_then(|v| v.trim().parse().ok()).unwrap_or(0);
                    if buf.len() >= idx + 4 + len { break; }
                }
                if n == 0 { break; }
            }
            tx.send(String::from_utf8_lossy(&buf).to_string()).unwrap();
            let resp = format!("HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}", body.len());
            s.write_all(resp.as_bytes()).unwrap();
        });
        (format!("http://127.0.0.1:{port}"), rx)
    }
    fn req() -> LlmRequest { LlmRequest { system: "sys".into(), user: "bonjour".into(), max_tokens: 50, temperature: 0.2 } }

    #[test]
    fn openai_envoie_en_tetes_et_corps_et_lit_le_contenu() {
        let (url, rx) = stub("200 OK", r#"{"choices":[{"message":{"role":"assistant","content":"salut"}}]}"#);
        let p = OpenAiCompatible { base_url: url, model: "google/gemma-4-31B-it".into(), token: "tok".into(),
            extra_headers: vec![("x-env".into(), "dev".into())], timeout: std::time::Duration::from_secs(5) };
        assert_eq!(p.complete(&req()).unwrap(), "salut");
        let raw = rx.recv().unwrap();
        assert!(raw.starts_with("POST /v1/chat/completions HTTP/1.1"), "{raw}");
        assert!(raw.to_lowercase().contains("authorization: bearer tok"));
        assert!(raw.to_lowercase().contains("x-env: dev"));
        let body_json: serde_json::Value = serde_json::from_str(raw.split("\r\n\r\n").nth(1).unwrap()).unwrap();
        assert_eq!(body_json["model"], "google/gemma-4-31B-it");
        assert_eq!(body_json["max_tokens"], 50);
        assert_eq!(body_json["messages"][0]["role"], "system");
        assert_eq!(body_json["messages"][1]["content"], "bonjour");
    }
    #[test]
    fn openai_401_devient_unauthorized_et_500_http() {
        let (url, _rx) = stub("401 Unauthorized", r#"{"error":"expired"}"#);
        let p = OpenAiCompatible { base_url: url, model: "m".into(), token: "".into(), extra_headers: vec![], timeout: std::time::Duration::from_secs(5) };
        assert_eq!(p.complete(&req()), Err(LlmError::Unauthorized));
        let (url, _rx) = stub("500 Internal Server Error", "boom");
        let p = OpenAiCompatible { base_url: url, model: "m".into(), token: "".into(), extra_headers: vec![], timeout: std::time::Duration::from_secs(5) };
        assert!(matches!(p.complete(&req()), Err(LlmError::Http { status: 500, .. })));
    }
    #[test]
    fn openai_sans_token_n_envoie_pas_d_authorization() {
        let (url, rx) = stub("200 OK", r#"{"choices":[{"message":{"content":"x"}}]}"#);
        let p = OpenAiCompatible { base_url: url, model: "m".into(), token: "".into(), extra_headers: vec![], timeout: std::time::Duration::from_secs(5) };
        p.complete(&req()).unwrap();
        assert!(!rx.recv().unwrap().to_lowercase().contains("authorization:"));
    }
    #[test]
    fn ollama_lit_message_content() {
        let (url, rx) = stub("200 OK", r#"{"message":{"role":"assistant","content":"ok ollama"}}"#);
        let p = Ollama { base_url: url, model: "gemma3".into(), timeout: std::time::Duration::from_secs(5) };
        assert_eq!(p.complete(&req()).unwrap(), "ok ollama");
        let raw = rx.recv().unwrap();
        assert!(raw.starts_with("POST /api/chat"));
        assert!(raw.contains(r#""stream":false"#));
    }
    #[test]
    fn reponse_mal_formee() {
        let (url, _rx) = stub("200 OK", r#"{"nope":1}"#);
        let p = OpenAiCompatible { base_url: url, model: "m".into(), token: "".into(), extra_headers: vec![], timeout: std::time::Duration::from_secs(5) };
        assert!(matches!(p.complete(&req()), Err(LlmError::Malformed(_))));
    }
    #[test]
    fn serveur_injoignable_devient_network() {
        let p = OpenAiCompatible { base_url: "http://127.0.0.1:9".into(), model: "m".into(), token: "".into(), extra_headers: vec![], timeout: std::time::Duration::from_secs(2) };
        assert!(matches!(p.complete(&req()), Err(LlmError::Network(_))));
    }
    #[test]
    fn claude_cli_binaire_absent() {
        let p = ClaudeCli { model: "sonnet".into(), timeout: std::time::Duration::from_secs(2) };
        std::env::set_var("PATH", "/nonexistent");
        assert!(matches!(p.complete(&req()), Err(LlmError::Network(_))));
    }
    #[test]
    fn from_settings_choisit_le_bon_fournisseur() {
        let mut s = crate::activity::settings::LlmSettings::default();
        assert_eq!(from_settings(&s).name(), "openai:google/gemma-4-31B-it");
        s.provider = crate::activity::settings::LlmProviderKind::ClaudeCli; s.model = "sonnet".into();
        assert_eq!(from_settings(&s).name(), "claude-cli:sonnet");
    }
}
```

- [ ] **Step 2 : Implémenter** avec ureq 3 :

```rust
fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::new_with_config(ureq::Agent::config_builder().http_status_as_error(false).timeout_global(Some(timeout)).build())
}
fn post_json(agent: &ureq::Agent, url: &str, headers: &[(String, String)], body: &serde_json::Value) -> Result<(u16, String), LlmError> {
    let mut req = agent.post(url).header("Content-Type", "application/json");
    for (k, v) in headers { req = req.header(k.as_str(), v.as_str()); }
    let mut resp = req.send_json(body).map_err(|e| match e {
        ureq::Error::Timeout(_) => LlmError::Timeout,
        other => LlmError::Network(other.to_string()),
    })?;
    let status = resp.status().as_u16();
    let text = resp.body_mut().read_to_string().map_err(|e| LlmError::Network(e.to_string()))?;
    Ok((status, text))
}
```
Puis : 401/403 → `Unauthorized` ; autre non-2xx → `Http { status, body: text.chars().take(500).collect() }` ; parse JSON → `Malformed` si le chemin `choices[0].message.content` (ou `message.content` pour Ollama) n'est pas une chaîne. URL : `format!("{}/v1/chat/completions", base_url.trim_end_matches('/'))`. `openai_body` : `{"model", "temperature", "max_tokens", "messages": [{"role":"system","content"},{"role":"user","content"}]}` ; `ollama_body` : `{"model", "stream": false, "messages", "options": {"temperature", "num_predict"}}`. `ClaudeCli` : `std::process::Command::new("claude").args(["-p", "--model", model, "--output-format", "text"])`, stdin = `format!("{system}\n\n---\n\n{user}")`, attente avec timeout (boucle `try_wait` + sleep 100 ms, `kill` au dépassement → `Timeout`) ; spawn en échec → `Network(e)`. `from_settings` : `extra_headers` BTreeMap → Vec, `timeout = 120 s`, jeton vide autorisé.

- [ ] **Step 3 : Vérifier** — 8 tests PASS. Si l'API ureq 3 diffère (noms de méthodes), lire `~/.cargo/registry/src/*/ureq-3*/README.md` et adapter ; ne pas passer en ureq 2.
- [ ] **Step 4 : Commit** — `feat(core): fournisseurs LLM (OpenAI-compatible pour Gemma, Ollama, claude -p)`

---

### Task 8 : Client et collecteur ClickUp

**Files:**
- Create: `crates/core/src/activity/providers/clickup.rs`, `crates/core/src/activity/collectors/clickup.rs`

**Interfaces (providers/clickup.rs) :**
```rust
pub struct ClickupClient { pub base_url: String /* défaut https://api.clickup.com/api/v2 */, pub token: String, pub timeout: Duration }
#[derive(Debug, Clone, PartialEq)] pub enum ClickupError { Unauthorized, Http { status: u16, body: String }, Network(String), Malformed(String) }
impl ClickupClient {
    pub fn new(token: &str) -> Self;
    pub fn current_user_id(&self) -> Result<u64, ClickupError>;                // GET /user → user.id
    pub fn first_team_id(&self) -> Result<u64, ClickupError>;                  // GET /team → teams[0].id
    pub fn tasks_updated_since(&self, team: u64, user: u64, since_ms: i64) -> Result<Vec<RawTask>, ClickupError>; // pagination, include_closed=true, subtasks=true
    pub fn open_tasks(&self, team: u64, user: u64) -> Result<Vec<RawTask>, ClickupError>;                          // include_closed=false, order_by=due_date
    pub fn task(&self, id: &str) -> Result<RawTask, ClickupError>;             // GET /task/{id}
}
/// Tâche réduite, parsée depuis le JSON ClickUp. Pur : `RawTask::from_json(&Value) -> Option<RawTask>`.
#[derive(Debug, Clone, PartialEq)]
pub struct RawTask { pub id: String, pub name: String, pub status: String, pub status_type: String, pub url: String,
    pub date_updated_ms: i64, pub due_date_ms: Option<i64>, pub priority: Option<String>, pub list_name: Option<String> }
impl RawTask { pub fn to_ticket_info(&self) -> TicketInfo; pub fn to_open_task(&self) -> OpenTask; }   // dates en secondes
```
**Interfaces (collectors/clickup.rs) :**
```rust
/// Étapes 1→4 de la spec §4. Sans token → Ok(0) sans appel. Cursor `clickup` = date_updated max (ms) ; `clickup:user`, `clickup:team` mémorisés.
pub fn collect(store: &Store, client: Option<&ClickupClient>, from: i64, to: i64, now: i64) -> Result<usize, String>;
/// Pur : tâche → événement `clickup_change`.
pub fn change_event(t: &RawTask) -> NewEvent;   // ts = date_updated/1000, title = "<nom> → <statut>", body = JSON réduit, ticket_ids = [id], source_ref = "<id>:<date_updated_ms>", workspace_dir = None
```
`from..to` de `collect` = plage dont on veut résoudre les tickets périmés (`stale_ticket_ids(from, to, now - 86400, 30)`).

- [ ] **Step 1 : Tests (échouent)** — fixture JSON d'une tâche ClickUp :

```rust
const TASK: &str = r#"{"id":"86c1abc","name":"Dashboard activité","status":{"status":"en cours","type":"custom"},
 "date_updated":"1789550000000","due_date":"1789900000000","url":"https://app.clickup.com/t/86c1abc",
 "priority":{"priority":"high"},"list":{"name":"Sprint 42"}}"#;
#[test]
fn raw_task_depuis_json_clickup() {
    let t = RawTask::from_json(&serde_json::from_str(TASK).unwrap()).unwrap();
    assert_eq!(t.id, "86c1abc"); assert_eq!(t.status, "en cours"); assert_eq!(t.date_updated_ms, 1789550000000);
    assert_eq!(t.priority.as_deref(), Some("high")); assert_eq!(t.list_name.as_deref(), Some("Sprint 42"));
    let info = t.to_ticket_info(); assert_eq!(info.due_date, Some(1789900000));
    let open = t.to_open_task(); assert_eq!(open.name, "Dashboard activité");
}
#[test]
fn raw_task_sans_due_date_ni_priorite() {
    let t = RawTask::from_json(&serde_json::json!({"id":"x","name":"n","status":{"status":"s","type":"open"},"date_updated":"5","url":"u","priority":null})).unwrap();
    assert_eq!(t.due_date_ms, None); assert_eq!(t.priority, None); assert_eq!(t.list_name, None);
}
#[test]
fn change_event_forme_attendue() {
    let t = RawTask::from_json(&serde_json::from_str(TASK).unwrap()).unwrap();
    let e = change_event(&t);
    assert_eq!(e.kind, EventKind::ClickupChange); assert_eq!(e.ts, 1789550000);
    assert_eq!(e.title, "Dashboard activité → en cours"); assert_eq!(e.ticket_ids, vec!["86c1abc"]);
    assert_eq!(e.source_ref, "86c1abc:1789550000000"); assert!(e.workspace_dir.is_none());
}
#[test]
fn collect_sans_client_ne_fait_rien() {
    let store = Store::open_in_memory().unwrap();
    assert_eq!(collect(&store, None, 0, 1, 1).unwrap(), 0);
}
#[test]
fn collect_avec_stub_http_insere_et_remplit_open_tasks_et_tickets() {
    // Stub multi-requêtes : un thread accepte N connexions et route par chemin.
    let routes: Vec<(&str, String)> = vec![
        ("/user", r#"{"user":{"id":7}}"#.into()),
        ("/team", r#"{"teams":[{"id":9}]}"#.into()),
        ("/team/9/task?", format!(r#"{{"tasks":[{TASK}],"last_page":true}}"#)),   // sert updated ET open (même corps)
        ("/task/", TASK.into()),
    ];
    let (base, _) = stub_router(routes, 6);
    let client = ClickupClient { base_url: base, token: "t".into(), timeout: std::time::Duration::from_secs(5) };
    let store = Store::open_in_memory().unwrap();
    let mut ev = NewEvent { ts: 1789550000, kind: EventKind::Commit, workspace_dir: Some("/a".into()), branch: None, title: "c".into(), body: None, ticket_ids: vec!["86c1abc".into()], source_ref: "sha".into() };
    store.insert_events(std::slice::from_ref(&ev)).unwrap(); ev.source_ref = "sha2".into();
    let n = collect(&store, Some(&client), 1789500000, 1789600000, 1789560000).unwrap();
    assert_eq!(n, 1);
    assert_eq!(store.open_tasks().unwrap()[0].id, "86c1abc");
    assert_eq!(store.tickets_by_ids(&["86c1abc".into()]).unwrap()[0].name, "Dashboard activité");
    assert_eq!(store.get_cursor("clickup").unwrap().as_deref(), Some("1789550000000"));
    assert_eq!(store.get_cursor("clickup:user").unwrap().as_deref(), Some("7"));
}
```
`stub_router(routes, max_conns)` : comme le `stub` de la Task 7 mais en boucle `for _ in 0..max_conns { accept }`, choisit la première route dont le chemin de la ligne de requête **commence par** la clé, répond 200 avec le corps ; chemin inconnu → 404 `{}`. Le collecteur doit tolérer que le stub ferme après `max_conns` connexions (les appels au-delà ne doivent pas exister : user, team, updated p0, open, task = 5 ; prévoir 6).

- [ ] **Step 2 : Implémenter** — en-tête `Authorization: <token>` (ClickUp : jeton personnel **sans** `Bearer`). Pagination : `page=N` tant que `last_page == false` (max 20 pages). `collect` : token absent/vide → `Ok(0)` ; `clickup:user`/`clickup:team` lus ou récupérés puis mémorisés ; cursor `clickup` lu (défaut `now*1000 - 30 jours`) ; événements via `insert_events` ; `set_cursor("clickup", max date_updated)` ; `replace_open_tasks` ; `stale_ticket_ids(from, to, now - 86400, 30)` → `task(id)` chacun → `upsert_tickets` (une erreur de résolution individuelle est ignorée). 401 → `Err("jeton ClickUp refusé")`.

- [ ] **Step 3 : Vérifier** — PASS. **Step 4 : Commit** — `feat(core): client REST ClickUp et collecteur des tâches`

---

### Task 9 : Digest

**Files:**
- Create: `crates/core/src/activity/digest.rs`

**Interfaces:**
```rust
pub struct Digest { pub text: String, pub hash: String /* sha256 hex */ , pub event_count: usize }
/// Texte déterministe pour le LLM (spec §6). `offset` = fuseau pour les heures affichées. `tickets` = infos connues.
pub fn build_digest(events: &[ActivityEvent], tickets: &[TicketInfo], offset: chrono::FixedOffset) -> Digest;
pub const MAX_CHARS: usize = 24_000;
```

- [ ] **Step 1 : Tests (échouent)**

```rust
fn ev(ts: i64, kind: EventKind, dir: &str, title: &str, tickets: &[&str]) -> ActivityEvent {
    ActivityEvent { id: 0, ts, kind, workspace_dir: Some(dir.into()), branch: Some("master".into()), title: title.into(), body: None,
        ticket_ids: tickets.iter().map(|s| s.to_string()).collect(), tickets: vec![] }
}
const T0: i64 = 1_789_516_800; // 2026-09-16 00:00 UTC
fn utc() -> FixedOffset { FixedOffset::east_opt(0).unwrap() }

#[test]
fn digest_groupe_par_workspace_puis_heure_et_liste_les_tickets() {
    let mut c = ev(T0 + 9 * 3600 + 120, EventKind::Commit, "/home/t/dev/terminals", "fix(core): TERM", &["86c1abc"]);
    c.body = Some(r#"{"files":3,"added":42,"deleted":7}"#.into());
    let evs = vec![
        c,
        ev(T0 + 9 * 3600 + 300, EventKind::ShellCmd, "/home/t/dev/terminals", "npm test", &[]),
        ev(T0 + 9 * 3600 + 400, EventKind::ShellCmd, "/home/t/dev/terminals", "npm test", &[]),
        ev(T0 + 14 * 3600, EventKind::ClaudePrompt, "/home/t/dev/autre", "Ajoute un dashboard", &[]),
    ];
    let tickets = vec![TicketInfo { id: "86c1abc".into(), name: "Dashboard".into(), status: "en cours".into(), status_type: "custom".into(), url: "https://app.clickup.com/t/86c1abc".into(), due_date: None, list_name: None }];
    let d = build_digest(&evs, &tickets, utc());
    let expected = "\
## autre (/home/t/dev/autre) — branche master
### 14h
- claude : « Ajoute un dashboard »

## terminals (/home/t/dev/terminals) — branche master
### 09h
- commit : fix(core): TERM (+42 −7, 3 fichiers) [86c1abc]
- shell : npm test ×2

## Tickets cités
- [86c1abc] Dashboard — en cours — https://app.clickup.com/t/86c1abc
";
    assert_eq!(d.text, expected);
    assert_eq!(d.event_count, 4);
    assert_eq!(d.hash.len(), 64);
    assert_eq!(build_digest(&evs, &tickets, utc()).hash, d.hash, "déterministe");
}
#[test]
fn digest_vide() {
    let d = build_digest(&[], &[], utc());
    assert_eq!(d.text, ""); assert_eq!(d.event_count, 0);
}
#[test]
fn prompt_tronque_a_120_et_ticket_inconnu_liste_avec_url_construite() {
    let long = "x".repeat(300);
    let evs = vec![ev(T0, EventKind::ClaudePrompt, "/a", &long, &["zzz1234"])];
    let d = build_digest(&evs, &[], utc());
    assert!(d.text.contains(&format!("« {}… »", "x".repeat(120))));
    assert!(d.text.contains("- [zzz1234] (inconnu) — https://app.clickup.com/t/zzz1234"));
}
#[test]
fn compaction_supprime_les_commandes_puis_tronque_les_prompts() {
    let mut evs = Vec::new();
    for i in 0..2000 { evs.push(ev(T0 + i, EventKind::ShellCmd, "/a", &format!("cmd-{i} {}", "y".repeat(20)), &[])); }
    for i in 0..300 { evs.push(ev(T0 + 5000 + i, EventKind::ClaudePrompt, "/a", &"p".repeat(120), &[])); }
    let d = build_digest(&evs, &[], utc());
    assert!(d.text.len() <= MAX_CHARS, "{}", d.text.len());
    assert!(!d.text.contains("shell :"), "les commandes partent d'abord");
}
#[test]
fn clickup_change_et_session_sont_rendus() {
    let mut s = ev(T0 + 8 * 3600, EventKind::ClaudeSession, "/a", "Session Claude Code · 2 prompts · 1 h 31 min", &[]);
    s.body = None;
    let mut c = ev(T0 + 10 * 3600, EventKind::ClickupChange, "/a", "Dashboard → terminé", &["86c1abc"]);
    c.workspace_dir = None;
    let d = build_digest(&[s, c], &[], utc());
    assert!(d.text.contains("## ClickUp\n### 10h\n- clickup : Dashboard → terminé [86c1abc]"));
    assert!(d.text.contains("- session : Session Claude Code · 2 prompts · 1 h 31 min"));
}
```

- [ ] **Step 2 : Implémenter** — groupes : `BTreeMap<String /*dir*/, BTreeMap<u32 /*heure*/, Vec<&ActivityEvent>>>` ; `workspace_dir = None` → groupe `ClickUp` rendu **en dernier**, autres triés par nom (`workspace_name`) puis dir. En-tête : `## {name} ({dir}) — branche {b}` (branche = celle du premier événement du groupe qui en a une ; sans branche : `## {name} ({dir})`). Lignes : commit → `- commit : {title} (+a −d, n fichiers) [t1, t2]` (stats depuis `body` JSON si présent, `fichier` singulier si 1 ; sans body : pas de parenthèse) ; prompt → `- claude : « {title≤120}{…} »` ; session → `- session : {title}` ; clickup → `- clickup : {title} [ids]` ; shell : dédupliqué par (groupe, heure, title) → `- shell : a ×2 · b · c` sur une ligne (ordre de première apparition, ` ×n` si n>1). Crochets `[ids]` uniquement si non vide. Section `## Tickets cités` si au moins un id : `- [id] {name} — {status} — {url}` ou `- [id] (inconnu) — {ticket_url(id)}`, ordre d'apparition. Groupes séparés par une ligne vide, fichier terminé par `\n`. Compaction : rendu complet ; si `> MAX_CHARS`, re-rendre sans les shell ; si encore trop long, prompts tronqués à 60 ; si encore trop long, tronquer brutalement à `MAX_CHARS` sur une frontière de ligne. Hash : `sha2::Sha256::digest(text)` → `format!("{:x}")`.

- [ ] **Step 3 : Vérifier** — PASS. **Step 4 : Commit** — `feat(core): digest textuel déterministe des événements pour le LLM`

---

### Task 10 : Résumés (prompts, cache, dernier jour ouvré)

**Files:**
- Create: `crates/core/src/activity/summaries.rs`

**Interfaces:**
```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SummaryKind { Bilan, ResteAFaire, Semaine }
impl SummaryKind { pub fn as_str(&self) -> &'static str; pub fn parse(s: &str) -> Option<Self>; }
/// Bornes epoch [from, to) d'un jour local `YYYY-MM-DD`.
pub fn day_range(day: &str, tz: &impl chrono::TimeZone) -> Option<(i64, i64)>;
/// Lundi → vendredi précédent ; mardi..vendredi → veille ; samedi/dimanche → vendredi.
pub fn last_working_day(day: chrono::NaiveDate) -> chrono::NaiveDate;
/// Plage à résumer pour `kind` sur `day` : bilan/reste d'un lundi couvre vendredi 00:00 → lundi 00:00 (spec §6) ; autre jour = le jour ; semaine = lundi 00:00 → samedi 00:00 de la semaine de `day`.
pub fn range_for(day: chrono::NaiveDate, kind: SummaryKind, tz: &impl chrono::TimeZone) -> (i64, i64);
pub struct SummaryInputs<'a> { pub open_tasks: &'a [OpenTask], pub unmerged: &'a [(String /*repo name*/, Vec<String>)] }
pub fn system_prompt(kind: SummaryKind) -> &'static str;
pub fn user_prompt(kind: SummaryKind, day: &str, digest_text: &str, inputs: &SummaryInputs) -> String;
/// Cache par (day, kind, digest_hash) sauf `force`. Digest vide → texte fixe sans appel LLM.
pub fn generate(store: &Store, provider: &dyn LlmProvider, settings: &LlmSettings, day: &str, kind: SummaryKind, force: bool, now: i64, tz: &impl chrono::TimeZone) -> Result<Summary, LlmError>;
pub const EMPTY_TEXT: &str = "Aucune activité enregistrée sur cette période.";
```

- [ ] **Step 1 : Tests (échouent)**

```rust
struct Fake { calls: std::sync::Mutex<u32>, reply: String }
impl LlmProvider for Fake {
    fn name(&self) -> String { "fake".into() }
    fn complete(&self, _r: &LlmRequest) -> Result<String, LlmError> { *self.calls.lock().unwrap() += 1; Ok(self.reply.clone()) }
}
fn d(s: &str) -> chrono::NaiveDate { chrono::NaiveDate::parse_from_str(s, "%Y-%m-%d").unwrap() }

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
    let (f, t) = range_for(d("2026-09-18"), SummaryKind::Bilan, &utc);   // vendredi → couvre jusqu'au lundi 00:00
    assert_eq!(t - f, 3 * 86400);
    let (f, t) = range_for(d("2026-09-16"), SummaryKind::Semaine, &utc); // mercredi → lundi 14 00:00 → samedi 19 00:00
    assert_eq!(f, 1_789_344_000); assert_eq!(t - f, 5 * 86400);
    assert_eq!(day_range("2026-09-16", &utc), Some((1_789_516_800, 1_789_603_200)));
    assert_eq!(day_range("n'importe", &utc), None);
}
#[test]
fn generate_met_en_cache_par_hash_et_force_regenere() {
    let store = Store::open_in_memory().unwrap();
    store.insert_events(&[NewEvent { ts: 1_789_550_000, kind: EventKind::Commit, workspace_dir: Some("/a".into()), branch: None, title: "c".into(), body: None, ticket_ids: vec![], source_ref: "1".into() }]).unwrap();
    let fake = Fake { calls: Default::default(), reply: "## Bilan\n- c".into() };
    let s = LlmSettings::default();
    let a = generate(&store, &fake, &s, "2026-09-16", SummaryKind::Bilan, false, 1_789_600_000, &chrono::Utc).unwrap();
    assert_eq!(a.text, "## Bilan\n- c"); assert!(!a.cached); assert_eq!(a.model, "fake");
    let b = generate(&store, &fake, &s, "2026-09-16", SummaryKind::Bilan, false, 1_789_600_001, &chrono::Utc).unwrap();
    assert!(b.cached); assert_eq!(*fake.calls.lock().unwrap(), 1);
    store.insert_events(&[NewEvent { ts: 1_789_551_000, kind: EventKind::Commit, workspace_dir: Some("/a".into()), branch: None, title: "d".into(), body: None, ticket_ids: vec![], source_ref: "2".into() }]).unwrap();
    let c = generate(&store, &fake, &s, "2026-09-16", SummaryKind::Bilan, false, 1_789_600_002, &chrono::Utc).unwrap();
    assert!(!c.cached, "nouveau digest → régénéré"); assert_eq!(*fake.calls.lock().unwrap(), 2);
    generate(&store, &fake, &s, "2026-09-16", SummaryKind::Bilan, true, 1_789_600_003, &chrono::Utc).unwrap();
    assert_eq!(*fake.calls.lock().unwrap(), 3);
}
#[test]
fn digest_vide_sans_appel_llm() {
    let store = Store::open_in_memory().unwrap();
    let fake = Fake { calls: Default::default(), reply: "x".into() };
    let r = generate(&store, &fake, &LlmSettings::default(), "2026-09-16", SummaryKind::Bilan, false, 1, &chrono::Utc).unwrap();
    assert_eq!(r.text, EMPTY_TEXT); assert_eq!(*fake.calls.lock().unwrap(), 0);
}
#[test]
fn echec_llm_n_ecrase_pas_le_cache() {
    struct Fail; impl LlmProvider for Fail { fn name(&self) -> String { "f".into() } fn complete(&self, _: &LlmRequest) -> Result<String, LlmError> { Err(LlmError::Unauthorized) } }
    let store = Store::open_in_memory().unwrap();
    store.insert_events(&[NewEvent { ts: 1_789_550_000, kind: EventKind::Commit, workspace_dir: Some("/a".into()), branch: None, title: "c".into(), body: None, ticket_ids: vec![], source_ref: "1".into() }]).unwrap();
    let fake = Fake { calls: Default::default(), reply: "ok".into() };
    generate(&store, &fake, &LlmSettings::default(), "2026-09-16", SummaryKind::Bilan, false, 1, &chrono::Utc).unwrap();
    assert_eq!(generate(&store, &Fail, &LlmSettings::default(), "2026-09-16", SummaryKind::Bilan, true, 2, &chrono::Utc), Err(LlmError::Unauthorized));
    assert_eq!(store.get_summary("2026-09-16", "bilan").unwrap().unwrap().text, "ok");
}
#[test]
fn user_prompt_reste_a_faire_inclut_taches_et_branches() {
    let tasks = vec![OpenTask { id: "86c1abc".into(), name: "Dashboard".into(), status: "en cours".into(), url: "https://app.clickup.com/t/86c1abc".into(), due_date: Some(1_789_950_000), priority: Some("high".into()), list_name: Some("Sprint 42".into()) }];
    let unmerged = vec![("terminals".to_string(), vec!["feat/dashboard".to_string()])];
    let p = user_prompt(SummaryKind::ResteAFaire, "2026-09-16", "## digest", &SummaryInputs { open_tasks: &tasks, unmerged: &unmerged });
    assert!(p.contains("[86c1abc](https://app.clickup.com/t/86c1abc) Dashboard — en cours — échéance 2026-09-21 — priorité high — Sprint 42"));
    assert!(p.contains("- terminals : feat/dashboard"));
    assert!(p.contains("## digest"));
}
```

- [ ] **Step 2 : Implémenter**

Prompts système (texte exact, en français) :

- Bilan : « Tu es l'assistant de Thomas, développeur. À partir du journal d'activité fourni (commits git, prompts envoyés à Claude Code, commandes shell, changements ClickUp), rédige le bilan de la période en 5 à 10 puces markdown groupées par sujet. Cite chaque ticket ClickUp mentionné sous la forme `[id](url)` avec l'URL fournie dans la section « Tickets cités ». N'invente rien qui ne soit pas dans le journal. Pas de préambule ni de conclusion. Réponds en français. »
- Reste à faire : « Tu es l'assistant de Thomas, développeur. On te donne son journal d'activité, ses tâches ClickUp ouvertes et ses branches git non fusionnées. Rédige la liste de ce qui reste à faire, priorisée, en trois sections markdown : `## Tickets ClickUp` (échéance la plus proche d'abord, lien `[id](url)`), `## Branches à finir`, `## Pistes vues dans les prompts` (uniquement si le journal en contient). N'invente rien. Réponds en français, sans préambule. »
- Semaine : « Tu es l'assistant de Thomas, développeur. À partir des journaux d'activité des jours ouvrés de la semaine, rédige une synthèse hebdomadaire en markdown : `## Thèmes de la semaine`, `## Tickets clos`, `## Tickets en cours`, `## Points de friction` (commandes répétées en échec, sessions très longues, allers-retours). Liens tickets `[id](url)`. N'invente rien. Réponds en français, sans préambule. »

`user_prompt` : `# Journal du {day}\n\n{digest}` ; pour ResteAFaire ajouter `\n\n# Tâches ClickUp ouvertes\n` + une ligne par tâche `- [id](url) name — status[ — échéance YYYY-MM-DD][ — priorité p][ — list]` (ou `- (aucune)`), puis `\n# Branches non fusionnées\n` + `- {repo} : b1, b2` (ou `- (aucune)`) ; pour Semaine, le digest passé est déjà la concaténation des jours (voir `generate`).

`generate` : `day` parsé (`Malformed` sinon) ; `range_for` ; `events = store.query(from, to, None)` ; tickets = `store.tickets_by_ids(ids)` ; digest ; Semaine → digests par jour concaténés avec `# {day}\n` en tête de chaque ; vide → `Summary { text: EMPTY_TEXT, model: provider.name(), generated_at: now, cached: false }` sans stocker ; sinon cache `get_summary` avec `digest_hash` égal et `!force` → `cached: true` ; sinon `inputs` (open_tasks via store, unmerged via `collectors::git::unmerged_branches` sur `active_repos`) ; `provider.complete(LlmRequest { system, user, max_tokens: settings.max_tokens, temperature: settings.temperature })` ; succès → `put_summary` puis retour `cached: false`. Erreur → propagée, cache intact.

- [ ] **Step 3 : Vérifier** — PASS. **Step 4 : Commit** — `feat(core): génération des résumés (bilan, reste à faire, semaine) avec cache par digest`

---

### Task 11 : Câblage Tauri — état, commandes, planificateur, shell

**Files:**
- Create: `src-tauri/src/activity.rs`
- Modify: `src-tauri/src/lib.rs` (module, `manage`, `generate_handler!`, thread lecteur de `spawn_pty`, `setup`), `src-tauri/src/pty.rs` (`build_shell_command` accepte un `Option<&ShellLaunch>`), `src-tauri/Cargo.toml` (`chrono = { workspace = true }`)

**Interfaces:**
- Consumes : tout `terminials_core::activity::*`.
- Produces (commandes Tauri, noms exacts du contrat §7) : `activity_register_workspaces`, `activity_collect_now`, `activity_query`, `activity_stats`, `activity_summary`, `activity_open_tasks`, `activity_status`, `activity_get_settings`, `activity_set_settings`. Events émis : `activity-updated { source: "git"|"claude"|"clickup"|"shell" }`, `summary-ready { day, kind }`.

```rust
pub struct ActivityState {
    pub store: Mutex<Option<Store>>,           // None si la base n'a pas pu s'ouvrir (erreur dans `open_error`)
    pub open_error: Mutex<Option<String>>,
    pub settings: RwLock<Settings>,
    pub pairer: Mutex<ShellPairer>,
    pub shims_dir: Option<PathBuf>,            // None si install_shims a échoué → intégration désactivée
    pub last_collect: Mutex<HashMap<String, i64>>,   // "git" | "claude" | "clickup" → epoch s
    pub errors: Mutex<Vec<String>>,            // dernières erreurs de collecte (max 20)
}
#[derive(Serialize)] #[serde(rename_all = "camelCase")]
pub struct ActivityStatus { pub last_collect: HashMap<String, i64>, pub errors: Vec<String>, pub shell_integration: bool, pub db_error: Option<String> }
```

- [ ] **Step 1 : Test unitaire du planificateur (pur)** — dans `activity.rs`, une fonction pure décide quoi faire à un tick :

```rust
pub struct TickPlan { pub collect_git_claude: bool, pub collect_clickup: bool, pub summaries_for: Option<chrono::NaiveDate> }
/// `now_local` : heure locale ; `last` : derniers passages (epoch s) ; `last_summary_day` : dernier jour résumé (YYYY-MM-DD).
pub fn plan_tick(now_utc: i64, now_local: chrono::NaiveDateTime, last: &HashMap<String, i64>, last_summary_day: Option<&str>, schedule: &ScheduleSettings) -> TickPlan;
```
Règles : git/claude si `now - last["git"] >= 300` (absent → true) ; clickup si `>= 900` ; résumés si le jour local est ouvré (ou `!weekdays_only`), l'heure locale ≥ `hour:minute`, et `last_summary_day != today` → `Some(last_working_day(today))`. Le rattrapage au démarrage tombe naturellement dans cette règle (au premier tick après 07:00, `last_summary_day` est d'hier ou absent).

```rust
#[cfg(test)]
mod tests {
    use super::*;
    fn at(h: u32, m: u32, day: &str) -> chrono::NaiveDateTime { chrono::NaiveDate::parse_from_str(day, "%Y-%m-%d").unwrap().and_hms_opt(h, m, 0).unwrap() }
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
        let mut last = HashMap::new(); last.insert("git".to_string(), 1000); last.insert("clickup".to_string(), 1000);
        let p = plan_tick(1200, at(10, 0, "2026-09-16"), &last, Some("2026-09-16"), &ScheduleSettings::default());
        assert!(!p.collect_git_claude && !p.collect_clickup);
        let p = plan_tick(1400, at(10, 0, "2026-09-16"), &last, Some("2026-09-16"), &ScheduleSettings::default());
        assert!(p.collect_git_claude && !p.collect_clickup);
    }
}
```
Run : `cargo test -p terminials activity::` (le crate Tauri s'appelle `terminials`).

- [ ] **Step 2 : Implémenter `activity.rs`**

Initialisation (`pub fn init() -> ActivityState`) : `settings::load(default_path())` (erreur → défauts + message dans `errors`) ; `Store::open($XDG_DATA_HOME|~/.local/share/terminials/activity.db)` ; `install_shims(default_shims_dir())` si `settings.shell.integration`.

Fonction `run_collect(app: &AppHandle, st: &ActivityState, sources: &[&str])` : pour chaque source, appelle le collecteur correspondant sous verrou du store (`git::collect(store, author, patterns, now)`, `claude::collect(store, &default_projects_dir(), patterns, now)`, `clickup::collect(store, client.as_ref(), from, to, now)` avec `from = now - 7 jours`, `to = now + 1 jour`), note `last_collect[source] = now`, pousse les erreurs (garder 20 max), émet `activity-updated`. Retourne un `CollectReport`.

Fonction `run_summaries(app, st, day: NaiveDate)` : provider = `llm::from_settings(&settings.llm)` ; pour `Bilan` et `ResteAFaire` : `summaries::generate(..., force=false, ..., &chrono::Local)` ; si `day.weekday() == Fri` aussi `Semaine` ; erreurs dans `errors` ; succès → `summary-ready { day, kind }` ; à la fin `set_cursor("summary_last_day", today)`. Tout tourne dans `std::thread::spawn` pour ne jamais bloquer l'IPC ; `catch_unwind` autour du corps du tick.

Planificateur (`pub fn start_scheduler(app: AppHandle)`) : thread, boucle `sleep(60 s)` ; chaque tick lit `plan_tick(...)` et exécute. Le premier tick est immédiat au démarrage.

Commandes :
- `activity_register_workspaces(st, dirs: Vec<String>)` → `store.register_repos(&dirs.map(repo_root), now)`.
- `activity_collect_now(app, st)` → `run_collect(..., &["git","claude","clickup"])` synchrone (le front l'appelle dans un `await`) ; retourne le rapport.
- `activity_query(st, from: i64, to: i64, workspace_dir: Option<String>)` → `store.query`.
- `activity_stats(st, from, to)` → `store.stats(from, to, *Local::now().offset())`.
- `activity_summary(app, st, day: String, kind: String, force: bool)` → `SummaryKind::parse` (erreur sinon) ; `generate(...)` ; erreur `LlmError` → `Err(format!("{e}"))` **préfixée** `"unauthorized: "` pour `Unauthorized` (le front teste ce préfixe) ; succès non caché → `summary-ready`.
- `activity_open_tasks(st)`, `activity_status(st)`, `activity_get_settings(st)`, `activity_set_settings(st, settings: Settings)` → `save` + remplace `settings` en mémoire ; si `shell.integration` a basculé, ré-installer / ignorer les shims (prise en compte aux prochains spawns).

Toute commande qui touche le store rend `Err(open_error)` si `store` est `None`.

- [ ] **Step 3 : Modifier `pty.rs` et `lib.rs`**

`build_shell_command(shell, cwd, workspace_id, id, launch: Option<&ShellLaunch>)` : si `launch` → `CommandBuilder::new(&launch.program)` + `args` + `env` ; test existant `shell_command_declares_color_capable_term` inchangé (passer `None`) ; nouveau test : `build_shell_command("/bin/bash", "/", "w", 1, Some(&launch_for("/bin/bash", Path::new("/run/x")).unwrap()))` → `get_argv()` contient `--init-file`. `spawn_pty` reçoit `launch: Option<&ShellLaunch>` ; dans `lib.rs::spawn_pty`, `launch = st.shims_dir.as_ref().filter(|_| settings.shell.integration).and_then(|d| launch_for(&shell, d))`.

Thread lecteur : remplacer `scanner.feed(chunk)` par `feed_events` ; `Notification` → comportement actuel ; `Command { cmd, pwd }` → `pairer.on_command(id, &cmd, &pwd, now_ms)` ; `Exit { code }` → `pairer.on_exit(id, code, now_ms, &settings.shell.ignored_commands)` → si `Some(mut ev)` : `ev.workspace_dir = ev.workspace_dir.map(|d| repo_root(&d))` (calculé hors verrou), `store.insert_events(&[ev])`, `app.emit("activity-updated", {"source":"shell"})`. À la sortie du PTY : `pairer.forget(id)`.

`run()` : `.manage(Arc::new(activity::init()))`, ajouter les 9 commandes au `generate_handler!`, dans `setup` : `activity::start_scheduler(app.handle().clone())`.

- [ ] **Step 4 : Vérifier** — `cargo test -p terminials-core && cargo test -p terminials` PASS ; `cargo build -p terminials` sans warning ; `cargo clippy -p terminials -p terminials-core` sans nouveau warning.
- [ ] **Step 5 : Commit** — `feat(tauri): commandes activity_*, planificateur 07:00 et intégration shell au spawn`

---

### Task 12 : Front — raccourci, store dashboard, jours locaux, API typée

**Files:**
- Modify: `src/lib/shortcuts.ts` (+ test dans `src/lib/shortcuts.test.ts`), `src/lib/shortcutDispatch.ts`
- Create: `src/store/dashboard.ts`, `src/store/dashboard.test.ts`, `src/lib/dashboardDay.ts`, `src/lib/dashboardDay.test.ts`, `src/lib/activityApi.ts`

**Interfaces:**
```ts
// shortcuts.ts : ShortcutAction gagne { type: "toggle-dashboard" } ; CTRL_SHIFT.KeyH.
// dashboardDay.ts (tout en heure locale du navigateur, jours "YYYY-MM-DD")
export function toDayString(d: Date): string;
export function todayString(now?: Date): string;
export function shiftDay(day: string, delta: number): string;
export function dayRange(day: string): { from: number; to: number };          // epoch s, [minuit, minuit+1j)
export function weekRange(day: string): { from: number; to: number; days: string[] }; // lundi 00:00 → samedi 00:00, days = 5 jours
export function lastWorkingDay(day: string): string;
export function formatDayLabel(day: string): string;   // "mercredi 16 septembre 2026" (Intl fr-FR)
export function formatHm(ts: number): string;          // "09:14"
export function formatDuration(minutes: number): string; // "1 h 05" / "45 min"
export function isWeekend(day: string): boolean;
// store/dashboard.ts
interface DashboardState {
  open: boolean; day: string; mode: "day" | "week"; filterDir: string | null; filterText: string;
  unreadSummary: boolean; settingsOpen: boolean; refreshTick: number;
  toggle(): void; close(): void; setDay(d: string): void; shiftDay(delta: number): void; today(): void;
  setMode(m: "day" | "week"): void; setFilterDir(d: string | null): void; setFilterText(t: string): void;
  markSummaryReady(): void; setSettingsOpen(b: boolean): void; bumpRefresh(): void;
}
export const useDashboardStore: UseBoundStore<StoreApi<DashboardState>>;
// activityApi.ts : types TS du contrat §7 (ActivityEvent, TicketRef, ActivityStats, HourCounts, DayCounts, WorkspaceCount, Summary, OpenTask, ActivityStatus, ActivitySettings, CollectReport, SummaryKind = "bilan"|"reste_a_faire"|"semaine")
export const activityApi = { registerWorkspaces(dirs), collectNow(), query(from,to,workspaceDir?), stats(from,to), summary(day,kind,force), openTasks(), status(), getSettings(), setSettings(s) };
export function isUnauthorized(err: unknown): boolean;   // String(err).startsWith("unauthorized:")
```
Sémantique du store : `toggle()` ouvre → `unreadSummary = false`, et met `day` à `todayString()` si l'overlay était fermé depuis plus d'une journée (comparer à `day` stocké : si `day` n'est pas aujourd'hui **et** que l'utilisateur ne l'a pas changé manuellement — simplifier : à l'ouverture, si `day > today` ou `day` absent → today ; sinon garder) ; `setFilterDir` sur la même valeur → `null` (toggle) ; `bumpRefresh` incrémente `refreshTick` (les hooks de données le mettent en dépendance).

- [ ] **Step 1 : Tests (échouent)** — `shortcuts.test.ts` : `matchShortcut({code:"KeyH", ctrlKey:true, shiftKey:true, altKey:false})` → `{type:"toggle-dashboard"}` ; `dashboardDay.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { toDayString, shiftDay, dayRange, weekRange, lastWorkingDay, formatHm, formatDuration, isWeekend, formatDayLabel } from "./dashboardDay";
describe("dashboardDay", () => {
  it("toDayString en local", () => { expect(toDayString(new Date(2026, 8, 16, 23, 59))).toBe("2026-09-16"); });
  it("shiftDay traverse les mois", () => { expect(shiftDay("2026-09-30", 1)).toBe("2026-10-01"); expect(shiftDay("2026-10-01", -1)).toBe("2026-09-30"); });
  it("dayRange = minuit local → minuit suivant", () => {
    const { from, to } = dayRange("2026-09-16");
    expect(from).toBe(Math.floor(new Date(2026, 8, 16).getTime() / 1000)); expect(to - from).toBe(86400);
  });
  it("weekRange du mercredi = lundi → samedi, 5 jours", () => {
    const w = weekRange("2026-09-16");
    expect(w.days).toEqual(["2026-09-14", "2026-09-15", "2026-09-16", "2026-09-17", "2026-09-18"]);
    expect(w.from).toBe(dayRange("2026-09-14").from); expect(w.to).toBe(dayRange("2026-09-19").from);
  });
  it("lastWorkingDay", () => {
    expect(lastWorkingDay("2026-09-21")).toBe("2026-09-18"); expect(lastWorkingDay("2026-09-22")).toBe("2026-09-21");
    expect(lastWorkingDay("2026-09-20")).toBe("2026-09-18");
  });
  it("formats", () => {
    expect(formatHm(new Date(2026, 8, 16, 9, 14).getTime() / 1000)).toBe("09:14");
    expect(formatDuration(65)).toBe("1 h 05"); expect(formatDuration(45)).toBe("45 min"); expect(formatDuration(0)).toBe("0 min");
    expect(isWeekend("2026-09-19")).toBe(true); expect(isWeekend("2026-09-16")).toBe(false);
    expect(formatDayLabel("2026-09-16")).toBe("mercredi 16 septembre 2026");
  });
});
```
`dashboard.test.ts` : `toggle` ouvre/ferme et efface `unreadSummary` ; `shiftDay(1)` depuis "2026-09-16" → "2026-09-17" ; `setFilterDir("/a")` deux fois → `null` ; `markSummaryReady` quand fermé → `unreadSummary=true`, quand ouvert → reste `false` ; `bumpRefresh` incrémente ; `setMode("week")`. Réinitialiser le store entre les tests avec `useDashboardStore.setState(initial)` (exporter `initialDashboardState`).

- [ ] **Step 2 : Implémenter** — `dashboardDay` sans dépendance (`new Date(y, m-1, d)` pour le local ; `Intl.DateTimeFormat("fr-FR", { weekday:"long", day:"numeric", month:"long", year:"numeric" })`). `shortcutDispatch` : `case "toggle-dashboard": useDashboardStore.getState().toggle(); return;`. `activityApi` : `invoke<T>("activity_query", { from, to, workspaceDir })` etc. (Tauri convertit les clés camelCase des args vers les paramètres snake_case Rust automatiquement).

- [ ] **Step 3 : Vérifier** — `npx vitest run` PASS, `npx tsc --noEmit` OK. **Step 4 : Commit** — `feat(front): store dashboard, jours locaux, raccourci Ctrl+Shift+H, API activity typée`

---

### Task 13 : Front — markdownLite

**Files:**
- Create: `src/lib/markdownLite.ts` (parseur pur → AST), `src/lib/markdownLite.test.ts`, `src/components/dashboard/Markdown.tsx` (AST → React)

**Interfaces:**
```ts
export type Inline = { t: "text"; v: string } | { t: "bold"; v: string } | { t: "code"; v: string } | { t: "link"; text: string; href: string };
export type Block = { t: "h"; level: 1 | 2 | 3; inl: Inline[] } | { t: "p"; inl: Inline[] } | { t: "ul"; items: Inline[][] } | { t: "ol"; items: Inline[][] };
export function parseMarkdown(src: string): Block[];
export function parseInline(src: string): Inline[];
// Markdown.tsx : export function Markdown({ text, onOpenLink }: { text: string; onOpenLink: (href: string) => void }) — rend les blocs ; un lien = <a href onClick={preventDefault + onOpenLink}>.
```
Règles : lignes `#`, `##`, `###` → titres ; `- ` ou `* ` → items `ul` consécutifs ; `1. ` → `ol` ; ligne vide sépare les paragraphes ; lignes consécutives non-liste forment un paragraphe (jointes par un espace). Inline : `**gras**`, `` `code` ``, `[texte](url)` uniquement si `url` commence par `http://` ou `https://` (sinon rendu texte brut) ; pas de HTML.

- [ ] **Step 1 : Tests (échouent)**

```ts
it("titres, listes, paragraphes", () => {
  expect(parseMarkdown("## Bilan\n- a\n- **b** fort\n\nTexte\nsuite\n1. un\n2. deux")).toEqual([
    { t: "h", level: 2, inl: [{ t: "text", v: "Bilan" }] },
    { t: "ul", items: [[{ t: "text", v: "a" }], [{ t: "bold", v: "b" }, { t: "text", v: " fort" }]] },
    { t: "p", inl: [{ t: "text", v: "Texte suite" }] },
    { t: "ol", items: [[{ t: "text", v: "un" }], [{ t: "text", v: "deux" }]] },
  ]);
});
it("liens http seulement, code inline", () => {
  expect(parseInline("voir [86c1abc](https://app.clickup.com/t/86c1abc) et `npm test` et [x](javascript:alert(1))")).toEqual([
    { t: "text", v: "voir " }, { t: "link", text: "86c1abc", href: "https://app.clickup.com/t/86c1abc" },
    { t: "text", v: " et " }, { t: "code", v: "npm test" }, { t: "text", v: " et [x](javascript:alert(1))" },
  ]);
});
it("texte brut sans balise reste un paragraphe", () => { expect(parseMarkdown("<b>x</b>")).toEqual([{ t: "p", inl: [{ t: "text", v: "<b>x</b>" }] }]); });
it("Markdown.tsx rend des liens cliquables sans innerHTML", () => {
  const html = renderToStaticMarkup(createElement(Markdown, { text: "- [t](https://x.y)", onOpenLink: () => {} }));
  expect(html).toContain('<a href="https://x.y"'); expect(html).toContain("<li>");
});
```
(`renderToStaticMarkup` de `react-dom/server` fonctionne dans l'environnement `node` de vitest : pas de DOM requis.)

- [ ] **Step 2 : Implémenter**, **Step 3 : Vérifier**, **Step 4 : Commit** — `feat(front): rendu markdown restreint en nœuds React`

---

### Task 14 : Front — blocs de données (tuiles, graphiques SVG, timeline)

**Files:**
- Create: `src/components/dashboard/StatTiles.tsx`, `HourChart.tsx`, `WorkspaceBars.tsx`, `Timeline.tsx`, `src/lib/chartScale.ts`, `src/lib/chartScale.test.ts`, `src/lib/timelineGroups.ts`, `src/lib/timelineGroups.test.ts`, `src/components/dashboard/blocks.test.tsx`

**Interfaces:**
```ts
// chartScale.ts (pur)
export const KIND_COLORS = { commit: "#2ecc71", claude_prompt: "#3b82f6", shell_cmd: "#8a8a8a", clickup_change: "#9b59b6" } as const;
export const KIND_LABELS = { commit: "commits", claude_prompt: "prompts Claude", shell_cmd: "commandes", clickup_change: "ClickUp" } as const;
export function visibleHours(byHour: HourCounts[]): number[];          // 7..20 étendu aux heures non vides (contiguës min..max)
export function stackSegments(c: KindCounts, total: number, height: number): Array<{ kind: keyof typeof KIND_COLORS; y: number; h: number }>;
export function niceMax(values: number[]): number;                     // max arrondi (1,2,5 × 10^n), min 1
// timelineGroups.ts (pur)
export function groupTimeline(events: ActivityEvent[], filterDir: string | null, filterText: string): Array<{ dir: string | null; name: string; events: ActivityEvent[] }>;
// filtre texte insensible à la casse sur title/branch/ticketIds ; groupe ClickUp (dir null) en dernier ; ordre des groupes = premier événement
export function eventIcon(kind: EventKind): string;   // commit "●", claude_prompt "✦", claude_session "◷", shell_cmd "›", clickup_change "◆"
// Composants (props seulement, aucun invoke) :
StatTiles({ totals: Totals })
HourChart({ byHour: HourCounts[] }) / HourChart({ byDay: DayCounts[] })   → prop `data: { kind: "hour"; byHour } | { kind: "day"; byDay }`
WorkspaceBars({ rows: WorkspaceCount[]; selected: string | null; onSelect(dir: string | null) })
Timeline({ events: ActivityEvent[]; filterDir; filterText; onOpenTicket(url: string) })
```

- [ ] **Step 1 : Tests (échouent)** — `chartScale.test.ts` : `visibleHours` sur 24 zéros → `[7..20]` ; avec un événement à 22h → `[7..22]` ; à 5h → `[5..20]`. `niceMax([0,3])` → 5, `niceMax([12])` → 20, `niceMax([])` → 1. `stackSegments` : ordre commit, claude, shell, clickup, somme des `h` = total/height×height. `timelineGroups.test.ts` : groupement, filtre dir, filtre texte sur ticket id, ClickUp en dernier. `blocks.test.tsx` avec `renderToStaticMarkup` : `StatTiles` affiche "5" et "commits" et "1 h 05" pour `activeMinutes: 65` ; `HourChart` mode heure rend 14 `<g class="bar">` pour la plage par défaut et une `<rect>` de couleur `#2ecc71` quand `commit: 1` à 9h ; `WorkspaceBars` rend une barre par ligne et `aria-pressed="true"` sur la sélection ; `Timeline` rend `<a href="https://app.clickup.com/t/86c1abc">`.

- [ ] **Step 2 : Implémenter** — SVG `viewBox` responsive (`width="100%"`), axe des heures en libellés `9h`, `12h`…, tooltip natif `<title>` par barre (`9h · 2 commits · 1 prompt`). Classes CSS `dash-*` (définies en Task 16). `Timeline` : `<section>` par groupe, en-tête `name` + `dir` abrégé (`~/…` via `abbreviateHome` si présent dans `src/lib/paths.ts`, sinon l'ajouter), lignes `<div class="dash-ev">` avec heure (`formatHm`), icône colorée par kind, titre, badges `<a>` par ticket (texte = `ticket.name ?? id`, `title` = statut). Un événement `claude_session` s'affiche en tête de son groupe avec l'icône ◷.

- [ ] **Step 3 : Vérifier** PASS + `tsc`. **Step 4 : Commit** — `feat(front): tuiles, graphiques SVG et timeline du dashboard`

---

### Task 15 : Front — résumés, tâches ouvertes, réglages, chargement des données

**Files:**
- Create: `src/components/dashboard/SummaryPanel.tsx`, `OpenTasks.tsx`, `SettingsPanel.tsx`, `src/hooks/useActivityData.ts`, `src/lib/summaryState.ts`, `src/lib/summaryState.test.ts`, `src/components/dashboard/panels.test.tsx`

**Interfaces:**
```ts
// summaryState.ts (pur) : réducteur de l'état d'un résumé
export type SummaryUi = { status: "idle" } | { status: "loading" } | { status: "ok"; summary: Summary } | { status: "unauthorized" } | { status: "error"; message: string };
export function reduceSummary(prev: SummaryUi, ev: { type: "start" } | { type: "ok"; summary: Summary } | { type: "fail"; error: unknown }): SummaryUi;
// useActivityData.ts
export function useActivityData(): { loading: boolean; events: ActivityEvent[]; stats: ActivityStats | null; openTasks: OpenTask[]; status: ActivityStatus | null; error: string | null; reload(): void };
// lit day/mode/refreshTick du store, appelle activityApi.query/stats (dayRange ou weekRange), openTasks, status ; annule les réponses obsolètes (compteur de requête).
export function useSummary(kind: SummaryKind): { ui: SummaryUi; generate(force: boolean): void };
// Composants
SummaryPanel({ kind; title: string; onOpenLink(href) })   // utilise useSummary ; états : idle→bouton « Générer », loading→squelette, ok→<Markdown> + pied « généré à HH:MM par <model> » + ↻, unauthorized→bandeau ambre + champ jeton (activityApi.getSettings → set token → setSettings → generate(true)), error→bandeau rouge + « Réessayer »
OpenTasks({ tasks: OpenTask[]; hasToken: boolean; onOpen(url) })   // sans token : « Ajouter un token ClickUp dans ⚙ »
SettingsPanel({ onClose() })   // formulaire complet §8 « Réglages », charge getSettings au montage, Enregistrer → setSettings puis collectNow puis bumpRefresh
```

- [ ] **Step 1 : Tests (échouent)** — `summaryState.test.ts` : `start` → loading ; `ok` → ok ; `fail` avec `"unauthorized: jeton LLM refusé"` → unauthorized ; `fail` autre → error avec message `String(error)`. `panels.test.tsx` (`renderToStaticMarkup`) : `OpenTasks` sans token affiche « Ajouter un token ClickUp » ; avec 2 tâches rend 2 `<li>` triées par échéance (la sans échéance en dernier) et le statut ; `SummaryPanel` n'est pas testé en rendu (hook + invoke) — tester à la place une fonction pure exportée `summaryFooter(summary: Summary): string` → `"généré à 07:02 par openai:google/gemma-4-31B-it"`.

- [ ] **Step 2 : Implémenter** — `invoke` moqué n'est pas nécessaire (pas de test de hook). Dans `useSummary`, `generate(force)` : `reduceSummary(start)` → `activityApi.summary(day, kind, force)` → ok/fail ; en mode semaine, `kind` forcé à `"semaine"` par le parent. Au montage et quand `day`/`refreshTick` changent : `generate(false)` (lecture du cache, coût nul si déjà généré ; si le digest est vide le back répond sans LLM).

- [ ] **Step 3 : Vérifier** PASS + `tsc`. **Step 4 : Commit** — `feat(front): panneaux résumé, tâches ouvertes, réglages et chargement des données`

---

### Task 16 : Assemblage — overlay, sidebar, App, CSS, README

**Files:**
- Create: `src/components/DashboardOverlay.tsx`
- Modify: `src/App.tsx`, `src/components/Sidebar.tsx`, `src/App.css`, `src/lib/socketEvents.ts`, `README.md`

- [ ] **Step 1 : `DashboardOverlay.tsx`** — `<div className="dash-overlay" tabIndex={-1} onKeyDown>` (Escape → close ; `[`/`]` → shiftDay ; `/` → focus du champ filtre) ; barre du haut (`dash-toolbar`) : `◂` `formatDayLabel(day)` `▸`, « Aujourd'hui », segment Jour|Semaine, « collecté il y a N min » (depuis `status.lastCollect` max ; ⚠ avec `title` = erreurs), « Générer maintenant » (déclenche `generate(true)` des panneaux visibles via un `generateTick` dans le store — ajouter `generateTick: number; bumpGenerate(): void` au store, `useSummary` écoute et régénère en `force`), ⚙. Corps : `dash-body` en deux colonnes 60/40 (`dash-left` scrollable : `StatTiles`, `HourChart`, `WorkspaceBars`, champ filtre, `Timeline` ; `dash-right` : mode jour → `SummaryPanel bilan` + `OpenTasks` + `SummaryPanel reste_a_faire` ; mode semaine → `SummaryPanel semaine`). `settingsOpen` → `SettingsPanel` en panneau latéral par-dessus la colonne droite. Ouverture des liens : `openUrl` de `@tauri-apps/plugin-opener`. Focus du conteneur au montage (comme `DiffOverlay`).

- [ ] **Step 2 : `App.tsx`** — importer `useDashboardStore` ; rendre `{dashboardOpen && <DashboardOverlay />}` dans le conteneur `position: relative` de la grille (après `DiffOverlay`) ; l'overlay doit aussi s'afficher quand il n'y a **aucun** workspace (état vide) : le placer au niveau du conteneur principal `flex:1` ; à chaque changement de la liste des `cwd` des workspaces, `activityApi.registerWorkspaces(cwds)` (effet sur `workspaces.map(w=>w.cwd).join("\n")`) ; `listen("activity-updated", () => bumpRefresh())` et `listen("summary-ready", () => markSummaryReady())` dans `registerSocketEvents` (ajouter au `Promise.all` existant).

- [ ] **Step 3 : `Sidebar.tsx`** — en tête de la liste, une ligne fixe `dash-entry` : icône `▦`, libellé « Dashboard », pastille bleue `#3b82f6` si `unreadSummary`, `title="Dashboard (Ctrl+Shift+H)"`, `onClick → toggle()` ; fond `#2c2c2c` quand `open`.

- [ ] **Step 4 : CSS** dans `App.css`, section `/* ---- Dashboard ---- */` : `.dash-overlay` (copie de `.diff-overlay`), `.dash-toolbar` (copie de `.diff-toolbar`), `.dash-body { flex:1; display:flex; min-height:0 }`, `.dash-left { flex: 0 0 60%; overflow:auto; padding: 12px 14px; display:flex; flex-direction:column; gap:14px }`, `.dash-right { flex:1; overflow:auto; padding:12px 14px; border-left:1px solid #242424; display:flex; flex-direction:column; gap:14px }`, `.dash-tiles { display:grid; grid-template-columns: repeat(5, 1fr); gap:8px }`, `.dash-tile { background:#242424; border-radius:8px; padding:10px 12px }`, `.dash-tile-value { font-size:22px; color:#eee }`, `.dash-tile-label { font-size:11px; color:#8a8a8a }`, `.dash-card { background:#242424; border-radius:8px; padding:10px 12px }`, `.dash-card h3 { margin:0 0 8px; font-size:12px; color:#8a8a8a; text-transform:uppercase; letter-spacing:.04em }`, `.dash-ev { display:grid; grid-template-columns: 42px 16px 1fr; gap:6px; padding:3px 0; font-size:12.5px }`, `.dash-ev-time { color:#6f6f6f; font-variant-numeric: tabular-nums }`, `.dash-badge { display:inline-block; padding:0 6px; border-radius:4px; background:#2c2c2c; color:#9b59b6; font-size:11px; margin-left:6px; text-decoration:none }`, `.dash-banner { padding:8px 10px; border-radius:6px; font-size:12.5px }`, `.dash-banner-warn { background:#3a2e12; color:#f1c40f }`, `.dash-banner-err { background:#3a1a1a; color:#e74c3c }`, `.dash-skeleton { height:12px; border-radius:4px; background: linear-gradient(90deg,#242424,#2c2c2c,#242424); margin:6px 0 }`, `.dash-md a { color:#3b82f6 }`, `.dash-seg button[aria-pressed="true"] { background:#3a3a3a; color:#fff }`, `.dash-entry { display:flex; align-items:center; gap:8px; margin:6px 6px 2px; padding:7px 10px; border-radius:6px; cursor:pointer; color:#ccc }`, `.dash-entry:hover { background:#2c2c2c }`, `.dash-input { background:#1a1a1a; border:1px solid #3a3a3a; border-radius:4px; color:#ddd; padding:4px 6px; font-size:12.5px }`.

- [ ] **Step 5 : README** — nouvelle puce « **Dashboard d'activité** (`Ctrl+Shift+H`) … » dans Fonctionnalités : sources, résumés Gemma à 07:00 en semaine + bouton, réglages dans ⚙ (`~/.config/terminials/settings.json`), intégration shell bash/zsh et sa limite (première commande simple), jeton Gemma périssable (6 h).

- [ ] **Step 6 : Vérifier** — `npx vitest run`, `npx tsc --noEmit`, `npm run build`, puis `cargo build -p terminials` ; lancer `npm run tauri dev` ≥ 30 s : la fenêtre s'ouvre, `Ctrl+Shift+H` affiche l'overlay, une commande tapée dans un pane apparaît dans la timeline après quelques secondes (`activity-updated`). Rapporter ce qui a été vu réellement.
- [ ] **Step 7 : Commit** — `feat(front): overlay Dashboard, entrée sidebar, événements et documentation`
