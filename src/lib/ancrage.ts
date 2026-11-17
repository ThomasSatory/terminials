/**
 * Ancrage des calques légers (popovers, menus, bulle) au dock. Le dock pose des
 * attributs sur ses éléments ; les calques, montés ailleurs (au niveau d'App), les
 * retrouvent dans le DOM et se placent en `position: fixed` d'après leur rectangle :
 *   - [data-ws-id="<id>"]     sur chaque avatar d'espace ;
 *   - [data-dock-add]         sur le « + » ;
 *   - [data-dock-group="<id>"] sur chaque étiquette de groupe.
 */

export type Ancre = { type: "espace"; wsId: string } | { type: "ajout" } | { type: "groupe"; groupId: string };

/** Valeur d'attribut entre guillemets, échappée (les id du store sont « ws:3 », « grp:0 »). */
const cite = (v: string) => `"${v.replace(/["\\]/g, "\\$&")}"`;

export function selecteurAncre(a: Ancre): string {
  switch (a.type) {
    case "espace":
      return `[data-ws-id=${cite(a.wsId)}]`;
    case "ajout":
      return "[data-dock-add]";
    case "groupe":
      return `[data-dock-group=${cite(a.groupId)}]`;
  }
}

/** Élément d'ancrage dans le document, null s'il n'est pas (ou plus) affiché. */
export function trouverAncre(a: Ancre, racine: ParentNode = document): HTMLElement | null {
  return racine.querySelector<HTMLElement>(selecteurAncre(a));
}

export interface Placement {
  /** Bord gauche du calque, en px depuis la gauche de la fenêtre. */
  left: number;
  /** Bord bas du calque, en px depuis le BAS de la fenêtre (`bottom` CSS). */
  bottom: number;
  /** Abscisse de la pointe (losange de 12 px) dans le calque, en px depuis son bord gauche. */
  pointe: number;
}

/**
 * Place un calque de `largeur` px au-dessus d'une ancre : centré sur `centreX`, son bas
 * à `ecart` px au-dessus de `haut` (le haut du dock pour un popover, de l'avatar pour une
 * bulle), sans sortir de la fenêtre (marge latérale `marge`). La pointe reste sous
 * l'ancre, sans jamais mordre l'arrondi du calque. Pure : toutes les mesures en entrée.
 */
export function placerAuDessus(
  ancre: { centreX: number; haut: number },
  largeur: number,
  fenetre: { largeur: number; hauteur: number },
  ecart = 14,
  marge = 12,
): Placement {
  const maxLeft = Math.max(marge, fenetre.largeur - largeur - marge);
  const left = Math.min(maxLeft, Math.max(marge, ancre.centreX - largeur / 2));
  const pointe = Math.min(largeur - 20, Math.max(20, ancre.centreX - left));
  return { left, bottom: fenetre.hauteur - ancre.haut + ecart, pointe };
}
