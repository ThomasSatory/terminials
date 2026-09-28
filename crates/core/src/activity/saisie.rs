//! Saisie des temps dans ClickUp depuis le dashboard (« Temps à saisir »).
//!
//! Même voie que la collecte : `claude -p` avec le serveur MCP `clickup` de la
//! configuration Claude Code (pas de clé API à générer), limité au seul outil
//! d'ajout d'entrée de temps. Un appel pour tout un lot : « Tout saisir » ne
//! coûte pas plus qu'une ligne. Ce qui a été saisi est noté dans le store
//! (`Store::saisies_du_jour`) pour ne jamais saisir deux fois le même temps.

use std::time::Duration;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::activity::providers::claude_process::{run_claude_p, ClaudeProcessError};
use crate::activity::providers::clickup::extraire_json;

/// Délai d'un `claude -p` de saisie : quelques appels d'outil, pas de recherche.
const DELAI_SAISIE: Duration = Duration::from_secs(300);

/// Arguments de `claude -p` : Sonnet, et SEUL l'outil d'ajout de temps autorisé —
/// la saisie n'a rien à lire ni à modifier d'autre dans ClickUp.
pub const ARGS_SAISIE: [&str; 7] = [
    "-p",
    "--output-format",
    "text",
    "--model",
    "sonnet",
    "--allowedTools",
    "mcp__clickup__clickup_add_time_entry",
];

/// Une entrée à créer.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EntreeTemps {
    /// Identifiant de l'US (personnalisé « ABC-123 » ou natif).
    pub task_id: String,
    /// Début, heure locale « AAAA-MM-JJ HH:MM ».
    pub debut: String,
    pub minutes: u32,
}

/// Issue d'une entrée.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResultatSaisie {
    pub task_id: String,
    pub ok: bool,
    pub erreur: Option<String>,
}

/// « 1h 30m », « 45m » : le format de durée de l'outil MCP.
fn duree_mcp(minutes: u32) -> String {
    match (minutes / 60, minutes % 60) {
        (0, m) => format!("{m}m"),
        (h, 0) => format!("{h}h"),
        (h, m) => format!("{h}h {m}m"),
    }
}

/// Prompt envoyé sur stdin. Pur.
pub fn prompt_saisie(entrees: &[EntreeTemps]) -> String {
    let lignes: Vec<String> = entrees
        .iter()
        .map(|e| {
            format!(
                "- task_id \"{}\", start \"{}\", duration \"{}\"",
                e.task_id,
                e.debut,
                duree_mcp(e.minutes)
            )
        })
        .collect();
    format!(
        "Tu as accès à l'outil MCP ClickUp clickup_add_time_entry. Ajoute exactement \
les entrées de temps suivantes, une par ligne, avec ces valeurs telles quelles \
(les task_id sont des identifiants personnalisés ClickUp) :\n{}\n\n\
N'ajoute rien d'autre et ne réessaie pas une entrée en erreur. Réponds UNIQUEMENT \
avec un objet JSON, sans texte autour ni balises markdown :\n\
{{\"resultats\":[{{\"taskId\":\"…\",\"ok\":true ou false,\"erreur\":\"…\" ou null}}]}}\n\
avec un résultat par entrée, dans le même ordre.",
        lignes.join("\n")
    )
}

/// Lit la réponse du modèle. Une entrée absente de la réponse est comptée en
/// échec : mieux vaut la redemander que la croire saisie. Pur.
pub fn parse_resultats(sortie: &str, entrees: &[EntreeTemps]) -> Vec<ResultatSaisie> {
    let lus: Vec<ResultatSaisie> = extraire_json(sortie)
        .and_then(|j| serde_json::from_str::<Value>(j).ok())
        .and_then(|v| v["resultats"].as_array().cloned())
        .unwrap_or_default()
        .iter()
        .filter_map(|r| {
            Some(ResultatSaisie {
                task_id: r["taskId"].as_str()?.to_string(),
                ok: r["ok"].as_bool().unwrap_or(false),
                erreur: r["erreur"].as_str().map(str::to_string),
            })
        })
        .collect();
    entrees
        .iter()
        .map(|e| {
            lus.iter().find(|r| r.task_id == e.task_id).cloned().unwrap_or(ResultatSaisie {
                task_id: e.task_id.clone(),
                ok: false,
                erreur: Some(format!("pas de réponse pour cette entrée : {}", sortie.chars().take(160).collect::<String>())),
            })
        })
        .collect()
}

/// Crée les entrées par `claude -p`. Une erreur du processus fait échouer tout le lot.
pub fn saisir(binary: &str, entrees: &[EntreeTemps]) -> Result<Vec<ResultatSaisie>, String> {
    if entrees.is_empty() {
        return Ok(Vec::new());
    }
    let sortie = run_claude_p(binary, &ARGS_SAISIE, &prompt_saisie(entrees), DELAI_SAISIE).map_err(|e| match e {
        ClaudeProcessError::Spawn(msg) => format!("claude introuvable : {msg}"),
        ClaudeProcessError::Timeout => "claude -p : délai dépassé".to_string(),
        ClaudeProcessError::Failed { code, stderr } => format!("claude -p a échoué ({code}) : {stderr}"),
    })?;
    Ok(parse_resultats(&sortie, entrees))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn entree(id: &str, minutes: u32) -> EntreeTemps {
        EntreeTemps { task_id: id.into(), debut: "2026-09-28 09:00".into(), minutes }
    }

    #[test]
    fn duree_au_format_de_l_outil() {
        assert_eq!(duree_mcp(45), "45m");
        assert_eq!(duree_mcp(120), "2h");
        assert_eq!(duree_mcp(90), "1h 30m");
    }

    #[test]
    fn prompt_liste_chaque_entree() {
        let p = prompt_saisie(&[entree("ABC-1", 90), entree("ABC-2", 15)]);
        assert!(p.contains(r#"task_id "ABC-1", start "2026-09-28 09:00", duration "1h 30m""#), "{p}");
        assert!(p.contains(r#"task_id "ABC-2""#));
    }

    #[test]
    fn resultats_lus_et_entree_manquante_en_echec() {
        let e = [entree("ABC-1", 30), entree("ABC-2", 15)];
        let r = parse_resultats(
            "```json\n{\"resultats\":[{\"taskId\":\"ABC-1\",\"ok\":true,\"erreur\":null}]}\n```",
            &e,
        );
        assert!(r[0].ok);
        assert!(!r[1].ok && r[1].erreur.is_some());
        assert!(parse_resultats("rien compris", &e).iter().all(|r| !r.ok));
    }
}
