/** Palette d'identité des workspaces (assignée en round-robin à la création). */
export const PALETTE = [
  "#5b8def", // bleu
  "#2ecc71", // vert
  "#1abc9c", // teal
  "#9b59b6", // violet
  "#e91e8c", // rose
  "#e67e22", // orange
  "#f1c40f", // jaune
  "#95a5a6", // gris
] as const;

/** Couleur d'alerte (notification / unread), distincte de la palette d'identité. */
export const ALERT_COLOR = "#f5a623";

/** Dernier segment non vide d'un chemin (nom par défaut d'un workspace). */
export function basename(path: string): string {
  const segs = path.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1] : path;
}
