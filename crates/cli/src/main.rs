use clap::{Parser, Subcommand};
use terminials_cli::{send_request, socket_path, with_workspace_id};

#[derive(Parser)]
#[command(name = "terminials", about = "CLI de pilotage de l'app terminials")]
struct Cli {
    #[command(subcommand)]
    cmd: Cmd,
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
    /// Installe les hooks d'intégration (Claude Code).
    Hooks {
        #[command(subcommand)]
        action: HooksAction,
    },
}

#[derive(Subcommand)]
enum HooksAction {
    /// Installe le script de notification Claude Code.
    Setup,
}

fn main() {
    let cli = Cli::parse();

    // Les commandes filesystem (hooks) sont traitées avant l'accès socket.
    if let Cmd::Hooks { action: HooksAction::Setup } = &cli.cmd {
        match terminials_cli::hooks::setup() {
            Ok(path) => {
                println!("Hook installé : {}", path.display());
                let entry = format!(
                    "[{{ \"hooks\": [{{ \"type\": \"command\", \"command\": \"{}\" }}] }}]",
                    path.display()
                );
                println!("Ajoute ceci à ~/.claude/settings.json :");
                println!("  \"hooks\": {{ \"Stop\": {entry}, \"Notification\": {entry} }}");
            }
            Err(e) => {
                eprintln!("échec installation hook : {e}");
                std::process::exit(1);
            }
        }
        return;
    }

    let (method, params) = match cli.cmd {
        Cmd::Ping => ("ping", serde_json::Value::Null),
        Cmd::Notify { title, subtitle, body } => (
            "notify",
            with_workspace_id(
                serde_json::json!({"title": title, "subtitle": subtitle, "body": body}),
            ),
        ),
        Cmd::NewWorkspace { cwd } => ("new-workspace", serde_json::json!({"cwd": cwd})),
        Cmd::SetStatus { label, color } => (
            "set-status",
            with_workspace_id(serde_json::json!({"label": label, "color": color})),
        ),
        Cmd::SetProgress { value, label } => (
            "set-progress",
            with_workspace_id(serde_json::json!({"value": value, "label": label})),
        ),
        Cmd::Hooks { .. } => unreachable!("traité plus haut"),
    };

    match send_request(&socket_path(), method, params) {
        Ok(resp) if resp.status == protocol::Status::Ok => {
            println!("{}", serde_json::to_string(&resp.data).unwrap());
        }
        Ok(resp) => {
            eprintln!("erreur: {}", resp.error.unwrap_or_default());
            std::process::exit(1);
        }
        Err(e) => {
            eprintln!("connexion impossible ({e}). L'app terminials est-elle lancée ?");
            std::process::exit(1);
        }
    }
}
