use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::thread;

/// Lance un faux serveur qui répond "ok" à une ligne, puis vérifie que send_request
/// envoie bien une ligne JSON `method:"ping"` et lit/désérialise la réponse.
#[test]
fn cli_sends_jsonline_and_reads_response() {
    let dir = std::env::temp_dir();
    let path = dir.join(format!("terminials-test-{}.sock", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path).unwrap();

    let handle = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.contains("\"method\":\"ping\""), "ligne reçue: {line}");
        let mut w = stream;
        w.write_all(b"{\"status\":\"ok\",\"data\":{\"pong\":true}}\n").unwrap();
    });

    let resp = terminials_cli::send_request(&path, "ping", serde_json::Value::Null).unwrap();
    assert_eq!(resp.status, protocol::Status::Ok);
    assert_eq!(resp.data, serde_json::json!({"pong": true}));
    handle.join().unwrap();
    let _ = std::fs::remove_file(&path);
}

/// Lance le vrai binaire `terminials notify` avec TERMINIALS_WORKSPACE_ID dans son env
/// et XDG_RUNTIME_DIR pointé sur un dossier de test (socket_path() → <dir>/terminials.sock),
/// puis vérifie que la requête reçue par le faux serveur contient workspaceId.
#[test]
fn notify_binary_joins_workspace_id_from_env() {
    let dir = std::env::temp_dir().join(format!("terminials-xdg-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let listener = UnixListener::bind(dir.join("terminials.sock")).unwrap();

    let handle = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let mut w = stream;
        w.write_all(b"{\"status\":\"ok\"}\n").unwrap();
        line
    });

    let status = std::process::Command::new(env!("CARGO_BIN_EXE_terminials"))
        .args(["notify", "--title", "t", "--body", "b"])
        .env("XDG_RUNTIME_DIR", &dir)
        .env("TERMINIALS_WORKSPACE_ID", "ws-77")
        .status()
        .unwrap();
    assert!(status.success());

    let line = handle.join().unwrap();
    assert!(line.contains("\"workspaceId\":\"ws-77\""), "ligne reçue: {line}");
    let _ = std::fs::remove_dir_all(&dir);
}
