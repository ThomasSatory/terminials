//! Hooks Claude Code de terminials : script `~/.claude/hooks/terminials-notify.sh` et sa
//! déclaration dans `~/.claude/settings.json`. Source unique pour la CLI
//! (`terminials hooks setup`) et pour la vue Paramètres (« Installer les hooks »).
//!
//! L'installation est idempotente et ne touche à rien d'autre que nos six déclarations :
//! le fichier de réglages de Claude Code appartient à l'utilisateur (permissions, modèle,
//! autres hooks…). Il est relu en gardant l'ordre de ses clés, sauvegardé avant toute
//! modification, puis réécrit de façon atomique. Un fichier illisible n'est jamais
//! écrasé : l'installation échoue en le disant.

mod json_ordonne;

use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;

pub use json_ordonne::Json;

/// Les six événements Claude Code que terminials écoute (maquette Paramètres).
pub const EVENEMENTS: [&str; 6] = [
    "UserPromptSubmit",
    "PostToolUse",
    "Stop",
    "Notification",
    "SessionStart",
    "SessionEnd",
];

/// Événements déclarés avec l'argument `busy` : ils partent très souvent (PostToolUse à
/// chaque outil) et prennent la voie rapide du script, sans jq.
const EVENEMENTS_BUSY: [&str; 2] = ["UserPromptSubmit", "PostToolUse"];

/// Nom du script, qui sert aussi à reconnaître nos déclarations quelle que soit la façon
/// dont le chemin a été écrit (`~`, `$HOME`, guillemets, ancienne version sans `busy`).
const NOM_SCRIPT: &str = "terminials-notify.sh";

/// Script embarqué. La comparaison octet à octet avec le fichier installé dit s'il est à
/// jour : toute modification ici fait proposer « Mettre à jour » dans les Paramètres.
pub const SCRIPT: &str = r#"#!/bin/bash
# Hook Claude Code -> terminials : notifie quand l'agent a fini / attend, et allume
# l'indicateur « au travail » de l'onglet entre le prompt et la fin du tour.
# Hors d'un terminal terminials (pas de TERMINIALS_WORKSPACE_ID), ne fait rien :
# le hook est déclaré dans la config Claude globale, donc aussi lu ailleurs.
[ -n "$TERMINIALS_WORKSPACE_ID" ] || exit 0
SOCK="${XDG_RUNTIME_DIR:-/tmp}/terminials.sock"
[ -S "$SOCK" ] || exit 0
# Voie rapide « busy » (UserPromptSubmit, PostToolUse, déclarés avec l'argument busy) :
# PostToolUse part à CHAQUE outil, avec la sortie de l'outil dans le JSON — ni jq ni titre.
if [ "$1" = "busy" ]; then
  cat >/dev/null
  terminials busy >/dev/null 2>&1
  exit 0
