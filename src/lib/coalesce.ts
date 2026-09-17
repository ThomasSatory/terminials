/** Déclencheur amorti : s'appelle comme une fonction, s'annule avec `cancel()`. */
export interface Coalesced {
  (): void;
  /** Annule l'exécution en attente (démontage / unlisten). */
  cancel(): void;
}

/**
 * Regroupe les appels rapprochés en une seule exécution de `fn`, `delaiMs`
 * après le **premier** appel de la rafale (fenêtre fixe, pas un debounce
 * glissant) : un flux continu d'événements — un cycle de collecte émet
 * `activity-updated` pour git, claude et clickup, plus une fois par commande
 * shell terminée — finirait sinon par repousser l'exécution indéfiniment et le
 * dashboard ne se rafraîchirait jamais. Les appels reçus pendant la fenêtre
 * sont absorbés ; le premier appel qui suit l'exécution rouvre une fenêtre.
 */
export function coalesce(fn: () => void, delaiMs: number): Coalesced {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const declencher = (() => {
    if (timer !== null) return; // rafale déjà en cours : rien à faire
    timer = setTimeout(() => {
      timer = null;
      fn();
    }, delaiMs);
  }) as Coalesced;

  declencher.cancel = () => {
    if (timer === null) return;
    clearTimeout(timer);
    timer = null;
  };

  return declencher;
}
