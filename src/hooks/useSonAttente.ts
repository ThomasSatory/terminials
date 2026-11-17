import { useEffect } from "react";
import { useWorkspaceStore } from "../store/workspace";
import { useReglagesStore } from "../store/reglages";
import { espacesPassesEnAttente, idsEnAttente, jouerSonAttente, sonPermis } from "../lib/parametresSon";

/**
 * Réglage « Son » (Paramètres › Agents et notifications) : un son bref (WebAudio, rien à
 * charger) quand un agent passe en attente. Monté une fois par la coquille ; muet tant
 * que le réglage est coupé.
 *
 * Seul un PASSAGE en attente sonne : les espaces déjà en attente au montage (reprise de
 * l'app) ou quand on active le réglage ne font pas de bruit, et deux agents qui
 * s'arrêtent ensemble ne sonnent qu'une fois (`sonPermis`).
 */
export function useSonAttente(): void {
  useEffect(() => {
    let precedents = idsEnAttente(useWorkspaceStore.getState());
    let dernier = 0;
    return useWorkspaceStore.subscribe((s) => {
      const actuels = idsEnAttente(s);
      const nouveaux = espacesPassesEnAttente(precedents, actuels);
      precedents = actuels;
      if (!nouveaux.length || !useReglagesStore.getState().reglages.notifications.son) return;
      const maintenant = Date.now();
      if (!sonPermis(dernier, maintenant)) return;
      dernier = maintenant;
      jouerSonAttente();
    });
  }, []);
}
