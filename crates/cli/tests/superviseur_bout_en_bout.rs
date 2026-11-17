//! Chaîne du superviseur de bout en bout, côté processus : moteur → faux `claude` (script
//! shell, aucun jeton consommé) → vraie CLI `terminials` → socket (faux serveur sur un
//! chemin temporaire, jamais celui de l'app) → réponse → sortie de la CLI → flux du
//! moteur. Le garde-fou lui-même est appliqué par le front (testé en vitest) ; ici on
//! vérifie ce qui le rend incontournable côté processus : le jeton du superviseur voyage
//! avec chaque appel d'outil, l'identité d'un terminal d'espace ne fuit pas dans son
//! environnement, une CLI lancée à la main n'a pas l'origine « superviseur », et les
//! commandes locales qui contourneraient le garde-fou lui sont refusées.

use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixListener;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde_json::{json, Value};
use terminials_core::reglages::Superviseur as ReglagesSuperviseur;
use terminials_core::superviseur::moteur::{ConfigMoteur, Hote, LanceurClaude, Moteur};
use terminials_core::superviseur::planif::ParametresPlanif;
use terminials_core::superviseur::{EvenementSuperviseur, FluxSuperviseur, GenreEvenement};

const JETON: &str = "0123456789abcdef0123456789abcdef";