fi
# Notification avec la raison de l'attente (autorisation|question|fin). Une CLI plus
# ancienne que ce script ne connaît pas --attente (erreur d'usage, code 2) : on renvoie
# alors sans, l'app reconnaissant aussi le texte « Claude demande l'autorisation… ».
notifier() {
  terminials notify --attente "$1" --title "$2" --body "$3" >/dev/null 2>&1
  [ $? -eq 2 ] && terminials notify --title "$2" --body "$3" >/dev/null 2>&1
  return 0
}
EVENT=$(cat)
TYPE=$(echo "$EVENT" | jq -r '.hook_event_name // "unknown"' 2>/dev/null)
# Titre : « Claude · projet », le projet étant le dossier où tourne la session.
CWD=$(echo "$EVENT" | jq -r '.cwd // empty' 2>/dev/null)
TITLE="Claude${CWD:+ · ${CWD##*/}}"
case "$TYPE" in
  Stop)
    terminials idle >/dev/null 2>&1
    MSGS=(
      "Claude a terminé"
      "Claude a fini"
      "C'est prêt"
      "Terminé, à toi de jouer"
      "Fini ! Tu peux jeter un œil"
      "Travail terminé"
      "La balle est dans ton camp"
      "Mission accomplie"
    )
    notifier fin "$TITLE" "${MSGS[RANDOM % ${#MSGS[@]}]}" ;;
  Notification)
    terminials idle >/dev/null 2>&1
    MSG=$(echo "$EVENT" | jq -r '.message // empty' 2>/dev/null)
    KIND=$(echo "$EVENT" | jq -r '.notification_type // empty' 2>/dev/null)
    # Invite restée 60 s sans saisie : Claude n'attend rien de précis, la fin du tour a
    # déjà été signalée par Stop — et ce rappel part aussi après un /clear, sur une
    # session vide. Connexion réussie : rien à faire non plus. Ni l'un ni l'autre ne
    # mérite une notification « a besoin de toi ».
    case "$KIND" in idle_prompt|auth_success) exit 0 ;; esac
    [ "$MSG" = "Claude is waiting for your input" ] && exit 0
    # Une demande d'autorisation bloque la session jusqu'à la réponse de l'utilisateur :
    # le superviseur ne doit rien y écrire sans validation explicite.
    ATTENTE=question
    case "$MSG" in
      "Claude needs your permission to use "*) ATTENTE=autorisation ;;
    esac
    [ "$KIND" = "permission_prompt" ] && ATTENTE=autorisation
    # Claude Code écrit en anglais : on traduit le message connu.
    case "$MSG" in
      "Claude needs your permission to use "*) MSG="Claude demande l'autorisation d'utiliser ${MSG#Claude needs your permission to use }" ;;
      "") MSG="Claude attend ta réponse" ;;
    esac
    notifier "$ATTENTE" "$TITLE" "$MSG" ;;
  SessionStart|SessionEnd)
    [ "$TYPE" = "SessionEnd" ] && terminials idle >/dev/null 2>&1
    # Reprise des sessions au relancement de l'app : l'onglet retient la session qui y tourne.
    # Une session `claude -p` (entrypoint sdk-cli) n'est pas une session à reprendre.
    [ "$CLAUDE_CODE_ENTRYPOINT" = "sdk-cli" ] && exit 0
    SID=$(echo "$EVENT" | jq -r '.session_id // empty' 2>/dev/null)
    [ -n "$SID" ] || exit 0
    if [ "$TYPE" = "SessionStart" ]; then
      [ -n "$CWD" ] && terminials claude-session --session-id "$SID" --cwd "$CWD" >/dev/null 2>&1
    else
      # Seule une sortie voulue (/exit, Ctrl+D, /logout) oublie la session. La fermeture de
      # l'app tue Claude par SIGHUP, qui finit en reason=other : la session reste à reprendre.
      REASON=$(echo "$EVENT" | jq -r '.reason // empty' 2>/dev/null)
      case "$REASON" in
        prompt_input_exit|logout)
          terminials claude-session --session-id "$SID" --ended >/dev/null 2>&1 ;;
      esac
    fi ;;
esac
exit 0
"#;

/// État des hooks, tel que la vue Paramètres l'affiche.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EtatHooks {
    /// Le script existe, est exécutable et correspond à la version embarquée.
    pub script_a_jour: bool,
    /// Chemin du script (affiché une fois installé).
    pub chemin_script: String,
    /// Événements de `EVENEMENTS` déclarés dans `~/.claude/settings.json` vers ce script,
    /// avec la bonne commande.
    pub evenements_declares: Vec<String>,
    /// Script à jour ET les six événements déclarés.
    pub installes: bool,
}

/// `~/.claude/hooks/terminials-notify.sh`.
pub fn chemin_script(home: &Path) -> PathBuf {
    home.join(".claude/hooks").join(NOM_SCRIPT)
}

/// `~/.claude/settings.json`.
pub fn chemin_reglages_claude(home: &Path) -> PathBuf {
    home.join(".claude/settings.json")
}

