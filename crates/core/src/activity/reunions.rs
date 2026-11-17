//! Réunions relevées dans l'agenda Outlook, par le MCP Microsoft 365 de Claude Code.
//!
//! Un `claude -p` liste les événements de l'agenda sur la fenêtre demandée et les
//! recopie tels quels ; le tri se fait ici : ni journée entière, ni annulé, ni
//! marqué « libre » (refusé, simple information). Les heures arrivent en heure
//! murale du fuseau de la boîte aux lettres, prise pour l'heure locale du poste
//! (ou en UTC quand Outlook n'en a pas).
//!
//! Chaque relevé remplace les réunions de sa fenêtre : une réunion déplacée ou
//! annulée depuis le relevé précédent disparaît. La saisie des temps place ces
//! réunions, une fois finies, à leur heure sur l'US de réunion (cf.
//! `src/lib/tempsSaisie.ts`).

use std::time::Duration;

use chrono::{Local, NaiveDate, NaiveDateTime, TimeZone, Utc};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::activity::providers::claude_process::{run_claude_p, ClaudeProcessError};
use crate::activity::providers::clickup::extraire_json;
use crate::activity::store::Store;

/// Délai d'un `claude -p` de relevé.
const DELAI_REUNIONS: Duration = Duration::from_secs(300);

/// Curseur du relevé : jour (« AAAA-MM-JJ ») du dernier relevé réussi.
pub const CURSEUR_REUNIONS: &str = "reunions_agenda";
/// Profondeur du premier relevé.
const PREMIER_RELEVE_JOURS: i64 = 14;

/// Arguments de `claude -p` : Sonnet, et seulement la recherche dans l'agenda.
pub const ARGS_REUNIONS: [&str; 7] = [
    "-p",
    "--output-format",
    "text",
    "--model",
    "sonnet",
    "--allowedTools",
    "mcp__claude_ai_Microsoft_365__outlook_calendar_search",
];

/// Une réunion de l'agenda. Bornes en epoch secondes.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Reunion {
    /// Identifiant de l'événement Outlook : clé d'idempotence.
    pub id: String,
    pub titre: String,
    pub debut: i64,
    pub fin: i64,
}

/// Prompt envoyé sur stdin, bornes incluses. Pur.
pub fn prompt_reunions(depuis: NaiveDate, jusqu: NaiveDate) -> String {
    format!(
        "Tu as accès à l'outil MCP outlook_calendar_search. Réponds UNIQUEMENT avec un \
objet JSON, sans texte autour ni balises markdown.\n\n\
Liste tous les événements de mon agenda Outlook entre le {depuis} et le {jusqu} inclus : \
query \"*\", afterDateTime \"{depuis}\", beforeDateTime \"{lendemain}\", limit 25, \
order \"oldest\", en suivant nextOffset jusqu'à la dernière page.\n\n\
Recopie chaque événement tel quel, sans en écarter aucun. Forme exacte :\n\
{{\"evenements\":[{{\"id\":\"…\",\"titre\":subject,\"debut\":start.dateTime,\"fin\":end.dateTime,\
\"timeZone\":start.timeZone,\"isAllDay\":…,\"isCancelled\":…,\"showAs\":\"…\"}}]}}\n\
`{{\"evenements\":[]}}` s'il n'y en a aucun.",
        depuis = depuis.format("%Y-%m-%d"),
        jusqu = jusqu.format("%Y-%m-%d"),
        lendemain = jusqu.succ_opt().unwrap_or(jusqu).format("%Y-%m-%d"),
    )
}

/// « 2026-10-13T14:00:00.0000000 » dans `fuseau` → epoch s. Heure locale du
/// poste, sauf UTC. Pur (au fuseau du poste près).
fn instant(date_heure: &str, fuseau: &str) -> Option<i64> {
    let naive = NaiveDateTime::parse_from_str(date_heure, "%Y-%m-%dT%H:%M:%S%.f").ok()?;
    if fuseau.eq_ignore_ascii_case("UTC") {
        Some(Utc.from_utc_datetime(&naive).timestamp())
    } else {
        Local
            .from_local_datetime(&naive)
            .earliest()
            .map(|d| d.timestamp())
    }
}

