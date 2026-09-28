//! Réglages du dashboard : ~/.config/terminials/settings.json (0600, écriture atomique).
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LlmProviderKind {
    Openai,
    Ollama,
    ClaudeCli,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct LlmSettings {
    pub provider: LlmProviderKind,
    pub base_url: String,
    pub model: String,
    pub token: String,
    pub extra_headers: BTreeMap<String, String>,
    pub temperature: f32,
    pub max_tokens: u32,
    pub token_command: Option<String>,
}
impl Default for LlmSettings {
    fn default() -> Self {
        let mut extra_headers = BTreeMap::new();
        extra_headers.insert("x-env".to_string(), "dev".to_string());
        Self {
            // `claude -p` par défaut : le jeton Gemma est un JWT de 6 h, trop
            // court pour être recollé à la main chaque matin. Les champs Gemma
            // ci-dessous restent renseignés, ils resservent tels quels si on
            // rebascule le fournisseur sur `openai`.
            provider: LlmProviderKind::ClaudeCli,
            base_url: "https://llm.example.com/gemma4-31b".into(),
            model: "google/gemma-4-31B-it".into(),
            token: String::new(),
            extra_headers,
            temperature: 0.3,
            max_tokens: 1500,
            token_command: None,
        }
    }
}

/// D'où viennent les tâches ClickUp.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ClickupSource {
    /// `claude -p` avec les outils MCP ClickUp de la configuration utilisateur.
    /// Défaut : générer une clé API ClickUp demande des droits que tout le monde
    /// n'a pas, alors que le serveur MCP est déjà connecté dans Claude Code.
    #[default]
    ClaudeMcp,
    /// API HTTP `api.clickup.com`, avec une clé personnelle (`token`).
    Api,
    Off,
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ClickupSettings {
    pub source: ClickupSource,
    pub token: String,
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ScheduleSettings {
    pub hour: u8,
    pub minute: u8,
    pub weekdays_only: bool,
}
impl Default for ScheduleSettings {
    fn default() -> Self {
        Self { hour: 7, minute: 0, weekdays_only: true }
    }
}

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct ShellSettings {
    pub integration: bool,
    pub ignored_commands: Vec<String>,
}
impl Default for ShellSettings {
    fn default() -> Self {
        Self {
            integration: true,
            ignored_commands: ["ls", "ll", "la", "cd", "pwd", "clear", "exit"]
                .iter()
                .map(|s| s.to_string())
                .collect(),
        }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct GitSettings {
    pub author_email: Option<String>,
}

/// Saisie des temps : ce qu'il faut déclarer par jour, et où va ce qui n'a pas d'US.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct SaisieSettings {
    /// Minutes à saisir du lundi au jeudi.
    pub journee_minutes: u32,
    /// Minutes à saisir le vendredi.
    pub vendredi_minutes: u32,
    /// US qui reçoit le temps sans US. Vide : l'US « Réunion » du sprint en
    /// cours, trouvée par la collecte ClickUp.
    pub us_reunion: String,
}
impl Default for SaisieSettings {
    fn default() -> Self {
        Self { journee_minutes: 450, vendredi_minutes: 420, us_reunion: String::new() }
    }
}

#[derive(Debug, Clone, PartialEq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub llm: LlmSettings,
    pub clickup: ClickupSettings,
    pub schedule: ScheduleSettings,
    pub shell: ShellSettings,
    pub git: GitSettings,
    pub ticket_patterns: Vec<String>,
    pub saisie: SaisieSettings,
}

/// `$XDG_CONFIG_HOME/terminials/settings.json`, défaut `~/.config/terminials/settings.json`.
pub fn default_path() -> PathBuf {
    let base = std::env::var("XDG_CONFIG_HOME")
        .ok()
        .filter(|s| !s.is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(std::env::var("HOME").unwrap_or_else(|_| "/tmp".into())).join(".config"));
    base.join("terminials").join("settings.json")
}

/// Fichier absent → défauts. JSON partiel → complété par les défauts (serde `default`).
pub fn load(path: &Path) -> std::io::Result<Settings> {
    match std::fs::read_to_string(path) {
        Ok(raw) => {
            let mut s: Settings = serde_json::from_str(&raw)
                .map_err(|e| std::io::Error::other(format!("settings.json invalide : {e}")))?;
            if source_clickup_absente(&raw) && !s.clickup.token.is_empty() {
                s.clickup.source = ClickupSource::Api;
            }
            Ok(s)
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Settings::default()),
        Err(e) => Err(e),
    }
}

/// Vrai si le fichier a bien un objet `clickup` mais sans clé `source` : c'est un
/// fichier écrit avant la tâche 18, dont le `token` dit à lui seul le mode voulu.
fn source_clickup_absente(raw: &str) -> bool {
    serde_json::from_str::<serde_json::Value>(raw)
        .ok()
        .is_some_and(|v| v["clickup"].is_object() && v["clickup"].get("source").is_none())
}

/// Écriture atomique (tmp + rename) en 0600 : le fichier contient des jetons.
pub fn save(path: &Path, settings: &Settings) -> std::io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let tmp = path.with_extension("json.tmp");
    let json = serde_json::to_string_pretty(settings).map_err(std::io::Error::other)?;
    {
        let mut f = std::fs::OpenOptions::new().write(true).create(true).truncate(true).mode(0o600).open(&tmp)?;
        use std::io::Write;
        f.write_all(json.as_bytes())?;
        f.sync_all()?;
    }
    std::fs::set_permissions(&tmp, std::os::unix::fs::PermissionsExt::from_mode(0o600))?;
    std::fs::rename(&tmp, path)
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn defauts_sur_claude_cli_en_gardant_les_champs_gemma() {
        let s = Settings::default();
        assert_eq!(s.llm.provider, LlmProviderKind::ClaudeCli);
        assert_eq!(s.llm.base_url, "https://llm.example.com/gemma4-31b");
        assert_eq!(s.llm.model, "google/gemma-4-31B-it");
        assert_eq!(s.llm.extra_headers.get("x-env").map(String::as_str), Some("dev"));
        assert!(s.llm.token.is_empty());
        assert_eq!(s.schedule.hour, 7);
        assert!(s.schedule.weekdays_only);
        assert!(s.shell.ignored_commands.contains(&"ls".to_string()));
    }
    #[test]
    fn save_puis_load_roundtrip_en_0600() {
        use std::os::unix::fs::PermissionsExt;
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("settings.json");
        let mut s = Settings::default();
        s.llm.token = "secret".into();
        s.clickup.token = "cu".into();
        save(&path, &s).unwrap();
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
        assert_eq!(load(&path).unwrap(), s);
    }
    #[test]
    fn load_fichier_absent_rend_les_defauts() {
        assert_eq!(load(std::path::Path::new("/nonexistent/x.json")).unwrap(), Settings::default());
    }
    #[test]
    fn defaut_clickup_passe_par_le_mcp_de_claude_code() {
        assert_eq!(ClickupSettings::default().source, ClickupSource::ClaudeMcp);
        assert!(ClickupSettings::default().token.is_empty());
    }
    #[test]
    fn fichier_sans_source_mais_avec_jeton_reste_en_mode_cle_api() {
        // Compatibilité : les réglages écrits avant l'arrivée de `source` n'ont
        // qu'un `token`. Un jeton renseigné veut dire « clé API » ; le basculer
        // silencieusement sur le MCP ferait tourner un `claude -p` de 80 s à la
        // place d'un appel HTTP qui marchait.
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.json");
        std::fs::write(&path, r#"{"clickup":{"token":"pk_123"}}"#).unwrap();
        let s = load(&path).unwrap();
        assert_eq!(s.clickup.source, ClickupSource::Api);
        assert_eq!(s.clickup.token, "pk_123");
    }
    #[test]
    fn fichier_sans_source_ni_jeton_prend_le_mcp() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.json");
        std::fs::write(&path, r#"{"clickup":{"token":""}}"#).unwrap();
        assert_eq!(load(&path).unwrap().clickup.source, ClickupSource::ClaudeMcp);
        std::fs::write(&path, r#"{"llm":{"token":"x"}}"#).unwrap();
        assert_eq!(load(&path).unwrap().clickup.source, ClickupSource::ClaudeMcp);
    }
    #[test]
    fn source_explicite_l_emporte_sur_la_compatibilite() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.json");
        std::fs::write(&path, r#"{"clickup":{"source":"off","token":"pk_123"}}"#).unwrap();
        assert_eq!(load(&path).unwrap().clickup.source, ClickupSource::Off);
        std::fs::write(&path, r#"{"clickup":{"source":"claude_mcp","token":"pk_123"}}"#).unwrap();
        assert_eq!(load(&path).unwrap().clickup.source, ClickupSource::ClaudeMcp);
    }
    #[test]
    fn load_json_partiel_complete_avec_les_defauts() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("s.json");
        std::fs::write(&path, r#"{"llm":{"token":"abc"}}"#).unwrap();
        let s = load(&path).unwrap();
        assert_eq!(s.llm.token, "abc");
        assert_eq!(s.llm.model, "google/gemma-4-31B-it");
    }
}