/// Met un chemin entre apostrophes s'il contient un caractère que le shell interpréterait
/// (Claude Code passe la commande à `sh -c`).
fn citer_pour_shell(chemin: &str) -> String {
    let sur = |c: char| c.is_ascii_alphanumeric() || "/._-+@,:=%".contains(c);
    if !chemin.is_empty() && chemin.chars().all(sur) {
        chemin.to_string()
    } else {
        format!("'{}'", chemin.replace('\'', r"'\''"))
    }
}

/// Commande à déclarer pour `evenement`.
pub fn commande_attendue(script: &str, evenement: &str) -> String {
    let base = citer_pour_shell(script);
    if EVENEMENTS_BUSY.contains(&evenement) {
        format!("{base} busy")
    } else {
        base
    }
}

/// La commande appelle-t-elle notre script (quelle que soit l'écriture du chemin) ?
fn vise_notre_script(commande: &str) -> bool {
    let premier = premier_mot_shell(commande);
    premier == NOM_SCRIPT || premier.ends_with(&format!("/{NOM_SCRIPT}"))
}

/// Premier mot d'une commande shell, apostrophes, guillemets et barres obliques inverses
/// retirés (`'/a b/x.sh' busy` → `/a b/x.sh`). Suffisant pour reconnaître un chemin ; ne
/// prétend pas interpréter le shell (pas d'expansion).
fn premier_mot_shell(commande: &str) -> String {
    let mut mot = String::new();
    let mut chars = commande.trim_start().chars();
    let mut citation: Option<char> = None;
    while let Some(c) = chars.next() {
        match (citation, c) {
            (None, c) if c.is_whitespace() => break,
            (None, '\'' | '"') => citation = Some(c),
            (Some(q), c) if c == q => citation = None,
            (None | Some('"'), '\\') => mot.extend(chars.next()),
            (_, c) => mot.push(c),
        }
    }
    mot
}

/// Pourquoi la fusion refuse de toucher au fichier.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ErreurFusion(pub String);

impl std::fmt::Display for ErreurFusion {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(&self.0)
    }
}

/// Commandes de nos déclarations pour `evenement` (toutes les entrées, tous les hooks).
fn nos_commandes<'a>(reglages: &'a Json, evenement: &str) -> Vec<&'a str> {
    let Some(Json::Liste(entrees)) = reglages.champ("hooks").and_then(|h| h.champ(evenement))
    else {
        return Vec::new();
    };
    entrees
        .iter()
        .filter_map(|e| match e.champ("hooks") {
            Some(Json::Liste(l)) => Some(l),
            _ => None,
        })
        .flatten()
        .filter_map(|h| h.champ("command").and_then(Json::texte))
        .filter(|c| vise_notre_script(c))
        .collect()
}

/// Événements correctement déclarés vers `script` dans `reglages` (pur).
pub fn evenements_declares(reglages: &Json, script: &str) -> Vec<String> {
    EVENEMENTS
        .iter()
        .filter(|ev| {
            nos_commandes(reglages, ev)
                .iter()
                .any(|c| *c == commande_attendue(script, ev))
        })
        .map(|ev| ev.to_string())
        .collect()
}

