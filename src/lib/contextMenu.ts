/** Marge minimale entre le menu et le bord de la fenêtre. */
const EDGE = 4;

export interface Size {
  width: number;
  height: number;
}

/**
 * Coin haut-gauche d'un menu contextuel ouvert au point (x, y).
 *
 * Le menu s'ouvre au point cliqué tant qu'il tient ; sinon il est recalé contre
 * le bord opposé (clic sur la dernière ligne de la sidebar, fenêtre étroite), et
 * jamais poussé hors de l'écran par le haut ou la gauche.
 */
export function menuPosition(x: number, y: number, menu: Size, viewport: Size): { left: number; top: number } {
  return {
    left: Math.max(EDGE, Math.min(x, viewport.width - menu.width - EDGE)),
    top: Math.max(EDGE, Math.min(y, viewport.height - menu.height - EDGE)),
  };
}
