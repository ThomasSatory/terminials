import { useUiStore } from "../store/ui";
import { reserveBasse } from "../lib/reserveBasse";

/**
 * Réserve basse (valeur CSS) des vues qui montent au-dessus du dock : App (terminaux),
 * Mosaïque et poste de suivi. Ne dépend que de la présence du dock (lib/reserveBasse) ;
 * pas de transition, chaque image intermédiaire redimensionnerait le PTY.
 */
export function useReserveDock(): string {
  const dockVisible = useUiStore((s) => s.dockVisible);
  return reserveBasse(dockVisible);
}
