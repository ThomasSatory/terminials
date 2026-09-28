//! Notifications desktop (D-Bus via notify-rust) + demande d'attention sur la fenêtre.

use std::path::PathBuf;
use std::sync::OnceLock;

use tauri::{AppHandle, Manager};

/// Icône embarquée dans le binaire : le serveur de notifications veut un chemin de fichier,
/// et le binaire release ne sait pas où vivent les sources.
const ICON_PNG: &[u8] = include_bytes!("../icons/128x128.png");

/// Affiche une notification desktop (urgency Critical) et demande l'attention sur la
/// fenêtre principale (urgency hint X11 sous GNOME). Sauf si la fenêtre est déjà focus.
pub fn fire(app: &AppHandle, title: &str, body: &str) {
    if window_focused(app) {
        // L'app est au premier plan : l'anneau/badge front suffisent, pas de notif desktop.
        return;
    }

    let mut notif = notify_rust::Notification::new();
    notif
        .summary(title)
        .body(body)
        .appname("terminials")
        // GNOME rattache la notif à terminials.desktop (nom + icône d'en-tête).
        .hint(notify_rust::Hint::DesktopEntry("terminials".into()))
        .urgency(notify_rust::Urgency::Critical);
    if let Some(icon) = icon_path() {
        notif.icon(icon);
    }
    let _ = notif.show();

    if let Some(win) = app.get_webview_window("main") {
        let _ = win.request_user_attention(Some(tauri::UserAttentionType::Critical));
    }
}

/// Vrai si la fenêtre principale a le focus.
pub fn window_focused(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false)
}

/// Écrit l'icône embarquée dans le cache au premier appel et renvoie son chemin absolu.
fn icon_path() -> Option<&'static str> {
    static PATH: OnceLock<Option<String>> = OnceLock::new();
    PATH.get_or_init(|| {
        let cache = std::env::var_os("XDG_CACHE_HOME")
            .map(PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))?;
        let dir = cache.join("terminials");
        std::fs::create_dir_all(&dir).ok()?;
        let path = dir.join("notification-icon.png");
        std::fs::write(&path, ICON_PNG).ok()?;
        path.to_str().map(str::to_owned)
    })
    .as_deref()
}