/// Déclare nos six événements dans `reglages` (contenu de `~/.claude/settings.json`), en
/// conservant tout le reste : autres clés, autres hooks du même événement, ordre. Une
/// déclaration existante de notre script dont la commande a vieilli (chemin écrit
/// autrement, argument `busy` manquant) est corrigée sur place plutôt que dupliquée.
/// Rend vrai si quelque chose a changé. Une structure inattendue (`hooks` qui n'est pas
/// un objet…) est une erreur : mieux vaut ne rien écrire que d'écraser un réglage.
pub fn fusionner(reglages: &mut Json, script: &str) -> Result<bool, ErreurFusion> {
    if !matches!(reglages, Json::Objet(_)) {
        return Err(ErreurFusion(
            "le fichier de réglages de Claude Code n'est pas un objet JSON".into(),
        ));
    }
    let hooks = reglages
        .champ_ou_inserer("hooks", Json::objet_vide())
        .expect("objet vérifié");
    if !matches!(hooks, Json::Objet(_)) {
        return Err(ErreurFusion("la clé « hooks » n'est pas un objet".into()));
    }
    let mut change = false;
    for ev in EVENEMENTS {
        let attendue = commande_attendue(script, ev);
        let liste = hooks
            .champ_ou_inserer(ev, Json::Liste(Vec::new()))
            .expect("objet vérifié");
        let Json::Liste(entrees) = liste else {
            return Err(ErreurFusion(format!(
                "la déclaration « hooks.{ev} » n'est pas une liste"
            )));
        };
        let mut trouve = false;
        for entree in entrees.iter_mut() {
            let Some(Json::Liste(cmds)) = entree.champ_mut("hooks") else {
                continue;
            };
            for h in cmds.iter_mut() {
                let Some(cmd) = h.champ_mut("command") else {
                    continue;
                };
                let Some(texte) = cmd.texte() else { continue };
                if !vise_notre_script(texte) {
                    continue;
                }
                if texte != attendue {
                    *cmd = Json::Texte(attendue.clone());
                    change = true;
                }
                trouve = true;
            }
        }
        if !trouve {
            entrees.push(Json::Objet(vec![(
                "hooks".into(),
                Json::Liste(vec![Json::Objet(vec![
                    ("type".into(), Json::Texte("command".into())),
                    ("command".into(), Json::Texte(attendue)),
                ])]),
            )]));
            change = true;
        }
    }
    Ok(change)
}

fn script_a_jour(chemin: &Path) -> bool {
    use std::os::unix::fs::PermissionsExt;
    let executable = std::fs::metadata(chemin)
        .map(|m| m.permissions().mode() & 0o111 != 0)
        .unwrap_or(false);
    executable
        && std::fs::read(chemin)
            .map(|c| c == SCRIPT.as_bytes())
            .unwrap_or(false)
}

/// Lit `~/.claude/settings.json`. Absent : objet vide. Illisible : erreur (jamais écrasé).
fn lire_reglages_claude(chemin: &Path) -> std::io::Result<Json> {
    match std::fs::read_to_string(chemin) {
        Ok(texte) if texte.trim().is_empty() => Ok(Json::objet_vide()),
        Ok(texte) => serde_json::from_str(&texte).map_err(|e| {
            std::io::Error::other(format!(
                "{} n'est pas un JSON valide ({e}) : rien n'a été modifié",
                chemin.display()
            ))
        }),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Json::objet_vide()),
        Err(e) => Err(e),
    }
}

/// Lit l'état des hooks sous `home`. Ne modifie rien.
pub fn etat(home: &Path) -> EtatHooks {
    let script = chemin_script(home);
    let script_txt = script.display().to_string();
    let a_jour = script_a_jour(&script);
    let declares = lire_reglages_claude(&chemin_reglages_claude(home))
        .map(|r| evenements_declares(&r, &script_txt))
        .unwrap_or_default();
    let installes = a_jour && declares.len() == EVENEMENTS.len();
    EtatHooks {
        script_a_jour: a_jour,
        chemin_script: script_txt,
        evenements_declares: declares,
        installes,
    }
}

/// Écrit `contenu` à la place de `cible` sans fenêtre où le fichier serait tronqué :
/// fichier temporaire voisin, `fsync`, puis `rename`.
fn ecrire_atomique(cible: &Path, contenu: &[u8], mode: u32) -> std::io::Result<()> {
    use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
    let dossier = cible
        .parent()
        .ok_or_else(|| std::io::Error::other("chemin sans dossier parent"))?;
    let nom = cible
        .file_name()
        .and_then(|n| n.to_str())
        .unwrap_or("fichier");
    let tmp = dossier.join(format!(".{nom}.terminials-{}.tmp", std::process::id()));
    let res = (|| {
        let mut f = std::fs::OpenOptions::new()
            .write(true)
            .create(true)
            .truncate(true)
            .mode(mode)
            .open(&tmp)?;
        f.write_all(contenu)?;
        f.sync_all()?;
        // `mode` à l'ouverture passe par l'umask : on fixe les droits voulus explicitement.
        std::fs::set_permissions(&tmp, std::fs::Permissions::from_mode(mode))?;
        std::fs::rename(&tmp, cible)
    })();
    if res.is_err() {
        let _ = std::fs::remove_file(&tmp);
    }
    res
}

