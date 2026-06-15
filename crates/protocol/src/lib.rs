use serde::{Deserialize, Serialize};

/// Une requête envoyée par la CLI vers l'app via le socket. Une par ligne.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    Error,
}

/// Réponse renvoyée par l'app. Une par ligne.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub status: Status,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub data: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn ok(data: serde_json::Value) -> Self {
        Self { status: Status::Ok, data, error: None }
    }
    pub fn err(msg: impl Into<String>) -> Self {
        Self { status: Status::Error, data: serde_json::Value::Null, error: Some(msg.into()) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_roundtrip_jsonline() {
        let req = Request { method: "notify".into(), params: serde_json::json!({"title":"t","body":"b"}) };
        let line = serde_json::to_string(&req).unwrap();
        assert!(!line.contains('\n'), "une requête sérialisée ne doit pas contenir de newline");
        let back: Request = serde_json::from_str(&line).unwrap();
        assert_eq!(back.method, "notify");
    }

    #[test]
    fn response_ok_and_err() {
        let ok = Response::ok(serde_json::json!({"id": 1}));
        let err = Response::err("boom");
        assert!(matches!(ok.status, Status::Ok));
        assert!(matches!(err.status, Status::Error));
        assert_eq!(err.error.as_deref(), Some("boom"));
    }
}
