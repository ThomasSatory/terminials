/**
 * Table unique des raccourcis clavier, consommée par les deux couches :
 * la couche window (hook useShortcuts) et la couche terminal
 * (attachCustomKeyEventHandler de chaque xterm).
 * Matching par `e.code` UNIQUEMENT (position physique — indépendant d'AZERTY).
 */
export type ShortcutAction =
  | { type: "open-folder" }
  | { type: "new-workspace" }
  | { type: "new-tab" }
  | { type: "close-tab" }
  | { type: "close-workspace" }
  | { type: "rename-workspace" }
  | { type: "toggle-diff" }
  | { type: "toggle-sidebar" }
  | { type: "new-group" }
  | { type: "toggle-group" } // replie/déplie le groupe du workspace actif
  | { type: "prev-workspace" }
  | { type: "next-workspace" }
  | { type: "prev-tab" }
  | { type: "next-tab" }
  | { type: "move-tab"; dir: "left" | "right" } // réordonne l'onglet actif
  | { type: "move-workspace"; dir: "up" | "down" } // réordonne, ne navigue pas
  | { type: "select-workspace"; index: number }; // 0-based, Digit1..Digit9

/** Sous-ensemble de KeyboardEvent nécessaire au matching (testable sans DOM). */
export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Couche Ctrl+Shift (convention gnome-terminal), indexée par `code` physique.
 *  KeyC et KeyV sont volontairement ABSENTS : Ctrl+Shift+C/V = copier/coller
 *  du terminal. Les flèches verticales déplacent le workspace actif dans la
 *  sidebar ; PageUp/PageDown déplacent l'onglet actif dans sa barre. */
const CTRL_SHIFT: Record<string, ShortcutAction> = {
  KeyO: { type: "open-folder" },
  KeyN: { type: "new-workspace" }, // nouvel espace direct sur ~, sans dialog
  KeyT: { type: "new-tab" },
  KeyW: { type: "close-tab" },
  KeyQ: { type: "close-workspace" },
  KeyR: { type: "rename-workspace" },
  KeyD: { type: "toggle-diff" },
  KeyB: { type: "toggle-sidebar" },
  KeyG: { type: "new-group" },
  KeyE: { type: "toggle-group" },
  ArrowUp: { type: "move-workspace", dir: "up" },
  ArrowDown: { type: "move-workspace", dir: "down" },
  PageUp: { type: "move-tab", dir: "left" },
  PageDown: { type: "move-tab", dir: "right" },
};

/**
 * Matche un événement clavier sur la table des raccourcis de l'app.
 * Retourne null si l'événement doit suivre son cours (shell/readline : ^W
 * kill-word, ^T transpose-chars… ne sont jamais interceptés).
 */
export function matchShortcut(e: KeyLike): ShortcutAction | null {
  const { code, ctrlKey, shiftKey, altKey } = e;

  // Alt+←/→ : onglet précédent/suivant (sans Ctrl ni Shift). Alt+↑/↓ restent
  // au shell : plus de grille, donc plus de focus directionnel.
  if (altKey) {
    if (ctrlKey || shiftKey) return null;
    if (code === "ArrowLeft") return { type: "prev-tab" };
    if (code === "ArrowRight") return { type: "next-tab" };
    return null;
  }

  if (!ctrlKey) return null;

  if (shiftKey) return CTRL_SHIFT[code] ?? null;

  // Couche Ctrl seul (sans Shift) : navigation de workspaces uniquement,
  // jamais de Ctrl+lettre nu.
  if (code === "PageUp") return { type: "prev-workspace" };
  if (code === "PageDown") return { type: "next-workspace" };
  const digit = /^Digit([1-9])$/.exec(code);
  if (digit) return { type: "select-workspace", index: Number(digit[1]) - 1 };
  return null;
}
