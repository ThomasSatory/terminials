/**
 * Registre tabId → callback de focus du xterm correspondant.
 * Chaque TerminalPane s'enregistre au montage (() => term.focus()) et se
 * désenregistre au démontage ; le dispatch des raccourcis (Alt+←/→, Ctrl+Shift+T)
 * et la barre d'onglets peuvent ainsi focus un terminal sans passer par React.
 */
const registry = new Map<string, () => void>();

export function registerTabFocus(tabId: string, focus: () => void): void {
  registry.set(tabId, focus);
}

export function unregisterTabFocus(tabId: string): void {
  registry.delete(tabId);
}

/** Focus le terminal de l'onglet (no-op si non enregistré). */
export function focusTab(tabId: string): void {
  registry.get(tabId)?.();
}
