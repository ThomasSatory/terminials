/**
 * Table unique des raccourcis clavier, consommée par les deux couches :
 * la couche window (hook useShortcuts) et la couche terminal
 * (attachCustomKeyEventHandler de chaque xterm).
 * Matching par `e.code` UNIQUEMENT (position physique — indépendant d'AZERTY).
 */
export type ShortcutAction =
  | { type: "open-folder" }
  | { type: "new-workspace" }
  | { type: "new-home-workspace" } // espace direct sur ~, sans formulaire
  | { type: "new-tab" }
  | { type: "close-tab" }
  | { type: "close-workspace" }
  | { type: "rename-workspace" }
  | { type: "toggle-diff" }
  | { type: "toggle-dock" }
  | { type: "toggle-palette" } // Ctrl+K
  | { type: "toggle-mosaique" }
  | { type: "toggle-dashboard" }
  | { type: "toggle-parametres" } // Ctrl+Maj+, : vue Paramètres
  | { type: "toggle-superviseur" } // Ctrl+Maj+Espace : panneau du superviseur
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
  /** Caractère produit (dépend de la disposition) ; ne sert qu'à départager « M » et « , ». */
  key?: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Couche Ctrl+Shift (convention gnome-terminal), indexée par `code` physique.
 *  KeyC et KeyV sont volontairement ABSENTS : Ctrl+Shift+C/V = copier/coller
 *  du terminal. Les flèches verticales déplacent le workspace actif dans son
 *  appartenance ; PageUp/PageDown déplacent l'onglet actif dans sa barre.
 *  KeyB masque/affiche le dock, KeyM bascule la mosaïque des agents. Comma ouvre les
 *  Paramètres, Space le panneau du superviseur (Ctrl+Maj+Espace n'a pas d'usage shell :
 *  readline ne lie que Ctrl+Espace, laissé au shell). */
const CTRL_SHIFT: Record<string, ShortcutAction> = {
  KeyO: { type: "open-folder" },
  KeyN: { type: "new-workspace" }, // formulaire nom + dossier
  Enter: { type: "new-home-workspace" }, // espace direct sur ~, sans formulaire
  NumpadEnter: { type: "new-home-workspace" },
  KeyT: { type: "new-tab" },
  KeyW: { type: "close-tab" },
  KeyQ: { type: "close-workspace" },
  KeyR: { type: "rename-workspace" },
  KeyD: { type: "toggle-diff" },
  KeyB: { type: "toggle-dock" },
  KeyM: { type: "toggle-mosaique" },
  KeyH: { type: "toggle-dashboard" },
  Comma: { type: "toggle-parametres" },
  Space: { type: "toggle-superviseur" },
  KeyG: { type: "new-group" },
  KeyE: { type: "toggle-group" },
  ArrowUp: { type: "move-workspace", dir: "up" },
  ArrowDown: { type: "move-workspace", dir: "down" },
  PageUp: { type: "move-tab", dir: "left" },
  PageDown: { type: "move-tab", dir: "right" },
};

/** Couche Ctrl seul (sans Shift). UNE exception à la règle « jamais de Ctrl+lettre nu » :
 *  Ctrl+K ouvre la palette (convention des lanceurs). Le prix est connu et accepté : le
 *  kill-line de readline (^K) ne part plus au shell ; Ctrl+U, Ctrl+W et Ctrl+A/E restent
 *  intacts. Ctrl+1…9 (sélection d'espace) est traité à part, par motif. */
const CTRL_SEUL: Record<string, ShortcutAction> = {
  KeyK: { type: "toggle-palette" },
  PageUp: { type: "prev-workspace" },
  PageDown: { type: "next-workspace" },
};

/** Couche Alt seul : onglet précédent/suivant. Alt+↑/↓ restent au shell : plus de
 *  grille, donc plus de focus directionnel. */
const ALT_SEUL: Record<string, ShortcutAction> = {
  ArrowLeft: { type: "prev-tab" },
  ArrowRight: { type: "next-tab" },
};

