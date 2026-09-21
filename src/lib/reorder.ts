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

// --- Dépôt dans une sidebar à groupes -------------------------------------------

/** Ligne de la sidebar telle que le drag la voit : un workspace (`groupId` = son
    appartenance, null hors-groupe) ou un en-tête de groupe (`groupId` = l'id du groupe).
    Ordre = ordre du DOM (hors-groupe, puis chaque groupe : en-tête puis membres dépliés). */
export interface SidebarRow extends RowRect {
  kind: "ws" | "group";
  groupId: string | null;
}

export type DropTarget =
  /** Insérer le workspace à `index` parmi les membres de `groupId` ; `boundary` = frontière
      de lignes (au sens de dropBoundary) où dessiner le trait. */
  | { kind: "workspace"; groupId: string | null; index: number; boundary: number }
  /** Déposé SUR un en-tête : en fin de ce groupe (déplié ou replié). */
  | { kind: "into-group"; groupId: string }
  /** Déplacer un groupe à `index` parmi les groupes ; `boundary` idem pour le trait. */
  | { kind: "group"; index: number; boundary: number };

/**
 * Cible de dépôt d'un `dragging` (workspace ou groupe) pour un pointeur à l'ordonnée `y`.
 *
 * Workspace : un pointeur DANS le rect d'un en-tête vise ce groupe (insertion en fin) ;
 * sinon la frontière de lignes visée (milieux, cf. dropBoundary) : l'appartenance est celle
 * de la ligne juste au-dessus (un en-tête au-dessus = tête de son groupe ; rien au-dessus =
 * hors-groupe), l'index = nombre de membres de cette appartenance déjà au-dessus.
 *
 * Groupe : seules les frontières entre en-têtes comptent (un groupe ne rentre jamais dans
 * un autre ni parmi les hors-groupe) ; le trait se pose avant l'en-tête visé, ou en fin.
 */
export function resolveDrop(rows: SidebarRow[], y: number, dragging: "ws" | "group"): DropTarget {
  if (dragging === "group") {
    const headers = rows.map((r, i) => ({ r, i })).filter(({ r }) => r.kind === "group");
    const index = dropBoundary(headers.map(({ r }) => r), y);
    const boundary = index < headers.length ? headers[index].i : rows.length;
    return { kind: "group", index, boundary };
  }
  const over = rows.find((r) => r.kind === "group" && y >= r.top && y < r.top + r.height);
  if (over && over.groupId !== null) return { kind: "into-group", groupId: over.groupId };
  const boundary = dropBoundary(rows, y);
  const above = rows[boundary - 1];
  const groupId = above ? above.groupId : null;
  const index = above?.kind === "group" ? 0 : rows.slice(0, boundary).filter((r) => r.kind === "ws" && r.groupId === groupId).length;
  return { kind: "workspace", groupId, index, boundary };
}
