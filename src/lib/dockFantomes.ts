/**
 * Disparition animée d'un espace fermé (« vanish » de la maquette Creation) et position de
 * l'indicateur d'accent du dock. Pur : le dock lui passe ses listes et ses mesures.
 *
 * Fermer un espace le retire AUSSITÔT du store (ses PTY sont fermés sur-le-champ) ; seul
 * le dock en garde une image, le « fantôme », le temps de l'animation, à sa place d'avant,
 * pour que les voisins ne glissent qu'une fois l'avatar effacé.
 */

/** Durée de la disparition (keyframes dock-disparition, .24s de la maquette). */
export const DUREE_DISPARITION_MS = 240;

/**
 * Liste affichée : `actuels` (le store) où chaque fantôme est réinséré à sa place dans
 * `precedents` (la liste affichée au rendu d'avant) — juste avant le premier espace qui le
 * suivait et existe encore, sinon juste après celui qui le précédait, sinon en fin. Un fantôme absent de `precedents` est ignoré ;
 * un id revenu dans le store n'est plus un fantôme.
 */
export function avecFantomes<W extends { id: string }>(
  actuels: readonly W[],
  precedents: readonly W[],
  fantomes: ReadonlySet<string>,
): W[] {
  const presents = new Set(actuels.map((w) => w.id));
  const out = [...actuels];
  for (let i = 0; i < precedents.length; i++) {
    const f = precedents[i];
    if (!fantomes.has(f.id) || presents.has(f.id)) continue;
    out.splice(placeFantome(out, precedents, i), 0, f);
  }
  return out;
}

/** Index d'insertion du fantôme `precedents[i]` dans `out` : devant le premier de ses
    anciens suivants encore affiché, sinon juste après le dernier de ses anciens
    précédents, sinon en fin. */
function placeFantome<W extends { id: string }>(out: readonly W[], precedents: readonly W[], i: number): number {
  const indexDe = (w: W) => out.findIndex((x) => x.id === w.id);
  for (let j = i + 1; j < precedents.length; j++) {
    const k = indexDe(precedents[j]);
    if (k !== -1) return k;
  }
  for (let j = i - 1; j >= 0; j--) {
    const k = indexDe(precedents[j]);
    if (k !== -1) return k + 1;
  }
  return out.length;
}

/** Ce que l'indicateur d'accent souligne : l'espace ouvert, ou le bouton de la vue affichée. */
export type CibleIndicateur = "espace" | "mosaique" | "activite";

/** Récap ouvert : sous « Activité » ; mosaïque : sous son bouton ; sinon sous l'espace ouvert. */
export function cibleIndicateur(recapOuvert: boolean, vue: "terminal" | "mosaique"): CibleIndicateur {
  if (recapOuvert) return "activite";
  return vue === "mosaique" ? "mosaique" : "espace";
}

/** Mesures du dock, en px dans le repère du `<nav>` (offsetLeft). */
export interface GeometrieDock {
  /** Bord gauche de la bande des avatars. */
  bande: number;
  /** Défilement horizontal de la bande (0 hors dernier recours). */
  defile: number;
  /** Largeur visible de la bande (0 : pas encore mesurée). */
  largeur: number;
  /** Bords gauches des boutons Mosaïque et Activité (40 px de large). */
  mosaique: number;
  activite: number;
}

/**
 * Abscisse, dans le repère du `<nav>` et AVANT défilement, de la boîte de 44 px de
 * l'indicateur. Le composant la pose sur une boîte intérieure qui glisse, dans une boîte
 * extérieure décalée de `-defile` sans transition : sous un avatar, l'indicateur suit le
 * défilement de la bande à l'image près ; sous un bouton (hors bande), le `+ defile`
 * compense. null : rien à souligner (l'indicateur s'efface sur place).
 */
export function abscisseIndicateurNav(
  cible: CibleIndicateur,
  abscisseBande: number | null,
  g: GeometrieDock,
): number | null {
  // Boîte de 44 px centrée sous un bouton de 40 : 2 px de débord de chaque côté.
  if (cible === "mosaique") return g.mosaique - 2 + g.defile;
  if (cible === "activite") return g.activite - 2 + g.defile;
  return abscisseBande === null ? null : g.bande + abscisseBande;
}

/** Demi-largeur du trait d'accent de l'indicateur (16 px). */
const DEMI_TRAIT = 8;

/**
 * L'indicateur sous un avatar est-il dans la partie visible de la bande ? Quand la bande
 * défile (fenêtre étroite) et que l'avatar ouvert en sort, le trait tomberait hors du
 * dock : il s'efface alors, comme l'avatar qu'il souligne, et revient quand on le fait
 * défiler à nouveau. `x` : abscisse de `abscisseIndicateurNav`, `boite` : largeur de la
 * boîte de l'indicateur. Sous Mosaïque et Activité (hors bande), toujours visible.
 */
export function indicateurDansBande(
  cible: CibleIndicateur,
  x: number | null,
  boite: number,
  g: GeometrieDock,
): boolean {
  if (cible !== "espace" || x === null || g.largeur <= 0) return true;
  const centre = x - g.defile + boite / 2;
  return centre - DEMI_TRAIT >= g.bande && centre + DEMI_TRAIT <= g.bande + g.largeur;
}
