//! Collecteur d'événements `commit` à partir de l'historique git des dépôts connus du store.

use std::path::Path;
use std::process::Command;
use std::sync::OnceLock;

use regex::Regex;

use crate::activity::store::Store;
use crate::activity::tickets::extract_ticket_ids;
use crate::activity::{EventKind, NewEvent};

/// Longueur maximale (en caractères) du corps de commit conservé dans `body.body`.
const MAX_BODY_CHARS: usize = 400;

/// Scanne tous les repos actifs du store depuis leur curseur `git:<dir>`, insère les
/// événements trouvés et avance le curseur. Retourne (nombre inséré, erreurs).
///
/// Un dossier disparu (déplacé/supprimé) est désactivé silencieusement (pas une erreur) ;
/// seul un échec de `git log` sur un dépôt toujours présent est remonté dans `errors`.
pub fn collect(
    store: &Store,
    author_email: Option<&str>,
    ticket_patterns: &[String],
    now: i64,
) -> (usize, Vec<String>) {
    let mut inserted = 0usize;
    let mut errors = Vec::new();

    let repos = match store.active_repos() {
        Ok(r) => r,
        Err(e) => return (0, vec![format!("lecture des dépôts actifs: {e}")]),
    };

    for dir in repos {
        if !Path::new(&dir).is_dir() {
            if let Err(e) = store.deactivate_repo(&dir) {
                errors.push(format!("désactivation de {dir}: {e}"));
            }
            continue;
        }

        let cursor_name = format!("git:{dir}");
        let since = store
            .get_cursor(&cursor_name)
            .ok()
            .flatten()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(0);

        match commits_since(&dir, since, author_email, ticket_patterns) {
            Ok(events) => match apply_scan(store, &cursor_name, events, now) {
                Ok(n) => inserted += n,
                Err(e) => errors.push(format!("{dir}: {e}")),
            },
            Err(e) => errors.push(format!("{dir}: {e}")),
        }
    }

    (inserted, errors)
}

/// Insère les événements d'un dépôt puis, seulement si l'insertion a réussi, avance son
/// curseur à `now - 3600`. Si l'insertion échoue, le curseur reste inchangé : sans ça, la
/// fenêtre de commits concernée serait perdue silencieusement et définitivement (elle ne
/// serait plus jamais rescannée, alors qu'aucun de ses commits n'a été persisté).
fn apply_scan(store: &Store, cursor_name: &str, events: Vec<NewEvent>, now: i64) -> Result<usize, String> {
    let n = store
        .insert_events(&events)
        .map_err(|e| format!("insertion des commits: {e}"))?;
    store
        .set_cursor(cursor_name, &(now - 3600).to_string())
        .map_err(|e| format!("avance du curseur: {e}"))?;
    Ok(n)
}

/// Commits d'un dépôt depuis `since` (epoch s) par `author` (None → `git config user.email`
/// du dépôt ; vide dans les deux cas → pas de filtre `--author`, tous les auteurs).
pub fn commits_since(
    dir: &str,
    since: i64,
    author: Option<&str>,
    ticket_patterns: &[String],
) -> Result<Vec<NewEvent>, String> {
    let author_email = match author {
        Some(a) if !a.is_empty() => a.to_string(),
        Some(_) => String::new(),
        None => config_user_email(dir).unwrap_or_default(),
    };

    let mut args = vec![
        "log".to_string(),
        "--all".to_string(),
        format!("--since=@{since}"),
    ];
    if !author_email.is_empty() {
        args.push(format!("--author={author_email}"));
    }
    args.push("--format=%x1e%H%x00%at%x00%s%x00%b".to_string());
    args.push("--numstat".to_string());

    let raw = run_git(dir, &args)?;
    Ok(parse_log(dir, &raw, ticket_patterns))
}

/// Branches locales non fusionnées dans HEAD (pour « reste à faire »). Hors repo git,
/// ou en cas d'échec de la commande, liste vide.
pub fn unmerged_branches(dir: &str) -> Vec<String> {
    // `--format` doit précéder `--no-merged` : sans argument explicite, `--no-merged` avale
    // sinon le token suivant (`--format=...`) comme s'il s'agissait d'un commit-ish.
    let Some(out) = git_out(dir, &["branch", "--format=%(refname:short)", "--no-merged"]) else {
        return Vec::new();
    };
    out.lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect()
}

