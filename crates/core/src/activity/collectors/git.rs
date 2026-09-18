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

/// Profondeur du tout premier scan d'un dépôt (30 jours), faute de curseur.
const PREMIER_SCAN_SECONDES: i64 = 30 * 86_400;

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
        // Curseur absent (premier passage sur ce dépôt) : on borne à 30 jours en
        // arrière, comme le collecteur ClickUp. Sans borne, la première passe
        // parcourait tout l'historique personnel de chaque dépôt connu — et la
        // liste des dépôts inclut tout projet où Claude Code a tourné un jour.
        let since = store
            .get_cursor(&cursor_name)
            .ok()
            .flatten()
            .and_then(|s| s.parse::<i64>().ok())
            .unwrap_or(now - PREMIER_SCAN_SECONDES);

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

    let mut args = vec!["log".to_string(), "--all".to_string()];
    // `--since=@0` ne veut PAS dire « depuis epoch » : l'analyseur de dates de git
    // refuse `@0` et, en cas d'échec, `approxidate()` renvoie l'heure courante
    // (`git rev-parse --since=@0` affiche `--max-age=<maintenant>`). Un `since`
    // nul ou négatif doit donc se traduire par *aucun* filtre de date, sans quoi
    // un premier scan ne rapporterait que les commits de la seconde en cours.
    if since > 0 {
        args.push(format!("--since=@{since}"));
    }
    if !author_email.is_empty() {
        args.push(format!("--author={author_email}"));
    }
    // `%D` (refnames de la pointe) et `%S` (la référence par laquelle `--all` a
    // atteint le commit, grâce à `--source`) donnent la branche sans aucun
    // sous-processus par commit. L'ancien `branch --all --contains <sha>` par
    // commit coûtait plusieurs secondes sur un dépôt à 7 000 branches, et la
    // collecte tenait le verrou du store pendant tout ce temps : interface figée.
    args.push("--source".to_string());
    args.push("--format=%x1e%H%x00%at%x00%D%x00%S%x00%s%x00%b".to_string());
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
        let mut parts = block.splitn(6, '\u{0}');
        let sha = parts.next().unwrap_or("").trim();
        let ts: i64 = parts.next().unwrap_or("0").trim().parse().unwrap_or(0);
        let refnames = parts.next().unwrap_or("");
        let source = parts.next().unwrap_or("");
        let subject = parts.next().unwrap_or("").to_string();
        let rest = parts.next().unwrap_or("");
        if sha.is_empty() {
            continue;
        }

        let (files, added, deleted, body_text) = parse_numstat_and_body(rest);
        // Pointe d'une branche : `%D` fait foi. Sinon, la référence source (`%S`)
        // par laquelle le parcours `--all` a atteint le commit. Zéro sous-processus.
        let tip = branches_from_refnames(refnames);
        let branches = if tip.is_empty() { branch_from_source(source) } else { tip };
        let branch = pick_branch(&branches);

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

/// Branche déduite de `%S` (`--source`) : `refs/heads/x` → `x`, `refs/remotes/origin/x`
/// → `origin/x` (que `pick_branch` ramène à `x`). `HEAD`, `*/HEAD`, les tags et une
/// source vide ne donnent rien.
fn branch_from_source(source: &str) -> Vec<String> {
    let s = source.trim();
    if s.is_empty() || s == "HEAD" || s.ends_with("/HEAD") || s.starts_with("refs/tags/") {
        return Vec::new();
    }
    let name = s
        .strip_prefix("refs/heads/")
        .or_else(|| s.strip_prefix("refs/remotes/"))
        .unwrap_or(s);
    vec![name.to_string()]
}

