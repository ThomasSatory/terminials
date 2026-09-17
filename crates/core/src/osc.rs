//! Parser des séquences de notification OSC 9 / 99 / 777 et des marqueurs de
//! commande OSC 133 (C = pré-exécution, D = fin) dans un flux d'octets PTY.

use base64::prelude::{Engine as _, BASE64_STANDARD};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OscNotification {
    pub title: String,
    pub body: String,
}

/// Événement produit par le scanner OSC : notification ou marqueur de commande shell (OSC 133).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum OscEvent {
    Notification(OscNotification),
    Command { cmd: String, pwd: String },
    Exit { code: i32 },
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

/// Scanner OSC à état, robuste aux séquences réparties sur plusieurs lectures PTY.
/// Conserve l'état entre les appels à `feed`, contrairement à `parse_notifications`.
#[derive(Default)]
pub struct OscScanner {
    in_osc: bool,
    esc: bool,           // hors OSC : ESC vu, on attend ']'
    saw_esc_in_osc: bool, // dans OSC : ESC vu, on attend '\' (terminateur ST)
    payload: Vec<u8>,
}

impl OscScanner {
    pub fn new() -> Self {
        Self::default()
    }

    /// Alimente le scanner avec un chunk d'octets ; retourne les notifications complètes trouvées.
    /// Reste l'API historique : filtre `feed_events` sur les seules notifications.
    pub fn feed(&mut self, bytes: &[u8]) -> Vec<OscNotification> {
        self.feed_events(bytes)
            .into_iter()
            .filter_map(|e| match e {
                OscEvent::Notification(n) => Some(n),
                _ => None,
            })
            .collect()
    }

    /// Alimente le scanner avec un chunk d'octets ; retourne tous les événements OSC
    /// complets trouvés (notifications et marqueurs de commande OSC 133).
    pub fn feed_events(&mut self, bytes: &[u8]) -> Vec<OscEvent> {
        let mut out = Vec::new();
        for &b in bytes {
            if !self.in_osc {
                if self.esc && b == b']' {
                    self.in_osc = true;
                    self.esc = false;
                    self.payload.clear();
                } else {
                    self.esc = b == 0x1b;
                }
                continue;
            }
            // Dans une séquence OSC.
            if self.saw_esc_in_osc {
                // ST = ESC '\' ; sinon séquence abandonnée.
                if b == b'\\' {
                    if let Some(e) = interpret_event(&String::from_utf8_lossy(&self.payload)) {
                        out.push(e);
                    }
                }
                self.reset_seq();
            } else if b == 0x07 {
                // BEL termine l'OSC.
                if let Some(e) = interpret_event(&String::from_utf8_lossy(&self.payload)) {
                    out.push(e);
                }
                self.reset_seq();
            } else if b == 0x1b {
                self.saw_esc_in_osc = true;
            } else {
                self.payload.push(b);
                // Borne anti-emballement sur entrée malformée (OSC jamais terminé).
                if self.payload.len() > 4096 {
                    self.reset_seq();
                }
            }
        }
        out
    }

    fn reset_seq(&mut self) {
        self.in_osc = false;
        self.saw_esc_in_osc = false;
        self.payload.clear();
    }
}

