/**
 * Réserve basse de la pile de terminaux (App) et de la grille de la mosaïque : la dernière
 * ligne ne passe jamais sous le dock.
 *
 * Elle ne dépend QUE de la présence du dock. Une bulle posée au-dessus du dock (agent qui
 * attend, superviseur) flotte par-dessus sans rien réserver : agrandir la réserve à son
 * arrivée retaillait la zone, le ResizeObserver de chaque terminal affiché refaisait un
 * fit(), xterm perdait des rangées et tout le texte remontait, puis redescendait à son
 * départ.
 */
export function reserveBasse(dockVisible: boolean): string {
  return dockVisible ? "var(--reserve-dock)" : "var(--reserve-sans-dock)";
}
