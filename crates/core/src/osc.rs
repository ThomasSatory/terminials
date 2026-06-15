//! Parser des séquences de notification OSC 9 / 99 / 777 dans un flux d'octets PTY.

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OscNotification {
    pub title: String,
    pub body: String,
}

/// Extrait les notifications OSC 9 / 99 / 777 d'un buffer d'octets PTY.
///
/// v1 : les séquences à cheval sur deux buffers (lectures successives) ne sont pas
/// recollées — acceptable pour des notifications courtes.
pub fn parse_notifications(buf: &[u8]) -> Vec<OscNotification> {
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < buf.len() {
        // début OSC : ESC ]
        if buf[i] == 0x1b && buf[i + 1] == b']' {
            let start = i + 2;
            // chercher le terminateur : BEL (0x07) ou ST (ESC \)
            let mut j = start;
            let mut end = None;
            let mut term_len = 0;
            while j < buf.len() {
                if buf[j] == 0x07 {
                    end = Some(j);
                    term_len = 1;
                    break;
                }
                if buf[j] == 0x1b && j + 1 < buf.len() && buf[j + 1] == b'\\' {
                    end = Some(j);
                    term_len = 2;
                    break;
                }
                j += 1;
            }
            if let Some(e) = end {
                let payload = String::from_utf8_lossy(&buf[start..e]).to_string();
                if let Some(n) = interpret(&payload) {
                    out.push(n);
                }
                i = e + term_len;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn interpret(payload: &str) -> Option<OscNotification> {
    // OSC 9 (iTerm2) : "9;<message>"
    if let Some(rest) = payload.strip_prefix("9;") {
        return Some(OscNotification { title: "terminials".into(), body: rest.to_string() });
    }
    // OSC 777 (RXVT) : "777;notify;<title>;<body>"
    if let Some(rest) = payload.strip_prefix("777;notify;") {
        let mut parts = rest.splitn(2, ';');
        let title = parts.next().unwrap_or("").to_string();
        let body = parts.next().unwrap_or("").to_string();
        return Some(OscNotification { title, body });
    }
    // OSC 99 (Kitty) : "99;<metadata>:p=title:<t>" ou ":p=body:<b>"
    if let Some(rest) = payload.strip_prefix("99;") {
        if let Some(idx) = rest.find("p=title:") {
            return Some(OscNotification { title: rest[idx + 8..].to_string(), body: String::new() });
        }
        if let Some(idx) = rest.find("p=body:") {
            return Some(OscNotification { title: String::new(), body: rest[idx + 7..].to_string() });
        }
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_osc9_iterm() {
        let input = b"\x1b]9;Task complete\x07";
        let n = parse_notifications(input);
        assert_eq!(n, vec![OscNotification { title: "terminials".into(), body: "Task complete".into() }]);
    }

    #[test]
    fn parses_osc777_rxvt() {
        let input = b"\x1b]777;notify;My Title;Message body\x07";
        let n = parse_notifications(input);
        assert_eq!(n, vec![OscNotification { title: "My Title".into(), body: "Message body".into() }]);
    }

    #[test]
    fn parses_osc99_kitty_title_and_body() {
        let input = b"\x1b]99;i=1:p=title:Build\x1b\\\x1b]99;i=1:p=body:Done\x1b\\";
        let n = parse_notifications(input);
        assert!(n.iter().any(|x| x.title == "Build"));
        assert!(n.iter().any(|x| x.body == "Done"));
    }

    #[test]
    fn ignores_non_notification_sequences() {
        let input = b"\x1b]0;some window title\x07normal text";
        assert!(parse_notifications(input).is_empty());
    }
}
