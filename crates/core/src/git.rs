//! Lecture de l'état git d'un répertoire de travail (branche + dirty), via le binaire `git`.

use std::process::Command;

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct GitInfo {
    pub branch: Option<String>,
    pub dirty: bool,
}

/// Branche courante + état dirty d'un cwd. Hors repo git → branch None, dirty false.
///
/// `symbolic-ref --short HEAD` renvoie la branche même sur un repo sans commit (HEAD non-né),
/// contrairement à `rev-parse --abbrev-ref HEAD`. Sur HEAD détaché, renvoie None.
pub fn git_info(cwd: &str) -> GitInfo {
    let branch = Command::new("git")
        .args(["symbolic-ref", "--short", "HEAD"])
        .current_dir(cwd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    let dirty = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(cwd)
        .output()
        .ok()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false);

    GitInfo { branch, dirty }
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
}
