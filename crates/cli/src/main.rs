use std::io::Write;
use std::path::Path;

use clap::{Parser, Subcommand, ValueEnum};
use protocol::{args as a, Outil};
use terminials_cli::{formater_sortie, send_request, socket_path, with_workspace_id};

#[derive(Parser)]
#[command(name = "terminials", about = "CLI de pilotage de l'app terminials")]
struct Cli {
    /// Sortie JSON brute (la donnée renvoyée par l'app), pour un agent ou un script.
    #[arg(long, global = true)]
    json: bool,
    #[command(subcommand)]
    cmd: Cmd,
}

/// Ce qu'attend l'agent qui notifie (hooks Claude Code) : le front bloque la session sur
/// une demande d'autorisation, pour que rien n'y soit écrit sans l'utilisateur.
#[derive(Clone, Copy, Debug, PartialEq, Eq, ValueEnum)]
enum Attente {
    Autorisation,
    Question,
    Fin,
}

impl Attente {
    fn id(self) -> &'static str {
        match self {
            Attente::Autorisation => "autorisation",
            Attente::Question => "question",
            Attente::Fin => "fin",
        }
    }
}

#[derive(Subcommand)]
enum Cmd {
    /// Vérifie que l'app répond.
    Ping,
    /// Affiche une notification desktop.
    Notify {
        #[arg(long)]
        title: String,
        #[arg(long, default_value = "")]
        subtitle: String,
        #[arg(long)]
        body: String,
        /// Pourquoi l'agent s'arrête : autorisation, question ou fin.
        #[arg(long, value_enum)]
        attente: Option<Attente>,
    },
    /// Crée un nouveau workspace.
    NewWorkspace {
        #[arg(long)]
        cwd: String,
    },
    /// Définit un statut (pill) sur le workspace actif.
    SetStatus {
        #[arg(long)]
        label: String,
        #[arg(long)]
        color: Option<String>,
    },
    /// Définit une barre de progression (0.0–1.0) sur le workspace actif.
    SetProgress {
        #[arg(long)]
        value: f64,
        #[arg(long)]
        label: Option<String>,
    },
    /// Signale la session Claude Code qui tourne dans l'onglet (hooks SessionStart / SessionEnd),
    /// pour la reprendre au prochain lancement de l'app.
    ClaudeSession {
        #[arg(long)]
        session_id: String,
        /// Dossier de la session (requis au démarrage, `claude --resume` en dépend).
        #[arg(long)]
        cwd: Option<String>,
        /// La session est terminée par l'utilisateur : ne plus la reprendre.
        #[arg(long)]
        ended: bool,
    },
    /// Signale qu'un agent travaille dans l'onglet (hooks UserPromptSubmit / PostToolUse).
    Busy,
    /// Signale que l'agent de l'onglet ne travaille plus (hooks Stop / Notification / SessionEnd).
    Idle,
    /// Installe les hooks d'intégration (Claude Code), ou en donne l'état.
    Hooks {
        #[command(subcommand)]
        action: HooksAction,
    },

