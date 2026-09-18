import type { WorkspaceCount } from "./activityApi";

/**
 * Teintes de workspace du dashboard « Journal » (tâche 17) : chaque projet a sa
 * couleur, réutilisée partout (chip d'en-tête, glyphe de la chronologie, barre
 * de répartition du mode semaine). Le laiton d'accent ouvre la liste : il
 * revient au workspace le plus actif de la plage affichée.
 */
export const WORKSPACE_COLORS = [
  "#c9a36a", // laiton (accent du dashboard)
  "#9bb08a", // vert sauge
  "#8da2bf", // bleu ardoise
  "#c48b8b", // rose brique
  "#b39ac6", // parme
  "#7fb3a8", // vert d'eau
] as const;

/** Teinte des événements sans workspace (changements ClickUp) : l'atténué des jetons. */
export const SANS_WORKSPACE_COLOR = "#8f887b";

/**
 * Associe une teinte à chaque workspace, du plus actif au moins actif ; au-delà
 * de six workspaces la palette cycle. À activité égale, l'ordre du dossier
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