/// Lit la réponse du modèle et ne garde que les vraies réunions : ni journée
/// entière, ni annulée, ni « libre », de durée entre 1 s et 12 h. Une sortie
/// sans JSON est une erreur. Pur (au fuseau du poste près).
pub fn parse_reunions(sortie: &str) -> Result<Vec<Reunion>, String> {
    let brut = extraire_json(sortie).ok_or_else(|| {
        format!(
            "aucun objet JSON dans : {}",
            sortie.chars().take(200).collect::<String>()
        )
    })?;
    let v: Value = serde_json::from_str(brut)
        .map_err(|e| format!("{e} dans : {}", brut.chars().take(200).collect::<String>()))?;
    Ok(v["evenements"]
        .as_array()
        .map(|a| {
            a.iter()
                .filter(|e| {
                    !e["isAllDay"].as_bool().unwrap_or(false)
                        && !e["isCancelled"].as_bool().unwrap_or(false)
                        && e["showAs"].as_str() != Some("free")
                })
                .filter_map(|e| {
                    let fuseau = e["timeZone"].as_str().unwrap_or("");
                    let debut = instant(e["debut"].as_str()?, fuseau)?;
                    let fin = instant(e["fin"].as_str()?, fuseau)?;
                    (1..=12 * 3600).contains(&(fin - debut)).then(|| Reunion {
                        id: e["id"].as_str().unwrap_or_default().to_string(),
                        titre: e["titre"].as_str().unwrap_or("Réunion").trim().to_string(),
                        debut,
                        fin,
                    })
                })
                .filter(|r| !r.id.is_empty())
                .collect()
        })
        .unwrap_or_default())
}

/// Relève les réunions par `claude -p` + MCP Microsoft 365.
pub fn relever(binary: &str, depuis: NaiveDate, jusqu: NaiveDate) -> Result<Vec<Reunion>, String> {
    let sortie = run_claude_p(
        binary,
        &ARGS_REUNIONS,
        &prompt_reunions(depuis, jusqu),
        DELAI_REUNIONS,
    )
    .map_err(|e| match e {
        ClaudeProcessError::Spawn(msg) => format!("claude introuvable : {msg}"),
        ClaudeProcessError::Timeout => "claude -p : délai dépassé".to_string(),
        ClaudeProcessError::Failed { code, stderr } => {
            format!("claude -p a échoué ({code}) : {stderr}")
        }
    })?;
    parse_reunions(&sortie)
}

/// Dates (incluses) du relevé : depuis la veille du dernier relevé réussi — une
/// réunion de la veille a pu bouger —, sinon deux semaines.
pub fn fenetre(store: &Store, aujourd_hui: NaiveDate) -> Result<(NaiveDate, NaiveDate), String> {
    let dernier = store
        .get_cursor(CURSEUR_REUNIONS)
        .map_err(|e| e.to_string())?
        .and_then(|v| NaiveDate::parse_from_str(&v, "%Y-%m-%d").ok());
    let depuis = match dernier {
        Some(d) => d.pred_opt().unwrap_or(d).min(aujourd_hui),
        None => aujourd_hui - chrono::Duration::days(PREMIER_RELEVE_JOURS),
    };
    Ok((depuis, aujourd_hui))
}

/// Minuit local de `jour`, en epoch s.
fn minuit(jour: NaiveDate) -> i64 {
    let naive = jour.and_hms_opt(0, 0, 0).expect("minuit existe");
    Local
        .from_local_datetime(&naive)
        .earliest()
        .map_or_else(|| naive.and_utc().timestamp(), |d| d.timestamp())
}