    // --- Outils du superviseur (et des agents des espaces). Chaque appel passe par le
    // garde-fou de l'app : selon le niveau d'autonomie réglé, il est exécuté, mis en
    // attente de validation (carte « À valider ») ou refusé. ---
    /// Liste les espaces, leurs onglets et l'état de leurs agents (outil espaces.etat).
    Espaces {
        /// Un seul espace (id, nom ou début de nom).
        espace: Option<String>,
    },
    /// Lit les dernières lignes du terminal d'un espace (outil terminal.lire).
    Lire {
        espace: String,
        #[arg(long)]
        onglet: Option<String>,
        #[arg(long)]
        lignes: Option<u32>,
    },
    /// Prévient l'utilisateur (fil et bulle du superviseur ; outil notifier).
    Prevenir {
        texte: String,
        #[arg(long)]
        titre: Option<String>,
        #[arg(long)]
        espace: Option<String>,
    },
    /// Pose le résumé d'une phrase d'un espace, affiché dans le poste de suivi
    /// (outil espace.resumer, réservé au superviseur).
    Resumer { espace: String, texte: String },
    /// Pose une question à un autre espace, ou au superviseur sans espace (outil demander).
    /// `terminials demander api-paiements "…"` ou `terminials demander "…"`.
    Demander {
        /// Espace interrogé, puis la question ; la question seule s'adresse au superviseur.
        #[arg(num_args = 1..=2, required = true)]
        mots: Vec<String>,
    },
    /// Crée un espace (outil espace.creer).
    Creer {
        #[arg(long)]
        dossier: String,
        #[arg(long)]
        nom: Option<String>,
        #[arg(long)]
        groupe: Option<String>,
        #[arg(long)]
        couleur: Option<String>,
    },
    /// Renomme un espace (outil espace.renommer).
    Renommer { espace: String, nom: String },
    /// Range un espace dans un groupe, ou hors groupe, à une position (outil espace.deplacer).
    Deplacer {
        espace: String,
        #[arg(long, conflicts_with = "hors_groupe")]
        groupe: Option<String>,
        #[arg(long)]
        hors_groupe: bool,
        #[arg(long)]
        position: Option<u32>,
    },
    /// Ferme un espace (outil espace.fermer).
    Fermer { espace: String },
    /// Crée un groupe, et y range des espaces (outil groupe.creer).
    Groupe {
        nom: String,
        #[arg(long)]
        couleur: Option<String>,
        /// Espaces à y ranger, séparés par des virgules.
        #[arg(long, value_delimiter = ',')]
        espaces: Vec<String>,
    },
    /// Ouvre un onglet dans un espace (outil onglet.ouvrir).
    Onglet {
        espace: String,
        #[arg(long)]
        dossier: Option<String>,
    },
    /// Affiche un espace (outil espace.focus).
    Aller {
        espace: String,
        #[arg(long)]
        onglet: Option<String>,
    },
    /// Écrit dans le terminal d'un espace (outil terminal.ecrire) : toujours soumis à validation.
    Ecrire {
        espace: String,
        texte: String,
        #[arg(long)]
        onglet: Option<String>,
        /// N'appuie pas sur Entrée après le texte.
        #[arg(long)]
        sans_entree: bool,
        /// Raison montrée à l'utilisateur sur la carte « À valider ».
        #[arg(long, default_value = "")]
        pourquoi: String,
    },
    /// Transmet la question d'un échange à l'espace interrogé (outil session.demander).
    Transmettre {
        echange: String,
        texte: String,
        #[arg(long, default_value = "")]
        pourquoi: String,
    },
    /// Rend la réponse d'un échange à l'espace qui a demandé (outil session.repondre).
    Repondre {
        echange: String,
        texte: String,
        #[arg(long, default_value = "")]
        pourquoi: String,
    },
}

/// Corps d'un appel d'outil : `{"outil": id, "args": {...}}`, complété par le jeton du
/// superviseur (s'il est dans l'environnement) et l'espace émetteur.
fn appel_outil(
    outil: protocol::Outil,
    args: impl serde::Serialize,
) -> (&'static str, serde_json::Value) {
    let mut params = serde_json::json!({ "outil": outil, "args": args });
    if let Some(jeton) = jeton_superviseur() {
        params["jeton"] = serde_json::Value::String(jeton);
    }
    (protocol::METHODE_OUTIL, with_workspace_id(params))
}

/// Jeton du superviseur, présent seulement dans l'environnement du `claude` qu'il lance.
fn jeton_superviseur() -> Option<String> {
    std::env::var(protocol::ENV_JETON_SUPERVISEUR)
        .ok()
        .filter(|j| !j.is_empty())
}

#[derive(Subcommand)]
enum HooksAction {
    /// Installe le script et le déclare dans ~/.claude/settings.json (sans toucher au reste,
    /// original sauvegardé à côté). Sans effet si c'est déjà fait.
    Setup,
    /// Dit si les hooks sont installés, sans rien modifier.
    #[command(alias = "status")]
    Etat,
}

