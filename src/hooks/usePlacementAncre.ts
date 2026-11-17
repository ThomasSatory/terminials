import { useLayoutEffect, useState } from "react";
import { placerAuDessus, selecteurAncre, trouverAncre, type Ancre } from "../lib/ancrage";

/** Position d'un calque `fixed` posé au-dessus d'une ancre du dock. */
export interface PlacementAncre {
  left: number;
  bottom: number;
  /** Abscisse de la pointe, depuis le bord gauche du calque. */
  pointe: number;
  /** Largeur retenue : réduite si la fenêtre est plus étroite que le calque. */
  largeur: number;
}

/** Durée pendant laquelle on remesure à chaque image : le dock glisse et grossit à son apparition. */
const SUIVI_ANIMATION_MS = 700;
const MARGE = 12;

/**
 * Suit une ancre du dock ([data-ws-id], [data-dock-add]…) et rend où poser un calque
 * `position: fixed` au-dessus d'elle, ou null tant que l'ancre n'est pas dans le DOM
 * (dock masqué, espace dans un groupe replié). Recalculé au redimensionnement de la
 * fenêtre et du dock (ResizeObserver), au défilement (le dock peut défiler), quand ses
 * enfants changent (avatar ajouté, groupe replié) et à chaque image pendant l'animation
 * d'entrée du dock. `relance` : valeur dont le changement force un nouveau suivi (le dock
 * monté ou démonté, par exemple).
 */
export function usePlacementAncre(
  ancre: Ancre | null,
  largeur: number,
  ecart: number,
  relance?: unknown,
): PlacementAncre | null {
  const [place, setPlace] = useState<PlacementAncre | null>(null);
  const cle = ancre ? selecteurAncre(ancre) : null;

  useLayoutEffect(() => {
    if (!ancre) {
      setPlace(null);
      return;
    }
    let image = 0;
    const debut = performance.now();

    const mesurer = () => {
      const el = trouverAncre(ancre);
      if (!el) {
        setPlace((p) => (p === null ? p : null));
        return;
      }
      const r = el.getBoundingClientRect();
      const larg = Math.max(0, Math.min(largeur, window.innerWidth - 2 * MARGE));
      const p = placerAuDessus(
        { centreX: r.left + r.width / 2, haut: r.top },
        larg,
        { largeur: window.innerWidth, hauteur: window.innerHeight },
        ecart,
        MARGE,
      );
      setPlace((prev) =>
        prev && prev.left === p.left && prev.bottom === p.bottom && prev.pointe === p.pointe && prev.largeur === larg
          ? prev
          : { ...p, largeur: larg },
      );
    };

    // Une seule mesure par image, quel que soit le nombre d'événements reçus.
    const planifier = () => {
      if (!image) image = requestAnimationFrame(() => ((image = 0), mesurer()));
    };
    const suivreAnimation = () => {
      mesurer();
      if (performance.now() - debut < SUIVI_ANIMATION_MS) image = requestAnimationFrame(suivreAnimation);
      else image = 0;
    };

    suivreAnimation();
    window.addEventListener("resize", planifier);
    window.addEventListener("scroll", planifier, true);

    const dock = document.querySelector<HTMLElement>('nav[aria-label="Espaces de travail"]');
    const cible = trouverAncre(ancre);
    const taille = new ResizeObserver(planifier);
    if (dock) taille.observe(dock);
    if (cible) taille.observe(cible);
    const mutations = new MutationObserver(planifier);
    if (dock) mutations.observe(dock, { childList: true, subtree: true });

    return () => {
      cancelAnimationFrame(image);
      window.removeEventListener("resize", planifier);
      window.removeEventListener("scroll", planifier, true);
      taille.disconnect();
      mutations.disconnect();
    };
    // `ancre` est décrit par sa clé : un objet neuf à chaque rendu ne relance pas le suivi.
  }, [cle, largeur, ecart, relance]);

  return place;
}
