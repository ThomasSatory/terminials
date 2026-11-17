import { useSyncExternalStore } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "./workspace";
import { keepExistingSessions } from "../lib/claudeResume";
import {
  ajouterRecent,
  ecrireRecents,
  espacesDisparus,
  estOuvert,
  fiche,
  lireRecents,
  type EspaceRecent,
} from "../lib/espacesRecents";

/**
 * Espaces récemment fermés (« Reprendre » de l'accueil, du menu du + et de la palette).
 * L'app n'en a pas d'autre source : on retient ceux qu'on ferme.
 *
 * Un module-level plutôt qu'un hook : le suivi doit tourner AVANT que l'accueil ne soit
 * monté (c'est la fermeture du dernier espace qui l'affiche), et sans toucher au store
 * workspace — on s'y abonne en lecture seule.
 */

const stockage = (): Storage | undefined => {
  try {
    return typeof localStorage === "undefined" ? undefined : localStorage;
  } catch {
    return undefined; // accès au stockage interdit
  }
};

let recents: EspaceRecent[] = lireRecents(stockage());
const abonnes = new Set<() => void>();

function majRecents(suite: EspaceRecent[]): void {
  recents = suite;
  ecrireRecents(stockage(), recents);
  abonnes.forEach((f) => f());
}

function suivreFermetures(): () => void {
  return useWorkspaceStore.subscribe((s, prev) => {
    if (s.workspaces === prev.workspaces) return;
    let suite = recents;
    for (const w of espacesDisparus(prev.workspaces, s.workspaces)) {
      // Groupe lu dans l'état d'AVANT : fermer le dernier membre retire le groupe.
      const groupe = w.groupId ? prev.groups.find((g) => g.id === w.groupId) : undefined;
      const f = fiche({ ...w, groupe }, Date.now());
      if (f) suite = ajouterRecent(suite, f);
    }
    if (suite !== recents) majRecents(suite);
  });
}

const arreterSuivi = suivreFermetures();
// Rechargement à chaud : sans cela chaque version du module laisserait son abonnement.
import.meta.hot?.dispose(arreterSuivi);

/** Les espaces récents, lus hors React (le + du dock décide d'ouvrir le menu ou non). */
export const lireRecentsCourants = (): EspaceRecent[] => recents;

/** Les espaces récents, du plus récent au plus ancien (ouverts compris). */
export function useRecents(): EspaceRecent[] {
  return useSyncExternalStore(
    (f) => {
      abonnes.add(f);
      return () => void abonnes.delete(f);
    },
    () => recents,
  );
}

/** Espaces en cours de réouverture (vérification des sessions) : un second clic ne les
    ouvre pas deux fois. */
const enCours = new Set<string>();
const cle = (e: Pick<EspaceRecent, "cwd" | "nom">) => `${e.cwd}\u0000${e.nom}`;

/**
 * Rouvre un espace récent : même nom, même dossier, même couleur propre, même groupe,
 * mêmes onglets, et la session Claude de chacun reprise au lancement de son shell. Déjà
 * ouvert (« ouvert » dans le menu du +) : on y va simplement. La fiche reste dans la liste,
 * marquée ouverte tant que l'espace l'est.
 */
export function rouvrir(e: EspaceRecent): void {
  const s = useWorkspaceStore.getState();
  const ouvert = s.workspaces.find((w) => w.cwd === e.cwd && w.name === e.nom);
  if (ouvert) {
    s.setActive(ouvert.id);
    return;
  }
  if (enCours.has(cle(e))) return;
  enCours.add(cle(e));
  const ouvrir = (claudeSessions?: EspaceRecent["sessions"]) => {
    enCours.delete(cle(e));
    useWorkspaceStore.getState().restaurerEspace({
      cwd: e.cwd,
      name: e.nom,
      tabCount: e.onglets ?? 1,
      ...(e.propre ? { color: e.propre } : {}),
      ...(claudeSessions ? { claudeSessions } : {}),
      groupe: e.groupe ? { name: e.groupe.nom, color: e.groupe.couleur } : null,
    });
  };
  if (!e.sessions) {
    ouvrir();
    return;
  }
  // Comme au démarrage de l'app : une session dont le dossier a disparu n'est pas reprise.
  void keepExistingSessions({ claudeSessions: e.sessions }, (path) => invoke<boolean>("dir_exists", { path }))
    .catch(() => ({ claudeSessions: undefined }))
    .then((r) => ouvrir(r.claudeSessions));
}

/** Espaces récents qui ne sont pas ouverts en ce moment : ceux qu'on peut reprendre. */
export function aReprendre(liste: readonly EspaceRecent[], ouverts: readonly { cwd: string; name: string }[]): EspaceRecent[] {
  return liste.filter((e) => !estOuvert(e, ouverts));
}
