use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use std::time::Duration;

use protocol::{Request, Response};
use serde_json::Value;

pub mod hooks;

/// Chemin du socket de contrôle de l'app. `$XDG_RUNTIME_DIR/terminials.sock`, sinon /tmp.
pub fn socket_path() -> std::path::PathBuf {
    match std::env::var("XDG_RUNTIME_DIR") {
        Ok(d) if !d.is_empty() => std::path::PathBuf::from(d).join("terminials.sock"),
        _ => std::path::PathBuf::from("/tmp/terminials.sock"),
    }
}

/// Attente maximale d'une réponse de l'app pour une méthode simple (notify, busy…) : elles
/// sont traitées par le backend seul, sans aller-retour vers l'interface.
pub const DELAI_SIMPLE: Duration = Duration::from_secs(10);

/// Attente maximale d'un appel d'outil : le backend attend l'interface au plus 20 s
/// (`pont::DELAI_REPONSE`) puis répond une erreur propre ; la marge laisse passer cette
/// erreur plutôt que de couper avant elle.
pub const DELAI_OUTIL: Duration = Duration::from_secs(25);

/// Ouvre le socket, envoie une requête JSON-par-ligne, lit et désérialise la réponse.
pub fn send_request(path: &Path, method: &str, params: Value) -> std::io::Result<Response> {
    let delai = if method == protocol::METHODE_OUTIL {
        DELAI_OUTIL
    } else {
        DELAI_SIMPLE
    };
    send_request_avec_delai(path, method, params, delai)
}

/// Comme `send_request`, avec une attente maximale explicite : une app figée ne doit pas
/// bloquer indéfiniment un hook de Claude Code ou le superviseur.
pub fn send_request_avec_delai(
    path: &Path,
    method: &str,
    params: Value,
    delai: Duration,
) -> std::io::Result<Response> {
    let mut stream = UnixStream::connect(path)?;
    stream.set_read_timeout(Some(delai))?;
    stream.set_write_timeout(Some(delai))?;
    let req = Request {
        method: method.to_string(),
        params,
    };
    let mut line = serde_json::to_string(&req).map_err(std::io::Error::other)?;
    line.push('\n');
    stream.write_all(line.as_bytes())?;
    let mut reader = BufReader::new(stream);
    let mut resp_line = String::new();
    let lu = reader
        .read_line(&mut resp_line)
        .map_err(|e| match e.kind() {
            std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut => std::io::Error::new(
                std::io::ErrorKind::TimedOut,
                "l'app n'a pas répondu à temps",
            ),
            _ => e,
        })?;
    if lu == 0 {
        return Err(std::io::Error::new(
            std::io::ErrorKind::UnexpectedEof,
            "l'app a fermé la connexion sans répondre",
        ));
    }
    serde_json::from_str(&resp_line).map_err(std::io::Error::other)
}

/// Ajoute `workspaceId` (et `ptyId`) aux params si TERMINIALS_WORKSPACE_ID
/// (et TERMINIALS_PTY_ID) sont présents dans l'env (shell lancé par l'app
/// terminials) : le front route alors la commande vers le workspace émetteur au
/// lieu du workspace actif, et une notification vers l'onglet émetteur.
pub fn with_workspace_id(mut params: Value) -> Value {
    if let Ok(ws) = std::env::var("TERMINIALS_WORKSPACE_ID") {
        if !ws.is_empty() {
            if let Some(obj) = params.as_object_mut() {
                obj.insert("workspaceId".to_string(), Value::String(ws));
                let pty = std::env::var("TERMINIALS_PTY_ID")
                    .ok()
                    .and_then(|v| v.parse::<u64>().ok());
                if let Some(pty) = pty {
                    obj.insert("ptyId".to_string(), Value::from(pty));
                }
            }
        }
    }
    params
}

