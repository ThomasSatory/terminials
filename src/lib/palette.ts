/** Palette d'identité des workspaces (assignée en round-robin à la création).
    "#5b8def" est relégué loin du début : quasi identique à ATTENTION_COLOR,
    il ne doit pas être attribué aux premiers workspaces. */
export const PALETTE = [
  "#2ecc71", // vert
  "#1abc9c", // teal
  "#9b59b6", // violet
  "#e91e8c", // rose
  "#e67e22", // orange
  "#f1c40f", // jaune
  "#5b8def", // bleu (décalé loin du bleu attention)
  "#95a5a6", // gris
] as const;

/** Bleu cmux : toute la sémantique « un agent attend »
    (anneau de pane, rail sidebar, halo de pastille). */
export const ATTENTION_COLOR = "#3b82f6";

/** Ambre : défaut du status pill et de la progress bar
    (la couleur explicite de `set-status` surcharge). */
export const STATUS_DEFAULT_COLOR = "#f5a623";

/** Dernier segment non vide d'un chemin (nom par défaut d'un workspace). */
export function basename(path: string): string {
  const segs = path.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1] : path;
}
