/**
 * Table unique des raccourcis clavier, consommée par les deux couches :
 * la couche window (hook useShortcuts) et la couche terminal
 * (attachCustomKeyEventHandler de chaque xterm).
 * Matching par `e.code` UNIQUEMENT (position physique — indépendant d'AZERTY).
 */
export type ShortcutAction =
  | { type: "open-folder" }
  | { type: "new-pane" }
  | { type: "close-pane" }
  | { type: "close-workspace" }
  | { type: "rename-workspace" }
  | { type: "toggle-diff" }
  | { type: "toggle-sidebar" }
  | { type: "prev-workspace" }
  | { type: "next-workspace" }
  | { type: "select-workspace"; index: number } // 0-based, Digit1..Digit9
  | { type: "focus-pane"; dir: "left" | "right" | "up" | "down" };

/** Sous-ensemble de KeyboardEvent nécessaire au matching (testable sans DOM). */
export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Couche Ctrl+Shift+lettre (convention gnome-terminal). KeyC et KeyV sont
 *  volontairement ABSENTS : Ctrl+Shift+C/V = copier/coller du terminal. */
const CTRL_SHIFT: Record<string, ShortcutAction> = {
  KeyO: { type: "open-folder" },
  KeyN: { type: "open-folder" }, // « nouveau workspace » = ouvrir un dossier
  KeyT: { type: "new-pane" },
  KeyW: { type: "close-pane" },
  KeyQ: { type: "close-workspace" },
  KeyR: { type: "rename-workspace" },
  KeyD: { type: "toggle-diff" },
  KeyB: { type: "toggle-sidebar" },
};

/**
 * Matche un événement clavier sur la table des raccourcis de l'app.
 * Retourne null si l'événement doit suivre son cours (shell/readline : ^W
 * kill-word, ^T transpose-chars… ne sont jamais interceptés).
 */
export function matchShortcut(e: KeyLike): ShortcutAction | null {
  const { code, ctrlKey, shiftKey, altKey } = e;

  // Alt+flèches : focus directionnel de pane (sans Ctrl ni Shift).
  if (altKey) {
    if (ctrlKey || shiftKey) return null;
    switch (code) {
      case "ArrowLeft":
        return { type: "focus-pane", dir: "left" };
      case "ArrowRight":
        return { type: "focus-pane", dir: "right" };
      case "ArrowUp":
        return { type: "focus-pane", dir: "up" };
      case "ArrowDown":
        return { type: "focus-pane", dir: "down" };
      default:
        return null;
    }
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

type Dir = "left" | "right" | "up" | "down";

/** Voisin directionnel dans la grille fixe de PaneTree :
 *  1:[a]  2:[a b]  3:[a b / c c]  4:[a b / c d].
 *  Pour 3 panes, « up » depuis c (qui s'étend sur les 2 colonnes) cible a. */
const NAV_TABLE: Record<number, Array<Partial<Record<Dir, number>>>> = {
  1: [{}],
  2: [{ right: 1 }, { left: 0 }],
  3: [{ right: 1, down: 2 }, { left: 0, down: 2 }, { up: 0 }],
  4: [
    { right: 1, down: 2 },
    { left: 0, down: 3 },
    { right: 3, up: 0 },
    { left: 2, up: 1 },
  ],
};

/** Index du pane cible, ou null au bord de la grille / hors géométrie. */
export function paneNavTarget(count: number, current: number, dir: Dir): number | null {
  return NAV_TABLE[count]?.[current]?.[dir] ?? null;
}
