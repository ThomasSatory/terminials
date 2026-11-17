import { useLayoutEffect, useState } from "react";

/** Position d'un calque `fixed` posé au-dessus de la marque du superviseur. */
export interface PlacementMarque {
  left: number;
  bottom: number;
  /** Abscisse de la pointe depuis le bord gauche du calque. */
  pointe: number;
  largeur: number;
}

const MARGE = 12;
/** Décalage de la bulle vers la gauche de la marque (maquette : `left: -12px`). */
const DEBORD = 12;
/** Écart entre le haut du bouton de la marque (44 px) et le bas de la bulle. */
const ECART = 22;
const SUIVI_ANIMATION_MS = 700;

/**
 * Où poser la bulle du superviseur : alignée sur la marque (et non centrée comme la bulle
 * d'un agent), sa pointe sous le centre du viseur, gardée dans la fenêtre. Pur.
 */
export function placerSurMarque(
  marque: { left: number; top: number; width: number },
  largeur: number,
  fenetre: { largeur: number; hauteur: number },
): PlacementMarque {
  const larg = Math.max(0, Math.min(largeur, fenetre.largeur - 2 * MARGE));
  const left = Math.max(MARGE, Math.min(marque.left - DEBORD, fenetre.largeur - MARGE - larg));
  return {
    left,
    bottom: fenetre.hauteur - marque.top + ECART,
    pointe: marque.left + marque.width / 2 - left,
    largeur: larg,
  };
}

/**
 * Suit la marque du superviseur ([data-dock-superviseur]) : null tant qu'elle n'est pas
 * dans le DOM (dock masqué, superviseur désactivé). Remesuré au redimensionnement de la
 * fenêtre et du dock, et à chaque image pendant l'apparition du dock.
 */
export function usePlacementSuperviseur(actif: boolean, largeur: number): PlacementMarque | null {
  const [place, setPlace] = useState<PlacementMarque | null>(null);

  useLayoutEffect(() => {
    if (!actif) {
      setPlace(null);
      return;
    }
    let image = 0;
    const debut = performance.now();
    const mesurer = () => {
      const el = document.querySelector<HTMLElement>("[data-dock-superviseur]");
      if (!el) {
        setPlace((p) => (p === null ? p : null));
        return;
      }
      const r = el.getBoundingClientRect();
      const p = placerSurMarque(r, largeur, { largeur: window.innerWidth, hauteur: window.innerHeight });
      setPlace((prev) =>
        prev && prev.left === p.left && prev.bottom === p.bottom && prev.pointe === p.pointe && prev.largeur === p.largeur
          ? prev
          : p,
      );
    };
    const planifier = () => {
      if (!image) image = requestAnimationFrame(() => ((image = 0), mesurer()));
    };
    const suivre = () => {
      mesurer();
      image = performance.now() - debut < SUIVI_ANIMATION_MS ? requestAnimationFrame(suivre) : 0;
    };
    suivre();
    window.addEventListener("resize", planifier);
    const dock = document.querySelector<HTMLElement>('nav[aria-label="Espaces de travail"]');
    const taille = new ResizeObserver(planifier);
    if (dock) taille.observe(dock);
    return () => {
      cancelAnimationFrame(image);
      window.removeEventListener("resize", planifier);
      taille.disconnect();
    };
  }, [actif, largeur]);

  return place;
}
