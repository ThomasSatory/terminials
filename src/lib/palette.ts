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

/** `name` : nom d'origine (celui de cmux, stable) ; `nom` : nom affiché, en français. */
export type NamedColor = { name: string; nom: string; hex: string };

/** Couleurs des workspaces et des groupes : les 16 couleurs nommées de cmux. Table
    unique des noms français : le dock, le menu d'espace et les formulaires la lisent. */
export const SIDEBAR_COLORS: readonly NamedColor[] = [
  { name: "Red", nom: "Rouge", hex: "#C0392B" },
  { name: "Crimson", nom: "Cramoisi", hex: "#922B21" },
  { name: "Orange", nom: "Orange", hex: "#A04000" },
  { name: "Amber", nom: "Ambre", hex: "#7D6608" },
  { name: "Olive", nom: "Olive", hex: "#4A5C18" },
  { name: "Green", nom: "Vert", hex: "#196F3D" },
  { name: "Teal", nom: "Sarcelle", hex: "#006B6B" },
  { name: "Aqua", nom: "Aqua", hex: "#0E6B8C" },
  { name: "Blue", nom: "Bleu", hex: "#1565C0" },
  { name: "Navy", nom: "Marine", hex: "#1A5276" },
  { name: "Indigo", nom: "Indigo", hex: "#283593" },
  { name: "Purple", nom: "Pourpre", hex: "#6A1B9A" },
  { name: "Magenta", nom: "Magenta", hex: "#AD1457" },
  { name: "Rose", nom: "Rose", hex: "#880E4F" },
  { name: "Brown", nom: "Brun", hex: "#7B3F00" },
  { name: "Charcoal", nom: "Anthracite", hex: "#3E4B5E" },
];

/** Couleur nommée d'un hex (casse ignorée), undefined pour une couleur hors palette. */
function couleurNommee(hex: string): NamedColor | undefined {
  const h = hex.toLowerCase();
  return SIDEBAR_COLORS.find((c) => c.hex.toLowerCase() === h);
}

/** Nom français d'une couleur nommée, sinon son hex (couleur posée par une version antérieure). */
export function nomCouleur(hex: string): string {
  return couleurNommee(hex)?.nom ?? hex;
}

/** Libellé de la couleur choisie dans un formulaire : « Rouge · #C0392B », ou
    « Automatique » sans couleur propre. */
export function libelleCouleur(hex: string | null | undefined): string {
  if (!hex) return "Automatique";
  const c = couleurNommee(hex);
  return c ? `${c.nom} · ${c.hex}` : hex;
}

/** Pas de 5, premier avec 16 : deux groupes créés à la suite ne reçoivent pas deux teintes voisines. */
export function defaultGroupColor(n: number): string {
  return SIDEBAR_COLORS[(n * 5) % SIDEBAR_COLORS.length].hex;
}

/** Bleu cmux : toute la sémantique « un agent attend »
    (anneau de pane, rail sidebar, halo de pastille). */
export const ATTENTION_COLOR = "#3b82f6";

/** Cyan : un agent travaille (arc tournant de la sidebar et des onglets). Ni le bleu
    d'attention, ni l'ambre du status, ni un vert qui dirait « fini ». */
export const BUSY_COLOR = "#22d3ee";

/** Dernier segment non vide d'un chemin (nom par défaut d'un workspace). */
export function basename(path: string): string {
  const segs = path.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1] : path;
}
