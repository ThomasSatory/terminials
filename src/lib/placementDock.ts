import type { Placement } from "./ancrage";

/**
 * Place un calque (popover d'espace, menu, formulaire de groupe) au-dessus du dock, comme
 * la maquette : centré sur son ancre mais borné au dock. Plus large que le dock (un à trois
 * espaces), il se centre sur le dock et seule la pointe suit l'ancre ; on évite ainsi un
 * popover qui déborde d'un seul côté du dock quand on l'ouvre depuis le « + ».
 *
 * Filet de sécurité absent de la maquette (où le dock tient toujours dans la fenêtre) :
 * le calque ne sort jamais de la fenêtre (marge `marge`), et la pointe ne quitte jamais
 * le calque. Pure : toutes les mesures en entrée, en coordonnées de la fenêtre.
 */
export function placerSurDock(
  ancreX: number,
  dock: { left: number; top: number; largeur: number },
  largeur: number,
  fenetre: { largeur: number; hauteur: number },
  ecart = 14,
  marge = 12,
): Placement {
  const libre = dock.largeur - largeur;
  // Bornes de la maquette, relatives au dock : [0, libre] si le calque tient dans le dock,
  // sinon réduites à la seule position centrée (libre / 2, négatif).
  const lo = Math.min(0, libre / 2);
  const hi = Math.max(libre, libre / 2);
  const relatif = Math.max(lo, Math.min(hi, ancreX - dock.left - largeur / 2));
  const maxLeft = Math.max(marge, fenetre.largeur - largeur - marge);
  const left = Math.min(maxLeft, Math.max(marge, dock.left + relatif));
  // La maquette ne borne pas la pointe : elle reste sous l'ancre. On la garde seulement
  // dans le calque (losange de 12 px) au cas où le bornage à la fenêtre l'en aurait sortie.
  const pointe = Math.min(largeur - 6, Math.max(6, ancreX - left));
  return { left, bottom: fenetre.hauteur - dock.top + ecart, pointe };
}
