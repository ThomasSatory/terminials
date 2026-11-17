import { useEffect } from "react";
import { useReglagesStore } from "../store/reglages";
import { attributsApparence, variablesApparence } from "../lib/apparence";

/**
 * Applique en direct les réglages d'apparence à toute l'interface : variables CSS de
 * l'accent et de la densité du dock sur :root, `data-densite` et `data-mouvement`
 * (« Réduire les animations », honoré par tokens.css et `mouvementReduit`). Monté une
 * fois, par la coquille. Les terminaux suivent de leur côté (TerminalPane lit
 * `optionsTerminal`), xterm ne lisant pas les variables CSS.
 */
export function useApparence(): void {
  const apparence = useReglagesStore((s) => s.reglages.apparence);
  useEffect(() => {
    const racine = document.documentElement;
    const r = { ...useReglagesStore.getState().reglages, apparence };
    for (const [nom, valeur] of Object.entries(variablesApparence(r))) racine.style.setProperty(nom, valeur);
    const { densite, mouvement } = attributsApparence(r);
    racine.dataset.densite = densite;
    racine.dataset.mouvement = mouvement;
  }, [apparence]);
}
