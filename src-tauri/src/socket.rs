//! Serveur de contrôle sur socket Unix (JSON-par-ligne), piloté par la CLI `terminials`.
//!
//! Chaque connexion est servie par sa propre tâche : un appel d'outil qui attend
//! l'interface (jusqu'à `pont::DELAI_REPONSE`) ne retarde ni les autres clients ni les
//! hooks de Claude Code. Sur une même connexion, les requêtes sont traitées dans l'ordre
//! (la réponse n'a pas d'identifiant : c'est l'ordre qui les apparie).
//!
//! Les appels d'outils (méthode `outil`) ne sont pas exécutés ici : le backend décide de
//! leur ORIGINE (jeton du superviseur, terminal d'un espace, ou extérieur), puis les
//! relaie au front par le pont, où le garde-fou les autorise, les met en attente de
//! validation ou les refuse. Aucune méthode ne lance de commande : le socket ne fait que
//! transmettre des données.

use std::future::Future;
use std::path::{Path, PathBuf};
use std::pin::Pin;
use std::sync::Arc;

use protocol::{Origine, Outil, ReponseOutil, Request, Response, METHODE_OUTIL};
use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncReadExt, AsyncWriteExt, BufReader};
use tokio::net::{UnixListener, UnixStream};

/// Chemin du socket : `$XDG_RUNTIME_DIR/terminials.sock`, sinon /tmp.
pub fn socket_path() -> PathBuf {
    match std::env::var("XDG_RUNTIME_DIR") {
        Ok(dir) if !dir.is_empty() => PathBuf::from(dir).join("terminials.sock"),
        _ => PathBuf::from("/tmp/terminials.sock"),
    }
}

/// Taille maximale d'une requête. Une requête légitime fait quelques kilo-octets (le
/// texte le plus long est celui d'une écriture dans un terminal) : au-delà, la connexion
/// est fermée après une erreur, plutôt que de laisser un client remplir la mémoire.
const TAILLE_MAX_REQUETE: u64 = 1024 * 1024;

/// Méthodes historiques : effets simples, relayés au front par `socket-command`.
const METHODES_HISTORIQUES: [&str; 6] = [
    "notify",
    "new-workspace",
    "set-status",
    "set-progress",
    "claude-session",
    "agent-busy",
];

/// Vrai si une instance écoute déjà (connexion réussie). Sinon, nettoie un socket mort.
/// À appeler avant bind().
pub async fn instance_already_running(path: &Path) -> bool {
    if UnixStream::connect(path).await.is_ok() {
        return true;
    }
    let _ = std::fs::remove_file(path); // socket mort d'un crash précédent
    false
}

/// Lie le socket et le restreint à son propriétaire (0600), défensif surtout sur le
/// repli /tmp : seul l'utilisateur de l'app peut piloter ses terminaux.
fn lier(path: &Path) -> std::io::Result<UnixListener> {
    use std::os::unix::fs::PermissionsExt;
    let listener = UnixListener::bind(path)?;
    std::fs::set_permissions(path, std::fs::Permissions::from_mode(0o600))?;
    Ok(listener)
}

/// Démarre le serveur socket. À lancer dans le setup hook via async_runtime::spawn.
pub async fn serve(app: AppHandle) -> std::io::Result<()> {
    let path = socket_path();
    if instance_already_running(&path).await {
        return Ok(()); // une autre instance tourne déjà
    }
    let listener = lier(&path)?;
    servir(listener, Arc::new(HoteTauri(app))).await
}

// ---------------------------------------------------------------------------
// Ce dont le serveur a besoin de l'app, isolé derrière un trait pour que le protocole
// (concurrence, origine, refus, erreurs) se teste sans webview.
// ---------------------------------------------------------------------------

type FutureReponse<'a> = Pin<Box<dyn Future<Output = ReponseOutil> + Send + 'a>>;

trait Hote: Send + Sync + 'static {
    /// `candidat` est-il le jeton du superviseur de ce lancement ?
    fn jeton_valide(&self, candidat: &str) -> bool;
    /// Le processus client (`pid` lu par SO_PEERCRED) descend-il du `claude` du
    /// superviseur ? Vrai même si l'appel ne présente pas le jeton (cf. `lignee_porte_jeton`).
    fn descend_du_superviseur(&self, pid: u32) -> bool;
    /// Espace (workspace_id, pty_id) du terminal de l'app dont descend le processus `pid`,
    /// d'après le registre des PTY et la lignée du pair ; `None` s'il n'en descend pas.
    fn espace_du_pair(&self, pid: u32) -> Option<(String, u64)>;
    /// Notification du bureau (méthode `notify`).
    fn notifier(&self, titre: &str, texte: &str);
    /// Relaie une méthode historique au front (`socket-command`).
    fn relayer(&self, req: &Request);
    /// Appel d'outil relayé au front, qui applique le garde-fou ; attend sa réponse.
    fn outil(&self, outil: Outil, args: Value, origine: Origine) -> FutureReponse<'_>;
}

