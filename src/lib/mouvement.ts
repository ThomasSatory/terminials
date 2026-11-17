/**
 * Animations réduites : préférence du système, ou réglage « Réduire les animations »
 * (attribut `data-mouvement="reduit"` posé sur :root par useApparence). Le CSS honore les
 * deux seul (blocs globaux de tokens.css) ; ce test sert au code qui anime en JavaScript
 * (zoom de la mosaïque, défilement doux, fantôme d'un espace fermé) pour qu'il s'en
 * abstienne aussi. Faux hors navigateur (tests, rendu serveur) ou sans matchMedia.
 */
export function mouvementReduit(
  fenetre: (Pick<Window, "matchMedia"> & { document?: Pick<Document, "documentElement"> }) | undefined = globalThis.window,
): boolean {
  if (!fenetre) return false;
  if (fenetre.document?.documentElement?.dataset?.mouvement === "reduit") return true;
  if (typeof fenetre.matchMedia !== "function") return false;
  return fenetre.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
