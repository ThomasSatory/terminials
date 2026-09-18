//! Lecture de l'état git d'un répertoire de travail (branche + dirty), via le binaire `git`.

use std::collections::HashMap;
use std::process::Command;

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct GitInfo {
    pub branch: Option<String>,
    pub dirty: bool,
}

/// Branche courante d'un cwd. Hors repo git ou HEAD détachée → None.
///
/// Sonde GRATUITE : `symbolic-ref` lit `.git/HEAD`, il ne stat aucun fichier suivi
/// (mesuré à 0,00 s sur un repo de 20 000 fichiers). Elle est donc sondée à
/// intervalle fixe, séparément du dirty. Ne pas la fusionner avec `is_dirty` dans
/// une sonde unique : ce serait payer le prix du dirty pour rafraîchir la branche.
///
/// `symbolic-ref --short HEAD` renvoie la branche même sur un repo sans commit (HEAD non-né),
/// contrairement à `rev-parse --abbrev-ref HEAD`. Sur HEAD détaché, renvoie None.
pub fn branch(cwd: &str) -> Option<String> {
    Command::new("git")
        .args(["symbolic-ref", "--short", "HEAD"])
        .current_dir(cwd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Le worktree a-t-il des modifications (suivies ou non) ? Hors repo git → false.
///
/// Sonde CHÈRE, et irréductiblement : le coût est le `lstat` de chaque fichier
/// suivi. Mesures sur ~/dev/monorepo (20 401 fichiers suivis) :
/// `status --porcelain` 6,14 s · `status --untracked-files=no` 5,43 s ·
/// `diff --quiet` 6,05 s — et `core.fsmonitor` reste inopérant. Aucune variante
/// n'est bon marché, donc l'appelant doit espacer les appels selon leur coût
/// mesuré (`src/lib/pollSchedule.ts`), jamais les lancer sur un intervalle fixe.
pub fn is_dirty(cwd: &str) -> bool {
    Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(cwd)
        .output()
        .ok()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false)
}

/// Branche + état dirty en un appel. Conservé pour les appels ponctuels ;
/// les sondes périodiques utilisent `branch` et `is_dirty` séparément, à des
/// cadences différentes.
pub fn git_info(cwd: &str) -> GitInfo {
    GitInfo { branch: branch(cwd), dirty: is_dirty(cwd) }
}

/// Statut d'un fichier modifié. Un fichier à la fois staged et modifié (porcelain `MM`)
/// produit UNE seule entrée : le code XY de `git status --porcelain` fusionne déjà
/// index et worktree.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
}

/// Un fichier modifié du repo, avec ses compteurs +/− (None = binaire, ou untracked
/// — les fichiers untracked sont invisibles pour `git diff --numstat`).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub status: FileStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orig_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<u32>,
}

/// Exécute git dans `cwd` avec GIT_OPTIONAL_LOCKS=0 (jamais de prise de verrou d'index
/// par une commande de lecture). Retourne None si git échoue (hors repo, git absent).
fn git_out(cwd: &str, args: &[&str]) -> Option<Vec<u8>> {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| o.stdout)
}