/// Branches dont `sha` est la **pointe**, lues dans `%D` (`refnames`) du `git log`
/// déjà lancé : `HEAD -> feature/x, origin/main, tag: v1`. `HEAD`, `*/HEAD` et les
/// tags sont écartés. Une pointe prime sur les branches qui ne contiennent le
/// commit que comme ancêtre (une branche créée après lui hérite de tout
/// l'historique de sa base sans que ce commit lui « appartienne »).
fn branches_from_refnames(refnames: &str) -> Vec<String> {
    refnames
        .split(',')
        .map(|s| s.trim())
        .map(|s| s.strip_prefix("HEAD -> ").unwrap_or(s))
        .filter(|s| !s.is_empty() && *s != "HEAD" && !s.ends_with("/HEAD") && !s.starts_with("tag: "))
        .map(|s| s.to_string())
        .collect()
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

    /// Premier horodatage des commits de fixture : 2026-09-16 09:00:00 UTC. Chaque
    /// commit d'un test en reçoit un distinct et croissant (`commit_at`) pour que
    /// l'ordre et le filtrage par date ne dépendent jamais de l'horloge de la machine.
    const TS_FIXTURE: i64 = 1_789_549_200;

    /// Exécute git dans `dir` et panique avec stderr si la commande échoue.
    fn git(dir: &std::path::Path, args: &[&str]) {
        git_env(dir, args, &[]);
    }

    /// Comme `git`, avec des variables d'environnement supplémentaires.
    fn git_env(dir: &std::path::Path, args: &[&str], env: &[(&str, String)]) {
        let mut cmd = StdCommand::new("git");
        cmd.args(args).current_dir(dir);
        for (k, v) in env {
            cmd.env(k, v);
        }
        let out = cmd.output().unwrap();
        assert!(
            out.status.success(),
            "git {args:?} a échoué: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// `git commit` avec des dates d'auteur et de commit figées (`TS_FIXTURE + decalage`).
    fn commit_at(dir: &std::path::Path, decalage: i64, args: &[&str]) {
        let date = format!("{} +0000", TS_FIXTURE + decalage);
        let mut all = vec!["commit"];
        all.extend_from_slice(args);
        git_env(
            dir,
            &all,
            &[("GIT_AUTHOR_DATE", date.clone()), ("GIT_COMMITTER_DATE", date)],
        );
    }

    /// Crée un repo git temporaire vierge (branche main, user configuré). Le
    /// `TempDir` doit rester vivant : il supprime le dossier quand il est détruit.
    fn tmp_repo() -> tempfile::TempDir {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path();
        git(dir, &["init", "-q", "-b", "main"]);
        git(dir, &["config", "user.email", "moi@x.fr"]);
        git(dir, &["config", "user.name", "moi"]);
        git(dir, &["config", "init.defaultBranch", "main"]);
        tmp
    }

    fn write_file(dir: &std::path::Path, name: &str, content: &[u8]) {
        std::fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn commits_since_filtre_auteur_et_lit_toutes_les_branches() {
        let tmp = tmp_repo();
        let dir = tmp.path();
        write_file(dir, "a.txt", b"1\n");
        git(dir, &["add", "."]);
        commit_at(dir, 0, &["-qm", "feat: a CU-86c1abc"]);
        git(dir, &["checkout", "-qb", "feature/CU-86c1abd_x"]);
        write_file(dir, "b.txt", b"1\n2\n");
        git(dir, &["add", "."]);
        commit_at(dir, 60, &["-qm", "fix: b"]);
        // Commit d'un autre auteur (identité passée par l'environnement : `-c` ne peut
        // pas être combiné avec `-m`), qui doit être exclu par le filtre `--author`.
        let date_autre = format!("{} +0000", TS_FIXTURE + 120);
        git_env(
            dir,
            &["commit", "-q", "--allow-empty", "-m", "pas moi"],
            &[
                ("GIT_AUTHOR_DATE", date_autre.clone()),
                ("GIT_COMMITTER_DATE", date_autre),
                ("GIT_AUTHOR_NAME", "Autre".to_string()),
                ("GIT_AUTHOR_EMAIL", "autre@x.fr".to_string()),
                ("GIT_COMMITTER_NAME", "Autre".to_string()),
                ("GIT_COMMITTER_EMAIL", "autre@x.fr".to_string()),
            ],
        );
        let evs = commits_since(dir.to_str().unwrap(), TS_FIXTURE - 86400, Some("moi@x.fr"), &[]).unwrap();
        assert_eq!(evs.len(), 2, "événements lus : {:?}", evs.iter().map(|e| &e.title).collect::<Vec<_>>());
        let b = evs.iter().find(|e| e.title == "fix: b").unwrap();
        assert_eq!(b.branch.as_deref(), Some("feature/CU-86c1abd_x"));
        assert_eq!(b.ticket_ids, vec!["86c1abd"]);
        let body: serde_json::Value = serde_json::from_str(b.body.as_deref().unwrap()).unwrap();
        assert_eq!(body["files"], 1);
        assert_eq!(body["added"], 2);
        let a = evs.iter().find(|e| e.title.starts_with("feat: a")).unwrap();
        assert_eq!(a.ticket_ids, vec!["86c1abc"]);
        // Pointe de main : la branche vient de %D, sans sous-processus supplémentaire.
        assert_eq!(a.branch.as_deref(), Some("main"));
        assert_eq!(a.ts, TS_FIXTURE, "l'horodatage vient du commit, pas de l'horloge");
        assert!(
            unmerged_branches(dir.to_str().unwrap()).is_empty(),
            "sur la feature branch tout est fusionné dans HEAD"
        );
        git(dir, &["checkout", "-q", "main"]);
        assert_eq!(unmerged_branches(dir.to_str().unwrap()), vec!["feature/CU-86c1abd_x"]);
    }

    /// `since = 0` (curseur absent) doit rendre *tout* l'historique. `--since=@0`
    /// est refusé par l'analyseur de dates de git, qui se rabat alors sur l'heure
    /// courante : sans la garde de `commits_since`, un premier scan ne verrait que
    /// les commits de la seconde en cours (et ce test échouerait ~une fois sur dix).
    #[test]
    fn commits_since_zero_lit_tout_l_historique() {
        let tmp = tmp_repo();
        let dir = tmp.path();
        write_file(dir, "a.txt", b"1\n");
        git(dir, &["add", "."]);
        commit_at(dir, 0, &["-qm", "ancien"]);
        write_file(dir, "b.txt", b"2\n");
        git(dir, &["add", "."]);
        commit_at(dir, 60, &["-qm", "récent"]);
        let evs = commits_since(dir.to_str().unwrap(), 0, Some("moi@x.fr"), &[]).unwrap();
        assert_eq!(evs.len(), 2, "événements lus : {:?}", evs.iter().map(|e| &e.title).collect::<Vec<_>>());
        // « ancien » n'est la pointe d'aucune branche : sa branche vient de `%S`
        // (`--source`), sans `branch --contains` par commit.
        let ancien = evs.iter().find(|e| e.title == "ancien").unwrap();
        assert_eq!(ancien.branch.as_deref(), Some("main"));
    }

    #[test]
    fn la_source_donne_la_branche_sans_sous_processus() {
        assert_eq!(branch_from_source("refs/heads/feature/x"), vec!["feature/x".to_string()]);
        assert_eq!(branch_from_source("refs/remotes/origin/main"), vec!["origin/main".to_string()]);
        assert!(branch_from_source("refs/tags/v1").is_empty());
        assert!(branch_from_source("refs/remotes/origin/HEAD").is_empty());
        assert!(branch_from_source("HEAD").is_empty());
        assert!(branch_from_source("").is_empty());
    }

    #[test]
    fn refnames_ignorent_head_et_les_tags() {
        assert_eq!(
            branches_from_refnames("HEAD -> feature/x, origin/feature/x, tag: v1.2, origin/HEAD"),
            vec!["feature/x".to_string(), "origin/feature/x".to_string()]
        );
        assert!(branches_from_refnames("").is_empty());
        assert!(branches_from_refnames("tag: v1.2").is_empty(), "un tag seul ne fait pas une branche");
        assert!(branches_from_refnames("HEAD").is_empty());
    }

    #[test]
    fn commits_since_hors_repo_rend_err() {
        assert!(commits_since("/", 0, Some("x@y"), &[]).is_err());
    }

    #[test]
    fn collect_avance_le_cursor_par_repo_et_desactive_les_dossiers_disparus() {
        let tmp = tmp_repo();
        let dir = tmp.path();
        write_file(dir, "a.txt", b"1\n");
        git(dir, &["add", "."]);
        commit_at(dir, 0, &["-qm", "c"]);
        let store = Store::open_in_memory().unwrap();
        store
            .register_repos(&[dir.to_str().unwrap().to_string(), "/nonexistent/repo".into()], 1)
            .unwrap();
        // `now` proche des commits de fixture : le repli « curseur absent » borne
        // le premier scan à 30 jours en arrière (cf. `collect`).
        let now = TS_FIXTURE + 3600;
        let (n, errs) = collect(&store, Some("moi@x.fr"), &[], now);
        assert_eq!(n, 1);
        assert!(errs.is_empty(), "un dossier disparu n'est pas une erreur : {errs:?}");
        assert_eq!(store.active_repos().unwrap().len(), 1);
        assert!(store.get_cursor(&format!("git:{}", dir.display())).unwrap().is_some());
        assert_eq!(collect(&store, Some("moi@x.fr"), &[], now).0, 0);
    }
}
