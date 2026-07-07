import { useEffect } from "react";
import { matchShortcut } from "../lib/shortcuts";
import { dispatchShortcut } from "../lib/shortcutDispatch";

/**
 * Couche window des raccourcis : matche sur la table unique (lib/shortcuts)
 * et fait l'UNIQUE dispatch de l'app. Les keydown nés dans un xterm bullent
 * jusqu'ici (la couche terminal retourne false à xterm sans stopPropagation).
 * Plus aucun Ctrl+lettre nu : ^W kill-word, ^T transpose, ^N next-history
 * repartent au shell.
 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = matchShortcut(e);
      if (!action) return;
      // preventDefault systématique : WebKitGTK mappe Alt+←/→ sur l'historique
      // du webview, et Ctrl+PageUp/Down peut scroller le document.
      e.preventDefault();
      dispatchShortcut(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
