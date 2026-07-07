use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use protocol::{Request, Response};

pub mod hooks;

/// Chemin du socket de contrôle de l'app. `$XDG_RUNTIME_DIR/terminials.sock`, sinon /tmp.
pub fn socket_path() -> std::path::PathBuf {
    match std::env::var("XDG_RUNTIME_DIR") {
        Ok(d) if !d.is_empty() => std::path::PathBuf::from(d).join("terminials.sock"),
        _ => std::path::PathBuf::from("/tmp/terminials.sock"),
    }
}

/// Ouvre le socket, envoie une requête JSON-par-ligne, lit et désérialise la réponse.
pub fn send_request(path: &Path, method: &str, params: serde_json::Value) -> std::io::Result<Response> {
    let mut stream = UnixStream::connect(path)?;
    let req = Request { method: method.to_string(), params };
    let mut line = serde_json::to_string(&req).unwrap();
    line.push('\n');
    stream.write_all(line.as_bytes())?;
    let mut reader = BufReader::new(stream);
    let mut resp_line = String::new();
    reader.read_line(&mut resp_line)?;
    serde_json::from_str(&resp_line).map_err(std::io::Error::other)
}

/// Ajoute `workspaceId` aux params si TERMINIALS_WORKSPACE_ID est présent dans l'env
/// (shell lancé par l'app terminials) : le front route alors la commande vers le
/// workspace émetteur au lieu du workspace actif.
pub fn with_workspace_id(mut params: serde_json::Value) -> serde_json::Value {
    if let Ok(ws) = std::env::var("TERMINIALS_WORKSPACE_ID") {
        if !ws.is_empty() {
            if let Some(obj) = params.as_object_mut() {
                obj.insert("workspaceId".to_string(), serde_json::Value::String(ws));
            }
        }
    }
    params
}

#[cfg(test)]
mod tests {
    use super::*;

    // Un seul test manipule TERMINIALS_WORKSPACE_ID (set + remove dans le même test) :
    // pas de course avec les autres tests du binaire, exécutés en parallèle.
    #[test]
    fn with_workspace_id_joins_env_var_when_present() {
        std::env::remove_var("TERMINIALS_WORKSPACE_ID");
        let p = with_workspace_id(serde_json::json!({"title": "t"}));
        assert_eq!(p.get("workspaceId"), None);

        std::env::set_var("TERMINIALS_WORKSPACE_ID", "ws-42");
        let p = with_workspace_id(serde_json::json!({"title": "t"}));
        assert_eq!(p.get("workspaceId").and_then(|v| v.as_str()), Some("ws-42"));
        std::env::remove_var("TERMINIALS_WORKSPACE_ID");
    }
}
