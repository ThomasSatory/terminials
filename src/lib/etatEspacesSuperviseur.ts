import { useWorkspaceStore, navigableOrder, type Group, type Workspace } from "../store/workspace";
import { useSuperviseurStore, SUPERVISEUR, espaceEnRelais, type LigneEtat } from "../store/superviseur";
import { useReglagesStore } from "../store/reglages";
import { etatEspace, etatOnglet } from "./etatAgent";
import { construireEtatEspaces, lignesEtats, type SourcesEtatEspaces } from "./outilsSuperviseur";

/**
 * Lectures de l'état réel des espaces pour le superviseur : ce que renvoie l'outil
 * `espaces.etat` et le tableau « où en sont mes agents » du fil. Partagé par l'exécuteur
 * des outils et l'envoi d'un message au superviseur.
 */

/** Ordre du dock (celui de Ctrl 1…9), puis les espaces des groupes repliés, qui n'y ont pas
    de rang mais restent dans l'état transmis. */
function ordreComplet(ws: Workspace[], groups: Group[]): string[] {
  const ordre = navigableOrder(ws, groups).map((w) => w.id);
  return [...ordre, ...ws.map((w) => w.id).filter((id) => !ordre.includes(id))];
}

export function sourcesEtat(): SourcesEtatEspaces {
  const w = useWorkspaceStore.getState();
  const sup = useSuperviseurStore.getState();
  const travail = { tabPtys: w.tabPtys, busyPtys: w.busyPtys, tabsTermines: w.tabsTermines };
  const parId = new Map(w.workspaces.map((x) => [x.id, x]));
  return {
    espaces: w.workspaces,
    groupes: w.groups,
    activeId: w.activeId,
    ordre: ordreComplet(w.workspaces, w.groups),
    etatEspace: (id) => {
      const ws = parId.get(id);
      return ws ? etatEspace(ws, travail) : "repos";
    },
    etatOnglet: (id, tabId) => {
      const ws = parId.get(id);
      return ws ? etatOnglet(ws, tabId, travail) : "repos";
    },
    sessionsBloquees: sup.sessionsBloquees,
    enRelais: (id) => espaceEnRelais(sup, id),
  };
}

/** Nom d'un interlocuteur (espace, ou le superviseur) pour les textes. */
export function nomInterlocuteur(qui: string): string {
  if (qui === SUPERVISEUR) return useReglagesStore.getState().reglages.superviseur.nom;
  return useWorkspaceStore.getState().workspaces.find((w) => w.id === qui)?.name ?? "un espace fermé";
}

/** À qui l'espace a posé une question encore sans réponse, sinon null. */
export function relaisVers(wsId: string): string | null {
  const e = useSuperviseurStore
    .getState()
    .echanges.find((x) => x.de === wsId && (x.etat === "ouvert" || x.etat === "transmis"));
  return e ? nomInterlocuteur(e.vers) : null;
}

/** Lignes du tableau « où en sont mes agents », tirées de l'état courant. */
export function lignesEtatsCourantes(): LigneEtat[] {
  return lignesEtats(construireEtatEspaces(sourcesEtat()).espaces, relaisVers);
}
