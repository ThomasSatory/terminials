//! Exécution partagée du binaire `claude` en mode non interactif (`claude -p`).
//!
//! Deux fournisseurs s'en servent : les synthèses (`llm::ClaudeCli`) et la
//! collecte ClickUp via les outils MCP (`clickup::ClickupMcp`). Le prompt part
//! **toujours** par stdin : plusieurs options de `claude` sont variadiques
//! (`--allowedTools`) et avaleraient un prompt passé en argument positionnel.

use std::time::Duration;

#[derive(Debug, Clone, PartialEq)]
pub enum ClaudeProcessError {
    /// Le binaire n'a pas pu être lancé (absent du `PATH`, non exécutable…).
    Spawn(String),
    /// Le délai maximum a été atteint ; le process a été tué.
    Timeout,
    /// Code de sortie non nul. `stderr` est tronqué à 500 caractères.
    Failed { code: i32, stderr: String },
}

impl std::fmt::Display for ClaudeProcessError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            ClaudeProcessError::Spawn(msg) => write!(f, "claude introuvable : {msg}"),
            ClaudeProcessError::Timeout => write!(f, "délai dépassé"),
            ClaudeProcessError::Failed { code, stderr } => {
                write!(f, "claude a échoué (code {code}) : {stderr}")
            }
        }
    }
}

impl std::error::Error for ClaudeProcessError {}

/// Lance `binary args…`, écrit `input` sur son stdin, et rend son stdout écourté
/// des espaces de bord.
///
/// `stderr` n'est lu que pour être rapporté en cas d'échec : `claude` y écrit un
/// avertissement « MCP servers blocked by enterprise policy » même quand tout va
/// bien, qu'il ne faut pas confondre avec une erreur.
pub fn run_claude_p(
    binary: &str,
    args: &[&str],
    input: &str,
    timeout: Duration,
) -> Result<String, ClaudeProcessError> {
    use std::io::{Read, Write};
    use std::process::{Command, Stdio};

    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| ClaudeProcessError::Spawn(e.to_string()))?;

    if let Some(mut stdin) = child.stdin.take() {
        // Écriture dans un thread séparé : un prompt plus gros que le tampon du
        // tube (64 Kio) bloquerait sinon le parent pendant que l'enfant attend,
        // lui, que son propre stdout soit lu.
        let bytes = input.as_bytes().to_vec();
        std::thread::spawn(move || {
            let _ = stdin.write_all(&bytes);
        });
    }
    let lecteur = |flux: Option<std::process::ChildStdout>| {
        flux.map(|mut f| {
            std::thread::spawn(move || {
                let mut buf = String::new();
                let _ = f.read_to_string(&mut buf);
                buf
            })
        })
    };
    let stdout_lu = lecteur(child.stdout.take());
    let stderr_lu = child.stderr.take().map(|mut f| {
        std::thread::spawn(move || {
            let mut buf = String::new();
            let _ = f.read_to_string(&mut buf);
            buf
        })
    });

    let debut = std::time::Instant::now();
    let status = loop {
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) => {
                if debut.elapsed() >= timeout {
                    let _ = child.kill();
                    let _ = child.wait();
                    return Err(ClaudeProcessError::Timeout);
                }
                std::thread::sleep(Duration::from_millis(100));
            }
            Err(e) => return Err(ClaudeProcessError::Spawn(e.to_string())),
        }
    };

    let stdout = stdout_lu.and_then(|h| h.join().ok()).unwrap_or_default();
    let stderr = stderr_lu.and_then(|h| h.join().ok()).unwrap_or_default();

    if !status.success() {
        return Err(ClaudeProcessError::Failed {
            code: status.code().unwrap_or(-1),
            stderr: stderr.chars().take(500).collect(),
        });
    }
    Ok(stdout.trim().to_string())
}

/// Lancement d'un `claude` dont on lit la sortie au fil de l'eau (`run_claude_stream`).
pub struct OptionsFlux<'a> {
    pub binaire: &'a str,
    pub args: &'a [String],
    /// Prompt, écrit sur stdin (jamais en argument : cf. en-tête du module).
    pub entree: &'a str,
    /// Répertoire de travail ; `None` : celui du process courant.
    pub dossier: Option<&'a std::path::Path>,
    /// Variables ajoutées (ou remplacées) dans l'environnement hérité.
    pub env: &'a [(String, String)],
    /// Variables retirées de l'environnement hérité.
    pub env_retire: &'a [String],
    pub delai: Duration,
    /// Passé à vrai par un autre thread : le process est tué au plus vite.
    pub arret: &'a std::sync::atomic::AtomicBool,
}

