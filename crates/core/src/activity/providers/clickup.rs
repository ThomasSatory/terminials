//! Client de l'API ClickUp (résolution des tickets).

use std::time::Duration;

use serde_json::Value;

use crate::activity::{OpenTask, TicketInfo};

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
        if status == 401 {
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

    pub fn task(&self, id: &str) -> Result<RawTask, ClickupError> {
        let agent = self.agent();
        let url = format!("{}/task/{}", self.base_url, id);
        let v = self.get_json(&agent, &url)?;
        RawTask::from_json(&v).ok_or_else(|| ClickupError::Malformed("tâche invalide".to_string()))
    }
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

    const TASK: &str = r#"{"id":"86c1abc","name":"Dashboard activité","status":{"status":"en cours","type":"custom"},
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

    #[test]
    fn raw_task_sans_due_date_ni_priorite() {
        let t = RawTask::from_json(&serde_json::json!({"id":"x","name":"n","status":{"status":"s","type":"open"},"date_updated":"5","url":"u","priority":null})).unwrap();
        assert_eq!(t.due_date_ms, None);
        assert_eq!(t.priority, None);
        assert_eq!(t.list_name, None);
    }
}