/// Découpe la sortie brute de `git log --format=%x1e... --numstat` en événements.
fn parse_log(dir: &str, raw: &str, ticket_patterns: &[String]) -> Vec<NewEvent> {
    let mut events = Vec::new();
    for block in raw.split('\u{1e}') {
        if block.trim().is_empty() {
            continue;
        }
        let mut parts = block.splitn(4, '\u{0}');
        let sha = parts.next().unwrap_or("").trim();
        let ts: i64 = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
        let subject = parts.next().unwrap_or("").to_string();
        let rest = parts.next().unwrap_or("");
        if sha.is_empty() {
            continue;
        }

        let (files, added, deleted, body_text) = parse_numstat_and_body(rest);
        let branches = branches_containing(dir, sha);
        let branch = choose_branch(dir, sha, &branches);

        let branch_ref = branch.clone().unwrap_or_default();
        let ticket_ids =
            extract_ticket_ids(&[branch_ref.as_str(), subject.as_str(), body_text.as_str()], ticket_patterns);

        let truncated_body: String = body_text.chars().take(MAX_BODY_CHARS).collect();
        let body = serde_json::json!({
            "files": files,
            "added": added,
            "deleted": deleted,
            "branches": branches,
            "body": truncated_body,
        })
        .to_string();

        events.push(NewEvent {
            ts,
            kind: EventKind::Commit,
            workspace_dir: Some(dir.to_string()),
            branch,
            title: subject,
            body: Some(body),
            ticket_ids,
            source_ref: sha.to_string(),
        });
    }
    events
}

/// Sépare les lignes numstat (`^(\d+|-)\t(\d+|-)\t...`) du corps du commit dans le 4e champ
/// (`%b` suivi, à même le texte, des lignes `--numstat`). `-` (binaire) compte pour 0.
fn parse_numstat_and_body(rest: &str) -> (u64, u64, u64, String) {
    let mut files = 0u64;
    let mut added = 0u64;
    let mut deleted = 0u64;
    let mut body_lines = Vec::new();
    for line in rest.split('\n') {
        if let Some(caps) = numstat_re().captures(line) {
            files += 1;
            added += caps[1].parse::<u64>().unwrap_or(0);
            deleted += caps[2].parse::<u64>().unwrap_or(0);
        } else {
            body_lines.push(line);
        }
    }
    let body = body_lines.join("\n").trim().to_string();
    (files, added, deleted, body)
}

fn numstat_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^(\d+|-)\t(\d+|-)\t").unwrap())
}

/// Branches (locales ou distantes) contenant `sha`, `HEAD` et `*/HEAD` exclus.
fn branches_containing(dir: &str, sha: &str) -> Vec<String> {
    let Some(out) = git_out(dir, &["branch", "--all", "--contains", sha, "--format=%(refname:short)"])
    else {
        return Vec::new();
    };
    out.lines()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty() && s != "HEAD" && !s.ends_with("/HEAD"))
        .collect()
}

