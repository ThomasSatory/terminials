//! Client LLM (OpenAI-compatible / Ollama / Claude CLI) pour la génération des synthèses.
use crate::activity::settings::{LlmProviderKind, LlmSettings};
use std::time::Duration;

#[derive(Debug, Clone, PartialEq)]
pub enum LlmError {
    Unauthorized,
    Http { status: u16, body: String },
    Network(String),
    Timeout,
    Malformed(String),
    Disabled,
}

impl std::fmt::Display for LlmError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            LlmError::Unauthorized => write!(f, "jeton LLM refusé (401/403)"),
            LlmError::Http { status, body } => write!(f, "HTTP {status} : {body}"),
            LlmError::Network(msg) => write!(f, "réseau : {msg}"),
            LlmError::Timeout => write!(f, "délai dépassé"),
            LlmError::Malformed(msg) => write!(f, "réponse inattendue : {msg}"),
            LlmError::Disabled => write!(f, "fournisseur désactivé"),
        }
    }
}

impl std::error::Error for LlmError {}

/// Requête indépendante du fournisseur : message système + message utilisateur.
pub struct LlmRequest {
    pub system: String,
    pub user: String,
    pub max_tokens: u32,
    pub temperature: f32,
}

pub trait LlmProvider: Send + Sync {
    fn name(&self) -> String;
    fn complete(&self, req: &LlmRequest) -> Result<String, LlmError>;
}

pub struct OpenAiCompatible {
    pub base_url: String,
    pub model: String,
    pub token: String,
    pub extra_headers: Vec<(String, String)>,
    pub timeout: Duration,
}

pub struct Ollama {
    pub base_url: String,
    pub model: String,
    pub timeout: Duration,
}

/// Fournisseur basé sur le binaire `claude` en mode non interactif (`claude -p`).
///
/// `binary` permet de pointer vers un exécutable arbitraire (par défaut `"claude"`,
/// résolu via `PATH`) — utile pour les tests, qui évitent ainsi de manipuler la
/// variable d'environnement `PATH` partagée par tout le process de test.
pub struct ClaudeCli {
    pub model: String,
    pub timeout: Duration,
    pub binary: String,
}

fn agent(timeout: Duration) -> ureq::Agent {
    ureq::Agent::new_with_config(
        ureq::Agent::config_builder()
            .http_status_as_error(false)
            .timeout_global(Some(timeout))
            .build(),
    )
}

fn post_json(
    agent: &ureq::Agent,
    url: &str,
    headers: &[(String, String)],
    body: &serde_json::Value,
) -> Result<(u16, String), LlmError> {
    let mut req = agent.post(url).header("Content-Type", "application/json");
    for (k, v) in headers {
        req = req.header(k.as_str(), v.as_str());
    }
    // Sérialisation compacte explicite : `send_json` d'ureq 3 utilise
    // `to_vec_pretty`, ce qui gonfle inutilement chaque requête sur le réseau.
    let bytes = serde_json::to_vec(body).map_err(|e| LlmError::Network(e.to_string()))?;
    let mut resp = req.send(bytes.as_slice()).map_err(|e| match e {
        ureq::Error::Timeout(_) => LlmError::Timeout,
        other => LlmError::Network(other.to_string()),
    })?;
    let status = resp.status().as_u16();
    let text = resp
        .body_mut()
        .read_to_string()
        .map_err(|e| LlmError::Network(e.to_string()))?;
    Ok((status, text))
}

/// Traduit un couple (status, corps) en `Ok`/`Err`, `extract` isolant le contenu
/// textuel propre à chaque API (`choices[0].message.content` pour OpenAI,
/// `message.content` pour Ollama).
fn interpret(status: u16, text: String, extract: impl Fn(&serde_json::Value) -> Option<String>) -> Result<String, LlmError> {
    if status == 401 || status == 403 {
        return Err(LlmError::Unauthorized);
    }
    if !(200..300).contains(&status) {
        return Err(LlmError::Http { status, body: text.chars().take(500).collect() });
    }
    let value: serde_json::Value = serde_json::from_str(&text).map_err(|e| LlmError::Malformed(e.to_string()))?;
    extract(&value).ok_or_else(|| LlmError::Malformed(format!("contenu introuvable dans : {}", text.chars().take(200).collect::<String>())))
}