struct HoteTauri(AppHandle);

impl Hote for HoteTauri {
    fn jeton_valide(&self, candidat: &str) -> bool {
        crate::superviseur::jeton_valide(&self.0, candidat)
    }
    fn descend_du_superviseur(&self, pid: u32) -> bool {
        let jeton = crate::superviseur::jeton(&self.0);
        lignee_porte_jeton(pid, std::process::id(), &jeton, environ_de, parent_de)
    }
    fn espace_du_pair(&self, pid: u32) -> Option<(String, u64)> {
        use tauri::Manager;
        let reg = self.0.state::<Arc<crate::pty::PtyRegistry>>();
        lignee_espace(
            pid,
            std::process::id(),
            |p| reg.espace_du_shell(p),
            parent_de,
        )
    }
    fn notifier(&self, titre: &str, texte: &str) {
        crate::notify::fire(&self.0, titre, texte);
    }
    fn relayer(&self, req: &Request) {
        let _ = self.0.emit("socket-command", req);
    }
    fn outil(&self, outil: Outil, args: Value, origine: Origine) -> FutureReponse<'_> {
        Box::pin(crate::pont::requete_front(
            &self.0,
            outil,
            args,
            origine,
            crate::pont::DELAI_REPONSE,
        ))
    }
}

/// Boucle d'acceptation : une tâche par connexion.
async fn servir<H: Hote>(listener: UnixListener, hote: Arc<H>) -> std::io::Result<()> {
    loop {
        let (stream, _) = listener.accept().await?;
        let hote = hote.clone();
        tokio::spawn(async move { servir_connexion(stream, hote).await });
    }
}

/// Profondeur maximale de la lignée remontée : bien au-delà d'un arbre réel (claude →
/// shell → sous-shell → CLI), elle borne la remontée sur une table /proc incohérente.
const PROFONDEUR_LIGNEE: usize = 64;

/// Vrai si `pid` ou l'un de ses ancêtres (jusqu'à `arret`, l'app elle-même, exclue) a été
/// lancé avec le jeton du superviseur dans son environnement.
///
/// Le jeton seul ne suffit pas à reconnaître le superviseur : la CLI le joint quand il
/// est dans son environnement, mais une commande qui l'en retire (`env -u …`) ferait
/// passer l'appel pour celui d'un terminal, et ses `notify` / `agent-busy` débloqueraient
/// une session qui attend une autorisation. Son `claude`, lui, a été lancé avec le jeton
/// (`/proc/<pid>/environ` garde l'environnement de départ) : tout ce qu'il lance en
/// descend. Pur : lecture de l'environnement et du parent injectées pour les tests.
fn lignee_porte_jeton(
    pid: u32,
    arret: u32,
    jeton: &str,
    environ: impl Fn(u32) -> Option<Vec<u8>>,
    parent: impl Fn(u32) -> Option<u32>,
) -> bool {
    if jeton.is_empty() {
        return false;
    }
    let attendu = format!("{}={jeton}", protocol::ENV_JETON_SUPERVISEUR);
    let mut courant = pid;
    for _ in 0..PROFONDEUR_LIGNEE {
        if courant <= 1 || courant == arret {
            return false;
        }
        if environ(courant)
            .is_some_and(|env| env.split(|&b| b == 0).any(|v| v == attendu.as_bytes()))
        {
            return true;
        }
        match parent(courant) {
            Some(p) if p != courant => courant = p,
            _ => return false,
        }
    }
    false
}

