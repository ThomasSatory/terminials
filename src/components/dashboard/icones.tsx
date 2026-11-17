/**
 * Icônes propres au récap, absentes du jeu partagé (`components/ui/icons.tsx`) :
 * même grille 16 × 16, au trait, `currentColor`, toujours décoratives.
 */

/** Deux feuilles du bouton « Copier pour le daily » (tracé de la maquette). */
export function IconeCopierDaily() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round">
      <rect x="5.5" y="5.5" width="8" height="8" rx="1.8" />
      <path d="M10.5 3.2V3a1 1 0 0 0-1-1H4a1.5 1.5 0 0 0-1.5 1.5V9a1 1 0 0 0 1 1h.2" />
    </svg>
  );
}

/** Roue crantée : réglages du récap. */
export function IconeReglages() {
  return (
    <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="8" cy="8" r="2" />
      <path d="M8 1.8v1.6M8 12.6v1.6M14.2 8h-1.6M3.4 8H1.8M12.4 3.6l-1.1 1.1M4.7 11.3l-1.1 1.1M12.4 12.4l-1.1-1.1M4.7 4.7L3.6 3.6" />
      <circle cx="8" cy="8" r="4.6" />
    </svg>
  );
}
