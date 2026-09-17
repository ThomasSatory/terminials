//! Collecteur d'événements `clickup_change` à partir des tickets liés aux commits.

use crate::activity::providers::clickup::{ClickupClient, ClickupError, RawTask};
use crate::activity::store::Store;
use crate::activity::{EventKind, NewEvent};

const TRENTE_JOURS_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const UN_JOUR: i64 = 86_400;
const MAX_TICKETS_PERIMES: usize = 30;

fn map_err(e: ClickupError) -> String {
    match e {
        ClickupError::Unauthorized => "jeton ClickUp refusé".to_string(),
        other => other.to_string(),
    }
}

/// Étapes 1→4 de la spec §4. Sans token → `Ok(0)` sans appel. Cursor `clickup` = date_updated
/// max (ms) ; `clickup:user`, `clickup:team` sont résolus une fois puis mémorisés.
pub fn collect(
    store: &Store,
    client: Option<&ClickupClient>,
    from: i64,
    to: i64,
    now: i64,
) -> Result<usize, String> {
    let client = match client {
        Some(c) if !c.token.is_empty() => c,
        _ => return Ok(0),
    };

    let user = match store.get_cursor("clickup:user").map_err(|e| e.to_string())? {
        Some(v) => v.parse::<u64>().map_err(|e| e.to_string())?,
        None => {
            let id = client.current_user_id().map_err(map_err)?;
            store
                .set_cursor("clickup:user", &id.to_string())
                .map_err(|e| e.to_string())?;
            id
        }
    };
    let team = match store.get_cursor("clickup:team").map_err(|e| e.to_string())? {
        Some(v) => v.parse::<u64>().map_err(|e| e.to_string())?,
        None => {
            let id = client.first_team_id().map_err(map_err)?;
            store
                .set_cursor("clickup:team", &id.to_string())
                .map_err(|e| e.to_string())?;
            id
        }
    };

    let since_ms = match store.get_cursor("clickup").map_err(|e| e.to_string())? {
        Some(v) => v.parse::<i64>().map_err(|e| e.to_string())?,
        None => now * 1000 - TRENTE_JOURS_MS,
    };

    let updated = client
        .tasks_updated_since(team, user, since_ms)
        .map_err(map_err)?;
    let mut inserted = 0usize;
    if !updated.is_empty() {
        let events: Vec<NewEvent> = updated.iter().map(change_event).collect();
        inserted = store.insert_events(&events).map_err(|e| e.to_string())?;
        let max_updated = updated
            .iter()
            .map(|t| t.date_updated_ms)
            .max()
            .unwrap_or(since_ms)
            .max(since_ms);
        store
            .set_cursor("clickup", &max_updated.to_string())
            .map_err(|e| e.to_string())?;
    }

    let open = client.open_tasks(team, user).map_err(map_err)?;
    let open_tasks: Vec<_> = open.iter().map(RawTask::to_open_task).collect();
    store
        .replace_open_tasks(&open_tasks, now)
        .map_err(|e| e.to_string())?;

    let stale_ids = store
        .stale_ticket_ids(from, to, now - UN_JOUR, MAX_TICKETS_PERIMES)
        .map_err(|e| e.to_string())?;
    for id in stale_ids {
        // Une erreur de résolution individuelle est ignorée (ticket transitoirement indisponible).
        if let Ok(t) = client.task(&id) {
            let _ = store.upsert_tickets(&[t.to_ticket_info()], now);
        }
    }

    Ok(inserted)
}

