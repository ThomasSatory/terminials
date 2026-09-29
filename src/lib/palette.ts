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

export type NamedColor = { name: string; hex: string };

/** Couleurs des workspaces et des groupes : les 16 couleurs nommées de cmux. */
export const SIDEBAR_COLORS: readonly NamedColor[] = [
  { name: "Red", hex: "#C0392B" },
  { name: "Crimson", hex: "#922B21" },
  { name: "Orange", hex: "#A04000" },
  { name: "Amber", hex: "#7D6608" },
  { name: "Olive", hex: "#4A5C18" },
  { name: "Green", hex: "#196F3D" },
  { name: "Teal", hex: "#006B6B" },
  { name: "Aqua", hex: "#0E6B8C" },
  { name: "Blue", hex: "#1565C0" },
  { name: "Navy", hex: "#1A5276" },
  { name: "Indigo", hex: "#283593" },
  { name: "Purple", hex: "#6A1B9A" },
  { name: "Magenta", hex: "#AD1457" },
  { name: "Rose", hex: "#880E4F" },
  { name: "Brown", hex: "#7B3F00" },
  { name: "Charcoal", hex: "#3E4B5E" },
];

/** Pas de 5, premier avec 16 : deux groupes créés à la suite ne reçoivent pas deux teintes voisines. */
export function defaultGroupColor(n: number): string {
  return SIDEBAR_COLORS[(n * 5) % SIDEBAR_COLORS.length].hex;
}

export function identityColor(w: { color?: string }, group?: { color: string }): string | undefined {
  return w.color ?? group?.color;
}

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
