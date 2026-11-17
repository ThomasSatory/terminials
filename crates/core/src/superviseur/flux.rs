//! Lecture ligne à ligne de la sortie `claude -p --output-format stream-json --verbose`.
//! Pur et testé sur des lignes enregistrées (jamais en lançant le vrai `claude`).
//!
//! Chaque ligne est un objet JSON : `system`/`init` (session), `assistant` (blocs texte,
//! `tool_use`, réflexion), `user` (résultats d'outils), `result` (fin du tour, coût).
//! Une ligne illisible ou d'un type inconnu est ignorée : le format évolue avec les
//! versions du CLI et le moteur ne doit pas s'arrêter pour un champ nouveau.

use serde_json::Value;

/// Ce qu'une ligne du flux apporte au moteur.
#[derive(Debug, Clone, PartialEq)]
pub enum LigneFlux {
    /// Message `system`/`init` : identifiant de la session.
    Init { session_id: String },
    /// Bloc texte d'un message assistant.
    Texte(String),
    /// Bloc `tool_use` (commande Bash lancée par le modèle).
    Outil { id: String, commande: String },
    /// Résultat d'un outil. `erreur` : commande refusée (hors `terminials …`) ou en échec.
    ResultatOutil {
        id: String,
        erreur: bool,
        texte: String,
    },
    /// Message `result` de fin de tour.
    Fin {
        session_id: Option<String>,
        ok: bool,
        erreur: Option<String>,
        cout_usd: Option<f64>,
    },
    /// Tout le reste (messages partiels, réflexion, lignes illisibles).
    Autre,
}

fn chaine(v: &Value, cle: &str) -> Option<String> {
    v.get(cle).and_then(Value::as_str).map(str::to_string)
}

/// Texte d'un `tool_result` : une chaîne, ou une liste de blocs `{type:"text",text}`.
fn texte_resultat(contenu: Option<&Value>) -> String {
    match contenu {
        Some(Value::String(s)) => s.clone(),
        Some(Value::Array(blocs)) => blocs
            .iter()
            .filter_map(|b| b.get("text").and_then(Value::as_str))
            .collect::<Vec<_>>()
            .join("\n"),
        _ => String::new(),
    }
}