/// Chemin libre pour la sauvegarde de `fichier` : `settings.json.avant-terminials-<date>`,
/// suffixé si une sauvegarde de la même seconde existe déjà.
fn chemin_sauvegarde(fichier: &Path) -> PathBuf {
    let date = chrono::Local::now().format("%Y%m%d-%H%M%S");
    let base = format!("{}.avant-terminials-{date}", fichier.display());
    let mut chemin = PathBuf::from(&base);
    let mut n = 1;
    while chemin.exists() {
        n += 1;
        chemin = PathBuf::from(format!("{base}-{n}"));
    }
    chemin
}

/// Écrit le script (0755) et déclare les six événements dans `settings.json` en
/// conservant le reste du fichier. Idempotent : un second appel ne réécrit rien. Avant
/// toute modification d'un `settings.json` existant, l'original est copié à côté
/// (`settings.json.avant-terminials-<date>`). Rend l'état obtenu.
pub fn installer(home: &Path) -> std::io::Result<EtatHooks> {
    let script = chemin_script(home);
    let script_txt = script.display().to_string();

    // Le fichier de Claude Code est lu et vérifié AVANT d'écrire quoi que ce soit : un
    // JSON illisible arrête tout, script compris.
    let lien = chemin_reglages_claude(home);
    // Un settings.json en lien symbolique (dépôt de dotfiles) : on écrit dans sa cible,
    // sans remplacer le lien par un fichier.
    let fichier = std::fs::canonicalize(&lien).unwrap_or_else(|_| lien.clone());
    let mut reglages = lire_reglages_claude(&fichier)?;
    let change = fusionner(&mut reglages, &script_txt).map_err(|e| std::io::Error::other(e.0))?;

    if !script_a_jour(&script) {
        std::fs::create_dir_all(script.parent().expect("chemin sous ~/.claude/hooks"))?;
        ecrire_atomique(&script, SCRIPT.as_bytes(), 0o755)?;
    }

    if change {
        use std::os::unix::fs::PermissionsExt;
        let mode = match std::fs::metadata(&fichier) {
            Ok(m) => {
                std::fs::copy(&fichier, chemin_sauvegarde(&fichier))?;
                m.permissions().mode() & 0o7777
            }
            Err(_) => {
                std::fs::create_dir_all(fichier.parent().expect("chemin sous ~/.claude"))?;
                0o644
            }
        };
        let mut texte = serde_json::to_string_pretty(&reglages).map_err(std::io::Error::other)?;
        texte.push('\n');
        ecrire_atomique(&fichier, texte.as_bytes(), mode)?;
    }
    Ok(etat(home))
}

#[cfg(test)]
mod tests {
    use super::*;

    const S: &str = "/h/.claude/hooks/terminials-notify.sh";

    fn json(s: &str) -> Json {
        serde_json::from_str(s).unwrap()
    }

    #[test]
    fn commandes_par_evenement() {
        assert_eq!(commande_attendue(S, "Stop"), S);
        assert_eq!(commande_attendue(S, "PostToolUse"), format!("{S} busy"));
        assert_eq!(commande_attendue("/a b/x.sh", "Stop"), "'/a b/x.sh'");
        assert_eq!(commande_attendue("/a'b/x.sh", "Stop"), r"'/a'\''b/x.sh'");
    }

    #[test]
    fn fusion_dans_un_fichier_vide() {
        let mut r = Json::objet_vide();
        assert!(fusionner(&mut r, S).unwrap());
        assert_eq!(evenements_declares(&r, S).len(), 6);
        // Idempotente.
        let avant = r.clone();
        assert!(!fusionner(&mut r, S).unwrap());
        assert_eq!(r, avant);
    }

