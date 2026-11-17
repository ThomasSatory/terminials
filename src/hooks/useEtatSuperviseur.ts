import { useEffect, useMemo, useState } from "react";
import { useWorkspaceStore, navigableOrder, hasAttention } from "../store/workspace";
import { useReglagesStore } from "../store/reglages";
import {
  useSuperviseurStore,
  demandesOuvertes,
  modeDepuis,
  nbEchangesEnCours,
  outilEnCours,
  type ModeSuperviseur,
} from "../store/superviseur";
import { couleurEspace } from "../lib/couleurEspace";
import { monogramme } from "../lib/monogram";
import { raccourciEspace } from "../lib/dockInfo";
import { ligneEtatSuperviseur, tonLigneEtat } from "../lib/superviseurLibelles";

/**
 * Lectures partagées par la marque, le panneau et la bulle du superviseur, en sélecteurs
 * ciblés (des nombres et des références stables, jamais le store entier).
 */

export interface InfoEspaceSuperviseur {
  id: string;
  nom: string;
  mono: string;
  couleur: string;
  cwd: string;
  /** « Ctrl 3 », ou "" au-delà de 9 / groupe replié. */
  raccourci: string;
  activeTabId: string | null;
}

/** Espaces par id, avec ce qu'en affichent le fil et les cartes. */
export function useEspacesSuperviseur(): Map<string, InfoEspaceSuperviseur> {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const groups = useWorkspaceStore((s) => s.groups);
  return useMemo(() => {
    const ordre = navigableOrder(workspaces, groups).map((w) => w.id);
    return new Map(
      workspaces.map((w) => [
        w.id,
        {
          id: w.id,
          nom: w.name,
          mono: monogramme(w.name),
          couleur: couleurEspace(w),
          cwd: w.cwd,
          raccourci: raccourciEspace(ordre, w.id),
          activeTabId: w.activeTabId,
        },
      ]),
    );
  }, [workspaces, groups]);
}

export interface EtatAffiche {
  mode: ModeSuperviseur;
  ligne: string;
  ton: "discret" | "travail" | "attente";
  nbAttente: number;
  nbDemandes: number;
}

/** Mode du superviseur et sa ligne d'état (« observe 8 espaces · 1 vous attend »). */
export function useEtatAffiche(): EtatAffiche {
  const pause = useReglagesStore((s) => s.reglages.superviseur.pause);
  const enCours = useSuperviseurStore((s) => s.moteur.enCours);
  const outil = useSuperviseurStore(outilEnCours);
  const nbDemandes = useSuperviseurStore((s) => demandesOuvertes(s).length);
  const nonLus = useSuperviseurStore((s) => s.nonLus);
  const nbEchanges = useSuperviseurStore(nbEchangesEnCours);
  const nbAttente = useWorkspaceStore((s) => s.workspaces.filter(hasAttention).length);
  const nbEspaces = useWorkspaceStore((s) => s.workspaces.length);
  const mode = modeDepuis({ pause, enCours, outil, nbDemandes, nbAttente, nonLus });
  return {
    mode,
    ligne: ligneEtatSuperviseur({ mode, nbEspaces, nbAttente, nbEchanges, outil }),
    ton: tonLigneEtat(mode, nbAttente > 0 || nbDemandes > 0),
    nbAttente,
    nbDemandes,
  };
}

/** Heure courante, rafraîchie toutes les `pasMs` (« depuis 3 min » qui avance). */
export function useMaintenantSuperviseur(pasMs: number): number {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setMaintenant(Date.now()), pasMs);
    return () => clearInterval(t);
  }, [pasMs]);
  return maintenant;
}
