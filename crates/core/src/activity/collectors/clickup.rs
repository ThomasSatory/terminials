//! Collecteur d'événements `clickup_change` à partir des tickets liés aux commits.

use crate::activity::providers::clickup::{ClickupBatch, ClickupError, ClickupQuery, ClickupSource, RawTask};
use crate::activity::store::Store;
use crate::activity::{EventKind, NewEvent};

const TRENTE_JOURS_MS: i64 = 30 * 24 * 60 * 60 * 1000;
const UN_JOUR: i64 = 86_400;
const MAX_TICKETS_PERIMES: usize = 30;
/// Curseur qui garde l'id de l'US « Réunion » du sprint en cours.
pub const CURSEUR_REUNION: &str = "clickup_reunion";

fn map_err(e: ClickupError) -> String {
    match e {
        ClickupError::Unauthorized => "jeton ClickUp refusé".to_string(),
        other => other.to_string(),
    }
}

/// Lectures du store à faire **avant** l'appel à la source : borne de
/// modification (curseur `clickup`, défaut 30 jours en arrière) et tickets dont
/// l'état en base est périmé. Aucune écriture, aucun appel réseau.
pub fn prepare(store: &Store, from: i64, to: i64, now: i64) -> Result<ClickupQuery, String> {
    let updated_since_ms = match store.get_cursor("clickup").map_err(|e| e.to_string())? {
        Some(v) => v.parse::<i64>().map_err(|e| e.to_string())?,
        None => now * 1000 - TRENTE_JOURS_MS,
    };
    let resolve_ids = store
        .stale_ticket_ids(from, to, now - UN_JOUR, MAX_TICKETS_PERIMES)
        .map_err(|e| e.to_string())?;
    Ok(ClickupQuery { updated_since_ms, resolve_ids })
}

/// Écritures du store à faire **après** l'appel à la source. Rend le nombre
/// d'événements `clickup_change` réellement insérés.
///
/// Le curseur n'avance que s'il y a eu des tâches modifiées, et jamais en
/// arrière : une horloge ClickUp en retard rejouerait sinon la même fenêtre à
/// chaque collecte.
pub fn apply(store: &Store, batch: &ClickupBatch, since_ms: i64, now: i64) -> Result<usize, String> {
    let mut inserted = 0usize;
    if !batch.updated.is_empty() {
        let events: Vec<NewEvent> = batch.updated.iter().map(change_event).collect();
        inserted = store.insert_events(&events).map_err(|e| e.to_string())?;
        let max_updated = batch
            .updated
            .iter()
            .map(|t| t.date_updated_ms)
            .max()
            .unwrap_or(since_ms)
            .max(since_ms);
        store
            .set_cursor("clickup", &max_updated.to_string())
            .map_err(|e| e.to_string())?;
    }

    let open_tasks: Vec<_> = batch.open.iter().map(RawTask::to_open_task).collect();
    store
        .replace_open_tasks(&open_tasks, now)
        .map_err(|e| e.to_string())?;

    let mut tickets: Vec<_> = batch.resolved.iter().map(RawTask::to_ticket_info).collect();
    // La réunion du sprint n'est pas remplacée quand la source n'en rend pas :
    // une réponse MCP incomplète ne doit pas renvoyer le temps à saisir sur
    // « US de réunion introuvable » jusqu'à la collecte suivante.
    if let Some(r) = &batch.reunion {
        tickets.push(r.to_ticket_info());
        store
            .set_cursor(CURSEUR_REUNION, &r.id)
            .map_err(|e| e.to_string())?;
    }
    if !tickets.is_empty() {
        store.upsert_tickets(&tickets, now).map_err(|e| e.to_string())?;
    }

    Ok(inserted)
}

