import type { ITerminalOptions } from "@xterm/xterm";
import { POLICE_TERMINAL, THEME_TERMINAL } from "./terminalTheme";
import { TAILLE_AVATAR_DOCK, type ReglagesApp } from "./reglages";

/**
 * Ce que les réglages d'apparence changent en direct, en logique pure :
 * - variables CSS posées sur :root (`useApparence`) : accent et ses composantes (toutes
 *   les vues s'appuient sur `--accent`, `--accent-rgb`), taille des avatars du dock selon
 *   la densité. L'anneau de focus (`--accent-focus`, tokens.css) ne suit PAS l'accent :
 *   la maquette Parametres le garde à #c3caff quel que soit l'accent choisi ;
 * - attributs de :root : `data-densite`, `data-mouvement="reduit"` (tokens.css y fige
 *   les animations comme pour `prefers-reduced-motion`) ;
 * - options xterm de chaque terminal (TerminalPane) : taille et police, défilement,
 *   curseur et sélection à l'accent.
 */

/** `#rrggbb` → composantes. */
function composantes(hex: string): [number, number, number] {
  return [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)) as [number, number, number];
}

/** « 143, 155, 255 » pour `rgba(var(--accent-rgb), .14)`. */
export function rgbAccent(hex: string): string {
  return composantes(hex).join(", ");
}

/** Variables CSS à poser sur :root. */
export function variablesApparence(r: ReglagesApp): Record<string, string> {
  const accent = r.apparence.accent;
  return {
    "--accent": accent,
    "--accent-rgb": rgbAccent(accent),
    "--dock-avatar": `${TAILLE_AVATAR_DOCK[r.apparence.densite]}px`,
  };
}

/** Attributs `data-*` à poser sur :root. */
export function attributsApparence(r: ReglagesApp): { densite: string; mouvement: "reduit" | "normal" } {
  return { densite: r.apparence.densite, mouvement: r.apparence.reduireAnimations ? "reduit" : "normal" };
}

/** Police système du terminal (réglage « Monospace du système »). */
export const POLICE_SYSTEME = "ui-monospace, monospace";

/** Options xterm tirées des réglages ; le reste vient d'OPTIONS_TERMINAL. */
export function optionsTerminal(
  r: ReglagesApp,
): Required<Pick<ITerminalOptions, "fontSize" | "fontFamily" | "scrollback" | "theme">> {
  const rgb = rgbAccent(r.apparence.accent);
  return {
    fontSize: r.terminal.taillePolice,
    fontFamily: r.terminal.police === "systeme" ? POLICE_SYSTEME : POLICE_TERMINAL,
    scrollback: r.terminal.defilement,
    theme: {
      ...THEME_TERMINAL,
      cursor: r.apparence.accent,
      selectionBackground: `rgba(${rgb}, 0.28)`,
      selectionInactiveBackground: `rgba(${rgb}, 0.14)`,
    },
  };
}
