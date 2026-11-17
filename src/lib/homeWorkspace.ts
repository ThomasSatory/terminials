import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { useWorkspaceStore } from "../store/workspace";
import { useDashboardStore } from "../store/dashboard";
import { useReglagesStore } from "../store/reglages";
import { nextCopyName } from "./copyName";
import { basename } from "./palette";

/** Nom d'un nouvel espace sur $HOME : « ~ », puis « ~ 2 », « ~ 3 »… */
export function homeWorkspaceName(existing: readonly string[]): string {
  return existing.includes("~") ? nextCopyName("~", existing) : "~";
}

/**
 * Dossier de départ (Paramètres › Terminal) → chemin absolu : « ~ » et « ~/… » partent du
 * dossier personnel, un chemin relatif aussi (un terminal n'a pas d'autre point
 * d'ancrage), un chemin absolu reste tel quel. Barres finales retirées.
 */
export function resoudreDossierDepart(reglage: string, home: string): string {
  const h = home.replace(/\/+$/, "") || "/";
  const r = reglage.trim();
  let chemin: string;
  if (!r || r === "~") chemin = h;
  else if (r.startsWith("~/")) chemin = `${h}/${r.slice(2)}`;
  else if (r.startsWith("/")) chemin = r;
  else chemin = `${h}/${r}`;
  return chemin.length > 1 ? chemin.replace(/\/+$/, "") : chemin;
}

/** Nom de l'espace ouvert sur le dossier de départ : « ~ » pour le dossier personnel
    (comme avant ce réglage), sinon le nom du dossier ; numéroté s'il est déjà pris. */
export function nomEspaceDepart(dossier: string, home: string, existants: readonly string[]): string {
  if (dossier === resoudreDossierDepart("~", home)) return homeWorkspaceName(existants);
  const nom = basename(dossier) || dossier;
  return existants.includes(nom) ? nextCopyName(nom, existants) : nom;
}

/** Crée un espace « libre » sur le dossier de départ réglé ($HOME par défaut), sans
 *  formulaire ni dialog (bouton ~, Ctrl+Maj+Entrée). Un dossier de départ disparu se
 *  signale et l'espace s'ouvre sur $HOME : le raccourci ne doit jamais rester sans effet. */
export async function addHomeWorkspace(): Promise<void> {
  const home = await homeDir().catch(() => "");
  const s = useWorkspaceStore.getState();
  if (!home) {
    s.showToast("home pas encore résolu");
    return;
  }
  const reglage = useReglagesStore.getState().reglages.terminal.dossierDepart;
  let dossier = resoudreDossierDepart(reglage, home);
  if (dossier !== resoudreDossierDepart("~", home)) {
    const existe = await invoke<boolean>("dir_exists", { path: dossier }).catch(() => false);
    if (!existe) {
      s.showToast(`dossier de départ introuvable : ${reglage}`);
      dossier = resoudreDossierDepart("~", home);
    }
  }
  // Créer un terminal, c'est vouloir le voir : le dashboard s'efface.
  useDashboardStore.getState().close();
  const etat = useWorkspaceStore.getState();
  etat.addWorkspace(dossier, nomEspaceDepart(dossier, home, etat.workspaces.map((w) => w.name)));
}
