//! Repérage des identifiants de tickets ClickUp dans branches, sujets et corps (spec §3).
use regex::Regex;
use std::sync::OnceLock;

fn defaults() -> &'static [Regex] {
    static RE: OnceLock<Vec<Regex>> = OnceLock::new();
    RE.get_or_init(|| {
        vec![
            // Pas de `\b` en fin de motif : `\b` traite `_` comme un caractère de mot,
            // ce qui bloquerait la capture dans des branches comme `CU-86c1abc_dashboard`.
            // La frontière de fin est vérifiée manuellement dans `extract_ticket_ids`.
            Regex::new(r"(?i)\bCU-([a-z0-9]{6,12})").unwrap(),
            Regex::new(r"app\.clickup\.com/t/(?:\d+/)?([A-Za-z0-9-]+)").unwrap(),
            Regex::new(r"#([a-z0-9]{7,9})\b").unwrap(),
        ]
    })
}

fn is_clickup_like(id: &str) -> bool {
    id.chars().any(|c| c.is_ascii_digit()) && id.chars().any(|c| c.is_ascii_alphabetic())
}

/// Vrai si le caractère suivant la position `end` (s'il existe) n'est pas alphanumérique,
/// c.-à-d. que l'identifiant capturé n'est pas tronqué au milieu d'un jeton plus long.
fn not_followed_by_alnum(text: &str, end: usize) -> bool {
    text.as_bytes().get(end).map_or(true, |b| !b.is_ascii_alphanumeric())
}

/// Extrait les identifiants de tickets présents dans `texts` (branches, sujets, corps).
/// Motifs custom d'abord, puis motifs par défaut (`CU-…`, URL ClickUp, `#…`).
/// Déduplique en conservant l'ordre d'apparition ; ids ClickUp natifs en minuscules,
/// ids custom conservés tels quels.
pub fn extract_ticket_ids(texts: &[&str], custom_patterns: &[String]) -> Vec<String> {
    let custom: Vec<Regex> = custom_patterns.iter().filter_map(|p| Regex::new(p).ok()).collect();
    let mut out: Vec<String> = Vec::new();
    let mut push = |id: String| {
        if !out.contains(&id) {
            out.push(id);
        }
    };
    for text in texts {
        for re in &custom {
            for m in re.find_iter(text) {
                push(m.as_str().to_string());
            }
        }
        let [cu, url, hash] = [&defaults()[0], &defaults()[1], &defaults()[2]];
        for c in cu.captures_iter(text) {
            let g = c.get(1).unwrap();
            if not_followed_by_alnum(text, g.end()) {
                push(g.as_str().to_ascii_lowercase());
            }
        }
        for c in url.captures_iter(text) {
            let id = &c[1];
            // ID custom (ABC-42) conservé tel quel ; ID ClickUp natif en minuscules.
            push(if id.contains('-') { id.to_string() } else { id.to_ascii_lowercase() });
        }
        for c in hash.captures_iter(text) {
            if is_clickup_like(&c[1]) {
                push(c[1].to_ascii_lowercase());
            }
        }
    }
    out
}

/// Construit l'URL ClickUp d'un identifiant de ticket.
pub fn ticket_url(id: &str) -> String {
    format!("https://app.clickup.com/t/{id}")
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn cu_prefixe_dans_une_branche() {
        assert_eq!(extract_ticket_ids(&["feature/CU-86c1abc_dashboard"], &[]), vec!["86c1abc"]);
    }
    #[test]
    fn diese_avec_lettres_et_chiffres() {
        assert_eq!(extract_ticket_ids(&["fix: relance #86c1abcd"], &[]), vec!["86c1abcd"]);
        assert!(extract_ticket_ids(&["voir #1234567"], &[]).is_empty(), "chiffres seuls = numéro d'issue, pas ClickUp");
    }
    #[test]
    fn url_clickup_avec_ou_sans_team() {
        assert_eq!(extract_ticket_ids(&["https://app.clickup.com/t/86c1abc"], &[]), vec!["86c1abc"]);
        assert_eq!(extract_ticket_ids(&["https://app.clickup.com/t/9012/ABC-42"], &[]), vec!["ABC-42"]);
    }
    #[test]
    fn motif_custom_et_dedup() {
        let custom = vec![r"\bABC-\d+\b".to_string()];
        assert_eq!(extract_ticket_ids(&["ABC-1234 puis ABC-1234", "CU-86c1abc"], &custom), vec!["ABC-1234", "86c1abc"]);
    }
    #[test]
    fn aucun_faux_positif_sur_un_sha() {
        assert!(extract_ticket_ids(&["Revert 3be757f4 (see 0c71fca)"], &[]).is_empty());
    }
    #[test]
    fn motif_custom_invalide_ignore() {
        assert_eq!(extract_ticket_ids(&["CU-abc1234"], &["(".to_string()]), vec!["abc1234"]);
    }
    #[test]
    fn url_construite() {
        assert_eq!(ticket_url("86c1abc"), "https://app.clickup.com/t/86c1abc");
    }
}
