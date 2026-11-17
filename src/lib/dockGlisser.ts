import type { DropTarget } from "./reorder";

/**
 * Visée du glisser-déposer du dock : cible de dépôt et abscisse du trait d'insertion.
 * Pure (aucun DOM) : le hook du dock la calcule à chaque pointermove, cette comparaison
 * décide s'il faut la reposer dans l'état React.
 */

/** Cible visée et abscisse du trait d'insertion (dans la bande, défilement compris). */
export interface Visee {
  cible: DropTarget;
  trait: number | null;
}

/** Deux cibles de dépôt identiques, champ à champ. */
export function memeCible(a: DropTarget, b: DropTarget): boolean {
  if (a.kind !== b.kind) return false;
  switch (a.kind) {
    case "into-group":
      return a.groupId === (b as typeof a).groupId;
    case "group": {
      const c = b as typeof a;
      return a.index === c.index && a.boundary === c.boundary;
    }
    case "workspace": {
      const c = b as typeof a;
      return a.groupId === c.groupId && a.index === c.index && a.boundary === c.boundary;
    }
  }
}

/**
 * Même visée : même cible et même trait. Le pointeur bouge à chaque image pendant un
 * glissement, mais la visée ne change qu'en franchissant une frontière : reposer un objet
 * neuf à chaque mouvement re-rendrait tout le dock pour rien.
 */
export function memeVisee(a: Visee | null, b: Visee | null): boolean {
  if (a === null || b === null) return a === b;
  return a.trait === b.trait && memeCible(a.cible, b.cible);
}
