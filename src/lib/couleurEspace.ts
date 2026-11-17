/**
 * Couleurs d'affichage des espaces et des groupes dans l'UI « Dock ».
 *
 * Les couleurs nommées (SIDEBAR_COLORS, reprises de cmux) sont sombres : posées telles
 * quelles en texte sur le fond #050506, elles seraient illisibles. On les affiche donc
 * dans leur teinte éclaircie (même teinte, saturation plafonnée). Un espace sans
 * couleur propre reçoit une teinte pastel automatique, stable d'un lancement à l'autre.
 * La couleur d'un groupe ne colore QUE son étiquette : les espaces gardent la leur.
 *
 * Toutes les fonctions rendent un hex à 6 chiffres en minuscules : l'avatar y accole
 * un canal alpha (`couleur + "18"` au repos, `+ "38"` actif).
 */

/** Teintes automatiques (pastels lisibles sur le fond sombre). */
export const COULEURS_AUTO = [
  "#a99cff",
  "#4ade80",
  "#b6c2d4",
  "#f78fc6",
  "#fdba74",
  "#d9f99d",
  "#f0abfc",
  "#a7f3d0",
  "#e9d5ff",
] as const;

/** `#rgb` ou `#rrggbb` → `#rrggbb` minuscule ; null si ce n'est pas un hex. */
export function normaliserHex(couleur: string): string | null {
  const c = couleur.trim().toLowerCase();
  if (/^#[0-9a-f]{6}$/.test(c)) return c;
  const court = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/.exec(c);
  return court ? `#${court[1]}${court[1]}${court[2]}${court[2]}${court[3]}${court[3]}` : null;
}

/**
 * Teinte d'affichage d'une couleur nommée : même teinte, éclaircie pour rester lisible
 * sur le fond sombre (luminosité relevée, saturation plafonnée à 62 %). Formule de la
 * maquette de création. Une couleur déjà claire (luminosité ≥ 0,6) est rendue telle
 * quelle. Entrée non hex → null.
 */
export function teinteLisible(couleur: string): string | null {
  const hex = normaliserHex(couleur);
  if (!hex) return null;
  const n = parseInt(hex.slice(1), 16);
  const r = ((n >> 16) & 255) / 255;
  const g = ((n >> 8) & 255) / 255;
  const b = (n & 255) / 255;
  const mx = Math.max(r, g, b);
  const mn = Math.min(r, g, b);
  const d = mx - mn;
  const l0 = (mx + mn) / 2;
  // Couleur déjà claire (pastel, teinte auto, couleur de groupe choisie telle quelle) :
  // lisible sur le fond sombre, on la garde. L'éclaircir la blanchirait.
  if (l0 >= 0.6) return hex;
  const s0 = d === 0 ? 0 : d / (1 - Math.abs(2 * l0 - 1));
  let h = 0;
  if (d) {
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  const l = 0.56 + 0.45 * l0;
  const sat = Math.min(0.62, s0);
  const c = (1 - Math.abs(2 * l - 1)) * sat;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const secteurs: [number, number, number][] = [
    [c, x, 0],
    [x, c, 0],
    [0, c, x],
    [0, x, c],
    [x, 0, c],
    [c, 0, x],
  ];
  const seg = secteurs[Math.floor(h / 60) % 6];
  return (
    "#" +
    seg
      .map((v) =>
        Math.min(255, Math.max(0, Math.round((v + m) * 255)))
          .toString(16)
          .padStart(2, "0"),
      )
      .join("")
  );
}

/** Hachage djb2 : rapide, déterministe, suffisant pour répartir des chemins. */
function hacher(texte: string): number {
  let h = 5381;
  for (let i = 0; i < texte.length; i++) h = ((h << 5) + h + texte.charCodeAt(i)) >>> 0;
  return h;
}

/** Teinte automatique d'un dossier : la même à chaque lancement (les id d'espace, eux,
    sont renumérotés au démarrage). Deux espaces sur le même dossier la partagent. */
export function couleurAuto(cwd: string): string {
  return COULEURS_AUTO[hacher(cwd) % COULEURS_AUTO.length];
}

/** Couleur d'affichage d'un espace : sa couleur propre éclaircie, sinon la teinte auto. */
export function couleurEspace(w: { cwd: string; color?: string }): string {
  return (w.color ? teinteLisible(w.color) : null) ?? couleurAuto(w.cwd);
}

/** Couleur d'affichage d'un groupe (carré de son étiquette). */
export function couleurGroupe(g: { color: string }): string {
  return teinteLisible(g.color) ?? "#9296a0";
}