/// Corps JSON envoyé à une API OpenAI-compatible (`/v1/chat/completions`). Pur : testable sans réseau.
pub fn openai_body(model: &str, req: &LlmRequest) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "temperature": req.temperature,
        "max_tokens": req.max_tokens,
        "messages": [
            {"role": "system", "content": req.system},
            {"role": "user", "content": req.user},
        ],
    })
}

/// Corps JSON envoyé à l'API Ollama (`/api/chat`). Pur : testable sans réseau.
pub fn ollama_body(model: &str, req: &LlmRequest) -> serde_json::Value {
    serde_json::json!({
        "model": model,
        "stream": false,
        "messages": [
            {"role": "system", "content": req.system},
            {"role": "user", "content": req.user},
        ],
        "options": {
            "temperature": req.temperature,
            "num_predict": req.max_tokens,
        },
    })
}

impl LlmProvider for OpenAiCompatible {
    fn name(&self) -> String {
        format!("openai:{}", self.model)
    }

    fn complete(&self, req: &LlmRequest) -> Result<String, LlmError> {
        let a = agent(self.timeout);
        let mut headers = self.extra_headers.clone();
        if !self.token.is_empty() {
            headers.push(("Authorization".to_string(), format!("Bearer {}", self.token)));
        }
        let url = format!("{}/v1/chat/completions", self.base_url.trim_end_matches('/'));
        let body = openai_body(&self.model, req);
        let (status, text) = post_json(&a, &url, &headers, &body)?;
        interpret(status, text, |v| v["choices"][0]["message"]["content"].as_str().map(str::to_string))
    }
}

impl LlmProvider for Ollama {
    fn name(&self) -> String {
        format!("ollama:{}", self.model)
    }

    fn complete(&self, req: &LlmRequest) -> Result<String, LlmError> {
        let a = agent(self.timeout);
        let url = format!("{}/api/chat", self.base_url.trim_end_matches('/'));
        let body = ollama_body(&self.model, req);
        let (status, text) = post_json(&a, &url, &[], &body)?;
        interpret(status, text, |v| v["message"]["content"].as_str().map(str::to_string))
    }
}

impl LlmProvider for ClaudeCli {
    fn name(&self) -> String {
        format!("claude-cli:{}", self.model)
    }

