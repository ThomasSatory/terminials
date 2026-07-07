import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore, getLastFolder, setLastFolder } from "../store/workspace";

// Guard module-level anti double-ouverture : un second Ctrl+Shift+O (ou
// double-clic sur le bouton +) pendant l'await ouvrirait deux dialogs GTK.
let dialogOpen = false;

/** Ouvre le sélecteur de dossier natif (GTK) et crée un workspace sur le
 *  dossier choisi. Annulation (null) → no-op strict. */
export async function openFolderDialog(): Promise<void> {
  if (dialogOpen) return;
  dialogOpen = true;
  try {
    const path = await open({ directory: true, defaultPath: getLastFolder() });
    if (typeof path !== "string") return; // annulation
    useWorkspaceStore.getState().addWorkspace(path);
    setLastFolder(path);
  } finally {
    dialogOpen = false;
  }
}
