/** Sous-ensemble d'HTMLElement dont dépend la résolution du pane : `HTMLElement` le
    satisfait structurellement, donc `resolvePaneId` reste testable sans DOM (les tests
    tournent en environnement node, cf. vite.config.ts). */
export interface PaneAncestor {
  dataset: { paneId?: string };
  parentElement: PaneAncestor | null;
}

export interface Point {
  x: number;
  y: number;
}

/** Remonte les ancêtres jusqu'au premier `data-pane-id` (le drop atterrit sur un
    descendant xterm, jamais sur la cellule elle-même). null = drop hors de toute
    cellule : l'appelant retombe sur le pane actif. */
export function resolvePaneId(el: PaneAncestor | null): string | null {
  for (let cur = el; cur; cur = cur.parentElement) {
    const paneId = cur.dataset.paneId;
    if (paneId) return paneId;
  }
  return null;
}

/** Les positions de `tauri://drag-drop` sont en pixels physiques ; `elementFromPoint`
    attend des pixels CSS. Un dpr nul/absurde laisse le point inchangé plutôt que de
    produire des Infinity. */
export function toCssPoint(point: Point, devicePixelRatio: number): Point {
  if (!(devicePixelRatio > 0)) return point;
  return { x: point.x / devicePixelRatio, y: point.y / devicePixelRatio };
}

/** Sous-ensemble du store nécessaire pour trouver le PTY cible (pure, testable sans Zustand). */
export interface PtyTargetState {
  panePtys: Record<string, number>;
  workspaces: { id: string; activePaneId: string | null }[];
  activeId: string | null;
}

/** PTY dans lequel écrire les chemins. `paneId` non nul est respecté strictement : un
    pane visé mais sans PTY (spawn en cours) ne retombe PAS sur le pane actif — écrire
    dans le mauvais terminal serait pire que ne rien faire. `null` (drop hors cellule)
    vise le pane actif du workspace actif. */
export function resolveTargetPty(state: PtyTargetState, paneId: string | null): number | undefined {
  if (paneId !== null) return state.panePtys[paneId];
  const active = state.workspaces.find((w) => w.id === state.activeId);
  const activePaneId = active?.activePaneId;
  return activePaneId ? state.panePtys[activePaneId] : undefined;
}
