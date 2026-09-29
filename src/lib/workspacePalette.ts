import type { WorkspaceCount } from "./activityApi";
import { PALETTE } from "./palette";

/**
 * Teintes de workspace du dashboard : les couleurs franches de la palette de
 * l'application (`PALETTE`), sans le gris,
 * réordonnées pour que les projets les plus actifs — voisins dans la frise —
 * reçoivent des teintes bien distinctes (le vert et le teal ne se suivent pas).
 * Chaque projet garde sa couleur partout (frise, chips, chronologie, semaine).
 */
export const WORKSPACE_COLORS = [
  PALETTE[0], // vert
  PALETTE[4], // orange
  PALETTE[2], // violet
  PALETTE[5], // jaune
  PALETTE[3], // rose
  PALETTE[1], // teal
  PALETTE[6], // bleu
] as const;

/** Teinte des événements sans workspace (changements ClickUp) : le gris de la palette. */
export const SANS_WORKSPACE_COLOR = PALETTE[7];

/**
 * Associe une teinte à chaque workspace, du plus actif au moins actif ; au-delà
 * de sept workspaces la palette cycle. À activité égale, l'ordre du dossier
 * départage pour que l'affectation reste stable d'un rendu à l'autre.
 *
 * L'ordre d'insertion de la `Map` est significatif : la première clé est le
 * workspace le plus actif de la plage (`groupByHour` s'en sert pour n'ajouter
 * le nom du projet qu'aux lignes des *autres* workspaces).
 */
export function assignWorkspaceColors(rows: WorkspaceCount[]): Map<string, string> {
  const tries = [...rows].sort((a, b) => b.events - a.events || a.dir.localeCompare(b.dir));
  const colors = new Map<string, string>();
  tries.forEach((row, i) => {
    colors.set(row.dir, WORKSPACE_COLORS[i % WORKSPACE_COLORS.length]);
  });
  return colors;
}

/** Teinte d'un dossier ; `null` ou dossier inconnu → teinte « sans workspace ». */
export function workspaceColor(dir: string | null, colors: Map<string, string>): string {
  if (dir === null) return SANS_WORKSPACE_COLOR;
  return colors.get(dir) ?? SANS_WORKSPACE_COLOR;
}