/// Issue d'un `run_claude_stream` qui n'a pas échoué.
#[derive(Debug, Clone, PartialEq)]
pub enum FinFlux {
    /// Le process s'est terminé de lui-même avec le code 0.
    Termine,
    /// `arret` est passé à vrai : le process (et son groupe) a été tué.
    Interrompu,
}

/// Lance `binaire args…`, écrit `entree` sur stdin et passe chaque ligne de stdout à
/// `sur_ligne` dès qu'elle arrive (sortie `--output-format stream-json`), sur le
/// thread appelant.
///
/// Le process est mis dans son propre groupe : l'arrêter (interruption, délai) tue
/// aussi les commandes qu'il a lancées (Bash), sans quoi elles survivraient orphelines.
/// Sous Linux, il reçoit en plus SIGKILL si le thread appelant disparaît (fermeture
/// brutale de l'app) : jamais de `claude` qui tourne encore après l'app.
pub fn run_claude_stream(
    o: &OptionsFlux<'_>,
    sur_ligne: &mut dyn FnMut(&str),
) -> Result<FinFlux, ClaudeProcessError> {
    use std::io::{BufRead, Read, Write};
    use std::os::unix::process::CommandExt;
    use std::process::{Command, Stdio};
    use std::sync::atomic::Ordering;
    use std::sync::{mpsc, Arc, Mutex};
    use std::time::Instant;

    let mut cmd = Command::new(o.binaire);
    cmd.args(o.args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(d) = o.dossier {
        cmd.current_dir(d);
    }
    for nom in o.env_retire {
        cmd.env_remove(nom);
    }
    for (nom, valeur) in o.env {
        cmd.env(nom, valeur);
    }
    cmd.process_group(0);
    signaux::mourir_avec_le_parent(&mut cmd);
    let mut child = cmd
        .spawn()
        .map_err(|e| ClaudeProcessError::Spawn(e.to_string()))?;
    let pgid = child.id();

    if let Some(mut stdin) = child.stdin.take() {
        // Même raison que `run_claude_p` : ne pas bloquer sur un tube plein.
        let bytes = o.entree.as_bytes().to_vec();
        std::thread::spawn(move || {
            let _ = stdin.write_all(&bytes);
        });
    }
    // stdout ligne à ligne par un canal, pour pouvoir surveiller arrêt et délai pendant
    // que `claude` réfléchit sans rien écrire.
    let (tx, rx) = mpsc::channel::<String>();
    if let Some(stdout) = child.stdout.take() {
        std::thread::spawn(move || {
            let mut lecteur = std::io::BufReader::new(stdout);
            let mut ligne = String::new();
            loop {
                ligne.clear();
                match lecteur.read_line(&mut ligne) {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        if tx
                            .send(ligne.trim_end_matches(['\n', '\r']).to_string())
                            .is_err()
                        {
                            break;
                        }
                    }
                }
            }
        });
    } else {
        drop(tx);
    }
    // stderr : rempli par un thread qu'on ne joint jamais (un petit-enfant peut garder
    // le tube ouvert) ; on prend ce qui est arrivé.
    let stderr_lu = Arc::new(Mutex::new(String::new()));
    let mut fil_stderr = None;
    if let Some(mut f) = child.stderr.take() {
        let dest = stderr_lu.clone();
        fil_stderr = Some(std::thread::spawn(move || {
            let mut buf = [0u8; 4096];
            while let Ok(n) = f.read(&mut buf) {
                if n == 0 {
                    break;
                }
                let mut d = dest.lock().unwrap_or_else(|e| e.into_inner());
                if d.len() < 8_000 {
                    d.push_str(&String::from_utf8_lossy(&buf[..n]));
                }
            }
        }));
    }
    // Laisse un court instant au lecteur de stderr pour finir (le message d'erreur
    // arrive souvent en même temps que la sortie du process).
    let stderr_court = || -> String {
        if let Some(f) = &fil_stderr {
            let debut = Instant::now();
            while !f.is_finished() && debut.elapsed() < Duration::from_millis(300) {
                std::thread::sleep(Duration::from_millis(10));
            }
        }
        stderr_lu
            .lock()
            .unwrap_or_else(|e| e.into_inner())
            .chars()
            .take(500)
            .collect()
    };

    let debut = Instant::now();
    let mut eof = false;
    let mut sortie: Option<(std::process::ExitStatus, Instant)> = None;
    loop {
        if !eof {
            match rx.recv_timeout(Duration::from_millis(100)) {
                Ok(ligne) => {
                    if !ligne.trim().is_empty() {
                        sur_ligne(&ligne);
                    }
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
                Err(mpsc::RecvTimeoutError::Disconnected) => eof = true,
            }
        } else if sortie.is_none() {
            std::thread::sleep(Duration::from_millis(50));
        }
        if o.arret.load(Ordering::SeqCst) {
            if sortie.is_none() {
                signaux::arreter_groupe(&mut child, pgid);
            }
            return Ok(FinFlux::Interrompu);
        }
        if sortie.is_none() {
            match child.try_wait() {
                Ok(Some(status)) => sortie = Some((status, Instant::now())),
                Ok(None) => {}
                Err(e) => {
                    signaux::arreter_groupe(&mut child, pgid);
                    return Err(ClaudeProcessError::Spawn(e.to_string()));
                }
            }
        }
        if let Some((status, quand)) = sortie {
            // Le process est fini : on lit encore les dernières lignes, sauf si un
            // petit-enfant garde stdout ouvert (on ne l'attend pas, on le tue).
            if eof || quand.elapsed() >= Duration::from_millis(500) {
                signaux::tuer_groupe(pgid);
                if !status.success() {
                    return Err(ClaudeProcessError::Failed {
                        code: status.code().unwrap_or(-1),
                        stderr: stderr_court(),
                    });
                }
                return Ok(FinFlux::Termine);
            }
        } else if debut.elapsed() >= o.delai {
            signaux::arreter_groupe(&mut child, pgid);
            return Err(ClaudeProcessError::Timeout);
        }
    }
}

/// Signaux POSIX dont `run_claude_stream` a besoin (la bibliothèque standard ne sait
/// tuer que le process lui-même, pas son groupe). La libc est toujours liée sous Unix.
mod signaux {
    use std::ffi::c_int;
    use std::time::Duration;

    const SIGKILL: c_int = 9;
    const SIGTERM: c_int = 15;

    extern "C" {
        fn kill(pid: c_int, sig: c_int) -> c_int;
        #[cfg(target_os = "linux")]
        fn prctl(option: c_int, ...) -> c_int;
        #[cfg(target_os = "linux")]
        fn getppid() -> c_int;
    }

    /// SIGKILL à tout le groupe (process et commandes qu'il a lancées). Une erreur
    /// (groupe déjà vide) est sans conséquence.
    pub fn tuer_groupe(pgid: u32) {
        if let Ok(p) = c_int::try_from(pgid) {
            if p > 1 {
                // SAFETY : appel système sans effet sur la mémoire du process.
                unsafe {
                    kill(-p, SIGKILL);
                }
            }
        }
    }

    /// Demande poliment (SIGTERM, pour que `claude` range sa session), puis tue le
    /// groupe et récolte l'enfant. Le groupe est tué AVANT la récolte : tant que
    /// l'enfant n'est pas récolté, son numéro ne peut pas être réattribué.
    pub fn arreter_groupe(child: &mut std::process::Child, pgid: u32) {
        if let Ok(p) = c_int::try_from(pgid) {
            if p > 1 {
                // SAFETY : idem `tuer_groupe`.
                unsafe {
                    kill(-p, SIGTERM);
                }
            }
        }
        std::thread::sleep(Duration::from_millis(200));
        tuer_groupe(pgid);
        let _ = child.kill();
        let _ = child.wait();
    }

    /// Sous Linux : l'enfant reçoit SIGKILL si le thread qui l'a lancé disparaît (app
    /// fermée ou plantée), donc pas d'orphelin même sans arrêt propre.
    #[cfg(target_os = "linux")]
    pub fn mourir_avec_le_parent(cmd: &mut std::process::Command) {
        use std::os::unix::process::CommandExt;
        const PR_SET_PDEATHSIG: c_int = 1;
        let parent = std::process::id() as c_int;
        // SAFETY : entre fork et exec, seuls des appels système async-signal-safe
        // (prctl, getppid) sont faits, sans allocation.
        unsafe {
            cmd.pre_exec(move || {
                if prctl(PR_SET_PDEATHSIG, SIGKILL as std::ffi::c_ulong) != 0 {
                    return Err(std::io::Error::last_os_error());
                }
                // Le parent est mort entre fork et prctl : ne pas démarrer orphelin.
                if getppid() != parent {
                    return Err(std::io::Error::other("parent disparu"));
                }
                Ok(())
            });
        }
    }

    #[cfg(not(target_os = "linux"))]
    pub fn mourir_avec_le_parent(_cmd: &mut std::process::Command) {}
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Écrit un script shell exécutable dans `dir` et rend son chemin.
    fn faux_binaire(dir: &std::path::Path, nom: &str, corps: &str) -> String {
        use std::os::unix::fs::PermissionsExt;
        let chemin = dir.join(nom);
        std::fs::write(&chemin, format!("#!/bin/sh\n{corps}\n")).unwrap();
        std::fs::set_permissions(&chemin, std::fs::Permissions::from_mode(0o755)).unwrap();
        chemin.display().to_string()
    }

    /// `run_claude_p` en réessayant sur `ETXTBSY` (« Text file busy »). Les tests
    /// tournent en parallèle : un autre thread peut être en train de forker
    /// pendant que nous écrivons un faux binaire, et le fils hérite brièvement du
    /// descripteur en écriture, ce qui interdit d'exécuter ce fichier. Le cas ne
    /// concerne que les faux binaires créés à la volée, jamais le vrai `claude`.
    fn lancer(
        bin: &str,
        args: &[&str],
        input: &str,
        timeout: Duration,
    ) -> Result<String, ClaudeProcessError> {
        for _ in 0..20 {
            match run_claude_p(bin, args, input, timeout) {
                Err(ClaudeProcessError::Spawn(msg)) if msg.contains("os error 26") => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                autre => return autre,
            }
        }
        run_claude_p(bin, args, input, timeout)
    }

    #[test]
    fn transmet_les_arguments_et_le_prompt_par_stdin() {
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_binaire(
            dir.path(),
            "faux-claude",
            r#"echo "args=$*"; echo "stdin=$(cat)""#,
        );
        let sortie = lancer(
            &bin,
            &["-p", "--model", "sonnet"],
            "bonjour",
            Duration::from_secs(10),
        )
        .unwrap();
        assert!(sortie.contains("args=-p --model sonnet"), "{sortie}");
        assert!(sortie.contains("stdin=bonjour"), "{sortie}");
    }

    #[test]
    fn code_de_sortie_non_nul_devient_failed_avec_stderr() {
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_binaire(dir.path(), "faux-claude", "echo 'boum' >&2; exit 3");
        match lancer(&bin, &[], "", Duration::from_secs(10)) {
            Err(ClaudeProcessError::Failed { code, stderr }) => {
                assert_eq!(code, 3);
                assert!(stderr.contains("boum"), "{stderr}");
            }
            autre => panic!("attendu Failed, obtenu {autre:?}"),
        }
    }

    #[test]
    fn stderr_bavard_avec_code_zero_reste_un_succes() {
        // `claude` écrit « MCP servers blocked by enterprise policy » sur stderr
        // même quand la commande réussit : ce n'est pas une erreur.
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_binaire(
            dir.path(),
            "faux-claude",
            "echo 'MCP servers blocked by enterprise policy' >&2; echo '{\"ok\":1}'",
        );
        assert_eq!(
            lancer(&bin, &[], "", Duration::from_secs(10)).unwrap(),
            "{\"ok\":1}"
        );
    }

    #[test]
    fn binaire_absent_devient_spawn() {
        // On évite de manipuler `PATH` (global au process de test) : un chemin
        // inexistant reproduit le même échec de lancement.
        assert!(matches!(
            run_claude_p("/nonexistent/claude", &[], "", Duration::from_secs(2)),
            Err(ClaudeProcessError::Spawn(_))
        ));
    }

    #[test]
    fn depassement_du_delai_tue_le_process() {
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_binaire(dir.path(), "faux-claude", "sleep 30");
        assert_eq!(
            lancer(&bin, &[], "", Duration::from_millis(300)),
            Err(ClaudeProcessError::Timeout)
        );
    }

    #[test]
    fn un_gros_prompt_ne_bloque_pas_sur_le_tube() {
        // Prompt plus gros que le tampon d'un tube (64 Kio) : l'écriture doit se
        // faire dans un thread, sinon parent et enfant s'attendent mutuellement.
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_binaire(dir.path(), "faux-claude", "wc -c");
        let prompt = "x".repeat(300_000);
        let sortie = lancer(&bin, &[], &prompt, Duration::from_secs(10)).unwrap();
        assert_eq!(sortie.trim(), "300000");
    }

    // --- run_claude_stream ---

    use std::sync::atomic::{AtomicBool, Ordering};

    /// `run_claude_stream` avec les lignes reçues, en réessayant sur `ETXTBSY` (cf. `lancer`).
    #[allow(clippy::too_many_arguments)]
    fn flux(
        bin: &str,
        args: &[String],
        entree: &str,
        env: &[(String, String)],
        retire: &[String],
        dossier: Option<&std::path::Path>,
        delai: Duration,
        arret: &AtomicBool,
    ) -> (Result<FinFlux, ClaudeProcessError>, Vec<String>) {
        for _ in 0..20 {
            let mut lignes = Vec::new();
            let o = OptionsFlux {
                binaire: bin,
                args,
                entree,
                dossier,
                env,
                env_retire: retire,
                delai,
                arret,
            };
            match run_claude_stream(&o, &mut |l| lignes.push(l.to_string())) {
                Err(ClaudeProcessError::Spawn(msg)) if msg.contains("os error 26") => {
                    std::thread::sleep(Duration::from_millis(50));
                }
                autre => return (autre, lignes),
            }
        }
        panic!("faux binaire toujours occupé");
    }

    #[test]
    fn flux_rend_chaque_ligne_avec_env_dossier_et_stdin() {
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_binaire(
            dir.path(),
            "faux-claude",
            r#"echo "args=$*"; echo "jeton=$JETON_TEST"; echo "retire=${RETIRE_TEST:-absent}"; echo "pwd=$(pwd)"; echo "stdin=$(cat)""#,
        );
        std::env::set_var("RETIRE_TEST", "present");
        let travail = tempfile::tempdir().unwrap();
        let arret = AtomicBool::new(false);
        let (res, lignes) = flux(
            &bin,
            &["-p".into(), "--verbose".into()],
            "réveil",
            &[("JETON_TEST".into(), "abc".into())],
            &["RETIRE_TEST".into()],
            Some(travail.path()),
            Duration::from_secs(10),
            &arret,
        );
        assert_eq!(res, Ok(FinFlux::Termine));
        assert_eq!(lignes[0], "args=-p --verbose");
        assert_eq!(lignes[1], "jeton=abc");
        assert_eq!(lignes[2], "retire=absent");
        let pwd = std::fs::canonicalize(travail.path()).unwrap();
        assert_eq!(lignes[3], format!("pwd={}", pwd.display()));
        assert_eq!(lignes[4], "stdin=réveil");
    }

    #[test]
    fn flux_code_non_nul_rend_failed_apres_les_lignes() {
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_binaire(
            dir.path(),
            "faux-claude",
            "echo '{\"type\":\"result\"}'; echo 'pas connecté' >&2; exit 1",
        );
        let arret = AtomicBool::new(false);
        let (res, lignes) = flux(
            &bin,
            &[],
            "",
            &[],
            &[],
            None,
            Duration::from_secs(10),
            &arret,
        );
        assert_eq!(lignes, vec!["{\"type\":\"result\"}".to_string()]);
        match res {
            Err(ClaudeProcessError::Failed { code: 1, stderr }) => {
                assert!(stderr.contains("pas connecté"), "{stderr}")
            }
            autre => panic!("attendu Failed, obtenu {autre:?}"),
        }
    }

    #[test]
    fn flux_binaire_absent_devient_spawn() {
        let arret = AtomicBool::new(false);
        let (res, _) = flux(
            "/nonexistent/claude",
            &[],
            "",
            &[],
            &[],
            None,
            Duration::from_secs(2),
            &arret,
        );
        assert!(matches!(res, Err(ClaudeProcessError::Spawn(_))));
    }

    /// Vrai si un process de ce pid existe encore (et n'est pas un zombie).
    fn vivant(pid: &str) -> bool {
        std::fs::read_to_string(format!("/proc/{pid}/stat"))
            .map(|s| {
                !s.split(')')
                    .nth(1)
                    .unwrap_or("")
                    .trim_start()
                    .starts_with('Z')
            })
            .unwrap_or(false)
    }

    #[test]
    fn flux_arret_tue_le_process_et_ses_enfants() {
        let dir = tempfile::tempdir().unwrap();
        // Le faux `claude` lance une commande longue (comme un Bash d'outil), écrit son
        // pid, puis attend.
        let bin = faux_binaire(
            dir.path(),
            "faux-claude",
            "sleep 30 & echo \"enfant=$!\"; wait",
        );
        let arret = std::sync::Arc::new(AtomicBool::new(false));
        let a2 = arret.clone();
        let enfant = std::sync::Arc::new(std::sync::Mutex::new(String::new()));
        let e2 = enfant.clone();
        let fil = std::thread::spawn(move || {
            for _ in 0..20 {
                let mut sur_ligne = |l: &str| {
                    if let Some(p) = l.strip_prefix("enfant=") {
                        *e2.lock().unwrap() = p.to_string();
                        a2.store(true, Ordering::SeqCst);
                    }
                };
                let o = OptionsFlux {
                    binaire: &bin,
                    args: &[],
                    entree: "",
                    dossier: None,
                    env: &[],
                    env_retire: &[],
                    delai: Duration::from_secs(20),
                    arret: &a2,
                };
                match run_claude_stream(&o, &mut sur_ligne) {
                    Err(ClaudeProcessError::Spawn(m)) if m.contains("os error 26") => {
                        std::thread::sleep(Duration::from_millis(50))
                    }
                    autre => return autre,
                }
            }
            panic!("faux binaire toujours occupé");
        });
        let debut = std::time::Instant::now();
        assert_eq!(fil.join().unwrap(), Ok(FinFlux::Interrompu));
        assert!(debut.elapsed() < Duration::from_secs(5));
        assert!(arret.load(Ordering::SeqCst));
        let pid = enfant.lock().unwrap().clone();
        assert!(!pid.is_empty());
        // Le `sleep` lancé par le faux `claude` est mort avec lui (même groupe).
        let mut mort = false;
        for _ in 0..40 {
            if !vivant(&pid) {
                mort = true;
                break;
            }
            std::thread::sleep(Duration::from_millis(50));
        }
        assert!(mort, "le sous-process {pid} a survécu à l'arrêt");
    }

    #[test]
    fn flux_delai_depasse_tue_le_process() {
        let dir = tempfile::tempdir().unwrap();
        let bin = faux_binaire(dir.path(), "faux-claude", "echo debut; sleep 30");
        let arret = AtomicBool::new(false);
        let debut = std::time::Instant::now();
        let (res, lignes) = flux(
            &bin,
            &[],
            "",
            &[],
            &[],
            None,
            Duration::from_millis(400),
            &arret,
        );
        assert_eq!(res, Err(ClaudeProcessError::Timeout));
        assert_eq!(lignes, vec!["debut".to_string()]);
        assert!(debut.elapsed() < Duration::from_secs(5));
    }

    #[test]
    fn flux_petit_enfant_qui_garde_stdout_ne_bloque_pas_la_fin() {
        let dir = tempfile::tempdir().unwrap();
        // Le process se termine mais laisse derrière lui une commande qui tient stdout.
        let bin = faux_binaire(dir.path(), "faux-claude", "echo fini; sleep 30 &");
        let arret = AtomicBool::new(false);
        let debut = std::time::Instant::now();
        let (res, lignes) = flux(
            &bin,
            &[],
            "",
            &[],
            &[],
            None,
            Duration::from_secs(20),
            &arret,
        );
        assert_eq!(res, Ok(FinFlux::Termine));
        assert_eq!(lignes, vec!["fini".to_string()]);
        assert!(debut.elapsed() < Duration::from_secs(5));
    }
}
