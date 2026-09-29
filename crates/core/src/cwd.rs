//! Dossier courant d'un process, lu dans /proc (Linux, WSL).

use std::path::PathBuf;

/// `None` si le lien est illisible (process terminé, pas de /proc) ou si sa cible n'est plus un
/// dossier : le noyau suffixe « (deleted) » au chemin d'un dossier supprimé.
pub fn process_cwd(pid: u32) -> Option<PathBuf> {
    let path = std::fs::read_link(format!("/proc/{pid}/cwd")).ok()?;
    path.is_dir().then_some(path)
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn process_courant() {
        assert_eq!(process_cwd(std::process::id()), std::env::current_dir().ok());
    }

    #[test]
    fn enfant_lance_dans_un_dossier() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("sleep").arg("5").current_dir(dir.path()).spawn().unwrap();
        let got = process_cwd(child.id());
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(got, Some(dir.path().canonicalize().unwrap()));
    }

    #[test]
    fn dossier_supprime() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("sleep").arg("5").current_dir(dir.path()).spawn().unwrap();
        std::fs::remove_dir(dir.path()).unwrap();
        let got = process_cwd(child.id());
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(got, None);
    }

    #[test]
    fn pid_inexistant() {
        assert_eq!(process_cwd(u32::MAX), None);
    }
}