/// Espace d'un processus : on remonte sa lignée jusqu'au shell que l'app a lancé dans un
/// PTY (`shell_de` : PID → (espace, PTY) d'après le registre), en s'arrêtant à `arret`
/// (l'app elle-même, exclue) et à la même borne de profondeur que `lignee_porte_jeton`.
/// L'identité vient du registre de l'app, jamais des variables d'environnement ni des
/// paramètres que le client envoie. Pur : registre et parent injectés pour les tests.
fn lignee_espace(
    pid: u32,
    arret: u32,
    shell_de: impl Fn(u32) -> Option<(String, u64)>,
    parent: impl Fn(u32) -> Option<u32>,
) -> Option<(String, u64)> {
    let mut courant = pid;
    for _ in 0..PROFONDEUR_LIGNEE {
        if courant <= 1 || courant == arret {
            return None;
        }
        if let Some(espace) = shell_de(courant) {
            return Some(espace);
        }
        match parent(courant) {
            Some(p) if p != courant => courant = p,
            _ => return None,
        }
    }
    None
}

fn environ_de(pid: u32) -> Option<Vec<u8>> {
    std::fs::read(format!("/proc/{pid}/environ")).ok()
}

fn parent_de(pid: u32) -> Option<u32> {
    ppid_de_stat(&std::fs::read_to_string(format!("/proc/{pid}/stat")).ok()?)
}

/// Parent lu dans `/proc/<pid>/stat` : `pid (comm) état ppid …`. Le nom peut contenir
/// espaces et parenthèses : on repart de la DERNIÈRE parenthèse fermante.
fn ppid_de_stat(stat: &str) -> Option<u32> {
    let reste = &stat[stat.rfind(')')? + 1..];
    reste.split_whitespace().nth(1)?.parse().ok()
}