fn main() {
    let cli = Cli::parse();
    let code = executer(
        cli,
        &socket_path(),
        &mut std::io::stdout(),
        &mut std::io::stderr(),
    );
    std::process::exit(code);
}

/// Traduit la commande en requête socket et écrit le résultat. Rend le code de sortie :
/// 0 si l'app a répondu « ok » (y compris « en attente de validation », qui n'est pas un
/// échec), 1 sinon (refus du garde-fou, erreur, app injoignable), message sur `erreurs`.
fn executer(cli: Cli, socket: &Path, sortie: &mut dyn Write, erreurs: &mut dyn Write) -> i32 {
    let json = cli.json;

    // Les commandes filesystem (hooks) sont traitées avant l'accès socket.
    if let Cmd::Hooks { action } = &cli.cmd {
        // Le superviseur a droit à `terminials *` : installer les hooks modifierait
        // ~/.claude/settings.json sans passer par le garde-fou. Réservé à l'utilisateur.
        if matches!(action, HooksAction::Setup) && jeton_superviseur().is_some() {
            let _ = writeln!(erreurs, "erreur : l'installation des hooks est réservée à l'utilisateur (Paramètres › Agents).");
            return 1;
        }
        let res = match action {
            HooksAction::Setup => terminials_cli::hooks::setup(),
            HooksAction::Etat => terminials_cli::hooks::etat(),
        };
        return match res {
            Ok(etat) if json => {
                let _ = writeln!(
                    sortie,
                    "{}",
                    serde_json::to_string(&etat).unwrap_or_default()
                );
                0
            }
            Ok(etat) => {
                let _ = writeln!(sortie, "{}", terminials_cli::hooks::decrire(&etat));
                0
            }
            Err(e) => {
                let _ = writeln!(erreurs, "erreur : hooks non installés : {e}");
                1
            }
        };
    }

    let (method, params) = requete(cli.cmd);
    // L'outil appelé (pour formater sa réponse) : celui que porte la requête elle-même.
    let outil = (method == protocol::METHODE_OUTIL)
        .then(|| {
            params
                .get("outil")
                .and_then(|o| o.as_str())
                .and_then(Outil::depuis_id)
        })
        .flatten();

    match send_request(socket, method, params) {
        Ok(resp) if resp.status == protocol::Status::Ok => {
            if json {
                let _ = writeln!(
                    sortie,
                    "{}",
                    serde_json::to_string(&resp.data).unwrap_or_default()
                );
            } else if method == "ping" {
                let _ = writeln!(sortie, "L'app répond.");
            } else {
                let texte = formater_sortie(outil, &resp.data);
                if !texte.is_empty() {
                    let _ = writeln!(sortie, "{texte}");
                }
            }
            0
        }
        Ok(resp) => {
            let _ = writeln!(erreurs, "erreur: {}", resp.error.unwrap_or_default());
            1
        }
        Err(e) => {
            let _ = writeln!(
                erreurs,
                "connexion impossible ({e}). L'app terminials est-elle lancée ?"
            );
            1
        }
    }
}