    fn complete(&self, req: &LlmRequest) -> Result<String, LlmError> {
        use std::io::Write;
        use std::process::{Command, Stdio};

        let mut child = Command::new(&self.binary)
            .args(["-p", "--model", &self.model, "--output-format", "text"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .map_err(|e| LlmError::Network(e.to_string()))?;

        let input = format!("{}\n\n---\n\n{}", req.system, req.user);
        if let Some(mut stdin) = child.stdin.take() {
            // Écrit dans un thread séparé : le process peut remplir son tube stdout
            // avant que nous ayons fini d'écrire, ce qui bloquerait sinon.
            std::thread::spawn(move || {
                let _ = stdin.write_all(input.as_bytes());
            });
        }
        let stdout_reader = child.stdout.take().map(|mut out| {
            std::thread::spawn(move || {
                use std::io::Read;
                let mut buf = String::new();
                let _ = out.read_to_string(&mut buf);
                buf
            })
        });
        let stderr_reader = child.stderr.take().map(|mut err| {
            std::thread::spawn(move || {
                use std::io::Read;
                let mut buf = String::new();
                let _ = err.read_to_string(&mut buf);
                buf
            })
        });

        let start = std::time::Instant::now();
        let status = loop {
            match child.try_wait() {
                Ok(Some(status)) => break status,
                Ok(None) => {
                    if start.elapsed() >= self.timeout {
                        let _ = child.kill();
                        let _ = child.wait();
                        return Err(LlmError::Timeout);
                    }
                    std::thread::sleep(Duration::from_millis(100));
                }
                Err(e) => return Err(LlmError::Network(e.to_string())),
            }
        };

        let stdout = stdout_reader.and_then(|h| h.join().ok()).unwrap_or_default();
        let stderr = stderr_reader.and_then(|h| h.join().ok()).unwrap_or_default();

        if !status.success() {
            let code = status.code().unwrap_or(-1);
            return Err(LlmError::Http {
                status: code.max(0) as u16,
                body: stderr.chars().take(500).collect(),
            });
        }
        Ok(stdout.trim().to_string())
    }
}

/// Construit le fournisseur configuré par l'utilisateur. `extra_headers` (BTreeMap
/// dans les réglages) est converti en `Vec` ordonné, le délai global est de 120 s
/// et un jeton vide est autorisé (l'API cible peut ne pas en exiger).
pub fn from_settings(s: &LlmSettings) -> Box<dyn LlmProvider> {
    let timeout = Duration::from_secs(120);
    match s.provider {
        LlmProviderKind::Openai => Box::new(OpenAiCompatible {
            base_url: s.base_url.clone(),
            model: s.model.clone(),
            token: s.token.clone(),
            extra_headers: s.extra_headers.iter().map(|(k, v)| (k.clone(), v.clone())).collect(),
            timeout,
        }),
        LlmProviderKind::Ollama => Box::new(Ollama {
            base_url: s.base_url.clone(),
            model: s.model.clone(),
            timeout,
        }),
        LlmProviderKind::ClaudeCli => Box::new(ClaudeCli {
            model: s.model.clone(),
            timeout,
            binary: "claude".to_string(),
        }),
    }
}

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
                    let len: usize = text
                        .lines()
                        .find_map(|l| l.strip_prefix("Content-Length: "))
                        .or_else(|| text.lines().find_map(|l| l.strip_prefix("content-length: ")))
                        .and_then(|v| v.trim().parse().ok())
                        .unwrap_or(0);
                    if buf.len() >= idx + 4 + len {
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            tx.send(String::from_utf8_lossy(&buf).to_string()).unwrap();
            let resp = format!(
                "HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                body.len()
            );
            s.write_all(resp.as_bytes()).unwrap();
        });
        (format!("http://127.0.0.1:{port}"), rx)
    }
    fn req() -> LlmRequest {
        LlmRequest { system: "sys".into(), user: "bonjour".into(), max_tokens: 50, temperature: 0.2 }
    }

    #[test]
    fn openai_envoie_en_tetes_et_corps_et_lit_le_contenu() {
        let (url, rx) = stub("200 OK", r#"{"choices":[{"message":{"role":"assistant","content":"salut"}}]}"#);
        let p = OpenAiCompatible {
            base_url: url,
            model: "google/gemma-4-31B-it".into(),
            token: "tok".into(),
            extra_headers: vec![("x-env".into(), "dev".into())],
            timeout: std::time::Duration::from_secs(5),
        };
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
        // On évite de manipuler `PATH` (variable globale au process, partagée par
        // tous les tests exécutés en parallèle) : `binary` pointe directement vers
        // un chemin inexistant, ce qui reproduit le même échec de spawn.
        let p = ClaudeCli { model: "sonnet".into(), timeout: std::time::Duration::from_secs(2), binary: "/nonexistent/claude".into() };
        assert!(matches!(p.complete(&req()), Err(LlmError::Network(_))));
    }
    #[test]
    fn from_settings_choisit_le_bon_fournisseur() {
        let mut s = crate::activity::settings::LlmSettings::default();
        assert_eq!(from_settings(&s).name(), "openai:google/gemma-4-31B-it");
        s.provider = crate::activity::settings::LlmProviderKind::ClaudeCli;
        s.model = "sonnet".into();
        assert_eq!(from_settings(&s).name(), "claude-cli:sonnet");
    }
}
