//! Serveur de contrôle sur socket Unix (JSON-par-ligne), piloté par la CLI `terminials`.

use std::path::{Path, PathBuf};

use protocol::{Request, Response};
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// Chemin du socket : `$XDG_RUNTIME_DIR/terminials.sock`, sinon /tmp.
pub fn socket_path() -> PathBuf {
    match std::env::var("XDG_RUNTIME_DIR") {
        Ok(dir) if !dir.is_empty() => PathBuf::from(dir).join("terminials.sock"),
        _ => PathBuf::from("/tmp/terminials.sock"),
    }
}

/// Vrai si une instance écoute déjà (connexion réussie). Sinon, nettoie un socket mort.
/// À appeler avant bind().
pub async fn instance_already_running(path: &Path) -> bool {
    if tokio::net::UnixStream::connect(path).await.is_ok() {
        return true;
    }
    let _ = std::fs::remove_file(path); // socket mort d'un crash précédent
    false
}

/// Démarre le serveur socket. À lancer dans le setup hook via async_runtime::spawn.
pub async fn serve(app: AppHandle) -> std::io::Result<()> {
    let path = socket_path();
    if instance_already_running(&path).await {
        return Ok(()); // une autre instance tourne déjà
    }
    let listener = tokio::net::UnixListener::bind(&path)?;
    // Seul le propriétaire peut se connecter (défensif, surtout sur le repli /tmp).
    use std::os::unix::fs::PermissionsExt;
    let _ = std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600));
    loop {
        let (stream, _) = listener.accept().await?;
        let app = app.clone();
        tokio::spawn(async move {
            let (read_half, mut write_half) = stream.into_split();
            let mut lines = BufReader::new(read_half).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let resp = match serde_json::from_str::<Request>(&line) {
                    Ok(req) => dispatch(&app, req),
                    Err(e) => Response::err(format!("requête invalide: {e}")),
                };
                let mut out = serde_json::to_string(&resp).unwrap_or_else(|_| "{}".into());
                out.push('\n');
                if write_half.write_all(out.as_bytes()).await.is_err() {
                    break;
                }
            }
        });
    }
}

/// Traduit une requête en effet sur l'app. La plupart des méthodes émettent un event vers le front.
fn dispatch(app: &AppHandle, req: Request) -> Response {
    match req.method.as_str() {
        "ping" => Response::ok(serde_json::json!({"pong": true})),
        "capabilities" => Response::ok(serde_json::json!({
            "methods": ["ping","capabilities","notify","new-workspace","set-status","set-progress"]
        })),
        "notify" => {
            let title = req.params.get("title").and_then(|v| v.as_str()).unwrap_or("terminials");
            let body = req.params.get("body").and_then(|v| v.as_str()).unwrap_or("");
            crate::notify::fire(app, title, body);
            let _ = app.emit("socket-command", &req);
            Response::ok(serde_json::Value::Null)
        }
        "new-workspace" | "set-status" | "set-progress" => {
            let _ = app.emit("socket-command", &req);
            Response::ok(serde_json::Value::Null)
        }
        other => Response::err(format!("méthode inconnue: {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn socket_path_resolution() {
        std::env::set_var("XDG_RUNTIME_DIR", "/run/user/1000");
        assert_eq!(socket_path(), std::path::PathBuf::from("/run/user/1000/terminials.sock"));
        std::env::remove_var("XDG_RUNTIME_DIR");
        assert_eq!(socket_path(), std::path::PathBuf::from("/tmp/terminials.sock"));
    }
}
