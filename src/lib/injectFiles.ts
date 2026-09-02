import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../store/workspace";
import { writePty } from "./pty";
import { resolveTargetPty } from "./dropTarget";
import { extFromMime, formatPathsForPrompt } from "./pastePaths";

/** Écrit des chemins de fichiers dans le pane visé (`null` = pane actif), quotés pour
    le shell. `false` = aucun PTY cible ou rien à écrire : l'appelant prévient l'utilisateur.
    Couche de câblage : la logique est dans dropTarget/pastePaths, testés à part. */
export function injectPaths(paneId: string | null, paths: string[]): boolean {
  const text = formatPathsForPrompt(paths);
  if (!text) return false;
  const ptyId = resolveTargetPty(useWorkspaceStore.getState(), paneId);
  if (ptyId === undefined) return false;
  writePty(ptyId, text);
  return true;
}

/** Sauve une image du presse-papier dans un fichier temporaire et retourne son chemin
    absolu. Les formats réellement acceptés sont tranchés côté Rust (`images.rs`). */
export async function savePastedImage(file: File): Promise<string> {
  const ext = extFromMime(file.type);
  if (!ext) throw new Error(`type de presse-papier non image : ${file.type || "inconnu"}`);
  const bytes = Array.from(new Uint8Array(await file.arrayBuffer()));
  return invoke<string>("save_pasted_image", { bytes, ext });
}
