import { homeDir } from "@tauri-apps/api/path";
import { useWorkspaceStore } from "../store/workspace";
import { useDashboardStore } from "../store/dashboard";
import { nextCopyName } from "./copyName";

/** Nom d'un nouvel espace sur $HOME : « ~ », puis « ~ 2 », « ~ 3 »… */
export function homeWorkspaceName(existing: readonly string[]): string {
  return existing.includes("~") ? nextCopyName("~", existing) : "~";
}

/** Crée un espace « libre » sur $HOME, sans formulaire ni dialog : un terminal
 *  qui n'appartient à aucun projet (bouton ~ de la sidebar, Ctrl+Shift+Entrée). */
export async function addHomeWorkspace(): Promise<void> {
  const home = await homeDir().catch(() => "");
  const s = useWorkspaceStore.getState();
  if (!home) {
    s.showToast("home pas encore résolu");
    return;
  }
  // Créer un terminal, c'est vouloir le voir : le dashboard s'efface.
  useDashboardStore.getState().close();
  s.addWorkspace(home, homeWorkspaceName(s.workspaces.map((w) => w.name)));
}
