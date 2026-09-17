//! Collecteur d'événements `claude_prompt`/`claude_session` à partir des transcripts
//! Claude Code (`~/.claude/projects/*/*.jsonl`).

use std::collections::BTreeSet;
use std::path::{Path, PathBuf};

use crate::activity::store::Store;
use crate::activity::tickets::extract_ticket_ids;
use crate::activity::{repo_root, EventKind, NewEvent};

/// Résultat du parsing pur d'un transcript : les prompts humains retenus et,
/// s'il y en a au moins un, l'événement de session qui les résume.
#[derive(Debug, Clone, Default, PartialEq)]
pub struct Parsed {
    pub prompts: Vec<NewEvent>,
    pub session: Option<NewEvent>,
}

/// Préfixes de contenu à ignorer : échos de commande slash et contexte système
/// injectés par Claude Code, qui ne sont pas des prompts saisis par l'utilisateur.
const IGNORED_PREFIXES: [&str; 3] = ["<local-command", "<command-name", "<system-reminder"];

/// Parse un transcript Claude Code (JSON Lines). Fonction pure, exposée pour les tests :
/// ne touche ni au disque ni au store.
pub fn parse_transcript(path_label: &str, content: &str, ticket_patterns: &[String]) -> Parsed {
    let mut prompts = Vec::new();
    let mut session_id: Option<String> = None;
    let mut min_ts: Option<i64> = None;
    let mut max_ts: Option<i64> = None;
    let mut first_workspace_dir: Option<String> = None;
    let mut first_branch: Option<String> = None;

    for line in content.lines() {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let value: serde_json::Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(_) => continue,
        };

        if session_id.is_none() {
            if let Some(sid) = value.get("sessionId").and_then(|v| v.as_str()) {
                session_id = Some(sid.to_string());
            }
        }

        let ts_opt = value
            .get("timestamp")
            .and_then(|v| v.as_str())
            .and_then(|s| chrono::DateTime::parse_from_rfc3339(s).ok())
            .map(|dt| dt.timestamp());
        if let Some(ts) = ts_opt {
            min_ts = Some(min_ts.map_or(ts, |m| m.min(ts)));
            max_ts = Some(max_ts.map_or(ts, |m| m.max(ts)));
        }

        if value.get("type").and_then(|v| v.as_str()) != Some("user") {
            continue;
        }
        let content_str = match value.pointer("/message/content").and_then(|v| v.as_str()) {
            Some(s) => s,
            None => continue,
        };
        let trimmed = content_str.trim();
        if trimmed.is_empty() || IGNORED_PREFIXES.iter().any(|p| trimmed.starts_with(p)) {
            continue;
        }
        let ts = match ts_opt {
            Some(t) => t,
            None => continue,
        };

        let cwd = value.get("cwd").and_then(|v| v.as_str());
        let workspace_dir = cwd.map(repo_root);
        let branch = value
            .get("gitBranch")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let uuid = value
            .get("uuid")
            .and_then(|v| v.as_str())
            .unwrap_or_default()
            .to_string();

        let title: String = content_str
            .replace(['\n', '\r', '\t'], " ")
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" ")
            .chars()
            .take(200)
            .collect();

        let branch_text = branch.clone().unwrap_or_default();
        let ticket_ids = extract_ticket_ids(&[branch_text.as_str(), content_str], ticket_patterns);

        if prompts.is_empty() {
            first_workspace_dir = workspace_dir.clone();
            first_branch = branch.clone();
        }

        prompts.push(NewEvent {
            ts,
            kind: EventKind::ClaudePrompt,
            workspace_dir,
            branch,
            title,
            body: None,
            ticket_ids,
            source_ref: uuid,
        });
    }

    let session = if prompts.is_empty() {
        None
    } else {
        let min_ts = min_ts.unwrap_or(0);
        let max_ts = max_ts.unwrap_or(min_ts);
        let duration_sec = max_ts - min_ts;
        let n = prompts.len();
        let plural = if n > 1 { "s" } else { "" };
        let sid = session_id.unwrap_or_else(|| {
            Path::new(path_label)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or(path_label)
                .to_string()
        });
        let body = serde_json::json!({
            "prompts": n,
            "durationSec": duration_sec,
            "sessionId": sid,
        })
        .to_string();

        Some(NewEvent {
            ts: min_ts,
            kind: EventKind::ClaudeSession,
            workspace_dir: first_workspace_dir,
            branch: first_branch,
            title: format!(
                "Session Claude Code · {n} prompt{plural} · {}",
                fmt_duration(duration_sec)
            ),
            body: Some(body),
            ticket_ids: Vec::new(),
            source_ref: path_label.to_string(),
        })
    };

    Parsed { prompts, session }
}