/// Étapes 1→4 de la spec §4, composées. Sans source → `Ok(0)` sans appel.
///
/// L'appelant Tauri n'utilise pas cette composition : il intercale la libération
/// du verrou du store entre `prepare` et `fetch`, puis le reprend pour `apply`.
/// Elle reste le point d'entrée des tests, qui n'ont pas de verrou à gérer.
pub fn collect(
    store: &Store,
    source: Option<&dyn ClickupSource>,
    from: i64,
    to: i64,
    now: i64,
) -> Result<usize, String> {
    let Some(source) = source else { return Ok(0) };
    let query = prepare(store, from, to, now)?;
    let batch = source.fetch(&query).map_err(map_err)?;
    apply(store, &batch, query.updated_since_ms, now)
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
    use crate::activity::providers::clickup::ClickupClient;
    use std::io::{Read, Write};
    use std::net::TcpListener;

    const TASK: &str = r#"{"id":"86c1abc","name":"Dashboard activité","status":{"status":"en cours","type":"custom"},"custom_item_id":1003,
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
    fn collect_sans_source_ne_fait_rien() {
        let store = Store::open_in_memory().unwrap();
        assert_eq!(collect(&store, None, 0, 1, 1).unwrap(), 0);
    }

    fn tache(id: &str, ms: i64) -> RawTask {
        RawTask {
            id: id.into(),
            name: format!("tâche {id}"),
            status: "en cours".into(),
            status_type: "open".into(),
            url: format!("https://app.clickup.com/t/{id}"),
            date_updated_ms: ms,
            due_date_ms: None,
            priority: None,
            list_name: None,
            task_type: Some("Story".into()),
            sprint: None,
        }
    }

    #[test]
    fn prepare_sans_curseur_remonte_de_trente_jours() {
        let store = Store::open_in_memory().unwrap();
        let q = prepare(&store, 0, 1, 1_789_560_000).unwrap();
        assert_eq!(q.updated_since_ms, 1_789_560_000 * 1000 - TRENTE_JOURS_MS);
        assert!(q.resolve_ids.is_empty());
    }

    #[test]
    fn prepare_reprend_le_curseur_et_les_tickets_perimes() {
        let store = Store::open_in_memory().unwrap();
        store.set_cursor("clickup", "1789550000000").unwrap();
        store
            .insert_events(&[NewEvent {
                ts: 1_789_550_000,
                kind: EventKind::Commit,
                workspace_dir: Some("/a".into()),
                branch: None,
                title: "c".into(),
                body: None,
                ticket_ids: vec!["86c1abc".into()],
                source_ref: "sha".into(),
            }])
            .unwrap();
        let q = prepare(&store, 1_789_500_000, 1_789_600_000, 1_789_560_000).unwrap();
        assert_eq!(q.updated_since_ms, 1_789_550_000_000);
        assert_eq!(q.resolve_ids, vec!["86c1abc".to_string()]);
    }

    #[test]
    fn apply_insere_avance_le_curseur_et_remplit_les_tables() {
        let store = Store::open_in_memory().unwrap();
        let batch = ClickupBatch {
            updated: vec![tache("a1", 1_789_550_000_000), tache("a2", 1_789_560_000_000)],
            open: vec![tache("o1", 1_789_540_000_000)],
            resolved: vec![tache("r1", 1_789_530_000_000)],
            reunion: None,
        };
        let n = apply(&store, &batch, 1_789_500_000_000, 1_789_560_001).unwrap();
        assert_eq!(n, 2);
        assert_eq!(store.get_cursor("clickup").unwrap().as_deref(), Some("1789560000000"));
        assert_eq!(store.open_tasks().unwrap()[0].id, "o1");
        assert_eq!(store.tickets_by_ids(&["r1".into()]).unwrap()[0].name, "tâche r1");
    }

    #[test]
    fn apply_sans_tache_modifiee_n_avance_pas_le_curseur_mais_vide_les_ouvertes() {
        let store = Store::open_in_memory().unwrap();
        store.set_cursor("clickup", "1789550000000").unwrap();
        let n = apply(&store, &ClickupBatch::default(), 1_789_550_000_000, 1_789_560_000).unwrap();
        assert_eq!(n, 0);
        assert_eq!(store.get_cursor("clickup").unwrap().as_deref(), Some("1789550000000"));
        assert!(store.open_tasks().unwrap().is_empty());
    }

    #[test]
    fn apply_retient_la_reunion_et_la_garde_si_la_source_n_en_rend_pas() {
        let store = Store::open_in_memory().unwrap();
        let batch = ClickupBatch { reunion: Some(tache("r9", 1)), ..Default::default() };
        apply(&store, &batch, 0, 1).unwrap();
        apply(&store, &ClickupBatch::default(), 0, 2).unwrap();
        assert_eq!(store.reunion_us("").unwrap().map(|t| t.name), Some(Some("tâche r9".to_string())));
    }

    #[test]
    fn apply_ne_recule_jamais_le_curseur() {
        // Une tâche modifiée « avant » la borne (horloges désynchronisées côté
        // ClickUp) ne doit pas rejouer indéfiniment la même fenêtre.
        let store = Store::open_in_memory().unwrap();
        let batch = ClickupBatch { updated: vec![tache("a1", 10)], ..Default::default() };
        apply(&store, &batch, 1_000_000, 1).unwrap();
        assert_eq!(store.get_cursor("clickup").unwrap().as_deref(), Some("1000000"));
    }

    /// Source en mémoire : mémorise la requête reçue et rend un lot figé.
    struct SourceFausse {
        recu: std::sync::Mutex<Option<ClickupQuery>>,
        lot: ClickupBatch,
    }
    impl ClickupSource for SourceFausse {
        fn fetch(&self, q: &ClickupQuery) -> Result<ClickupBatch, ClickupError> {
            *self.recu.lock().unwrap() = Some(q.clone());
            Ok(self.lot.clone())
        }
        fn name(&self) -> &'static str {
            "fausse"
        }
    }

    #[test]
    fn collect_compose_prepare_fetch_et_apply() {
        let store = Store::open_in_memory().unwrap();
        store.set_cursor("clickup", "1789500000000").unwrap();
        let source = SourceFausse {
            recu: Default::default(),
            lot: ClickupBatch {
                updated: vec![tache("a1", 1_789_550_000_000)],
                open: vec![tache("o1", 1_789_540_000_000)],
                resolved: vec![],
                reunion: None,
            },
        };
        let n = collect(&store, Some(&source), 1_789_500_000, 1_789_600_000, 1_789_560_000).unwrap();
        assert_eq!(n, 1);
        assert_eq!(source.recu.lock().unwrap().as_ref().unwrap().updated_since_ms, 1_789_500_000_000);
        assert_eq!(store.get_cursor("clickup").unwrap().as_deref(), Some("1789550000000"));
        assert_eq!(store.open_tasks().unwrap()[0].id, "o1");
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
            // Jeton propre à ce test : le cache mémoire des identifiants
            // (utilisateur, équipe) est global au process et indexé par jeton.
            token: "jeton-du-test-collect".into(),
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
    }
}