/// Analyse une ligne JSON du flux. Un message assistant peut porter plusieurs blocs
/// (texte puis outil) : ils sont rendus dans l'ordre.
pub fn analyser_ligne(ligne: &str) -> Vec<LigneFlux> {
    let Ok(v) = serde_json::from_str::<Value>(ligne.trim()) else {
        return vec![LigneFlux::Autre];
    };
    // Messages d'un sous-agent (non utilisés par le superviseur, mais le CLI peut les
    // relayer) : leur texte n'est pas adressé à l'utilisateur.
    let sous_agent = v.get("parent_tool_use_id").is_some_and(|p| !p.is_null());
    match v.get("type").and_then(Value::as_str) {
        Some("system") if v.get("subtype").and_then(Value::as_str) == Some("init") => {
            match chaine(&v, "session_id") {
                Some(session_id) if !session_id.is_empty() => vec![LigneFlux::Init { session_id }],
                _ => vec![LigneFlux::Autre],
            }
        }
        Some("assistant") if !sous_agent => {
            let blocs = v.pointer("/message/content").and_then(Value::as_array);
            let sortie: Vec<LigneFlux> = blocs
                .into_iter()
                .flatten()
                .filter_map(|b| match b.get("type").and_then(Value::as_str) {
                    Some("text") => {
                        let t = b.get("text").and_then(Value::as_str).unwrap_or("").trim();
                        (!t.is_empty()).then(|| LigneFlux::Texte(t.to_string()))
                    }
                    Some("tool_use") => Some(LigneFlux::Outil {
                        id: chaine(b, "id").unwrap_or_default(),
                        commande: b
                            .pointer("/input/command")
                            .and_then(Value::as_str)
                            .map(str::to_string)
                            // Un outil autre que Bash (ne devrait pas arriver : `--tools Bash`).
                            .unwrap_or_else(|| chaine(b, "name").unwrap_or_default()),
                    }),
                    _ => None,
                })
                .collect();
            if sortie.is_empty() {
                vec![LigneFlux::Autre]
            } else {
                sortie
            }
        }
        Some("user") if !sous_agent => {
            let blocs = v.pointer("/message/content").and_then(Value::as_array);
            let sortie: Vec<LigneFlux> = blocs
                .into_iter()
                .flatten()
                .filter(|b| b.get("type").and_then(Value::as_str) == Some("tool_result"))
                .map(|b| LigneFlux::ResultatOutil {
                    id: chaine(b, "tool_use_id").unwrap_or_default(),
                    erreur: b.get("is_error").and_then(Value::as_bool).unwrap_or(false),
                    texte: texte_resultat(b.get("content")),
                })
                .collect();
            if sortie.is_empty() {
                vec![LigneFlux::Autre]
            } else {
                sortie
            }
        }
        Some("result") => {
            let sous_type = v.get("subtype").and_then(Value::as_str).unwrap_or("");
            let est_erreur = v.get("is_error").and_then(Value::as_bool).unwrap_or(false);
            let ok = !est_erreur && (sous_type.is_empty() || sous_type == "success");
            let erreur = (!ok).then(|| {
                // Selon la version : texte dans `result`, liste `errors`, ou seulement le sous-type.
                let liste = v
                    .get("errors")
                    .and_then(Value::as_array)
                    .map(|e| {
                        e.iter()
                            .filter_map(Value::as_str)
                            .collect::<Vec<_>>()
                            .join(" ; ")
                    })
                    .filter(|s| !s.is_empty());
                chaine(&v, "result")
                    .filter(|s| !s.trim().is_empty())
                    .or(liste)
                    .unwrap_or_else(|| {
                        if sous_type.is_empty() {
                            "erreur".into()
                        } else {
                            sous_type.to_string()
                        }
                    })
            });
            vec![LigneFlux::Fin {
                session_id: chaine(&v, "session_id").filter(|s| !s.is_empty()),
                ok,
                erreur,
                cout_usd: v.get("total_cost_usd").and_then(Value::as_f64),
            }]
        }
        _ => vec![LigneFlux::Autre],
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // Lignes au format de `claude -p --output-format stream-json --verbose` (2.1.x),
    // raccourcies aux champs utiles.
    const INIT: &str = r#"{"type":"system","subtype":"init","cwd":"/tmp/s","session_id":"0b7c4f1e-9a2d-4c1b-8f00-3e5d2a1b9c77","tools":["Bash"],"mcp_servers":[],"model":"claude","permissionMode":"dontAsk","apiKeySource":"none"}"#;
    const ASSISTANT: &str = r#"{"type":"assistant","message":{"id":"msg_1","type":"message","role":"assistant","content":[{"type":"text","text":"Je regarde l'état des espaces."},{"type":"tool_use","id":"toolu_01","name":"Bash","input":{"command":"terminials espaces","description":"État des espaces"}}],"stop_reason":null},"parent_tool_use_id":null,"session_id":"0b7c4f1e-9a2d-4c1b-8f00-3e5d2a1b9c77"}"#;
    const RESULTAT: &str = r#"{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_01","type":"tool_result","content":"{\"espaces\":[]}","is_error":false}]},"parent_tool_use_id":null,"session_id":"0b7c4f1e"}"#;
    const REFUS: &str = r#"{"type":"user","message":{"role":"user","content":[{"tool_use_id":"toolu_02","type":"tool_result","content":[{"type":"text","text":"Permission to use Bash has been denied."}],"is_error":true}]},"parent_tool_use_id":null}"#;
    const FIN: &str = r#"{"type":"result","subtype":"success","is_error":false,"duration_ms":5321,"num_turns":3,"result":"api-paiements attend votre autorisation.","session_id":"0b7c4f1e-9a2d-4c1b-8f00-3e5d2a1b9c77","total_cost_usd":0.0213,"usage":{"input_tokens":12}}"#;

    #[test]
    fn init_donne_la_session() {
        assert_eq!(
            analyser_ligne(INIT),
            vec![LigneFlux::Init {
                session_id: "0b7c4f1e-9a2d-4c1b-8f00-3e5d2a1b9c77".into()
            }]
        );
    }

    #[test]
    fn message_assistant_texte_puis_outil_dans_l_ordre() {
        assert_eq!(
            analyser_ligne(ASSISTANT),
            vec![
                LigneFlux::Texte("Je regarde l'état des espaces.".into()),
                LigneFlux::Outil {
                    id: "toolu_01".into(),
                    commande: "terminials espaces".into()
                },
            ]
        );
    }

    #[test]
    fn resultats_d_outils_chaine_ou_blocs() {
        assert_eq!(
            analyser_ligne(RESULTAT),
            vec![LigneFlux::ResultatOutil {
                id: "toolu_01".into(),
                erreur: false,
                texte: "{\"espaces\":[]}".into()
            }]
        );
        assert_eq!(
            analyser_ligne(REFUS),
            vec![LigneFlux::ResultatOutil {
                id: "toolu_02".into(),
                erreur: true,
                texte: "Permission to use Bash has been denied.".into()
            }]
        );
    }

    #[test]
    fn fin_reussie_avec_cout() {
        assert_eq!(
            analyser_ligne(FIN),
            vec![LigneFlux::Fin {
                session_id: Some("0b7c4f1e-9a2d-4c1b-8f00-3e5d2a1b9c77".into()),
                ok: true,
                erreur: None,
                cout_usd: Some(0.0213),
            }]
        );
    }

    #[test]
    fn fin_en_erreur_garde_le_message() {
        let auth = r#"{"type":"result","subtype":"success","is_error":true,"result":"Invalid API key · Please run /login","session_id":"s1","total_cost_usd":0}"#;
        assert_eq!(
            analyser_ligne(auth),
            vec![LigneFlux::Fin {
                session_id: Some("s1".into()),
                ok: false,
                erreur: Some("Invalid API key · Please run /login".into()),
                cout_usd: Some(0.0),
            }]
        );
        let tours =
            r#"{"type":"result","subtype":"error_max_turns","is_error":true,"session_id":"s2"}"#;
        match &analyser_ligne(tours)[0] {
            LigneFlux::Fin {
                ok: false,
                erreur: Some(e),
                ..
            } => assert_eq!(e, "error_max_turns"),
            autre => panic!("{autre:?}"),
        }
        let liste = r#"{"type":"result","subtype":"error_during_execution","is_error":true,"errors":["No conversation found with session ID: abc"]}"#;
        match &analyser_ligne(liste)[0] {
            LigneFlux::Fin {
                ok: false,
                erreur: Some(e),
                session_id: None,
                ..
            } => {
                assert!(e.contains("No conversation found"))
            }
            autre => panic!("{autre:?}"),
        }
    }

    #[test]
    fn le_reste_est_ignore_sans_erreur() {
        for l in [
            "",
            "pas du json",
            r#"{"type":"system","subtype":"api_retry","attempt":1}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"thinking","thinking":"…"}]}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"   "}]}}"#,
            r#"{"type":"stream_event","event":{}}"#,
            r#"{"type":"assistant","message":{"content":[{"type":"text","text":"interne"}]},"parent_tool_use_id":"toolu_9"}"#,
        ] {
            assert_eq!(analyser_ligne(l), vec![LigneFlux::Autre], "{l}");
        }
    }
}
