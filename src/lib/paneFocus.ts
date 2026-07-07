/**
 * Registre paneId → callback de focus du xterm correspondant.
 * Chaque TerminalPane s'enregistre au montage (() => term.focus()) et se
 * désenregistre au démontage ; le dispatch des raccourcis (Alt+flèches)
 * peut ainsi focus un terminal sans passer par React.
 */
const registry = new Map<string, () => void>();

export function registerPaneFocus(paneId: string, focus: () => void): void {
  registry.set(paneId, focus);
}

export function unregisterPaneFocus(paneId: string): void {
  registry.delete(paneId);
}

/** Focus le terminal du pane (no-op si non enregistré). */
export function focusPane(paneId: string): void {
  registry.get(paneId)?.();
}