/// Choisit la branche attribuée à `sha` : si `sha` est la pointe d'une (ou plusieurs)
/// branches, cette branche prime sur les branches qui ne le contiennent que comme ancêtre
/// (cas d'une branche créée après ce commit, qui hérite tous les commits antérieurs de sa
/// base sans que ce commit lui « appartienne ») ; sinon, repli sur `containing`, la liste
/// complète des branches contenant `sha` (déjà filtrée de HEAD/*/HEAD).
fn choose_branch(dir: &str, sha: &str, containing: &[String]) -> Option<String> {
    let tips = git_out(dir, &["branch", "--all", "--points-at", sha, "--format=%(refname:short)"])
        .map(|out| {
            out.lines()
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty() && s != "HEAD" && !s.ends_with("/HEAD"))
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let pool = if tips.is_empty() { containing } else { &tips };
    pick_branch(pool)
}

/// Choisit une branche locale de préférence ; sinon une branche distante `origin/x` → `x`.
fn pick_branch(branches: &[String]) -> Option<String> {
    if let Some(local) = branches.iter().find(|b| !b.starts_with("origin/")) {
        return Some(local.clone());
    }
    branches.first().map(|b| b.trim_start_matches("origin/").to_string())
}

/// `git config user.email` du dépôt, ou None si absent / hors repo.
fn config_user_email(dir: &str) -> Option<String> {
    git_out(dir, &["config", "user.email"]).map(|s| s.trim().to_string()).filter(|s| !s.is_empty())
}

/// Exécute git dans `dir` ; None si la commande échoue (hors repo, git absent, dossier
/// inexistant). Ne prend pas de verrou d'index (lecture seule).
fn git_out(dir: &str, args: &[&str]) -> Option<String> {
    Command::new("git")
        .args(args)
        .current_dir(dir)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
}

/// Comme `git_out`, mais renvoie l'erreur (message stderr, ou d'exécution) au lieu de None :
/// utilisé pour `git log`, dont l'échec doit remonter jusqu'à l'appelant.
fn run_git(dir: &str, args: &[String]) -> Result<String, String> {
    let str_args: Vec<&str> = args.iter().map(|s| s.as_str()).collect();
    let out = Command::new("git")
        .args(&str_args)
        .current_dir(dir)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .map_err(|e| format!("échec du lancement de git: {e}"))?;
    if !out.status.success() {
        return Err(format!(
            "git {}: {}",
            str_args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        ));
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::activity::store::Store;
    use std::process::Command as StdCommand;

    /// Exécute git dans `dir` et panique avec stderr si la commande échoue.
    fn git(dir: &std::path::Path, args: &[&str]) {
        let out = StdCommand::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(
            out.status.success(),
            "git {args:?} a échoué: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// Crée un repo git temporaire vierge (branche main, user configuré).
    fn tmp_repo(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("terminials-act-git-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        git(&dir, &["config", "user.email", "moi@x.fr"]);
        git(&dir, &["config", "user.name", "moi"]);
        git(&dir, &["config", "init.defaultBranch", "main"]);
        dir
    }

    fn write_file(dir: &std::path::Path, name: &str, content: &[u8]) {
        std::fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn commits_since_filtre_auteur_et_lit_toutes_les_branches() {
        let dir = tmp_repo("act-git");
        write_file(&dir, "a.txt", b"1\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-qm", "feat: a CU-86c1abc"]);
        git(&dir, &["checkout", "-qb", "feature/CU-86c1abd_x"]);
        write_file(&dir, "b.txt", b"1\n2\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-qm", "fix: b"]);
        git(
            &dir,
            &["-c", "user.email=autre@x.fr", "-c", "user.name=Autre", "commit", "-q", "--allow-empty", "-m", "pas moi"],
        );
        let evs = commits_since(dir.to_str().unwrap(), 0, Some("moi@x.fr"), &[]).unwrap();
        assert_eq!(evs.len(), 2);
        let b = evs.iter().find(|e| e.title == "fix: b").unwrap();
        assert_eq!(b.branch.as_deref(), Some("feature/CU-86c1abd_x"));
        assert_eq!(b.ticket_ids, vec!["86c1abd"]);
        let body: serde_json::Value = serde_json::from_str(b.body.as_deref().unwrap()).unwrap();
        assert_eq!(body["files"], 1);
        assert_eq!(body["added"], 2);
        let a = evs.iter().find(|e| e.title.starts_with("feat: a")).unwrap();
        assert_eq!(a.ticket_ids, vec!["86c1abc"]);
        assert!(
            unmerged_branches(dir.to_str().unwrap()).is_empty(),
            "sur la feature branch tout est fusionné dans HEAD"
        );
        git(&dir, &["checkout", "-q", "main"]);
        assert_eq!(unmerged_branches(dir.to_str().unwrap()), vec!["feature/CU-86c1abd_x"]);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn commits_since_hors_repo_rend_err() {
        assert!(commits_since("/", 0, Some("x@y"), &[]).is_err());
    }

    #[test]
    fn collect_avance_le_cursor_par_repo_et_desactive_les_dossiers_disparus() {
        let dir = tmp_repo("act-git2");
        write_file(&dir, "a.txt", b"1\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-qm", "c"]);
        let store = Store::open_in_memory().unwrap();
        store
            .register_repos(&[dir.to_str().unwrap().to_string(), "/nonexistent/repo".into()], 1)
            .unwrap();
        let (n, errs) = collect(&store, Some("moi@x.fr"), &[], 2_000_000_000);
        assert_eq!(n, 1);
        assert!(errs.is_empty(), "un dossier disparu n'est pas une erreur : {errs:?}");
        assert_eq!(store.active_repos().unwrap().len(), 1);
        assert!(store.get_cursor(&format!("git:{}", dir.display())).unwrap().is_some());
        assert_eq!(collect(&store, Some("moi@x.fr"), &[], 2_000_000_000).0, 0);
        let _ = std::fs::remove_dir_all(&dir);
    }
}