/// Fichiers modifiés du repo (index + worktree fusionnés par `status --porcelain`),
/// enrichis des compteurs +/− de `diff --numstat` (worktree) et `diff --cached --numstat`
/// (staged), sommés par chemin. added/deleted None = binaire (ou untracked, absent des
/// numstat). Hors repo git → liste vide. Résultat trié par chemin.
pub fn changed_files(cwd: &str) -> Vec<ChangedFile> {
    let Some(raw) = git_out(cwd, &["status", "--porcelain=v1", "-z"]) else {
        return Vec::new();
    };
    // Format -z : `XY path\0` ; renommage/copie : `XY nouveau\0ancien\0` (ordre inversé
    // du format long, cf. doc git-status « the field order is reversed »).
    let fields: Vec<&[u8]> = raw.split(|&b| b == 0).collect();
    let mut files: Vec<ChangedFile> = Vec::new();
    let mut i = 0;
    while i < fields.len() {
        let f = fields[i];
        i += 1;
        if f.len() < 4 {
            continue; // champ final vide après le dernier NUL
        }
        let (x, y) = (f[0] as char, f[1] as char);
        let path = String::from_utf8_lossy(&f[3..]).into_owned();
        let orig_path = if matches!(x, 'R' | 'C') {
            let orig = fields.get(i).map(|o| String::from_utf8_lossy(o).into_owned());
            i += 1; // consomme le champ chemin d'origine
            orig
        } else {
            None
        };
        let status = match (x, y) {
            ('?', '?') => FileStatus::Untracked,
            ('R' | 'C', _) => FileStatus::Renamed,
            ('A', _) | (_, 'A') => FileStatus::Added,
            ('D', _) | (_, 'D') => FileStatus::Deleted,
            _ => FileStatus::Modified,
        };
        files.push(ChangedFile { path, status, orig_path, added: None, deleted: None });
    }

    // Compteurs +/− : worktree + staged, sommés. Un côté binaire (None) rend le total None.
    let mut stats: HashMap<String, (Option<u32>, Option<u32>)> = HashMap::new();
    for args in [&["diff", "--numstat", "-z"][..], &["diff", "--cached", "--numstat", "-z"][..]] {
        let Some(out) = git_out(cwd, args) else { continue };
        for (path, add, del) in parse_numstat_z(&out) {
            let e = stats.entry(path).or_insert((Some(0), Some(0)));
            e.0 = e.0.zip(add).map(|(a, b)| a + b);
            e.1 = e.1.zip(del).map(|(a, b)| a + b);
        }
    }
    for f in &mut files {
        if let Some((a, d)) = stats.get(&f.path) {
            f.added = *a;
            f.deleted = *d;
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files
}

/// Parse `git diff --numstat -z` : `add\tdel\tpath\0` par entrée ; pour un renommage le
/// champ chemin est vide et suivi de `pré-image\0post-image\0` (stats affectées à la
/// post-image). `-` (binaire) → None.
fn parse_numstat_z(raw: &[u8]) -> Vec<(String, Option<u32>, Option<u32>)> {
    let fields: Vec<String> =
        raw.split(|&b| b == 0).map(|f| String::from_utf8_lossy(f).into_owned()).collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < fields.len() {
        let rec = &fields[i];
        if rec.is_empty() {
            i += 1;
            continue;
        }
        let mut parts = rec.splitn(3, '\t');
        let (Some(a), Some(d), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
            i += 1;
            continue;
        };
        let add = a.parse::<u32>().ok();
        let del = d.parse::<u32>().ok();
        if path.is_empty() {
            if let Some(post) = fields.get(i + 2) {
                out.push((post.clone(), add, del));
            }
            i += 3;
        } else {
            out.push((path.to_string(), add, del));
            i += 1;
        }
    }
    out
}

/// Racine du repo contenant `cwd` (`git rev-parse --show-toplevel`), ou None hors repo.
/// `status`/`numstat` renvoient des chemins racine-relatifs quel que soit le cwd, alors
/// qu'un pathspec `git diff -- <path>` est interprété relativement au cwd : les commandes
/// qui reçoivent un tel chemin racine-relatif doivent donc s'exécuter depuis cette racine.
fn repo_root(cwd: &str) -> Option<String> {
    git_out(cwd, &["rev-parse", "--show-toplevel"])
        .map(|o| String::from_utf8_lossy(&o).trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Diff unifié d'un fichier : `git diff [--cached] --no-color -- <path>`.
/// Si le diff est vide et que le fichier n'est pas suivi, repli sur
/// `git diff --no-index /dev/null <path>` (untracked → diff « tout ajouté »).
/// `--no-index` sort avec le code 1 quand il y a des différences : normal, pas une erreur.
/// Fichier binaire : git émet « Binary files ... differ », renvoyé tel quel.
///
/// `path` est racine-relatif (fourni par `changed_files`) : on exécute depuis la racine
/// du repo pour que le pathspec (et le `<path>` du repli `--no-index`) corresponde même
/// si le workspace est ouvert sur un sous-dossier. Hors repo → comportement inchangé
/// (racine None ⇒ exécution dans `cwd`).
pub fn file_diff(cwd: &str, path: &str, staged: bool) -> String {
    let root = repo_root(cwd);
    let base = root.as_deref().unwrap_or(cwd);
    let mut args: Vec<&str> = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.extend_from_slice(&["--no-color", "--", path]);
    if let Some(out) = git_out(base, &args) {
        if !out.is_empty() {
            return String::from_utf8_lossy(&out).into_owned();
        }
    }
    if !staged && is_untracked(base, path) {
        // Pas de filtre sur le code de sortie : 1 = différences trouvées.
        if let Ok(o) = Command::new("git")
            .args(["diff", "--no-color", "--no-index", "--", "/dev/null", path])
            .current_dir(base)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .output()
        {
            return String::from_utf8_lossy(&o.stdout).into_owned();
        }
    }
    String::new()
}

/// Vrai si `path` n'est pas dans l'index (fichier untracked). `path` étant racine-relatif,
/// l'appelant doit passer la racine du repo en `cwd` (sinon un fichier suivi hors du cwd
/// serait faussement classé untracked).
fn is_untracked(cwd: &str, path: &str) -> bool {
    Command::new("git")
        .args(["ls-files", "--error-unmatch", "--", path])
        .current_dir(cwd)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .map(|o| !o.status.success())
        .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn reads_branch_of_a_git_repo() {
        let dir = std::env::temp_dir().join(format!("terminials-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let run = |args: &[&str]| {
            Command::new("git").args(args).current_dir(&dir).output().unwrap();
        };
        run(&["init", "-q", "-b", "maa-branche"]);
        let info = git_info(dir.to_str().unwrap());
        assert_eq!(info.branch.as_deref(), Some("maa-branche"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn does_not_panic_outside_repo() {
        // Ne doit pas paniquer hors d'un repo git.
        let _ = git_info("/");
    }

    // ---- sondes séparées : branch (gratuite) / is_dirty (chère) ----

    #[test]
    fn branch_seule_lit_la_branche_sans_scanner_le_worktree() {
        let dir = tmp_repo("branch-only");
        write_file(&dir, "sale.txt", b"non suivi\n");
        // La branche ne dépend pas de l'état du worktree : un fichier non suivi
        // ne la change pas, et `symbolic-ref` ne stat pas les fichiers suivis.
        assert_eq!(branch(dir.to_str().unwrap()).as_deref(), Some("main"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn branch_hors_repo_ou_head_detachee_rend_none() {
        assert!(branch("/").is_none());
        let dir = tmp_repo("detached");
        write_file(&dir, "a.txt", b"x\n");
        git(&dir, &["add", "a.txt"]);
        git(&dir, &["commit", "-qm", "c1"]);
        let sha = Command::new("git")
            .args(["rev-parse", "HEAD"])
            .current_dir(&dir)
            .output()
            .unwrap();
        let sha = String::from_utf8_lossy(&sha.stdout).trim().to_string();
        git(&dir, &["checkout", "-q", &sha]);
        assert!(branch(dir.to_str().unwrap()).is_none(), "HEAD détachée → None");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn is_dirty_distingue_propre_modifie_et_non_suivi() {
        let dir = tmp_repo("dirty");
        write_file(&dir, "a.txt", b"v1\n");
        git(&dir, &["add", "a.txt"]);
        git(&dir, &["commit", "-qm", "c1"]);
        assert!(!is_dirty(dir.to_str().unwrap()), "repo propre");

        write_file(&dir, "a.txt", b"v2\n");
        assert!(is_dirty(dir.to_str().unwrap()), "fichier suivi modifié");

        git(&dir, &["checkout", "--", "a.txt"]);
        write_file(&dir, "b.txt", b"nouveau\n");
        assert!(is_dirty(dir.to_str().unwrap()), "fichier non suivi");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn is_dirty_hors_repo_est_false() {
        assert!(!is_dirty("/"));
    }

    #[test]
    fn git_info_reste_la_composition_des_deux_sondes() {
        let dir = tmp_repo("compose");
        write_file(&dir, "a.txt", b"v1\n");
        let info = git_info(dir.to_str().unwrap());
        assert_eq!(info.branch, branch(dir.to_str().unwrap()));
        assert_eq!(info.dirty, is_dirty(dir.to_str().unwrap()));
        let _ = std::fs::remove_dir_all(&dir);
    }

    // ---- changed_files ----

    /// Exécute git dans `dir` et panique avec stderr si la commande échoue.
    fn git(dir: &std::path::Path, args: &[&str]) {
        let out = Command::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(
            out.status.success(),
            "git {args:?} a échoué: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// Crée un repo git temporaire vierge (branche main, user configuré).
    fn tmp_repo(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("terminials-cf-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        git(&dir, &["config", "user.email", "test@test.local"]);
        git(&dir, &["config", "user.name", "test"]);
        dir
    }

    fn write_file(dir: &std::path::Path, name: &str, content: &[u8]) {
        std::fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn changed_files_modified_worktree() {
        let dir = tmp_repo("modified");
        write_file(&dir, "a.txt", b"ligne1\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "a.txt", b"ligne2\n");
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "a.txt");
        assert_eq!(files[0].status, FileStatus::Modified);
        assert_eq!(files[0].added, Some(1));
        assert_eq!(files[0].deleted, Some(1));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_added_staged() {
        let dir = tmp_repo("added");
        write_file(&dir, "a.txt", b"x\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "b.txt", b"un\ndeux\n");
        git(&dir, &["add", "b.txt"]);
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "b.txt");
        assert_eq!(files[0].status, FileStatus::Added);
        assert_eq!(files[0].added, Some(2));
        assert_eq!(files[0].deleted, Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_deleted_worktree() {
        let dir = tmp_repo("deleted");
        write_file(&dir, "a.txt", b"x\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        std::fs::remove_file(dir.join("a.txt")).unwrap();
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, FileStatus::Deleted);
        assert_eq!(files[0].deleted, Some(1));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_renamed_staged() {
        let dir = tmp_repo("renamed");
        write_file(&dir, "a.txt", b"x\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        git(&dir, &["mv", "a.txt", "c.txt"]);
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "c.txt");
        assert_eq!(files[0].status, FileStatus::Renamed);
        assert_eq!(files[0].orig_path.as_deref(), Some("a.txt"));
        assert_eq!(files[0].added, Some(0));
        assert_eq!(files[0].deleted, Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_untracked() {
        let dir = tmp_repo("untracked");
        write_file(&dir, "nouveau.txt", b"contenu\n");
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "nouveau.txt");
        assert_eq!(files[0].status, FileStatus::Untracked);
        // Les untracked n'apparaissent pas dans numstat : pas de compteurs.
        assert_eq!(files[0].added, None);
        assert_eq!(files[0].deleted, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_staged_and_modified_appears_once() {
        // Porcelain `MM` : staged ET re-modifié dans le worktree → UNE entrée,
        // compteurs = somme des deux numstat (--cached : +1 ; worktree : +1).
        let dir = tmp_repo("mm");
        write_file(&dir, "a.txt", b"un\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "a.txt", b"un\ndeux\n");
        git(&dir, &["add", "a.txt"]);
        write_file(&dir, "a.txt", b"un\ndeux\ntrois\n");
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, FileStatus::Modified);
        assert_eq!(files[0].added, Some(2));
        assert_eq!(files[0].deleted, Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_binary_has_no_counts() {
        let dir = tmp_repo("binaire");
        write_file(&dir, "bin.dat", &[0u8, 1, 2, 3]);
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "bin.dat", &[0u8, 1, 2, 3, 4]);
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, FileStatus::Modified);
        // numstat émet `-\t-` pour un binaire → None.
        assert_eq!(files[0].added, None);
        assert_eq!(files[0].deleted, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_outside_repo_is_empty() {
        let dir = std::env::temp_dir().join(format!("terminials-cf-norepo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(changed_files(dir.to_str().unwrap()).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_file_serializes_camel_case_and_lowercase_status() {
        // Verrouille le contrat JSON consommé par le front (origPath, statuts minuscules).
        let f = ChangedFile {
            path: "a".into(),
            status: FileStatus::Renamed,
            orig_path: Some("b".into()),
            added: Some(1),
            deleted: None,
        };
        let v = serde_json::to_value(&f).unwrap();
        assert_eq!(v, serde_json::json!({"path": "a", "status": "renamed", "origPath": "b", "added": 1}));
    }

    // ---- file_diff ----

    #[test]
    fn file_diff_modified_contains_plus_minus() {
        let dir = tmp_repo("fd-mod");
        write_file(&dir, "a.txt", b"ligne1\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "a.txt", b"ligne2\n");
        let d = file_diff(dir.to_str().unwrap(), "a.txt", false);
        assert!(d.contains("-ligne1"), "diff: {d}");
        assert!(d.contains("+ligne2"), "diff: {d}");
        assert!(d.contains("@@"), "diff: {d}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_diff_untracked_via_no_index() {
        // Un untracked est invisible pour `git diff` : repli sur --no-index /dev/null,
        // dont le code de sortie 1 (différences trouvées) est normal.
        let dir = tmp_repo("fd-untracked");
        write_file(&dir, "nouveau.txt", b"contenu\n");
        let d = file_diff(dir.to_str().unwrap(), "nouveau.txt", false);
        assert!(d.contains("+contenu"), "diff: {d}");
        assert!(d.contains("/dev/null"), "diff: {d}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_diff_staged_uses_cached() {
        let dir = tmp_repo("fd-staged");
        write_file(&dir, "a.txt", b"un\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "a.txt", b"deux\n");
        git(&dir, &["add", "a.txt"]);
        let staged = file_diff(dir.to_str().unwrap(), "a.txt", true);
        assert!(staged.contains("+deux"), "diff staged: {staged}");
        // Worktree == index : diff non-staged vide, et PAS de repli --no-index
        // (le fichier est suivi).
        assert_eq!(file_diff(dir.to_str().unwrap(), "a.txt", false), "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_diff_binary_says_binary() {
        let dir = tmp_repo("fd-bin");
        write_file(&dir, "bin.dat", &[0u8, 1, 2, 3]);
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "bin.dat", &[0u8, 1, 2, 3, 4]);
        let d = file_diff(dir.to_str().unwrap(), "bin.dat", false);
        assert!(d.contains("Binary files"), "diff: {d}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_diff_depuis_un_sous_dossier_du_repo() {
        // status/numstat renvoient des chemins racine-relatifs quel que soit le cwd,
        // mais `git diff -- <path>` interprète le pathspec relativement au cwd :
        // ouvert sur un sous-dossier, le diff d'un fichier racine doit rester non vide.
        let dir = tmp_repo("fd-subdir");
        std::fs::create_dir(dir.join("sub")).unwrap();
        write_file(&dir, "a.txt", b"ligne1\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "a.txt", b"ligne2\n");
        let sub = dir.join("sub");
        let d = file_diff(sub.to_str().unwrap(), "a.txt", false);
        assert!(d.contains("-ligne1"), "diff: {d}");
        assert!(d.contains("+ligne2"), "diff: {d}");
        assert!(d.contains("@@"), "diff: {d}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_diff_untracked_depuis_un_sous_dossier_du_repo() {
        // Untracked à la racine, workspace ouvert sur un sous-dossier : le repli
        // `--no-index -- /dev/null <path>` doit résoudre le <path> racine-relatif
        // depuis la racine (sinon le fichier est introuvable → diff vide).
        let dir = tmp_repo("fd-subdir-untracked");
        std::fs::create_dir(dir.join("sub")).unwrap();
        write_file(&dir, "garde.txt", b"x\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "nouveau.txt", b"contenu\n");
        let sub = dir.join("sub");
        let d = file_diff(sub.to_str().unwrap(), "nouveau.txt", false);
        assert!(d.contains("+contenu"), "diff: {d}");
        assert!(d.contains("/dev/null"), "diff: {d}");
        let _ = std::fs::remove_dir_all(&dir);
    }
}