/**
 * « M » et « , » échangent leurs places entre QWERTY et AZERTY : la virgule d'un AZERTY est
 * à la position physique KeyM, et son « M » à la position Semicolon. Pour ces deux raccourcis
 * seulement, le caractère produit l'emporte sur la position, afin que Ctrl+Maj+M et
 * Ctrl+Maj+, fassent ce qui est écrit sur la touche. (Maj+virgule produit « ? » en AZERTY.)
 */
function codeSelonDisposition(code: string, key: string | undefined): string {
  if (!key) return code;
  if (key === "m" || key === "M") return "KeyM";
  if (code === "KeyM" && (key === "," || key === "?")) return "Comma";
  return code;
}

/**
 * Matche un événement clavier sur la table des raccourcis de l'app.
 * Retourne null si l'événement doit suivre son cours (shell/readline : ^W
 * kill-word, ^T transpose-chars… ne sont jamais interceptés).
 */
export function matchShortcut(e: KeyLike): ShortcutAction | null {
  const { code, ctrlKey, shiftKey, altKey } = e;

  // Alt+←/→ (sans Ctrl ni Shift).
  if (altKey) return ctrlKey || shiftKey ? null : (ALT_SEUL[code] ?? null);

  if (!ctrlKey) return null;

  if (shiftKey) return CTRL_SHIFT[codeSelonDisposition(code, e.key)] ?? null;

  const digit = /^Digit([1-9])$/.exec(code);
  if (digit) return { type: "select-workspace", index: Number(digit[1]) - 1 };
  return CTRL_SEUL[code] ?? null;
}

/** Nom affiché d'une touche physique (« N », « Entrée », « → », « PageUp »). */
function nomTouche(code: string): string {
  const noms: Record<string, string> = {
    Enter: "Entrée",
    NumpadEnter: "Entrée",
    ArrowLeft: "←",
    ArrowRight: "→",
    ArrowUp: "↑",
    ArrowDown: "↓",
    Comma: ",",
    Space: "Espace",
  };
  return noms[code] ?? /^(?:Key|Digit)(.)$/.exec(code)?.[1] ?? code;
}

const memeAction = (a: ShortcutAction, b: ShortcutAction) => JSON.stringify(a) === JSON.stringify(b);

/**
 * Raccourci d'une action, tel que l'interface l'affiche (palette, infobulles) : déduit
 * de la table ci-dessus, il ne peut pas dériver d'elle. « Ctrl+Maj+N », « Ctrl K »,
 * « Ctrl PageDown », « Alt+→ », « Ctrl 3 ». undefined si l'action n'a pas de raccourci.
 */
export function libelleRaccourci(action: ShortcutAction): string | undefined {
  if (action.type === "select-workspace") {
    return action.index >= 0 && action.index < 9 ? `Ctrl ${action.index + 1}` : undefined;
  }
  const couches: Array<[Record<string, ShortcutAction>, (touche: string) => string]> = [
    [CTRL_SHIFT, (t) => `Ctrl+Maj+${t}`],
    [CTRL_SEUL, (t) => `Ctrl ${t}`],
    [ALT_SEUL, (t) => `Alt+${t}`],
  ];
  for (const [table, format] of couches) {
    const code = Object.keys(table).find((c) => memeAction(table[c], action));
    if (code) return format(nomTouche(code));
  }
  return undefined;
}

/**
 * Couche terminal (attachCustomKeyEventHandler de chaque xterm) : true = xterm traite la
 * touche et l'envoie au PTY ; false = xterm la laisse passer sans rien envoyer, et le
 * keydown bulle jusqu'à la couche window (useShortcuts), qui fait l'unique dispatch.
 * Tout raccourci de la table passe donc, Ctrl+K et Ctrl+Maj+M compris.
 */
export function terminalGardeTouche(e: KeyLike): boolean {
  return matchShortcut(e) === null;
}