fn interpret(payload: &str) -> Option<OscNotification> {
    // OSC 9 (iTerm2) : "9;<message>". Le message peut contenir des ';' (ex. "Erreur; voir
    // logs") : c'est un texte libre, pas un format à sous-champs — tout le reste est le corps.
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

/// Interprète un payload OSC complet (sans le préfixe `ESC ]` ni le terminateur) : marqueur
/// de commande OSC 133 (`C;<b64 cmd>;<b64 pwd>` ou `D;<code>`), sinon délégué à `interpret`
/// et emballé en notification. Un payload 133 mal formé est ignoré silencieusement.
fn interpret_event(payload: &str) -> Option<OscEvent> {
    if let Some(rest) = payload.strip_prefix("133;") {
        let mut parts = rest.splitn(3, ';');
        return match parts.next() {
            Some("C") => {
                let b64_cmd = parts.next()?;
                let cmd_bytes = BASE64_STANDARD.decode(b64_cmd).ok()?;
                let cmd = String::from_utf8_lossy(&cmd_bytes).to_string();
                let pwd = match parts.next() {
                    Some(b64_pwd) if !b64_pwd.is_empty() => {
                        let pwd_bytes = BASE64_STANDARD.decode(b64_pwd).ok()?;
                        String::from_utf8_lossy(&pwd_bytes).to_string()
                    }
                    _ => String::new(),
                };
                Some(OscEvent::Command { cmd, pwd })
            }
            Some("D") => {
                let code = parts.next()?.parse::<i32>().ok()?;
                Some(OscEvent::Exit { code })
            }
            _ => None,
        };
    }
    interpret(payload).map(OscEvent::Notification)
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

    #[test]
    fn scanner_handles_sequence_split_across_chunks() {
        let mut sc = OscScanner::new();
        // La séquence OSC 777 est coupée en deux lectures.
        assert!(sc.feed(b"\x1b]777;notify;Titre").is_empty());
        let n = sc.feed(b";Corps\x07");
        assert_eq!(n, vec![OscNotification { title: "Titre".into(), body: "Corps".into() }]);
    }

    #[test]
    fn scanner_handles_st_terminator_and_multiple() {
        let mut sc = OscScanner::new();
        let n = sc.feed(b"bruit\x1b]9;A\x07plus\x1b]99;i=1:p=title:B\x1b\\fin");
        assert_eq!(n.len(), 2);
        assert_eq!(n[0].body, "A");
        assert_eq!(n[1].title, "B");
    }

    #[test]
    fn feed_events_decode_commande_et_sortie_base64() {
        // "npm test" / "/home/t" en base64 standard
        let seq = b"\x1b]133;C;bnBtIHRlc3Q=;L2hvbWUvdA==\x07sortie\x1b]133;D;0\x07";
        let mut sc = OscScanner::new();
        let ev = sc.feed_events(seq);
        assert_eq!(
            ev,
            vec![
                OscEvent::Command { cmd: "npm test".into(), pwd: "/home/t".into() },
                OscEvent::Exit { code: 0 },
            ]
        );
    }

    #[test]
    fn feed_events_sequence_133_fragmentee_et_notification_conservee() {
        let full = b"\x1b]133;D;130\x07\x1b]9;Claude Code;fini\x07";
        let mut sc = OscScanner::new();
        let mut ev = sc.feed_events(&full[..5]);
        ev.extend(sc.feed_events(&full[5..]));
        assert_eq!(ev.len(), 2);
        assert_eq!(ev[0], OscEvent::Exit { code: 130 });
        assert!(matches!(&ev[1], OscEvent::Notification(n) if n.body == "Claude Code;fini"));
        let mut sc2 = OscScanner::new();
        assert_eq!(sc2.feed(full).len(), 1, "feed reste l'API des notifications seules");
    }

    #[test]
    fn notification_osc9_conserve_le_point_virgule_dans_le_corps() {
        // Le corps d'une notification OSC 9 est du texte libre : un ';' interne (ex. une
        // phrase) ne doit pas être interprété comme un séparateur de sous-champs.
        let input = b"\x1b]9;Erreur; voir logs\x07";
        let n = parse_notifications(input);
        assert_eq!(n, vec![OscNotification { title: "terminials".into(), body: "Erreur; voir logs".into() }]);
    }

    #[test]
    fn feed_events_ignore_133_mal_forme() {
        let mut sc = OscScanner::new();
        assert!(sc
            .feed_events(b"\x1b]133;C;%%%pas-du-base64\x07\x1b]133;D;abc\x07\x1b]133;A\x07")
            .is_empty());
    }
}