/// Lit les requêtes d'une connexion une à une et répond à chacune sur une ligne.
async fn servir_connexion<H: Hote>(stream: UnixStream, hote: Arc<H>) {
    // Client lancé (de près ou de loin) par le superviseur : décidé une fois par connexion,
    // d'après le processus à l'autre bout du socket et non d'après ce qu'il envoie.
    let pid_pair = stream
        .peer_cred()
        .ok()
        .and_then(|c| c.pid())
        .and_then(|p| u32::try_from(p).ok());
    let du_superviseur = pid_pair.is_some_and(|p| hote.descend_du_superviseur(p));
    // Espace du client, vérifié de la même façon : le terminal de l'app dont il descend.
    let espace = if du_superviseur {
        None
    } else {
        pid_pair.and_then(|p| hote.espace_du_pair(p))
    };
    let (lecture, mut ecriture) = stream.into_split();
    let mut lecteur = BufReader::new(lecture);
    let mut ligne = Vec::new();
    loop {
        ligne.clear();
        let lu = match (&mut lecteur)
            .take(TAILLE_MAX_REQUETE + 1)
            .read_until(b'\n', &mut ligne)
            .await
        {
            Ok(0) | Err(_) => break, // client parti
            Ok(n) => n,
        };
        let trop_longue = lu as u64 > TAILLE_MAX_REQUETE && ligne.last() != Some(&b'\n');
        let resp = if trop_longue {
            Response::err(format!(
                "requête trop longue (plus de {TAILLE_MAX_REQUETE} octets)"
            ))
        } else if ligne.iter().all(u8::is_ascii_whitespace) {
            continue; // ligne vide : rien à répondre
        } else {
            match serde_json::from_slice::<Request>(&ligne) {
                Ok(req) => {
                    dispatch_depuis(hote.as_ref(), req, du_superviseur, espace.as_ref()).await
                }
                Err(e) => Response::err(format!("requête invalide : {e}")),
            }
        };
        let mut out =
            serde_json::to_string(&resp).unwrap_or_else(|_| r#"{"status":"error"}"#.into());
        out.push('\n');
        if ecriture.write_all(out.as_bytes()).await.is_err() || trop_longue {
            break;
        }
    }
}

/// Jeton présenté par l'appelant (CLI lancée par le superviseur), s'il y en a un.
fn jeton(params: &Value) -> Option<&str> {
    params
        .get("jeton")
        .and_then(Value::as_str)
        .filter(|j| !j.is_empty())
}

/// Origine d'un appel d'outil, décidée ici et jamais crue sur parole : seul le bon jeton
/// donne l'origine « superviseur ». Un jeton faux n'est pas une erreur, l'appel est
/// simplement traité comme venant de son terminal (ou de l'extérieur). L'espace n'est
/// jamais lu dans les paramètres (`workspaceId` / `ptyId`, forgeables) : c'est celui que
/// le serveur a retrouvé par la lignée du pair, ou « externe » si le pair ne descend
/// d'aucun terminal de l'app.
fn origine(espace: Option<&(String, u64)>, jeton_ok: bool) -> Origine {
    if jeton_ok {
        return Origine::Superviseur;
    }
    match espace {
        Some((workspace_id, pty_id)) => Origine::Espace {
            workspace_id: workspace_id.clone(),
            pty_id: Some(*pty_id),
        },
        None => Origine::Externe,
    }
}

/// Outil et arguments d'un appel `outil`. Les arguments restent du JSON : le front les
/// lit avec les mêmes formes (`protocol::args`), et les valide en les résolvant.
fn lire_appel(params: &Value) -> Result<(Outil, Value), String> {
    let id = params
        .get("outil")
        .and_then(Value::as_str)
        .ok_or("appel d'outil sans « outil »")?;
    let outil = Outil::depuis_id(id).ok_or_else(|| {
        let ids: Vec<&str> = Outil::TOUS.iter().map(|o| o.id()).collect();
        format!("outil inconnu : {id} (outils : {})", ids.join(", "))
    })?;
    let args = match params.get("args") {
        None | Some(Value::Null) => Value::Object(Default::default()),
        Some(a @ Value::Object(_)) => a.clone(),
        Some(_) => return Err(format!("arguments de {id} : un objet JSON est attendu")),
    };
    Ok((outil, args))
}

/// Réponse socket d'une réponse d'outil du front.
fn reponse_de(r: ReponseOutil) -> Response {
    if r.ok {
        Response::ok(r.data)
    } else {
        Response::err(r.erreur.unwrap_or_else(|| "refusé".to_string()))
    }
}

fn capacites() -> Value {
    let mut methodes = vec!["ping", "capabilities", METHODE_OUTIL];
    methodes.extend(METHODES_HISTORIQUES);
    let outils: Vec<&str> = Outil::TOUS.iter().map(|o| o.id()).collect();
    serde_json::json!({ "methods": methodes, "outils": outils })
}

/// Traduit une requête en effet sur l'app (client qui ne descend pas du superviseur).
#[cfg(test)]
async fn dispatch<H: Hote + ?Sized>(hote: &H, req: Request) -> Response {
    dispatch_depuis(hote, req, false, None).await
}

/// Impose l'identité vérifiée du pair aux params d'une méthode historique relayée au front :
/// `workspaceId` / `ptyId` du client ne sont jamais crus. Pair d'un terminal de l'app : ils
/// sont remplacés (ou ajoutés) par les valeurs vérifiées ; pair externe : ils sont retirés.
fn imposer_espace(params: &mut Value, espace: Option<&(String, u64)>) {
    if let Some((ws, pty)) = espace {
        if !params.is_object() {
            *params = Value::Object(Default::default());
        }
        if let Some(obj) = params.as_object_mut() {
            obj.insert("workspaceId".into(), Value::String(ws.clone()));
            obj.insert("ptyId".into(), Value::from(*pty));
        }
    } else if let Some(obj) = params.as_object_mut() {
        obj.remove("workspaceId");
        obj.remove("ptyId");
    }
}

/// Traduit une requête en effet sur l'app. `du_superviseur` : le client descend du
/// `claude` du superviseur ; il est alors traité comme lui, jeton présenté ou non.
/// `espace` : terminal de l'app dont descend le client (vérifié, cf. `lignee_espace`).
async fn dispatch_depuis<H: Hote + ?Sized>(
    hote: &H,
    mut req: Request,
    du_superviseur: bool,
    espace: Option<&(String, u64)>,
) -> Response {
    let jeton_ok = du_superviseur || jeton(&req.params).is_some_and(|j| hote.jeton_valide(j));
    // Le jeton ne quitte jamais le backend : ni le front ni les journaux ne le voient.
    if let Some(obj) = req.params.as_object_mut() {
        obj.remove("jeton");
    }
    match req.method.as_str() {
        "ping" => Response::ok(serde_json::json!({"pong": true})),
        "capabilities" => Response::ok(capacites()),
        METHODE_OUTIL => match lire_appel(&req.params) {
            Ok((outil, args)) => {
                reponse_de(hote.outil(outil, args, origine(espace, jeton_ok)).await)
            }
            Err(e) => Response::err(e),
        },
        // Le superviseur n'agit que par les outils, qui passent par le garde-fou : ses
        // appels aux méthodes historiques (notifier, créer un espace…) sont refusés.
        m if METHODES_HISTORIQUES.contains(&m) && jeton_ok => Response::err(format!(
            "méthode « {m} » refusée au superviseur : passez par les outils (terminials --help)"
        )),
        "notify" => {
            let title = req
                .params
                .get("title")
                .and_then(|v| v.as_str())
                .unwrap_or("terminials");
            let body = req
                .params
                .get("body")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            hote.notifier(title, body);
            imposer_espace(&mut req.params, espace);
            hote.relayer(&req);
            Response::ok(Value::Null)
        }
        m if METHODES_HISTORIQUES.contains(&m) => {
            imposer_espace(&mut req.params, espace);
            hote.relayer(&req);
            Response::ok(Value::Null)
        }
        other => Response::err(format!("méthode inconnue : {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;
    use std::sync::Mutex;
    use std::time::Duration;

    #[test]
    fn socket_path_resolution() {
        std::env::set_var("XDG_RUNTIME_DIR", "/run/user/1000");
        assert_eq!(
            socket_path(),
            std::path::PathBuf::from("/run/user/1000/terminials.sock")
        );
        std::env::remove_var("XDG_RUNTIME_DIR");
        assert_eq!(
            socket_path(),
            std::path::PathBuf::from("/tmp/terminials.sock")
        );
    }

    #[test]
    fn origine_decidee_par_le_backend() {
        let ws3 = ("ws:3".to_string(), 7);
        assert_eq!(origine(Some(&ws3), true), Origine::Superviseur);
        assert_eq!(origine(None, true), Origine::Superviseur);
        assert_eq!(
            origine(Some(&ws3), false),
            Origine::Espace {
                workspace_id: "ws:3".into(),
                pty_id: Some(7)
            }
        );
        assert_eq!(origine(None, false), Origine::Externe);
    }

    #[test]
    fn lecture_d_un_appel() {
        let (o, a) = lire_appel(&json!({"outil":"terminal.lire","args":{"espace":"api"}})).unwrap();
        assert_eq!(o, Outil::TerminalLire);
        assert_eq!(a, json!({"espace":"api"}));
        assert_eq!(
            lire_appel(&json!({"outil":"espaces.etat"})).unwrap().1,
            json!({})
        );
        let e = lire_appel(&json!({"outil":"rm"})).unwrap_err();
        assert!(
            e.contains("outil inconnu : rm") && e.contains("terminal.ecrire"),
            "{e}"
        );
        assert!(lire_appel(&json!({})).is_err());
        assert!(lire_appel(&json!({"outil":"notifier","args":"texte"})).is_err());
    }

    #[test]
    fn capacites_listent_les_outils() {
        let c = capacites();
        assert!(c["methods"].as_array().unwrap().contains(&json!("outil")));
        assert_eq!(c["outils"].as_array().unwrap().len(), Outil::TOUS.len());
    }

    /// Hôte de test : le jeton valide est « bon » ; l'outil `terminal.lire` répond après
    /// le délai donné dans `args.attendre` (ms), en renvoyant l'origine reçue.
    #[derive(Default)]
    struct FauxHote {
        relayes: Mutex<Vec<Request>>,
        notifs: Mutex<Vec<String>>,
    }

    impl Hote for FauxHote {
        fn jeton_valide(&self, candidat: &str) -> bool {
            candidat == "bon"
        }
        fn descend_du_superviseur(&self, _pid: u32) -> bool {
            false
        }
        fn espace_du_pair(&self, _pid: u32) -> Option<(String, u64)> {
            None
        }
        fn notifier(&self, titre: &str, _texte: &str) {
            self.notifs.lock().unwrap().push(titre.to_string());
        }
        fn relayer(&self, req: &Request) {
            self.relayes.lock().unwrap().push(req.clone());
        }
        fn outil(&self, outil: Outil, args: Value, origine: Origine) -> FutureReponse<'_> {
            Box::pin(async move {
                if let Some(ms) = args.get("attendre").and_then(Value::as_u64) {
                    tokio::time::sleep(Duration::from_millis(ms)).await;
                }
                match outil {
                    Outil::EspaceFermer => ReponseOutil::err("Niveau Observer : refusé."),
                    _ => {
                        ReponseOutil::ok(json!({"outil": outil, "origine": origine, "args": args}))
                    }
                }
            })
        }
    }

    fn req(method: &str, params: Value) -> Request {
        Request {
            method: method.into(),
            params,
        }
    }

    #[tokio::test]
    async fn dispatch_des_outils_et_refus() {
        let h = FauxHote::default();
        let r = dispatch(
            &h,
            req(
                "outil",
                json!({"outil":"espaces.etat","jeton":"bon","workspaceId":"ws:1"}),
            ),
        )
        .await;
        assert_eq!(r.data["origine"], json!({"type":"superviseur"}));
        let r = dispatch(
            &h,
            req(
                "outil",
                json!({"outil":"espaces.etat","jeton":"faux","workspaceId":"ws:1"}),
            ),
        )
        .await;
        // Un workspaceId forgé ne crée pas d'espace : le pair n'est d'aucun terminal.
        assert_eq!(r.data["origine"], json!({"type":"externe"}));
        let r = dispatch(
            &h,
            req(
                "outil",
                json!({"outil":"espace.fermer","args":{"espace":"a"}}),
            ),
        )
        .await;
        assert_eq!(r.error.as_deref(), Some("Niveau Observer : refusé."));
        let r = dispatch(&h, req("outil", json!({"outil":"inconnu"}))).await;
        assert!(r.error.unwrap().starts_with("outil inconnu"));
        let r = dispatch(&h, req("rm", Value::Null)).await;
        assert_eq!(r.error.as_deref(), Some("méthode inconnue : rm"));
    }

    #[tokio::test]
    async fn le_superviseur_n_a_pas_les_methodes_historiques() {
        let h = FauxHote::default();
        let r = dispatch(
            &h,
            req("notify", json!({"title":"t","body":"b","jeton":"bon"})),
        )
        .await;
        assert!(r.error.unwrap().contains("refusée au superviseur"));
        assert!(h.notifs.lock().unwrap().is_empty());
        assert!(h.relayes.lock().unwrap().is_empty());
        // Sans jeton (hook d'un espace), `notify` passe et relaie `attente` ; un jeton
        // faux est retiré avant d'atteindre le front.
        let r = dispatch(
            &h,
            req(
                "notify",
                json!({"title":"t","body":"b","attente":"autorisation","jeton":"x"}),
            ),
        )
        .await;
        assert_eq!(r.status, protocol::Status::Ok);
        let relayes = h.relayes.lock().unwrap();
        assert_eq!(relayes[0].params["attente"], "autorisation");
        assert!(relayes[0].params.get("jeton").is_none());
    }

    #[tokio::test]
    async fn un_descendant_du_superviseur_sans_jeton_reste_le_superviseur() {
        let h = FauxHote::default();
        // `env -u TERMINIALS_SUPERVISEUR_JETON terminials notify …` : pas de jeton, mais
        // lancé par le superviseur → refusé, et il ne débloque aucune session.
        let r = dispatch_depuis(
            &h,
            req("notify", json!({"title":"t","body":"b"})),
            true,
            None,
        )
        .await;
        assert!(r.error.unwrap().contains("refusée au superviseur"));
        let r = dispatch_depuis(
            &h,
            req("agent-busy", json!({"busy":true,"workspaceId":"ws:1"})),
            true,
            None,
        )
        .await;
        assert!(r.error.unwrap().contains("refusée au superviseur"));
        assert!(h.relayes.lock().unwrap().is_empty());
        // Ses appels d'outils gardent l'origine superviseur, même avec un espace forgé.
        let r = dispatch_depuis(
            &h,
            req(
                "outil",
                json!({"outil":"espaces.etat","workspaceId":"ws:1"}),
            ),
            true,
            None,
        )
        .await;
        assert_eq!(r.data["origine"], json!({"type":"superviseur"}));
    }

    fn espace_forge(workspace_id: &str) -> Value {
        json!({"outil":"espaces.etat","workspaceId":workspace_id,"ptyId":99})
    }

    #[tokio::test]
    async fn l_espace_vient_du_serveur_pas_des_params() {
        let h = FauxHote::default();
        let a = ("ws:A".to_string(), 1);
        // Pair d'un espace A qui envoie workspaceId B : c'est A, avec le PTY vérifié.
        let r = dispatch_depuis(&h, req("outil", espace_forge("ws:B")), false, Some(&a)).await;
        assert_eq!(
            r.data["origine"],
            json!({"type":"espace","workspaceId":"ws:A","ptyId":1})
        );
        // Pair étranger à l'app avec un workspaceId usurpé : externe.
        let r = dispatch_depuis(&h, req("outil", espace_forge("ws:B")), false, None).await;
        assert_eq!(r.data["origine"], json!({"type":"externe"}));
        // Le superviseur reste prioritaire.
        let r = dispatch_depuis(&h, req("outil", espace_forge("ws:B")), true, Some(&a)).await;
        assert_eq!(r.data["origine"], json!({"type":"superviseur"}));
    }

    #[tokio::test]
    async fn les_methodes_relayees_portent_l_espace_verifie() {
        let h = FauxHote::default();
        let a = ("ws:A".to_string(), 1);
        // Pair de A qui vise B : relayé avec A et son vrai PTY.
        for (m, p) in [
            (
                "notify",
                json!({"title":"t","workspaceId":"ws:B","ptyId":99}),
            ),
            (
                "agent-busy",
                json!({"busy":true,"workspaceId":"ws:B","ptyId":99}),
            ),
        ] {
            assert!(dispatch_depuis(&h, req(m, p), false, Some(&a))
                .await
                .error
                .is_none());
        }
        // Pair externe avec identité forgée : relayé sans workspaceId ni ptyId.
        dispatch_depuis(
            &h,
            req(
                "agent-busy",
                json!({"busy":true,"workspaceId":"ws:B","ptyId":99}),
            ),
            false,
            None,
        )
        .await;
        // Pair de A sans params : A et son PTY sont ajoutés.
        dispatch_depuis(&h, req("set-status", Value::Null), false, Some(&a)).await;
        let r = h.relayes.lock().unwrap();
        for i in [0, 1, 3] {
            assert_eq!(r[i].params["workspaceId"], "ws:A");
            assert_eq!(r[i].params["ptyId"], 1);
        }
        assert_eq!(r[1].params["busy"], true);
        assert!(r[2].params.get("workspaceId").is_none());
        assert!(r[2].params.get("ptyId").is_none());
        assert_eq!(r[2].params["busy"], true);
    }

    #[test]
    fn lignee_d_un_espace() {
        // App 10 → shell 20 (espace A, PTY 3) → sous-shell 30 → CLI 40 ;
        // shell 50 (espace B, PTY 4) → 10 ; processus étranger 60 → 1.
        let parents = |p: u32| match p {
            40 => Some(30),
            30 => Some(20),
            20 | 50 => Some(10),
            60 => Some(1),
            _ => None,
        };
        let shells = |p: u32| match p {
            20 => Some(("ws:A".to_string(), 3)),
            50 => Some(("ws:B".to_string(), 4)),
            _ => None,
        };
        let esp = |pid| lignee_espace(pid, 10, shells, parents);
        // Directement le shell, puis via un sous-shell.
        assert_eq!(esp(20), Some(("ws:A".to_string(), 3)));
        assert_eq!(esp(40), Some(("ws:A".to_string(), 3)));
        assert_eq!(esp(50), Some(("ws:B".to_string(), 4)));
        // Pair étranger, ou remontée qui atteint l'app sans croiser de shell.
        assert_eq!(esp(60), None);
        assert_eq!(lignee_espace(10, 10, shells, parents), None);
        assert_eq!(lignee_espace(1, 10, shells, parents), None);
        // Lignée en boucle : bornée, sans espace.
        assert_eq!(lignee_espace(70, 10, |_| None, |_| Some(71)), None);
        assert_eq!(
            lignee_espace(70, 10, |_| None, |p| Some(if p == 70 { 71 } else { 70 })),
            None
        );
    }

    #[test]
    fn lignee_du_superviseur() {
        // Arbre : app 10 → claude 20 (jeton) → bash 30 → terminials 40 ; terminal 50 → 10.
        let parents = |p: u32| match p {
            40 => Some(30),
            30 => Some(20),
            20 => Some(10),
            50 => Some(10),
            10 => Some(1),
            _ => None,
        };
        let environ = |p: u32| match p {
            20 => Some(b"HOME=/h\0TERMINIALS_SUPERVISEUR_JETON=abc\0".to_vec()),
            // Jeton retiré par la commande : seul l'ancêtre le porte encore.
            40 | 30 | 50 => Some(b"HOME=/h\0".to_vec()),
            _ => None,
        };
        assert!(lignee_porte_jeton(40, 10, "abc", environ, parents));
        assert!(
            !lignee_porte_jeton(50, 10, "abc", environ, parents),
            "terminal d'un espace"
        );
        assert!(
            !lignee_porte_jeton(40, 10, "autre", environ, parents),
            "jeton d'un autre lancement"
        );
        assert!(!lignee_porte_jeton(40, 10, "", environ, parents));
        // Préfixe du jeton : pas une correspondance.
        assert!(!lignee_porte_jeton(40, 10, "ab", environ, parents));
        // Boucle dans la table : bornée.
        assert!(!lignee_porte_jeton(7, 10, "abc", |_| None, |_| Some(8)));
    }

    #[test]
    fn parent_lu_dans_stat() {
        assert_eq!(ppid_de_stat("1234 (bash) S 99 1234 1234 0 -1"), Some(99));
        assert_eq!(ppid_de_stat("1234 (a b) c)) R 7 1 1"), Some(7));
        assert_eq!(ppid_de_stat("illisible"), None);
        // Le processus de test a un parent réel.
        assert!(parent_de(std::process::id()).is_some_and(|p| p > 0));
    }

    /// Socket temporaire (jamais celui de l'utilisateur) servi par le faux hôte.
    async fn serveur() -> (PathBuf, Arc<FauxHote>) {
        static N: std::sync::atomic::AtomicU32 = std::sync::atomic::AtomicU32::new(0);
        let dir = std::env::temp_dir().join(format!(
            "terminials-socket-test-{}-{}",
            std::process::id(),
            N.fetch_add(1, std::sync::atomic::Ordering::SeqCst)
        ));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let chemin = dir.join("t.sock");
        let ecoute = lier(&chemin).unwrap();
        let hote = Arc::new(FauxHote::default());
        tokio::spawn(servir(ecoute, hote.clone()));
        (chemin, hote)
    }

    async fn echanger(flux: &mut BufReader<UnixStream>, ligne: &str) -> Value {
        flux.get_mut()
            .write_all(format!("{ligne}\n").as_bytes())
            .await
            .unwrap();
        let mut rep = String::new();
        flux.read_line(&mut rep).await.unwrap();
        serde_json::from_str(&rep).unwrap()
    }

    #[tokio::test]
    async fn socket_reserve_au_proprietaire() {
        use std::os::unix::fs::PermissionsExt;
        let (chemin, _) = serveur().await;
        assert_eq!(
            std::fs::metadata(&chemin).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let _ = std::fs::remove_dir_all(chemin.parent().unwrap());
    }

    #[tokio::test]
    async fn plusieurs_clients_simultanes() {
        let (chemin, _) = serveur().await;
        // Un client lent (outil qui attend l'interface) ne bloque pas un client rapide.
        let mut lent = BufReader::new(UnixStream::connect(&chemin).await.unwrap());
        lent.get_mut()
            .write_all(b"{\"method\":\"outil\",\"params\":{\"outil\":\"terminal.lire\",\"args\":{\"attendre\":400}}}\n")
            .await
            .unwrap();
        let mut rapide = BufReader::new(UnixStream::connect(&chemin).await.unwrap());
        let debut = std::time::Instant::now();
        let r = echanger(&mut rapide, r#"{"method":"ping"}"#).await;
        assert_eq!(r["data"]["pong"], true);
        assert!(
            debut.elapsed() < Duration::from_millis(300),
            "le client rapide a attendu le lent"
        );
        let mut rep = String::new();
        lent.read_line(&mut rep).await.unwrap();
        let rep: Value = serde_json::from_str(&rep).unwrap();
        assert_eq!(rep["status"], "ok");
        assert_eq!(rep["data"]["outil"], "terminal.lire");
        let _ = std::fs::remove_dir_all(chemin.parent().unwrap());
    }

    #[tokio::test]
    async fn erreurs_propres_et_connexion_conservee() {
        let (chemin, _) = serveur().await;
        let mut c = BufReader::new(UnixStream::connect(&chemin).await.unwrap());
        let r = echanger(&mut c, "pas du json").await;
        assert_eq!(r["status"], "error");
        assert!(r["error"].as_str().unwrap().starts_with("requête invalide"));
        // Plusieurs requêtes sur la même connexion, réponses dans l'ordre.
        let r = echanger(
            &mut c,
            r#"{"method":"outil","params":{"outil":"espace.fermer"}}"#,
        )
        .await;
        assert_eq!(r["error"], "Niveau Observer : refusé.");
        let r = echanger(&mut c, r#"{"method":"ping"}"#).await;
        assert_eq!(r["status"], "ok");

        // Requête démesurée : erreur, puis connexion fermée.
        let mut c = BufReader::new(UnixStream::connect(&chemin).await.unwrap());
        let enorme = vec![b'x'; (TAILLE_MAX_REQUETE + 10) as usize];
        let _ = c.get_mut().write_all(&enorme).await;
        let mut rep = String::new();
        c.read_line(&mut rep).await.unwrap();
        assert!(rep.contains("requête trop longue"), "{rep}");
        rep.clear();
        assert_eq!(c.read_line(&mut rep).await.unwrap(), 0);
        let _ = std::fs::remove_dir_all(chemin.parent().unwrap());
    }
}
