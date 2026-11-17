import { useEffect, useState } from "react";
import { abonnerTerminal, lireDernieresLignes, DELAI_ABONNEMENT_MS } from "../lib/terminalRegistry";

/**
 * Les `n` dernières lignes non vides du terminal d'un onglet, tenues à jour au rythme
 * limité du registre (au plus une lecture par `delaiMs`). Lecture seule : ne monte ni
 * ne touche aucun terminal ; un onglet sans terminal (pas encore monté) rend [].
 */
export function useDernieresLignes(tabId: string | null, n: number, delaiMs = DELAI_ABONNEMENT_MS): string[] {
  const [lignes, setLignes] = useState<string[]>(() => (tabId ? lireDernieresLignes(tabId, n) : []));
  useEffect(() => {
    if (!tabId) {
      setLignes([]);
      return;
    }
    const lire = () => {
      const suivantes = lireDernieresLignes(tabId, n);
      // Même contenu : on garde le tableau précédent, pas de re-rendu.
      setLignes((cur) =>
        cur.length === suivantes.length && cur.every((l, i) => l === suivantes[i]) ? cur : suivantes,
      );
    };
    lire();
    return abonnerTerminal(tabId, lire, delaiMs);
  }, [tabId, n, delaiMs]);
  return lignes;
}