    #[test]
    fn fusion_conserve_le_reste_et_l_ordre() {
        let mut r = json(
            r#"{"model":"x","hooks":{"Stop":[{"matcher":"","hooks":[{"type":"command","command":"autre.sh"}]}],"PreToolUse":[]},"permissions":{"allow":["Bash(ls)"]}}"#,
        );
        assert!(fusionner(&mut r, S).unwrap());
        let texte = serde_json::to_string(&r).unwrap();
        // Clés d'origine dans leur ordre, l'autre hook de Stop intact, PreToolUse intact.
        assert!(texte.starts_with(r#"{"model":"x","hooks":{"Stop":[{"matcher":"","hooks":[{"type":"command","command":"autre.sh"}]},"#));
        assert!(texte.contains(r#""PreToolUse":[]"#));
        assert!(texte.ends_with(r#""permissions":{"allow":["Bash(ls)"]}}"#));
        assert_eq!(nos_commandes(&r, "Stop"), vec![S]);
    }

    #[test]
    fn ancienne_declaration_corrigee_sans_doublon() {
        // Installation manuelle d'avant : PostToolUse sans « busy », chemin par ~.
        let mut r = json(
            r#"{"hooks":{"PostToolUse":[{"hooks":[{"type":"command","command":"~/.claude/hooks/terminials-notify.sh"}]}],"Stop":[{"hooks":[{"type":"command","command":"/h/.claude/hooks/terminials-notify.sh"}]}]}}"#,
        );
        assert!(fusionner(&mut r, S).unwrap());
        assert_eq!(
            nos_commandes(&r, "PostToolUse"),
            vec![format!("{S} busy").as_str()]
        );
        assert_eq!(nos_commandes(&r, "Stop"), vec![S]);
        let Some(Json::Liste(stop)) = r.champ("hooks").and_then(|h| h.champ("Stop")) else {
            panic!()
        };
        assert_eq!(stop.len(), 1);
    }

    #[test]
    fn structure_inattendue_refusee() {
        assert!(fusionner(&mut json("[]"), S).is_err());
        assert!(fusionner(&mut json(r#"{"hooks":"non"}"#), S).is_err());
        assert!(fusionner(&mut json(r#"{"hooks":{"Stop":{}}}"#), S).is_err());
    }

    #[test]
    fn reconnait_notre_script() {
        assert!(vise_notre_script("/x/terminials-notify.sh busy"));
        assert!(vise_notre_script("'/a b/terminials-notify.sh'"));
        assert!(vise_notre_script(r"'/a'\''b/terminials-notify.sh' busy"));
        assert!(vise_notre_script(r#""/a b"/terminials-notify.sh"#));
        assert!(vise_notre_script(
            "$HOME/.claude/hooks/terminials-notify.sh"
        ));
        assert!(!vise_notre_script("/x/autre-terminials-notify.sh.bak"));
        assert!(!vise_notre_script("echo terminials-notify.sh"));
    }

    #[test]
    fn le_script_signale_l_attente() {
        assert!(SCRIPT.contains(r#"notifier fin "$TITLE""#));
        assert!(SCRIPT.contains(r#"notifier "$ATTENTE" "$TITLE" "$MSG""#));
        assert!(SCRIPT.contains("ATTENTE=autorisation"));
        assert!(SCRIPT.contains(r#"terminials notify --attente "$1""#));
    }

    #[test]
    fn installation_dans_un_dossier_temporaire() {
        use std::os::unix::fs::PermissionsExt;
        let home = tempfile::tempdir().unwrap();
        let claude = home.path().join(".claude");
        std::fs::create_dir_all(&claude).unwrap();
        let reglages = claude.join("settings.json");
        std::fs::write(
            &reglages,
            "{\n  \"theme\": \"dark\",\n  \"env\": {\"A\": \"1\"}\n}\n",
        )
        .unwrap();
        std::fs::set_permissions(&reglages, std::fs::Permissions::from_mode(0o600)).unwrap();

        let avant = etat(home.path());
        assert!(!avant.installes && !avant.script_a_jour && avant.evenements_declares.is_empty());

        let apres = installer(home.path()).unwrap();
        assert!(apres.installes, "{apres:?}");
        let script = chemin_script(home.path());
        assert_eq!(
            std::fs::metadata(&script).unwrap().permissions().mode() & 0o777,
            0o755
        );
        assert_eq!(
            std::fs::metadata(&reglages).unwrap().permissions().mode() & 0o777,
            0o600
        );
        let texte = std::fs::read_to_string(&reglages).unwrap();
        assert!(texte.find("\"theme\"").unwrap() < texte.find("\"env\"").unwrap());
        assert!(texte.contains("\"A\": \"1\""));

        // Une sauvegarde, identique à l'original.
        let sauvegardes: Vec<_> = std::fs::read_dir(&claude)
            .unwrap()
            .filter_map(|e| e.ok())
            .filter(|e| {
                e.file_name()
                    .to_string_lossy()
                    .starts_with("settings.json.avant-terminials-")
            })
            .collect();
        assert_eq!(sauvegardes.len(), 1);
        assert!(std::fs::read_to_string(sauvegardes[0].path())
            .unwrap()
            .contains("\"theme\": \"dark\""));

        // Idempotente : rien n'est réécrit, aucune nouvelle sauvegarde.
        let modif = std::fs::metadata(&reglages).unwrap().modified().unwrap();
        assert!(installer(home.path()).unwrap().installes);
        assert_eq!(
            std::fs::metadata(&reglages).unwrap().modified().unwrap(),
            modif
        );
        assert_eq!(std::fs::read_dir(&claude).unwrap().count(), 3); // hooks/, settings.json, sauvegarde

        // Script modifié à la main : plus à jour, réinstallé.
        std::fs::write(&script, "#!/bin/sh\n").unwrap();
        assert!(!etat(home.path()).installes);
        assert!(installer(home.path()).unwrap().installes);
    }

    /// Exécute le vrai script avec une fausse CLI `terminials` (qui journalise ses
    /// arguments) et un faux socket, comme Claude Code le ferait sur `evenement`.
    /// `cli_ancienne` : la fausse CLI refuse `--attente` (code 2), comme avant cette option.
    fn executer_script(evenement: &str, cli_ancienne: bool) -> Vec<String> {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let script = dir.path().join("hook.sh");
        std::fs::write(&script, SCRIPT).unwrap();
        let bin = dir.path().join("bin");
        std::fs::create_dir_all(&bin).unwrap();
        let journal = dir.path().join("journal");
        let refus = if cli_ancienne {
            r#"case " $* " in *" --attente "*) exit 2 ;; esac"#
        } else {
            ""
        };
        let fausse_cli = format!(
            "#!/bin/bash\n{refus}\nprintf '%s\\n' \"$*\" >> '{}'\n",
            journal.display()
        );
        std::fs::write(bin.join("terminials"), fausse_cli).unwrap();
        std::fs::set_permissions(
            bin.join("terminials"),
            std::fs::Permissions::from_mode(0o755),
        )
        .unwrap();
        // Le script ne fait rien sans socket : un vrai socket Unix dans le dossier de test.
        let _ecoute =
            std::os::unix::net::UnixListener::bind(dir.path().join("terminials.sock")).unwrap();
        let path = format!(
            "{}:{}",
            bin.display(),
            std::env::var("PATH").unwrap_or_default()
        );
        let mut enfant = std::process::Command::new("bash")
            .arg(&script)
            .env("PATH", path)
            .env("XDG_RUNTIME_DIR", dir.path())
            .env("TERMINIALS_WORKSPACE_ID", "ws:1")
            .stdin(std::process::Stdio::piped())
            .spawn()
            .unwrap();
        enfant
            .stdin
            .take()
            .unwrap()
            .write_all(evenement.as_bytes())
            .unwrap();
        assert!(enfant.wait().unwrap().success());
        std::fs::read_to_string(&journal)
            .unwrap_or_default()
            .lines()
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn le_script_qualifie_l_attente() {
        if std::process::Command::new("jq")
            .arg("--version")
            .output()
            .is_err()
        {
            return; // jq absent : le script ne peut rien lire, rien à vérifier ici.
        }
        let autorisation = r#"{"hook_event_name":"Notification","cwd":"/srv/api","message":"Claude needs your permission to use Bash"}"#;
        let appels = executer_script(autorisation, false);
        assert_eq!(appels[0], "idle");
        assert_eq!(
            appels[1],
            "notify --attente autorisation --title Claude · api --body Claude demande l'autorisation d'utiliser Bash"
        );
        let question = r#"{"hook_event_name":"Notification","cwd":"/srv/api","notification_type":"elicitation_dialog","message":"Choisis une option"}"#;
        assert_eq!(
            executer_script(question, false)[1],
            "notify --attente question --title Claude · api --body Choisis une option"
        );
        // Invite restée sans saisie (y compris après /clear) ou connexion réussie : l'onglet
        // repasse au repos, mais personne n'est notifié.
        for muet in [
            r#"{"hook_event_name":"Notification","notification_type":"idle_prompt","message":"Claude is waiting for your input"}"#,
            r#"{"hook_event_name":"Notification","message":"Claude is waiting for your input"}"#,
            r#"{"hook_event_name":"Notification","notification_type":"auth_success","message":"ok"}"#,
        ] {
            assert_eq!(executer_script(muet, false), vec!["idle"], "{muet}");
        }
        let typee = r#"{"hook_event_name":"Notification","notification_type":"permission_prompt","message":"x"}"#;
        assert!(executer_script(typee, false)[1]
            .starts_with("notify --attente autorisation --title Claude --body x"));
        let fin = executer_script(r#"{"hook_event_name":"Stop"}"#, false);
        assert!(
            fin[1].starts_with("notify --attente fin --title Claude --body "),
            "{fin:?}"
        );
        // CLI plus ancienne que le script : la notification part quand même, sans --attente.
        let appels = executer_script(autorisation, true);
        assert_eq!(
            appels[1],
            "notify --title Claude · api --body Claude demande l'autorisation d'utiliser Bash"
        );
        assert_eq!(appels.len(), 2);
    }

    #[test]
    fn installation_sans_settings_json() {
        let home = tempfile::tempdir().unwrap();
        let e = installer(home.path()).unwrap();
        assert!(e.installes);
        assert!(chemin_reglages_claude(home.path()).is_file());
    }

    #[test]
    fn json_illisible_jamais_ecrase() {
        let home = tempfile::tempdir().unwrap();
        let claude = home.path().join(".claude");
        std::fs::create_dir_all(&claude).unwrap();
        std::fs::write(claude.join("settings.json"), "{ pas du json").unwrap();
        assert!(installer(home.path()).is_err());
        assert_eq!(
            std::fs::read_to_string(claude.join("settings.json")).unwrap(),
            "{ pas du json"
        );
        assert!(!chemin_script(home.path()).exists());
    }

    #[test]
    fn lien_symbolique_conserve() {
        let home = tempfile::tempdir().unwrap();
        let claude = home.path().join(".claude");
        std::fs::create_dir_all(&claude).unwrap();
        let cible = home.path().join("dotfiles-settings.json");
        std::fs::write(&cible, "{}").unwrap();
        std::os::unix::fs::symlink(&cible, claude.join("settings.json")).unwrap();
        assert!(installer(home.path()).unwrap().installes);
        assert!(std::fs::symlink_metadata(claude.join("settings.json"))
            .unwrap()
            .file_type()
            .is_symlink());
        assert!(std::fs::read_to_string(&cible)
            .unwrap()
            .contains("terminials-notify.sh"));
    }
}
