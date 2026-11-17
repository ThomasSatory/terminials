import { useWorkspaceStore } from "../store/workspace";
import { etatEspace, etatOnglet, type EtatAgent } from "../lib/etatAgent";

/**
 * État d'agent d'un espace, lu dans le store par un sélecteur qui rend une CHAÎNE : le
 * composant ne se re-rend que quand l'état change, pas à chaque tour des sondes
 * (branche, ports) qui réallouent `workspaces`.
 */
export function useEtatEspace(wsId: string): EtatAgent {
  return useWorkspaceStore((s) => {
    const w = s.workspaces.find((x) => x.id === wsId);
    return w ? etatEspace(w, s) : "repos";
  });
}

/** État d'agent d'un onglet (barre d'onglets, mosaïque). */
export function useEtatOnglet(wsId: string, tabId: string): EtatAgent {
  return useWorkspaceStore((s) => {
    const w = s.workspaces.find((x) => x.id === wsId);
    return w ? etatOnglet(w, tabId, s) : "repos";
  });
}