/// Dossier temporaire du test, supprimé à la fin (court : un chemin de socket Unix ne
/// dépasse pas 108 octets).
struct Temp(PathBuf);
impl Temp {
    fn new(nom: &str) -> Temp {
        let p = std::env::temp_dir().join(format!("tsup-{nom}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&p);
        std::fs::create_dir_all(&p).unwrap();
        Temp(p)
    }
}
impl Drop for Temp {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

/// Faux serveur socket : décide l'origine comme le backend (le bon jeton, sinon le
/// terminal d'espace, sinon l'extérieur) et répond comme le garde-fou au niveau Agir :
/// lecture servie, écriture du superviseur mise en attente de validation, écriture de
/// toute autre origine refusée. Relève chaque requête reçue.
fn faux_serveur(socket: &Path) -> Arc<Mutex<Vec<Value>>> {
    let ecoute = UnixListener::bind(socket).unwrap();
    let recues = Arc::new(Mutex::new(Vec::new()));
    let r = recues.clone();
    std::thread::spawn(move || {
        for flux in ecoute.incoming() {
            let Ok(mut flux) = flux else { break };
            let mut ligne = String::new();
            if BufReader::new(&flux).read_line(&mut ligne).is_err() {
                continue;
            }
            let req: Value = serde_json::from_str(&ligne).unwrap_or(Value::Null);
            r.lock().unwrap().push(req.clone());
            let p = &req["params"];
            let origine = if p["jeton"] == JETON {
                "superviseur"
            } else if p["workspaceId"].is_string() {
                "espace"
            } else {
                "externe"
            };
            let rep = match (p["outil"].as_str(), origine) {
                (Some("terminal.lire"), _) => json!({"status":"ok","data":{
                    "espace":{"id":"ws:1","nom":"api"},"onglet":{"id":"tab:1","titre":"claude"},
                    "lignes":["Autoriser npm run migrate ?"]}}),
                (Some("terminal.ecrire"), "superviseur") => json!({"status":"ok","data":{
                    "statut":"en_attente","demande":"d1","message":"En attente de la validation de l'utilisateur."}}),
                (Some("terminal.ecrire"), _) => {
                    json!({"status":"error","error":"Réservé au superviseur."})
                }
                _ => json!({"status":"error","error":"inattendu"}),
            };
            let _ = flux.write_all(format!("{rep}\n").as_bytes());
        }
    });
    recues
}

/// Hôte du moteur : superviseur actif au niveau Agir, flux relevé.
struct FauxHote {
    emis: Mutex<Vec<FluxSuperviseur>>,
}
impl Hote for FauxHote {
    fn emettre(&self, flux: FluxSuperviseur) {
        self.emis.lock().unwrap().push(flux);
    }
    fn etat_espaces(&self) -> Result<Value, String> {
        Ok(json!({"espaces":[{"id":"ws:1","nom":"api"}],"groupes":[]}))
    }
    fn reglages(&self) -> ReglagesSuperviseur {
        ReglagesSuperviseur {
            actif: true,
            niveau: terminials_core::reglages::NiveauAutonomie::Agir,
            ..ReglagesSuperviseur::default()
        }
    }
}

fn ecrire_executable(chemin: &Path, contenu: &str) {
    use std::os::unix::fs::PermissionsExt;
    std::fs::write(chemin, contenu).unwrap();
    std::fs::set_permissions(chemin, std::fs::Permissions::from_mode(0o755)).unwrap();
}

#[test]
fn moteur_faux_claude_cli_socket_aller_retour() {
    let t = Temp::new("e2e");
    let xdg = t.0.join("x");
    let home = t.0.join("h");
    let sortie = t.0.join("o");
    for d in [&xdg, &home, &sortie] {
        std::fs::create_dir_all(d).unwrap();
    }
    let recues = faux_serveur(&xdg.join("terminials.sock"));

    // Faux `claude` : lit l'invite, se présente, appelle les outils par la CLI comme le
    // ferait le modèle (Bash), puis rend les codes de sortie dans un bloc de texte.
    let faux_claude = t.0.join("claude");
    ecrire_executable(
        &faux_claude,
        &format!(
            r#"#!/bin/sh
cat > "{o}/invite"
echo '{{"type":"system","subtype":"init","session_id":"sess-e2e"}}'
terminials lire api > "{o}/lire" 2>&1; l=$?
terminials ecrire api "oui" --pourquoi "choix du plan" > "{o}/ecrire" 2>&1; e=$?
terminials hooks setup > "{o}/hooks" 2>&1; h=$?
printf '{{"type":"assistant","message":{{"content":[{{"type":"text","text":"codes %s %s %s ws=%s"}}]}},"parent_tool_use_id":null}}\n' "$l" "$e" "$h" "${{TERMINIALS_WORKSPACE_ID:-aucun}}"
echo '{{"type":"result","subtype":"success","is_error":false,"result":"","total_cost_usd":0}}'
"#,
            o = sortie.display()
        ),
    );

    // Même lanceur que l'app (src-tauri/superviseur.rs) : jeton dans l'env, identité de
    // terminal retirée, CLI en tête du PATH. HOME et XDG_RUNTIME_DIR temporaires : rien
    // n'atteint les fichiers ni le socket de l'utilisateur.
    let cli = PathBuf::from(env!("CARGO_BIN_EXE_terminials"));
    let path = format!("{}:/usr/bin:/bin", cli.parent().unwrap().display());
    let lanceur = LanceurClaude {
        binaire: faux_claude.display().to_string(),
        dossier: t.0.join("session"),
        env: vec![
            ("TERMINIALS_SUPERVISEUR_JETON".into(), JETON.into()),
            ("PATH".into(), path),
            ("HOME".into(), home.display().to_string()),
            ("XDG_RUNTIME_DIR".into(), xdg.display().to_string()),
        ],
        env_retire: vec![
            "TERMINIALS_WORKSPACE_ID".into(),
            "TERMINIALS_PTY_ID".into(),
            "CLAUDECODE".into(),
        ],
    };
    // Comme si l'app avait été lancée depuis le terminal d'un espace : le `claude` du
    // superviseur ne doit pas hériter de cette identité (ses appels prendraient
    // l'origine de l'espace). Les autres tests de ce fichier retirent la variable
    // explicitement de leurs commandes.
    std::env::set_var("TERMINIALS_WORKSPACE_ID", "ws:9");
    std::env::set_var("TERMINIALS_PTY_ID", "9");

    let hote = Arc::new(FauxHote {
        emis: Mutex::new(Vec::new()),
    });
    let config = ConfigMoteur {
        planif: ParametresPlanif {
            regroupement_ms: 10,
            regroupement_message_ms: 5,
            intervalle_min_ms: 0,
            max_tours_heure: 100,
        },
        delai_tour: Duration::from_secs(20),
        dossier_session: t.0.join("session"),
    };
    let moteur = Moteur::demarrer(hote.clone(), Arc::new(lanceur), config);
    moteur.signaler(EvenementSuperviseur {
        genre: GenreEvenement::Message,
        texte: "Réponds à api".into(),
        ws_id: None,
    });

    let debut = std::time::Instant::now();
    while !hote
        .emis
        .lock()
        .unwrap()
        .iter()
        .any(|f| matches!(f, FluxSuperviseur::TourFin { .. }))
    {
        assert!(
            debut.elapsed() < Duration::from_secs(15),
            "le tour n'a jamais fini : {:?}",
            hote.emis.lock().unwrap()
        );
        std::thread::sleep(Duration::from_millis(20));
    }
    moteur.arreter();

    // Le flux du moteur rend ce que le faux `claude` a écrit : lecture et écriture en
    // attente réussissent (code 0), l'installation des hooks est refusée (code 1),
    // l'identité de terminal n'a pas fui dans l'environnement.
    let emis = hote.emis.lock().unwrap().clone();
    assert!(
        emis.contains(&FluxSuperviseur::Texte {
            texte: "codes 0 0 1 ws=aucun".into()
        }),
        "flux : {emis:?}"
    );
    assert!(
        emis.contains(&FluxSuperviseur::TourFin {
            ok: true,
            erreur: None,
            cout_usd: Some(0.0)
        }),
        "{emis:?}"
    );

    // Ce que la CLI a envoyé : deux appels d'outil, chacun avec le jeton, sans espace.
    let recues = recues.lock().unwrap().clone();
    assert_eq!(recues.len(), 2, "{recues:?}");
    for r in &recues {
        assert_eq!(r["method"], "outil");
        assert_eq!(r["params"]["jeton"], JETON);
        assert!(r["params"].get("workspaceId").is_none(), "{r}");
    }
    assert_eq!(recues[0]["params"]["outil"], "terminal.lire");
    assert_eq!(recues[1]["params"]["outil"], "terminal.ecrire");
    assert_eq!(
        recues[1]["params"]["args"],
        json!({"espace":"api","texte":"oui","entree":true,"pourquoi":"choix du plan"})
    );

    // Sorties de la CLI telles que le modèle les lit.
    let lire = |n: &str| std::fs::read_to_string(sortie.join(n)).unwrap();
    assert_eq!(
        lire("lire"),
        "── api › claude (1 lignes)\nAutoriser npm run migrate ?\n"
    );
    assert_eq!(
        lire("ecrire"),
        "En attente de la validation de l'utilisateur. (demande d1)\n"
    );
    assert!(
        lire("hooks").contains("réservée à l'utilisateur"),
        "{}",
        lire("hooks")
    );
    assert!(
        !home.join(".claude").exists(),
        "les hooks ont été installés par le superviseur"
    );
    // L'invite est passée par stdin, avec l'état des espaces lu avant le tour.
    assert!(lire("invite").contains("Réponds à api"));
}

#[test]
fn cli_a_la_main_sans_jeton_n_a_pas_l_origine_superviseur() {
    let t = Temp::new("main");
    let recues = faux_serveur(&t.0.join("terminials.sock"));
    let cli = env!("CARGO_BIN_EXE_terminials");

    // Depuis le terminal d'un espace : l'écriture est refusée par le « garde-fou ».
    let sortie = std::process::Command::new(cli)
        .args(["ecrire", "api", "rm -rf /", "--pourquoi", "x"])
        .env("XDG_RUNTIME_DIR", &t.0)
        .env_remove(protocol::ENV_JETON_SUPERVISEUR)
        .env("TERMINIALS_WORKSPACE_ID", "ws:2")
        .env("TERMINIALS_PTY_ID", "4")
        .output()
        .unwrap();
    assert_eq!(sortie.status.code(), Some(1));
    assert_eq!(
        String::from_utf8_lossy(&sortie.stderr),
        "erreur: Réservé au superviseur.\n"
    );

    // Un jeton deviné n'est qu'un jeton faux : la requête le porte, le serveur ne le
    // reconnaît pas, l'appel garde l'origine de son terminal.
    let sortie = std::process::Command::new(cli)
        .args(["ecrire", "api", "oui"])
        .env("XDG_RUNTIME_DIR", &t.0)
        .env(protocol::ENV_JETON_SUPERVISEUR, "devine")
        .env_remove("TERMINIALS_WORKSPACE_ID")
        .env_remove("TERMINIALS_PTY_ID")
        .output()
        .unwrap();
    assert_eq!(sortie.status.code(), Some(1));

    let recues = recues.lock().unwrap().clone();
    assert_eq!(recues.len(), 2);
    assert!(recues[0]["params"].get("jeton").is_none());
    assert_eq!(recues[0]["params"]["workspaceId"], "ws:2");
    assert_eq!(recues[0]["params"]["ptyId"], 4);
    assert_eq!(recues[1]["params"]["jeton"], "devine");
    assert!(recues[1]["params"].get("workspaceId").is_none());
}

#[test]
fn sous_commandes_des_outils_et_arguments_envoyes() {
    let t = Temp::new("args");
    let recues = faux_serveur(&t.0.join("terminials.sock"));
    let cli = env!("CARGO_BIN_EXE_terminials");
    let appels: [&[&str]; 9] = [
        &["espaces", "api"],
        &["prevenir", "Fini", "--titre", "api", "--espace", "api"],
        &["demander", "site", "Quel format ?"],
        &["resumer", "api", "Écrit les tests du calcul des avoirs."],
        &[
            "creer",
            "--dossier",
            "/srv/a",
            "--nom",
            "a",
            "--groupe",
            "g",
        ],
        &["deplacer", "api", "--hors-groupe", "--position", "2"],
        &["groupe", "services", "--espaces", "api,site"],
        &["transmettre", "e1", "Quel format ?", "--pourquoi", "relais"],
        &["repondre", "e1", "JSON", "--pourquoi", "réponse"],
    ];
    for a in appels {
        // Le faux serveur répond « inattendu » : seule compte la requête envoyée.
        let s = std::process::Command::new(cli)
            .args(a)
            .env("XDG_RUNTIME_DIR", &t.0)
            .env_remove(protocol::ENV_JETON_SUPERVISEUR)
            .env_remove("TERMINIALS_WORKSPACE_ID")
            .output()
            .unwrap();
        assert_eq!(s.status.code(), Some(1), "{a:?}");
    }
    let r: Vec<Value> = recues
        .lock()
        .unwrap()
        .iter()
        .map(|r| r["params"].clone())
        .collect();
    let attendu = [
        ("espaces.etat", json!({"espace":"api"})),
        (
            "notifier",
            json!({"texte":"Fini","titre":"api","espace":"api"}),
        ),
        (
            "demander",
            json!({"espace":"site","question":"Quel format ?"}),
        ),
        (
            "espace.resumer",
            json!({"espace":"api","texte":"Écrit les tests du calcul des avoirs."}),
        ),
        (
            "espace.creer",
            json!({"dossier":"/srv/a","nom":"a","groupe":"g"}),
        ),
        (
            "espace.deplacer",
            json!({"espace":"api","groupe":"","position":2}),
        ),
        (
            "groupe.creer",
            json!({"nom":"services","espaces":["api","site"]}),
        ),
        (
            "session.demander",
            json!({"echange":"e1","texte":"Quel format ?","pourquoi":"relais"}),
        ),
        (
            "session.repondre",
            json!({"echange":"e1","texte":"JSON","pourquoi":"réponse"}),
        ),
    ];
    assert_eq!(r.len(), attendu.len());
    for (p, (outil, args)) in r.iter().zip(attendu) {
        assert_eq!(p["outil"], outil);
        // Les options absentes peuvent être omises ou nulles : on compare ce qui est posé.
        for (k, v) in args.as_object().unwrap() {
            assert_eq!(&p["args"][k], v, "{outil}.{k} dans {p}");
        }
    }
}
