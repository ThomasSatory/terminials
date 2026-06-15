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
