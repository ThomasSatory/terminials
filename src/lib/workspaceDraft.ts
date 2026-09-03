import { stripTrailingSlash } from "./paths";

/** Champs bruts du formulaire inline de la Sidebar (création et édition). */
export interface DraftFields {
  name: string;
  folder: string;
}

/** Couple prêt pour le store. `name: undefined` = laisser le store retomber
    sur basename(cwd) (création) ou sur le même fallback via renameWorkspace(""). */
export interface ResolvedDraft {
  cwd: string;
  name: string | undefined;
}

/**
 * Résout les deux champs du formulaire en (cwd, name).
 *
 * - dossier vide ou « ~ » → $HOME ; « ~/x » réexpansé en absolu
 * - slash final retiré (le cwd d'un workspace reste canonique, cf. paths.ts)
 * - nom vide → undefined, SAUF sur $HOME où le nom devient « ~ » : le nom du
 *   compte système ne dit rien d'utile dans la sidebar
 *
 * Retourne null quand aucun cwd absolu ne peut être déterminé : chemin relatif
 * saisi à la main, ou $HOME pas encore résolu par Tauri alors qu'on en a besoin.
 * Pure et testable sans Tauri.
 */
export function resolveDraft(d: DraftFields, home: string): ResolvedDraft | null {
  const h = stripTrailingSlash(home);
  const folder = d.folder.trim();

  let cwd: string;
  if (folder === "" || folder === "~") cwd = h;
  else if (folder.startsWith("~/")) cwd = h ? stripTrailingSlash(h + folder.slice(1)) : "";
  else cwd = stripTrailingSlash(folder);

  if (!cwd.startsWith("/")) return null;

  const name = d.name.trim();
  return { cwd, name: name || (cwd === h ? "~" : undefined) };
}
