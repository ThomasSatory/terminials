//! Persistance SQLite des événements d'activité (spec §3).

use std::collections::{BTreeMap, BTreeSet};
use std::path::Path;

use chrono::{FixedOffset, Timelike};
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};

use crate::activity::tickets::ticket_url;
use crate::activity::{
    ActivityEvent, ActivityStats, DayCounts, EventKind, HourCounts, KindCounts, NewEvent,
    OpenTask, TicketInfo, TicketRef, Totals, WorkspaceCount,
};

pub type StoreResult<T> = Result<T, rusqlite::Error>;

const SCHEMA_V1: &str = "
CREATE TABLE events(
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,
  kind TEXT NOT NULL,
  workspace_dir TEXT,
  branch TEXT,
  title TEXT NOT NULL,
  body TEXT,
  ticket_ids TEXT NOT NULL DEFAULT '',
  source_ref TEXT NOT NULL,
  UNIQUE(kind, source_ref)
);
CREATE INDEX events_ts ON events(ts);

CREATE TABLE repos(dir TEXT PRIMARY KEY, last_seen INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
CREATE TABLE tickets(id TEXT PRIMARY KEY, name TEXT, status TEXT, status_type TEXT, url TEXT, due_date INTEGER,
        list_name TEXT, fetched_at INTEGER NOT NULL);
CREATE TABLE open_tasks(id TEXT PRIMARY KEY, name TEXT, status TEXT, url TEXT, due_date INTEGER, priority TEXT,
           list_name TEXT, fetched_at INTEGER NOT NULL);
CREATE TABLE summaries(day TEXT NOT NULL, kind TEXT NOT NULL, model TEXT NOT NULL, digest_hash TEXT NOT NULL,
          text TEXT NOT NULL, generated_at INTEGER NOT NULL, PRIMARY KEY(day, kind));
CREATE TABLE collector_state(name TEXT PRIMARY KEY, cursor TEXT NOT NULL);
PRAGMA user_version = 1;
";

#[derive(Debug, Clone, PartialEq)]
pub struct StoredSummary {
    pub day: String,
    pub kind: String,
    pub model: String,
    pub digest_hash: String,
    pub text: String,
    pub generated_at: i64,
}

pub struct Store {
    conn: Connection,
}

impl Store {
    pub fn open(path: &Path) -> StoreResult<Store> {
        if let Some(p) = path.parent() {
            let _ = std::fs::create_dir_all(p);
        }
        let conn = Connection::open(path)?;
        conn.pragma_update(None, "journal_mode", "WAL")?;
        let s = Store { conn };
        s.migrate()?;
        Ok(s)
    }

    pub fn open_in_memory() -> StoreResult<Store> {
        let conn = Connection::open_in_memory()?;
        let s = Store { conn };
        s.migrate()?;
        Ok(s)
    }

    fn migrate(&self) -> StoreResult<()> {
        let v: i64 = self
            .conn
            .query_row("PRAGMA user_version", [], |r| r.get(0))?;
        if v < 1 {
            self.conn.execute_batch(SCHEMA_V1)?;
        }
        Ok(())
    }

    pub fn insert_events(&self, events: &[NewEvent]) -> StoreResult<usize> {
        let mut count = 0usize;
        let tx = self.conn.unchecked_transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT OR IGNORE INTO events (ts, kind, workspace_dir, branch, title, body, ticket_ids, source_ref)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            for e in events {
                let ticket_ids = e.ticket_ids.join(",");
                let n = stmt.execute(params![
                    e.ts,
                    e.kind.as_str(),
                    e.workspace_dir,
                    e.branch,
                    e.title,
                    e.body,
                    ticket_ids,
                    e.source_ref,
                ])?;
                count += n;
            }
        }
        tx.commit()?;
        Ok(count)
    }

    pub fn upsert_event(&self, e: &NewEvent) -> StoreResult<()> {
        let ticket_ids = e.ticket_ids.join(",");
        self.conn.execute(
            "INSERT INTO events (ts, kind, workspace_dir, branch, title, body, ticket_ids, source_ref)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
             ON CONFLICT(kind, source_ref) DO UPDATE SET
                ts = excluded.ts,
                title = excluded.title,
                body = excluded.body,
                branch = excluded.branch,
                ticket_ids = excluded.ticket_ids",
            params![
                e.ts,
                e.kind.as_str(),
                e.workspace_dir,
                e.branch,
                e.title,
                e.body,
                ticket_ids,
                e.source_ref,
            ],
        )?;
        Ok(())
    }

    pub fn query(
        &self,
        from: i64,
        to: i64,
        workspace_dir: Option<&str>,
    ) -> StoreResult<Vec<ActivityEvent>> {
        let mut rows: Vec<(i64, i64, EventKind, Option<String>, Option<String>, String, Option<String>, String)> =
            Vec::new();
        {
            let sql = if workspace_dir.is_some() {
                "SELECT id, ts, kind, workspace_dir, branch, title, body, ticket_ids FROM events
                 WHERE ts >= ?1 AND ts < ?2 AND workspace_dir = ?3 ORDER BY ts, id"
            } else {
                "SELECT id, ts, kind, workspace_dir, branch, title, body, ticket_ids FROM events
                 WHERE ts >= ?1 AND ts < ?2 ORDER BY ts, id"
            };
            let mut stmt = self.conn.prepare(sql)?;
            let mapper = |row: &rusqlite::Row| {
                let kind_raw: String = row.get(2)?;
                let kind = EventKind::parse(&kind_raw).ok_or_else(|| {
                    rusqlite::Error::FromSqlConversionFailure(
                        2,
                        rusqlite::types::Type::Text,
                        Box::new(std::io::Error::new(
                            std::io::ErrorKind::InvalidData,
                            format!("kind d'événement inconnu en base : {kind_raw:?}"),
                        )),
                    )
                })?;
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    kind,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, Option<String>>(6)?,
                    row.get::<_, String>(7)?,
                ))
            };
            if let Some(dir) = workspace_dir {
                let iter = stmt.query_map(params![from, to, dir], mapper)?;
                for r in iter {
                    rows.push(r?);
                }
            } else {
                let iter = stmt.query_map(params![from, to], mapper)?;
                for r in iter {
                    rows.push(r?);
                }
            }
        }

        // Collecter tous les ids de tickets référencés, dans l'ordre d'apparition.
        let mut all_ids: Vec<String> = Vec::new();
        let mut seen: BTreeSet<String> = BTreeSet::new();
        for (_, _, _, _, _, _, _, ticket_ids) in &rows {
            for id in split_ticket_ids(ticket_ids) {
                if seen.insert(id.clone()) {
                    all_ids.push(id);
                }
            }
        }
        let known = self.tickets_by_ids(&all_ids)?;
        let known_map: BTreeMap<String, TicketInfo> =
            known.into_iter().map(|t| (t.id.clone(), t)).collect();

        let mut events = Vec::with_capacity(rows.len());
        for (id, ts, kind, workspace_dir, branch, title, body, ticket_ids_raw) in rows {
            let ticket_ids = split_ticket_ids(&ticket_ids_raw);
            let tickets = ticket_ids
                .iter()
                .map(|tid| match known_map.get(tid) {
                    Some(info) => TicketRef {
                        id: tid.clone(),
                        name: Some(info.name.clone()),
                        status: Some(info.status.clone()),
                        url: if info.url.is_empty() {
                            ticket_url(tid)
                        } else {
                            info.url.clone()
                        },
                    },
                    None => TicketRef {
                        id: tid.clone(),
                        name: None,
                        status: None,
                        url: ticket_url(tid),
                    },
                })
                .collect();
            events.push(ActivityEvent {
                id,
                ts,
                kind,
                workspace_dir,
                branch,
                title,
                body,
                ticket_ids,
                tickets,
            });
        }
        Ok(events)
    }

    pub fn stats(
        &self,
        from: i64,
        to: i64,
        offset: FixedOffset,
    ) -> StoreResult<ActivityStats> {
        let events = self.query(from, to, None)?;

        fn bump(c: &mut KindCounts, kind: EventKind) {
            match kind {
                EventKind::Commit => c.commit += 1,
                EventKind::ClaudePrompt => c.claude_prompt += 1,
                EventKind::ShellCmd => c.shell_cmd += 1,
                EventKind::ClickupChange => c.clickup_change += 1,
                EventKind::ClaudeSession => {}
            }
        }

        let mut by_hour: Vec<HourCounts> = (0..24u8)
            .map(|h| HourCounts {
                hour: h,
                counts: KindCounts::default(),
            })
            .collect();
        let mut by_day: BTreeMap<String, KindCounts> = BTreeMap::new();
        let mut by_ws: BTreeMap<String, (u32, u32)> = BTreeMap::new();
        let mut slots: BTreeSet<i64> = BTreeSet::new();
        let mut tickets: BTreeSet<String> = BTreeSet::new();

        for e in &events {
            // `%at` d'un commit est arbitraire : un horodatage hors bornes se replie
            // sur epoch 0 au lieu de faire paniquer `stats` (commande synchrone, donc
            // le thread principal de l'application).
            let local = chrono::DateTime::from_timestamp(e.ts, 0)
                .unwrap_or(chrono::DateTime::UNIX_EPOCH)
                .with_timezone(&offset);
            let day = local.format("%Y-%m-%d").to_string();
            bump(&mut by_hour[local.hour() as usize].counts, e.kind);
            bump(by_day.entry(day).or_default(), e.kind);
            if e.kind != EventKind::ClaudeSession {
                slots.insert(e.ts.div_euclid(900));
                if let Some(d) = &e.workspace_dir {
                    let w = by_ws.entry(d.clone()).or_default();
                    w.0 += 1;
                    if e.kind == EventKind::Commit {
                        w.1 += 1;
                    }
                }
            }
            tickets.extend(e.ticket_ids.iter().cloned());
        }

        let totals = Totals {
            commits: events.iter().filter(|e| e.kind == EventKind::Commit).count() as u32,
            prompts: events
                .iter()
                .filter(|e| e.kind == EventKind::ClaudePrompt)
                .count() as u32,
            commands: events
                .iter()
                .filter(|e| e.kind == EventKind::ShellCmd)
                .count() as u32,
            tickets: tickets.len() as u32,
            active_minutes: (slots.len() * 15) as u32,
        };

        let by_day: Vec<DayCounts> = by_day
            .into_iter()
            .map(|(day, counts)| DayCounts { day, counts })
            .collect();

        let mut by_workspace: Vec<WorkspaceCount> = by_ws
            .into_iter()
            .map(|(dir, (events, commits))| WorkspaceCount {
                name: crate::activity::workspace_name(&dir),
                dir,
                events,
                commits,
            })
            .collect();
        by_workspace.sort_by(|a, b| b.events.cmp(&a.events).then_with(|| a.dir.cmp(&b.dir)));

        Ok(ActivityStats {
            totals,
            by_hour,
            by_day,
            by_workspace,
        })
    }

    pub fn register_repos(&self, dirs: &[String], now: i64) -> StoreResult<()> {
        let tx = self.conn.unchecked_transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO repos (dir, last_seen, active) VALUES (?1, ?2, 1)
                 ON CONFLICT(dir) DO UPDATE SET last_seen = excluded.last_seen, active = 1",
            )?;
            for dir in dirs {
                stmt.execute(params![dir, now])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn active_repos(&self) -> StoreResult<Vec<String>> {
        let mut stmt = self
            .conn
            .prepare("SELECT dir FROM repos WHERE active = 1 ORDER BY dir")?;
        let rows = stmt.query_map([], |r| r.get::<_, String>(0))?;
        rows.collect()
    }

    pub fn deactivate_repo(&self, dir: &str) -> StoreResult<()> {
        self.conn
            .execute("UPDATE repos SET active = 0 WHERE dir = ?1", params![dir])?;
        Ok(())
    }

    pub fn get_cursor(&self, name: &str) -> StoreResult<Option<String>> {
        self.conn
            .query_row(
                "SELECT cursor FROM collector_state WHERE name = ?1",
                params![name],
                |r| r.get::<_, String>(0),
            )
            .optional()
    }

    pub fn set_cursor(&self, name: &str, value: &str) -> StoreResult<()> {
        self.conn.execute(
            "INSERT INTO collector_state (name, cursor) VALUES (?1, ?2)
             ON CONFLICT(name) DO UPDATE SET cursor = excluded.cursor",
            params![name, value],
        )?;
        Ok(())
    }

    pub fn get_summary(&self, day: &str, kind: &str) -> StoreResult<Option<StoredSummary>> {
        self.conn
            .query_row(
                "SELECT day, kind, model, digest_hash, text, generated_at FROM summaries
                 WHERE day = ?1 AND kind = ?2",
                params![day, kind],
                |r| {
                    Ok(StoredSummary {
                        day: r.get(0)?,
                        kind: r.get(1)?,
                        model: r.get(2)?,
                        digest_hash: r.get(3)?,
                        text: r.get(4)?,
                        generated_at: r.get(5)?,
                    })
                },
            )
            .optional()
    }

    pub fn put_summary(&self, s: &StoredSummary) -> StoreResult<()> {
        self.conn.execute(
            "INSERT INTO summaries (day, kind, model, digest_hash, text, generated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(day, kind) DO UPDATE SET
                model = excluded.model,
                digest_hash = excluded.digest_hash,
                text = excluded.text,
                generated_at = excluded.generated_at",
            params![s.day, s.kind, s.model, s.digest_hash, s.text, s.generated_at],
        )?;
        Ok(())
    }

    pub fn upsert_tickets(&self, tickets: &[TicketInfo], fetched_at: i64) -> StoreResult<()> {
        let tx = self.conn.unchecked_transaction()?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO tickets (id, name, status, status_type, url, due_date, list_name, fetched_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    status = excluded.status,
                    status_type = excluded.status_type,
                    url = excluded.url,
                    due_date = excluded.due_date,
                    list_name = excluded.list_name,
                    fetched_at = excluded.fetched_at",
            )?;
            for t in tickets {
                stmt.execute(params![
                    t.id,
                    t.name,
                    t.status,
                    t.status_type,
                    t.url,
                    t.due_date,
                    t.list_name,
                    fetched_at,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn tickets_by_ids(&self, ids: &[String]) -> StoreResult<Vec<TicketInfo>> {
        if ids.is_empty() {
            return Ok(Vec::new());
        }
        let placeholders = ids.iter().map(|_| "?").collect::<Vec<_>>().join(",");
        let sql = format!(
            "SELECT id, name, status, status_type, url, due_date, list_name FROM tickets WHERE id IN ({placeholders})"
        );
        let mut stmt = self.conn.prepare(&sql)?;
        let rows = stmt.query_map(params_from_iter(ids.iter()), |r| {
            Ok(TicketInfo {
                id: r.get(0)?,
                name: r.get(1)?,
                status: r.get(2)?,
                status_type: r.get(3)?,
                url: r.get(4)?,
                due_date: r.get(5)?,
                list_name: r.get(6)?,
            })
        })?;
        rows.collect()
    }

    pub fn stale_ticket_ids(
        &self,
        from: i64,
        to: i64,
        older_than: i64,
        limit: usize,
    ) -> StoreResult<Vec<String>> {
        let ids = self.ticket_ids_in_range(from, to)?;
        let mut stale = Vec::new();
        for id in ids {
            let fetched_at: Option<i64> = self
                .conn
                .query_row(
                    "SELECT fetched_at FROM tickets WHERE id = ?1",
                    params![id],
                    |r| r.get(0),
                )
                .optional()?;
            let is_stale = match fetched_at {
                None => true,
                Some(f) => f < older_than,
            };
            if is_stale {
                stale.push(id);
                if stale.len() >= limit {
                    break;
                }
            }
        }
        Ok(stale)
    }

    pub fn replace_open_tasks(&self, tasks: &[OpenTask], fetched_at: i64) -> StoreResult<()> {
        let tx = self.conn.unchecked_transaction()?;
        tx.execute("DELETE FROM open_tasks", [])?;
        {
            let mut stmt = tx.prepare(
                "INSERT INTO open_tasks (id, name, status, url, due_date, priority, list_name, fetched_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            )?;
            for t in tasks {
                stmt.execute(params![
                    t.id,
                    t.name,
                    t.status,
                    t.url,
                    t.due_date,
                    t.priority,
                    t.list_name,
                    fetched_at,
                ])?;
            }
        }
        tx.commit()?;
        Ok(())
    }

    pub fn open_tasks(&self) -> StoreResult<Vec<OpenTask>> {
        let mut stmt = self.conn.prepare(
            "SELECT id, name, status, url, due_date, priority, list_name FROM open_tasks
             ORDER BY due_date IS NULL, due_date, name",
        )?;
        let rows = stmt.query_map([], |r| {
            Ok(OpenTask {
                id: r.get(0)?,
                name: r.get(1)?,
                status: r.get(2)?,
                url: r.get(3)?,
                due_date: r.get(4)?,
                priority: r.get(5)?,
                list_name: r.get(6)?,
            })
        })?;
        rows.collect()
    }

    pub fn ticket_ids_in_range(&self, from: i64, to: i64) -> StoreResult<Vec<String>> {
        let mut stmt = self.conn.prepare(
            "SELECT ticket_ids FROM events WHERE ts >= ?1 AND ts < ?2 AND ticket_ids != ''",
        )?;
        let rows = stmt.query_map(params![from, to], |r| r.get::<_, String>(0))?;
        let mut ids: Vec<String> = Vec::new();
        let mut seen: BTreeSet<String> = BTreeSet::new();
        for row in rows {
            let raw = row?;
            for id in split_ticket_ids(&raw) {
                if seen.insert(id.clone()) {
                    ids.push(id);
                }
            }
        }
        Ok(ids)
    }
}

fn split_ticket_ids(raw: &str) -> Vec<String> {
    if raw.is_empty() {
        Vec::new()
    } else {
        raw.split(',').map(|s| s.to_string()).collect()
    }
}

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
    #[test]
    fn query_echoue_si_le_kind_en_base_est_inconnu() {
        let s = Store::open_in_memory().unwrap();
        s.conn
            .execute(
                "INSERT INTO events (ts, kind, workspace_dir, branch, title, body, ticket_ids, source_ref)
                 VALUES (?1, 'inconnu', '/a', 'master', 't', NULL, '', 'x')",
                params![T0],
            )
            .unwrap();
        assert!(s.query(T0, T0 + 1, None).is_err());
    }
}