// ---------------------------------------------------------------------------
// Sortie lisible des outils. Par défaut la CLI écrit pour un humain (et pour le modèle
// du superviseur, qui lit aussi bien des phrases courtes) ; `--json` rend la donnée
// brute, stable, pour un agent ou un script.
// ---------------------------------------------------------------------------

fn s<'a>(v: &'a Value, cle: &str) -> Option<&'a str> {
    v.get(cle).and_then(Value::as_str).filter(|t| !t.is_empty())
}

/// Formulation humaine de la réponse `data` de `outil`. Une forme inattendue retombe sur
/// le JSON indenté : rien n'est jamais perdu.
pub fn formater_sortie(outil: Option<protocol::Outil>, data: &Value) -> String {
    use protocol::Outil;
    // Réponses communes aux outils qui agissent.
    match s(data, "statut") {
        Some("en_attente") => {
            let msg = s(data, "message").unwrap_or("En attente de la validation de l'utilisateur.");
            return match s(data, "demande") {
                Some(id) => format!("{msg} (demande {id})"),
                None => msg.to_string(),
            };
        }
        Some("transmise") => {
            let msg = s(data, "message").unwrap_or("Question transmise.");
            return match s(data, "echange") {
                Some(id) => format!("{msg} Échange {id}."),
                None => msg.to_string(),
            };
        }
        Some("fait") => return formater_fait(data),
        _ => {}
    }
    match outil {
        Some(Outil::EspacesEtat) if data.get("espaces").is_some() => formater_espaces(data),
        Some(Outil::TerminalLire) if data.get("lignes").is_some() => formater_lecture(data),
        _ if data.is_null() => String::new(),
        _ => serde_json::to_string_pretty(data).unwrap_or_default(),
    }
}

fn formater_fait(data: &Value) -> String {
    let objet = |cle: &str, libelle: &str| {
        let o = data.get(cle)?;
        let id = s(o, "id")?;
        Some(match s(o, "nom") {
            Some(nom) => format!("{libelle} « {nom} » ({id})"),
            None => format!("{libelle} {id}"),
        })
    };
    match objet("espace", "espace")
        .or_else(|| objet("groupe", "groupe"))
        .or_else(|| objet("onglet", "onglet"))
    {
        Some(quoi) => format!("Fait : {quoi}."),
        None => "Fait.".to_string(),
    }
}

fn formater_lecture(data: &Value) -> String {
    let espace = data.get("espace").and_then(|e| s(e, "nom")).unwrap_or("?");
    let onglet = data
        .get("onglet")
        .and_then(|o| s(o, "titre"))
        .unwrap_or("?");
    let lignes: Vec<&str> = data
        .get("lignes")
        .and_then(Value::as_array)
        .map(|l| l.iter().filter_map(Value::as_str).collect())
        .unwrap_or_default();
    let mut out = format!("── {espace} › {onglet} ({} lignes)", lignes.len());
    for l in lignes {
        out.push('\n');
        out.push_str(l);
    }
    out
}