/// Méthode et paramètres socket de la commande.
fn requete(cmd: Cmd) -> (&'static str, serde_json::Value) {
    match cmd {
        Cmd::Ping => ("ping", serde_json::Value::Null),
        Cmd::Notify {
            title,
            subtitle,
            body,
            attente,
        } => {
            let mut params =
                serde_json::json!({"title": title, "subtitle": subtitle, "body": body});
            if let Some(attente) = attente {
                params["attente"] = serde_json::Value::from(attente.id());
            }
            ("notify", with_workspace_id(params))
        }
        Cmd::NewWorkspace { cwd } => ("new-workspace", serde_json::json!({"cwd": cwd})),
        Cmd::SetStatus { label, color } => (
            "set-status",
            with_workspace_id(serde_json::json!({"label": label, "color": color})),
        ),
        Cmd::SetProgress { value, label } => (
            "set-progress",
            with_workspace_id(serde_json::json!({"value": value, "label": label})),
        ),
        Cmd::ClaudeSession {
            session_id,
            cwd,
            ended,
        } => (
            "claude-session",
            with_workspace_id(
                serde_json::json!({"sessionId": session_id, "cwd": cwd, "ended": ended}),
            ),
        ),
        Cmd::Busy => (
            "agent-busy",
            with_workspace_id(serde_json::json!({"busy": true})),
        ),
        Cmd::Idle => (
            "agent-busy",
            with_workspace_id(serde_json::json!({"busy": false})),
        ),
        Cmd::Hooks { .. } => unreachable!("traité avant l'accès au socket"),
        Cmd::Espaces { espace } => appel_outil(Outil::EspacesEtat, a::EspacesEtat { espace }),
        Cmd::Lire {
            espace,
            onglet,
            lignes,
        } => appel_outil(
            Outil::TerminalLire,
            a::TerminalLire {
                espace,
                onglet,
                lignes,
            },
        ),
        Cmd::Prevenir {
            texte,
            titre,
            espace,
        } => appel_outil(
            Outil::Notifier,
            a::Notifier {
                texte,
                titre,
                espace,
            },
        ),
        Cmd::Resumer { espace, texte } => {
            appel_outil(Outil::EspaceResumer, a::EspaceResumer { espace, texte })
        }
        Cmd::Demander { mut mots } => {
            let question = mots.pop().unwrap_or_default();
            appel_outil(
                Outil::Demander,
                a::Demander {
                    espace: mots.pop(),
                    question,
                },
            )
        }
        Cmd::Creer {
            dossier,
            nom,
            groupe,
            couleur,
        } => appel_outil(
            Outil::EspaceCreer,
            a::EspaceCreer {
                dossier,
                nom,
                groupe,
                couleur,
            },
        ),
        Cmd::Renommer { espace, nom } => {
            appel_outil(Outil::EspaceRenommer, a::EspaceRenommer { espace, nom })
        }
        Cmd::Deplacer {
            espace,
            groupe,
            hors_groupe,
            position,
        } => {
            let groupe = if hors_groupe {
                Some(String::new())
            } else {
                groupe
            };
            appel_outil(
                Outil::EspaceDeplacer,
                a::EspaceDeplacer {
                    espace,
                    groupe,
                    position,
                },
            )
        }
        Cmd::Fermer { espace } => appel_outil(Outil::EspaceFermer, a::EspaceFermer { espace }),
        Cmd::Groupe {
            nom,
            couleur,
            espaces,
        } => appel_outil(
            Outil::GroupeCreer,
            a::GroupeCreer {
                nom,
                couleur,
                espaces,
            },
        ),
        Cmd::Onglet { espace, dossier } => {
            appel_outil(Outil::OngletOuvrir, a::OngletOuvrir { espace, dossier })
        }
        Cmd::Aller { espace, onglet } => {
            appel_outil(Outil::EspaceFocus, a::EspaceFocus { espace, onglet })
        }
        Cmd::Ecrire {
            espace,
            texte,
            onglet,
            sans_entree,
            pourquoi,
        } => appel_outil(
            Outil::TerminalEcrire,
            a::TerminalEcrire {
                espace,
                onglet,
                texte,
                entree: !sans_entree,
                pourquoi,
            },
        ),
        Cmd::Transmettre {
            echange,
            texte,
            pourquoi,
        } => appel_outil(
            Outil::SessionDemander,
            a::SessionEchange {
                echange,
                texte,
                pourquoi,
            },
        ),
        Cmd::Repondre {
            echange,
            texte,
            pourquoi,
        } => appel_outil(
            Outil::SessionRepondre,
            a::SessionEchange {
                echange,
                texte,
                pourquoi,
            },
        ),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use clap::CommandFactory;

    #[test]
    fn la_ligne_de_commande_est_coherente() {
        Cli::command().debug_assert();
    }

    #[test]
    fn demander_avec_ou_sans_espace() {
        let cli = Cli::try_parse_from(["terminials", "demander", "api", "format ?"]).unwrap();
        let Cmd::Demander { mots } = cli.cmd else {
            panic!()
        };
        assert_eq!(mots, vec!["api".to_string(), "format ?".to_string()]);
        let cli = Cli::try_parse_from(["terminials", "demander", "branche ?"]).unwrap();
        let Cmd::Demander { mots } = cli.cmd else {
            panic!()
        };
        assert_eq!(mots, vec!["branche ?".to_string()]);
        assert!(Cli::try_parse_from(["terminials", "demander"]).is_err());
    }

    #[test]
    fn resumer_prend_un_espace_et_une_phrase() {
        let cli =
            Cli::try_parse_from(["terminials", "resumer", "api", "Écrit les tests."]).unwrap();
        let Cmd::Resumer { espace, texte } = cli.cmd else {
            panic!()
        };
        assert_eq!(espace, "api");
        assert_eq!(texte, "Écrit les tests.");
        assert!(Cli::try_parse_from(["terminials", "resumer", "api"]).is_err());
    }

    #[test]
    fn appel_outil_porte_l_id_et_les_arguments() {
        let (methode, params) = appel_outil(
            Outil::EspaceRenommer,
            a::EspaceRenommer {
                espace: "a".into(),
                nom: "b".into(),
            },
        );
        assert_eq!(methode, "outil");
        assert_eq!(params["outil"], "espace.renommer");
        assert_eq!(params["args"]["nom"], "b");
    }

    #[test]
    fn notify_porte_l_attente() {
        let cli = Cli::try_parse_from([
            "terminials",
            "notify",
            "--attente",
            "autorisation",
            "--title",
            "t",
            "--body",
            "b",
        ])
        .unwrap();
        let (m, p) = requete(cli.cmd);
        assert_eq!(m, "notify");
        assert_eq!(p["attente"], "autorisation");
        let cli =
            Cli::try_parse_from(["terminials", "notify", "--title", "t", "--body", "b"]).unwrap();
        assert!(requete(cli.cmd).1.get("attente").is_none());
        assert!(Cli::try_parse_from([
            "terminials",
            "notify",
            "--attente",
            "autre",
            "--title",
            "t",
            "--body",
            "b"
        ])
        .is_err());
    }

    #[test]
    fn ecrire_valide_par_entree_sauf_sans_entree() {
        let cli = Cli::try_parse_from(["terminials", "ecrire", "api", "1", "--pourquoi", "choix"])
            .unwrap();
        let (_, p) = requete(cli.cmd);
        assert_eq!(
            p["args"],
            serde_json::json!({"espace":"api","texte":"1","entree":true,"pourquoi":"choix"})
        );
        let cli =
            Cli::try_parse_from(["terminials", "ecrire", "api", "1", "--sans-entree"]).unwrap();
        assert_eq!(requete(cli.cmd).1["args"]["entree"], false);
        let cli = Cli::try_parse_from(["terminials", "deplacer", "api", "--hors-groupe"]).unwrap();
        assert_eq!(requete(cli.cmd).1["args"]["groupe"], "");
        assert!(Cli::try_parse_from([
            "terminials",
            "deplacer",
            "api",
            "--hors-groupe",
            "--groupe",
            "g"
        ])
        .is_err());
    }

    /// Dossier temporaire propre au test, supprimé à la fin (pas de dépendance `tempfile`
    /// dans ce crate).
    struct Temp(std::path::PathBuf);
    impl Temp {
        fn new() -> Temp {
            use std::sync::atomic::{AtomicU32, Ordering};
            static N: AtomicU32 = AtomicU32::new(0);
            let p = std::env::temp_dir().join(format!(
                "terminials-cli-{}-{}",
                std::process::id(),
                N.fetch_add(1, Ordering::SeqCst)
            ));
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

    /// Faux serveur : répond `reponse` à la première ligne reçue et la rend.
    fn faux_serveur(
        reponse: &'static str,
    ) -> (Temp, std::path::PathBuf, std::thread::JoinHandle<String>) {
        use std::io::{BufRead, BufReader};
        let dir = Temp::new();
        let chemin = dir.0.join("t.sock");
        let ecoute = std::os::unix::net::UnixListener::bind(&chemin).unwrap();
        let fil = std::thread::spawn(move || {
            let (mut flux, _) = ecoute.accept().unwrap();
            let mut ligne = String::new();
            BufReader::new(&flux).read_line(&mut ligne).unwrap();
            flux.write_all(reponse.as_bytes()).unwrap();
            ligne
        });
        (dir, chemin, fil)
    }

    fn lancer(args: &[&str], chemin: &Path) -> (i32, String, String) {
        let cli = Cli::try_parse_from(args).unwrap();
        let (mut out, mut err) = (Vec::new(), Vec::new());
        let code = executer(cli, chemin, &mut out, &mut err);
        (
            code,
            String::from_utf8(out).unwrap(),
            String::from_utf8(err).unwrap(),
        )
    }

    #[test]
    fn sortie_humaine_et_json() {
        const REP: &str = "{\"status\":\"ok\",\"data\":{\"espace\":{\"id\":\"ws:1\",\"nom\":\"api\"},\"onglet\":{\"id\":\"tab:2\",\"titre\":\"claude\"},\"lignes\":[\"$ ls\"]}}\n";
        let (_d, chemin, fil) = faux_serveur(REP);
        let (code, out, _) = lancer(&["terminials", "lire", "api", "--lignes", "5"], &chemin);
        assert_eq!(code, 0);
        assert_eq!(out, "── api › claude (1 lignes)\n$ ls\n");
        let ligne: serde_json::Value = serde_json::from_str(&fil.join().unwrap()).unwrap();
        assert_eq!(ligne["method"], "outil");
        assert_eq!(ligne["params"]["outil"], "terminal.lire");
        assert_eq!(ligne["params"]["args"]["lignes"], 5);

        let (_d, chemin, fil) = faux_serveur(REP);
        let (code, out, _) = lancer(&["terminials", "--json", "lire", "api"], &chemin);
        assert_eq!(code, 0);
        let data: serde_json::Value = serde_json::from_str(&out).unwrap();
        assert_eq!(data["lignes"][0], "$ ls");
        fil.join().unwrap();
    }

    #[test]
    fn en_attente_reussit_refus_echoue() {
        let (_d, chemin, fil) = faux_serveur(
            "{\"status\":\"ok\",\"data\":{\"statut\":\"en_attente\",\"demande\":\"d1\",\"message\":\"En attente de la validation de l'utilisateur.\"}}\n",
        );
        let (code, out, _) = lancer(
            &["terminials", "ecrire", "api", "oui", "--pourquoi", "p"],
            &chemin,
        );
        assert_eq!(code, 0);
        assert_eq!(
            out,
            "En attente de la validation de l'utilisateur. (demande d1)\n"
        );
        fil.join().unwrap();

        let (_d, chemin, fil) = faux_serveur(
            "{\"status\":\"error\",\"error\":\"Niveau Observer : écrire est refusé.\"}\n",
        );
        let (code, out, err) = lancer(&["terminials", "fermer", "api"], &chemin);
        assert_eq!(code, 1);
        assert_eq!(out, "");
        assert_eq!(err, "erreur: Niveau Observer : écrire est refusé.\n");
        fil.join().unwrap();
    }

    #[test]
    fn app_absente() {
        let dir = Temp::new();
        let (code, _, err) = lancer(&["terminials", "espaces"], &dir.0.join("absent.sock"));
        assert_eq!(code, 1);
        assert!(err.starts_with("connexion impossible"), "{err}");
    }
}
