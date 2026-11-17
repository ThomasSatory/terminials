/**
 * Zoom de la tuile vers le terminal, comme la maquette (zoomA/zoomB, .38s) : c'est la
 * VRAIE zone terminal de la coquille qui grandit depuis la tuile choisie, pas une copie.
 * La mosaïque disparaît aussitôt (vue « terminal »), la barre du haut réelle (nom,
 * groupe, onglets, ±) est déjà en place, et le terminal grandit dessous avec son propre
 * rendu : aucun calque intermédiaire, donc aucun saut de mise en page ou de couleurs à
 * la fin de l'effet.
 *
 * Sans saut : pendant le zoom, la zone porte `data-zoom`, qui coupe l'entrée ordinaire du
 * panneau révélé (inA, glissement de 8 px en fondu, topbar.css) — les deux mouvements
 * superposés faisaient sauter le texte en fin d'effet. Le zoom part de la tuile et finit
 * exactement sur la zone réelle des terminaux (transform « none », sans remplissage).
 *
 * L'animation passe par l'API Web Animations sur `.app-zone` : elle survit au démontage
 * de la mosaïque et ne laisse rien derrière elle (pas de style en ligne, pas de remplissage
 * final). Le terminal n'est ni démonté ni redimensionné : un `transform` ne change pas la
 * taille de mise en page que mesure le terminal, donc aucun refit du PTY pendant l'effet.
 */

/** Durée et courbe du zoom de la maquette. */
const DUREE_ZOOM_MS = 380;
const COURBE_ZOOM = "cubic-bezier(.2,.9,.25,1)";

let zoomEnCours: Animation | null = null;

/**
 * Lance le zoom de la zone terminal depuis le rectangle `depuis` (la tuile, en px
 * fenêtre). À appeler juste AVANT de passer en vue terminal, dans le même tour : le
 * terminal apparaît déjà réduit, sans image de trop. Sans zone ou sans API d'animation
 * (tests), ne fait rien : la vue change simplement.
 */
export function zoomerVersTerminal(depuis: DOMRect): void {
  const zone = document.querySelector<HTMLElement>(".app-zone");
  if (!zone || typeof zone.animate !== "function") return;
  const z = zone.getBoundingClientRect();
  // Origine dans le repère de la zone, comme la maquette (centre de la tuile moins la barre).
  const x = Math.round(depuis.left + depuis.width / 2 - z.left);
  const y = Math.max(0, Math.round(depuis.top + depuis.height / 2 - z.top));
  const origine = `${x}px ${y}px`;
  zoomEnCours?.cancel();
  // Posé AVANT le rendu de la vue terminal : le panneau révélé naît sans son entrée inA.
  zone.dataset.zoom = "";
  // La courbe s'applique par segment, comme `animation-timing-function` en CSS :
  // l'opacité atteint 1 à 55 %, l'échelle court sur toute la durée.
  zoomEnCours = zone.animate(
    [
      {
        offset: 0,
        opacity: 0,
        transform: "scale(.2)",
        transformOrigin: origine,
        borderRadius: "12px",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,.16)",
        easing: COURBE_ZOOM,
      },
      { offset: 0.55, opacity: 1, easing: COURBE_ZOOM },
      {
        offset: 1,
        opacity: 1,
        transform: "none",
        transformOrigin: origine,
        borderRadius: "0px",
        boxShadow: "inset 0 0 0 1px rgba(255,255,255,0)",
      },
    ],
    { duration: DUREE_ZOOM_MS, easing: "linear" },
  );
  const fin = zoomEnCours;
  fin.onfinish = fin.oncancel = () => {
    if (zoomEnCours !== fin) return; // un zoom plus récent a pris la main (et l'attribut)
    zoomEnCours = null;
    delete zone.dataset.zoom;
  };
}