fn formater_espaces(data: &Value) -> String {
    let vide = Vec::new();
    let espaces = data
        .get("espaces")
        .and_then(Value::as_array)
        .unwrap_or(&vide);
    let groupes = data
        .get("groupes")
        .and_then(Value::as_array)
        .unwrap_or(&vide);
    if espaces.is_empty() {
        return "Aucun espace.".to_string();
    }
    let mut out = Vec::new();
    for e in espaces {
        let mut tete = format!(
            "{} ({})",
            s(e, "nom").unwrap_or("?"),
            s(e, "id").unwrap_or("?")
        );
        let mut traits: Vec<String> = Vec::new();
        if let Some(etat) = s(e, "etat") {
            traits.push(etat.to_string());
        }
        if e.get("relais").and_then(Value::as_bool) == Some(true) {
            traits.push("en relais".into());
        }
        if let Some(b) = s(e, "branche") {
            traits.push(format!("branche {b}"));
        }
        if let Some(g) = s(e, "groupe") {
            traits.push(format!("groupe {g}"));
        }
        if let Some(r) = s(e, "raccourci") {
            traits.push(r.to_string());
        }
        if e.get("actif").and_then(Value::as_bool) == Some(true) {
            traits.push("affiché".into());
        }
        if !traits.is_empty() {
            tete.push_str(" · ");
            tete.push_str(&traits.join(" · "));
        }
        out.push(tete);
        if let Some(d) = s(e, "dossier") {
            out.push(format!("  {d}"));
        }
        if let Some(n) = s(e, "notification") {
            out.push(format!("  notification : {n}"));
        }
        for o in e.get("onglets").and_then(Value::as_array).unwrap_or(&vide) {
            let rang = o
                .get("rang")
                .and_then(Value::as_u64)
                .map(|r| format!("{r}. "))
                .unwrap_or_default();
            let mut ligne = format!(
                "  {rang}{} ({})",
                s(o, "titre").unwrap_or("?"),
                s(o, "id").unwrap_or("?")
            );
            if let Some(etat) = s(o, "etat") {
                ligne.push_str(&format!(" · {etat}"));
            }
            if o.get("claude").and_then(Value::as_bool) == Some(true) {
                ligne.push_str(" · session claude");
            }
            if o.get("actif").and_then(Value::as_bool) == Some(true) {
                ligne.push_str(" · actif");
            }
            if let Some(b) = s(o, "bloque") {
                ligne.push_str(&format!(" · bloqué : {b}"));
            }
            out.push(ligne);
        }
    }
    if !groupes.is_empty() {
        let liste: Vec<String> = groupes
            .iter()
            .map(|g| {
                let replie = if g.get("replie").and_then(Value::as_bool) == Some(true) {
                    ", replié"
                } else {
                    ""
                };
                format!(
                    "{} ({}{replie})",
                    s(g, "nom").unwrap_or("?"),
                    s(g, "id").unwrap_or("?")
                )
            })
            .collect();
        out.push(format!("Groupes : {}", liste.join(", ")));
    }
    out.join("\n")
}

#[cfg(test)]
mod tests {
    use super::*;
    use protocol::Outil;
    use serde_json::json;

    // Un seul test manipule TERMINIALS_WORKSPACE_ID / TERMINIALS_PTY_ID (set + remove
    // dans le même test) : pas de course avec les autres tests du binaire, exécutés en
    // parallèle.
    #[test]
    fn with_workspace_id_joins_env_var_when_present() {
        std::env::remove_var("TERMINIALS_WORKSPACE_ID");
        std::env::remove_var("TERMINIALS_PTY_ID");
        let p = with_workspace_id(json!({"title": "t"}));
        assert_eq!(p.get("workspaceId"), None);

        std::env::set_var("TERMINIALS_WORKSPACE_ID", "ws-42");
        let p = with_workspace_id(json!({"title": "t"}));
        assert_eq!(p.get("workspaceId").and_then(|v| v.as_str()), Some("ws-42"));
        assert_eq!(p.get("ptyId"), None);

        std::env::set_var("TERMINIALS_PTY_ID", "7");
        let p = with_workspace_id(json!({"title": "t"}));
        assert_eq!(p.get("ptyId").and_then(|v| v.as_u64()), Some(7));
        std::env::remove_var("TERMINIALS_WORKSPACE_ID");
        std::env::remove_var("TERMINIALS_PTY_ID");
    }

    #[test]
    fn sortie_des_actions() {
        assert_eq!(
            formater_sortie(Some(Outil::EspaceFermer), &json!({"statut":"fait"})),
            "Fait."
        );
        assert_eq!(
            formater_sortie(
                Some(Outil::EspaceCreer),
                &json!({"statut":"fait","espace":{"id":"ws:4","nom":"api"}})
            ),
            "Fait : espace « api » (ws:4)."
        );
        assert_eq!(
            formater_sortie(
                Some(Outil::OngletOuvrir),
                &json!({"statut":"fait","onglet":{"id":"tab:9"}})
            ),
            "Fait : onglet tab:9."
        );
        assert_eq!(
            formater_sortie(
                Some(Outil::TerminalEcrire),
                &json!({"statut":"en_attente","demande":"d3","message":"En attente de la validation de l'utilisateur."})
            ),
            "En attente de la validation de l'utilisateur. (demande d3)"
        );
        assert_eq!(
            formater_sortie(
                Some(Outil::Demander),
                &json!({"statut":"transmise","echange":"e1","message":"Question confiée à Superviseur."})
            ),
            "Question confiée à Superviseur. Échange e1."
        );
    }