/// Pur : tâche → événement `clickup_change`.
pub fn change_event(t: &RawTask) -> NewEvent {
    let body = serde_json::json!({
        "id": t.id,
        "status": t.status,
        "url": t.url,
    })
    .to_string();
    NewEvent {
        ts: t.date_updated_ms / 1000,
        kind: EventKind::ClickupChange,
        workspace_dir: None,
        branch: None,
        title: format!("{} → {}", t.name, t.status),
        body: Some(body),
        ticket_ids: vec![t.id.clone()],
        source_ref: format!("{}:{}", t.id, t.date_updated_ms),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    const TASK: &str = r#"{"id":"86c1abc","name":"Dashboard activité","status":{"status":"en cours","type":"custom"},
 "date_updated":"1789550000000","due_date":"1789900000000","url":"https://app.clickup.com/t/86c1abc",
 "priority":{"priority":"high"},"list":{"name":"Sprint 42"}}"#;

    /// Serveur multi-requêtes : accepte jusqu'à `max_conns` connexions, route chacune par le
    /// chemin de la ligne de requête. La route retenue est celle, parmi celles dont la clé est
    /// un préfixe du chemin, dont la clé est la plus longue (la plus spécifique) — ceci lève
    /// l'ambiguïté entre `/team` et `/team/9/task?...`, tous deux préfixes valides de ce
    /// second chemin. Chemin inconnu → 404 `{}`.
    fn stub_router(routes: Vec<(&'static str, String)>, max_conns: usize) -> (String, std::thread::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        let port = listener.local_addr().unwrap().port();
        let handle = std::thread::spawn(move || {
            for _ in 0..max_conns {
                let (mut s, _) = match listener.accept() {
                    Ok(x) => x,
                    Err(_) => break,
                };
                let mut buf = Vec::new();
                let mut tmp = [0u8; 4096];
                loop {
                    let n = match s.read(&mut tmp) {
                        Ok(n) => n,
                        Err(_) => break,
                    };
                    if n == 0 {
                        break;
                    }
                    buf.extend_from_slice(&tmp[..n]);
                    if String::from_utf8_lossy(&buf).contains("\r\n\r\n") {
                        break;
                    }
                }
                let text = String::from_utf8_lossy(&buf).to_string();
                let path = text
                    .lines()
                    .next()
                    .unwrap_or("")
                    .split_whitespace()
                    .nth(1)
                    .unwrap_or("");
                let best = routes
                    .iter()
                    .filter(|(prefix, _)| path.starts_with(prefix))
                    .max_by_key(|(prefix, _)| prefix.len());
                let (status, body) = match best {
                    Some((_, body)) => ("200 OK", body.clone()),
                    None => ("404 Not Found", "{}".to_string()),
                };
                let resp = format!(
                    "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = s.write_all(resp.as_bytes());
            }
        });
        (format!("http://127.0.0.1:{port}"), handle)
    }

    #[test]
    fn change_event_forme_attendue() {
        let t = RawTask::from_json(&serde_json::from_str(TASK).unwrap()).unwrap();
        let e = change_event(&t);
        assert_eq!(e.kind, EventKind::ClickupChange);
        assert_eq!(e.ts, 1789550000);
        assert_eq!(e.title, "Dashboard activité → en cours");
        assert_eq!(e.ticket_ids, vec!["86c1abc"]);
        assert_eq!(e.source_ref, "86c1abc:1789550000000");
        assert!(e.workspace_dir.is_none());
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
            ("/team/9/task?", format!(r#"{{"tasks":[{TASK}],"last_page":true}}"#)),
            ("/task/", TASK.into()),
        ];
        let (base, _) = stub_router(routes, 6);
        let client = ClickupClient {
            base_url: base,
            token: "t".into(),
            timeout: std::time::Duration::from_secs(5),
        };
        let store = Store::open_in_memory().unwrap();
        let mut ev = NewEvent {
            ts: 1789550000,
            kind: EventKind::Commit,
            workspace_dir: Some("/a".into()),
            branch: None,
            title: "c".into(),
            body: None,
            ticket_ids: vec!["86c1abc".into()],
            source_ref: "sha".into(),
        };
        store.insert_events(std::slice::from_ref(&ev)).unwrap();
        ev.source_ref = "sha2".into();
        let n = collect(&store, Some(&client), 1789500000, 1789600000, 1789560000).unwrap();
        assert_eq!(n, 1);
        assert_eq!(store.open_tasks().unwrap()[0].id, "86c1abc");
        assert_eq!(
            store.tickets_by_ids(&["86c1abc".into()]).unwrap()[0].name,
            "Dashboard activité"
        );
        assert_eq!(
            store.get_cursor("clickup").unwrap().as_deref(),
            Some("1789550000000")
        );
        assert_eq!(store.get_cursor("clickup:user").unwrap().as_deref(), Some("7"));
    }
}
