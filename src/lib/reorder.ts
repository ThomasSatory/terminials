/** Géométrie verticale d'une ligne de la sidebar (sous-ensemble de DOMRect : un vrai
    DOMRect satisfait cette interface, donc le calcul reste testable sans DOM — les
    tests tournent en environnement node, cf. vite.config.ts). */
export interface RowRect {
  top: number;
  height: number;
}

/**
 * Frontière d'insertion visée par un pointeur à l'ordonnée `y`, dans `[0, rects.length]` :
 * 0 = avant la première ligne, `length` = après la dernière.
 *
 * Implémenté en comptant les lignes dont le MILIEU est au-dessus de `y` : la moitié
 * haute d'une ligne vise donc la frontière avant elle, la moitié basse celle après.
 * Ne dépend que des milieux, donc un `y` tombé dans la marge entre deux lignes, ou
 * hors de la liste, donne quand même la bonne frontière (pas de cas particulier).
 * `rects` doit être ordonné de haut en bas.
 */
export function dropBoundary(rects: RowRect[], y: number): number {
  return rects.filter((r) => y >= r.top + r.height / 2).length;
}

/**
 * Convertit une frontière d'insertion en index final pour `moveItem`, sachant que
 * l'élément tiré (`from`) quitte d'abord sa place : une frontière SOUS lui perd donc
 * un cran. Corollaire : les frontières `from` et `from + 1` désignent toutes deux sa
 * place actuelle et donnent un no-op.
 */
export function finalIndex(from: number, boundary: number): number {
  return boundary > from ? boundary - 1 : boundary;
}

/**
 * Nouveau tableau avec l'élément `from` déplacé à l'index `to`. Renvoie le tableau
 * d'origine INCHANGÉ (même référence) si le déplacement est un no-op ou si un index
 * sort des bornes : les consommateurs Zustand évitent ainsi un re-render pour rien.
 */
export function moveItem<T>(arr: T[], from: number, to: number): T[] {
  if (from === to) return arr;
  if (from < 0 || from >= arr.length) return arr;
  if (to < 0 || to >= arr.length) return arr;
  const next = arr.slice();
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}
