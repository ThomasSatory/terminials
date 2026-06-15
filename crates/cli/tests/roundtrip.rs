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