/// Enregistre un relevé réussi : les réunions de la fenêtre [depuis, jusqu]
/// remplacent celles déjà connues, puis le curseur avance.
pub fn appliquer(
    store: &Store,
    reunions: &[Reunion],
    depuis: NaiveDate,
    jusqu: NaiveDate,
) -> Result<usize, String> {
    let fin = jusqu.succ_opt().unwrap_or(jusqu);
    store
        .remplacer_reunions(minuit(depuis), minuit(fin), reunions)
        .map_err(|e| e.to_string())?;
    store
        .set_cursor(CURSEUR_REUNIONS, &jusqu.format("%Y-%m-%d").to_string())
        .map_err(|e| e.to_string())?;
    Ok(reunions.len())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(id: &str, debut: &str, fin: &str) -> String {
        format!(
            r#"{{"id":"{id}","titre":" Point ","debut":"{debut}","fin":"{fin}","timeZone":"UTC","isAllDay":false,"isCancelled":false,"showAs":"busy"}}"#
        )
    }

    #[test]
    fn evenements_tries_et_heures_lues() {
        let sortie = format!(
            "```json\n{{\"evenements\":[{},{},{},{},{}]}}\n```",
            ev(
                "a",
                "2026-10-13T14:00:00.0000000",
                "2026-10-13T16:00:00.0000000"
            ),
            ev("b", "2026-10-13T00:00:00", "2026-10-14T00:00:00")
                .replace(r#""isAllDay":false"#, r#""isAllDay":true"#),
            ev("c", "2026-10-13T10:00:00", "2026-10-13T11:00:00")
                .replace(r#""isCancelled":false"#, r#""isCancelled":true"#),
            ev("d", "2026-10-13T10:00:00", "2026-10-13T11:00:00").replace("busy", "free"),
            ev("e", "2026-10-13T10:00:00", "illisible"),
        );
        let r = parse_reunions(&sortie).unwrap();
        let debut = Utc
            .with_ymd_and_hms(2026, 10, 13, 14, 0, 0)
            .unwrap()
            .timestamp();
        assert_eq!(
            r,
            vec![Reunion {
                id: "a".into(),
                titre: "Point".into(),
                debut,
                fin: debut + 7200
            }]
        );
        assert!(parse_reunions("rien").is_err());
    }

    #[test]
    fn heure_murale_hors_utc_prise_en_local() {
        let naive = NaiveDate::from_ymd_opt(2026, 10, 13)
            .unwrap()
            .and_hms_opt(14, 0, 0)
            .unwrap();
        let attendu = Local
            .from_local_datetime(&naive)
            .earliest()
            .unwrap()
            .timestamp();
        assert_eq!(
            instant("2026-10-13T14:00:00.0000000", "Romance Standard Time"),
            Some(attendu)
        );
    }

    #[test]
    fn prompt_borne_les_dates() {
        let p = prompt_reunions(
            NaiveDate::from_ymd_opt(2026, 10, 13).unwrap(),
            NaiveDate::from_ymd_opt(2026, 10, 15).unwrap(),
        );
        assert!(
            p.contains(r#"afterDateTime "2026-10-13", beforeDateTime "2026-10-16""#),
            "{p}"
        );
    }

    #[test]
    fn releve_remplace_la_fenetre_et_reprend_la_veille() {
        let store = Store::open_in_memory().unwrap();
        let j = |d: u32| NaiveDate::from_ymd_opt(2026, 10, d).unwrap();
        assert_eq!(fenetre(&store, j(15)).unwrap(), (j(1), j(15)));
        let r = |id: &str, jour: u32| Reunion {
            id: id.into(),
            titre: "Point".into(),
            debut: minuit(j(jour)) + 3600,
            fin: minuit(j(jour)) + 7200,
        };
        appliquer(&store, &[r("ancienne", 10), r("annulee", 13)], j(1), j(13)).unwrap();
        assert_eq!(fenetre(&store, j(15)).unwrap(), (j(12), j(15)));
        // Relevé du 12 au 15 : « annulee » a disparu de l'agenda, « ancienne » est hors fenêtre.
        assert_eq!(
            appliquer(&store, &[r("nouvelle", 14)], j(12), j(15)).unwrap(),
            1
        );
        let ids: Vec<String> = store
            .reunions(0, i64::MAX)
            .unwrap()
            .into_iter()
            .map(|r| r.id)
            .collect();
        assert_eq!(ids, vec!["ancienne", "nouvelle"]);
    }
}