    #[test]
    fn sortie_d_une_lecture() {
        let data = json!({"espace":{"id":"ws:3","nom":"api"},"onglet":{"id":"tab:1","titre":"claude"},"lignes":["a","b"]});
        assert_eq!(
            formater_sortie(Some(Outil::TerminalLire), &data),
            "── api › claude (2 lignes)\na\nb"
        );
    }

    #[test]
    fn sortie_de_l_etat_des_espaces() {
        let data = json!({
            "espaces": [{
                "id":"ws:3","nom":"api","dossier":"/srv/api","groupe":"services","branche":"fix/x",
                "actif":true,"etat":"attente","relais":false,"raccourci":"Ctrl 3",
                "notification":"Autoriser npm run migrate ?",
                "onglets":[{"id":"tab:4","rang":1,"titre":"claude","actif":true,"etat":"attente","claude":true,
                            "bloque":"Claude demande l'autorisation d'utiliser Bash"}]
            }],
            "groupes": [{"id":"grp:1","nom":"services","couleur":"#f78fc6","replie":true}]
        });
        let texte = formater_sortie(Some(Outil::EspacesEtat), &data);
        assert_eq!(
            texte,
            "api (ws:3) · attente · branche fix/x · groupe services · Ctrl 3 · affiché\n  /srv/api\n  notification : Autoriser npm run migrate ?\n  1. claude (tab:4) · attente · session claude · actif · bloqué : Claude demande l'autorisation d'utiliser Bash\nGroupes : services (grp:1, replié)"
        );
        assert_eq!(
            formater_sortie(
                Some(Outil::EspacesEtat),
                &json!({"espaces":[],"groupes":[]})
            ),
            "Aucun espace."
        );
    }

    #[test]
    fn forme_inattendue_rendue_en_json() {
        assert_eq!(
            formater_sortie(None, &json!({"pong":true})),
            "{\n  \"pong\": true\n}"
        );
        assert_eq!(formater_sortie(None, &Value::Null), "");
    }

    #[test]
    fn delai_depasse_rend_une_erreur_propre() {
        let dir = std::env::temp_dir().join(format!("terminials-delai-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let chemin = dir.join("t.sock");
        let ecoute = std::os::unix::net::UnixListener::bind(&chemin).unwrap();
        // Serveur muet : accepte, lit, ne répond jamais.
        let fil = std::thread::spawn(move || {
            let (flux, _) = ecoute.accept().unwrap();
            let mut l = String::new();
            let _ = BufReader::new(&flux).read_line(&mut l);
            std::thread::sleep(Duration::from_millis(400));
        });
        let err = send_request_avec_delai(&chemin, "ping", Value::Null, Duration::from_millis(100))
            .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::TimedOut);
        fil.join().unwrap();
        // Serveur qui ferme sans répondre.
        let ecoute = {
            let _ = std::fs::remove_file(&chemin);
            std::os::unix::net::UnixListener::bind(&chemin).unwrap()
        };
        let fil = std::thread::spawn(move || {
            let (flux, _) = ecoute.accept().unwrap();
            let mut l = String::new();
            let _ = BufReader::new(&flux).read_line(&mut l);
        });
        let err = send_request_avec_delai(&chemin, "ping", Value::Null, Duration::from_secs(2))
            .unwrap_err();
        assert_eq!(err.kind(), std::io::ErrorKind::UnexpectedEof);
        fil.join().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
    }
}