/// Formate une durée en secondes : `"12 min"` en dessous d'une heure, sinon `"1 h 31 min"`.
fn fmt_duration(total_sec: i64) -> String {
    let total_min = total_sec.max(0) / 60;
    if total_min < 60 {
        format!("{total_min} min")
    } else {
        format!("{} h {} min", total_min / 60, total_min % 60)
    }
}

/// Dossier par défaut des transcripts Claude Code : `$HOME/.claude/projects`.
pub fn default_projects_dir() -> PathBuf {
    let home = std::env::var("HOME").unwrap_or_default();
    PathBuf::from(home).join(".claude").join("projects")
}

/// Scanne `projects_dir` (défaut `~/.claude/projects`) à la recherche de nouveaux
/// transcripts depuis le dernier passage (curseur `mtime`), insère les prompts et
/// sessions correspondants, et enregistre les workspaces vus. Retourne le nombre
/// de prompts insérés.
pub fn collect(
    store: &Store,
    projects_dir: &Path,
    ticket_patterns: &[String],
    now: i64,
) -> Result<usize, String> {
    let cursor: i64 = store
        .get_cursor("claude")
        .map_err(|e| e.to_string())?
        .and_then(|s| s.parse::<i64>().ok())
        .unwrap_or(0);

    let project_entries = match std::fs::read_dir(projects_dir) {
        Ok(rd) => rd,
        Err(_) => return Ok(0), // dossier absent : rien à collecter
    };

    let mut max_mtime = cursor;
    let mut inserted = 0usize;
    let mut dirs: BTreeSet<String> = BTreeSet::new();

    for project_entry in project_entries.flatten() {
        let project_path = project_entry.path();
        if !project_path.is_dir() {
            continue;
        }
        let file_entries = match std::fs::read_dir(&project_path) {
            Ok(rd) => rd,
            Err(_) => continue, // dossier illisible : on ignore ce projet
        };
        for file_entry in file_entries.flatten() {
            let file_path = file_entry.path();
            if file_path.extension().and_then(|e| e.to_str()) != Some("jsonl") {
                continue;
            }
            let mtime = match file_entry
                .metadata()
                .ok()
                .and_then(|m| m.modified().ok())
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
            {
                Some(d) => d.as_secs() as i64,
                None => continue,
            };
            if mtime <= cursor {
                continue;
            }
            let content = match std::fs::read_to_string(&file_path) {
                Ok(c) => c,
                Err(_) => continue, // fichier illisible : on l'ignore et on continue
            };

            let path_label = file_path.to_string_lossy().to_string();
            let parsed = parse_transcript(&path_label, &content, ticket_patterns);

            if !parsed.prompts.is_empty() {
                inserted += store
                    .insert_events(&parsed.prompts)
                    .map_err(|e| e.to_string())?;
            }
            if let Some(session) = &parsed.session {
                store.upsert_event(session).map_err(|e| e.to_string())?;
            }
            for p in &parsed.prompts {
                if let Some(dir) = &p.workspace_dir {
                    dirs.insert(dir.clone());
                }
            }

            if mtime > max_mtime {
                max_mtime = mtime;
            }
        }
    }

    if !dirs.is_empty() {
        let dirs: Vec<String> = dirs.into_iter().collect();
        store.register_repos(&dirs, now).map_err(|e| e.to_string())?;
    }
    if max_mtime > cursor {
        store
            .set_cursor("claude", &max_mtime.to_string())
            .map_err(|e| e.to_string())?;
    }

    Ok(inserted)
}

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
