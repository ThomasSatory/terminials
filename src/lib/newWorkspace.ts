import { homeDir } from "@tauri-apps/api/path";
import { useWorkspaceStore } from "../store/workspace";
import { stripTrailingSlash } from "./paths";

/** Crée un workspace directement sur $HOME, sans sélecteur de dossier :
 *  c'est l'action « nouvel espace » (bouton + et Ctrl+Shift+N). Le sélecteur
 *  reste réservé à « ouvrir un dossier » (Ctrl+Shift+O).
 *  Nommé « ~ » plutôt que par basename($HOME) : le nom du compte système ne dit
 *  rien d'utile dans la sidebar. */
export async function createHomeWorkspace(): Promise<void> {
  let home: string;
  try {
    home = stripTrailingSlash(await homeDir());
  } catch {
    useWorkspaceStore.getState().showToast("home introuvable");
    return;
  }
  useWorkspaceStore.getState().addWorkspace(home, "~");
}
