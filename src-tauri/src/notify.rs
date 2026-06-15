//! Notifications desktop (D-Bus via notify-rust) + demande d'attention sur la fenêtre.

use tauri::{AppHandle, Manager};

/// Affiche une notification desktop (urgency Critical) et demande l'attention sur la
/// fenêtre principale (urgency hint X11 sous GNOME). Sauf si la fenêtre est déjà focus.
pub fn fire(app: &AppHandle, title: &str, body: &str) {
    if window_focused(app) {
        // L'app est au premier plan : l'anneau/badge front suffisent, pas de notif desktop.
        return;
    }

    let _ = notify_rust::Notification::new()
        .summary(title)
        .body(body)
        .appname("terminials")
        .urgency(notify_rust::Urgency::Critical)
        .show();

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
