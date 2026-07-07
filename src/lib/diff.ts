/** Une ligne de diff unifié prête à rendre : type + numéros de ligne + texte sans marqueur. */
export interface DiffLine {
  kind: "add" | "del" | "ctx" | "hunk" | "meta";
  oldNo?: number;
  newNo?: number;
  text: string;
}

/** Fichier modifié tel que sérialisé par la commande Tauri `git_changed_files` (camelCase). */
export interface ChangedFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  origPath?: string;
  /** Lignes ajoutées/supprimées (numstat) ; absents = fichier binaire. */
  added?: number;
  deleted?: number;
}

/** En-tête de hunk : `@@ -old[,n] +new[,m] @@[ section]` — les comptes sont optionnels. */
const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse un diff unifié (`git diff --no-color`, un ou plusieurs fichiers concaténés)
 * en lignes annotées :
 * - en-têtes (`diff --git`, `index`, `---`, `+++`, `new file mode`, `Binary files …`) → "meta" ;
 * - `\ No newline at end of file` → "meta" ;
 * - numéros old/new calculés depuis les en-têtes `@@` ;
 * - le marqueur `+`/`-`/espace est retiré de `text` pour add/del/ctx (le kind le porte).
 */
export function parseUnifiedDiff(text: string): DiffLine[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop(); // newline final du diff
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of lines) {
    const m = HUNK_RE.exec(line);
    if (m) {
      oldNo = parseInt(m[1], 10);
      newNo = parseInt(m[2], 10);
      inHunk = true;
      out.push({ kind: "hunk", text: line });
    } else if (!inHunk || line.startsWith("diff --git ")) {
      // Avant le premier @@ d'un fichier, tout est en-tête ; un `diff --git` non préfixé
      // (jamais produit comme ligne de contenu, qui commence par espace/+/-) rouvre les en-têtes.
      inHunk = false;
      out.push({ kind: "meta", text: line });
    } else if (line.startsWith("+")) {
      out.push({ kind: "add", newNo: newNo++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      out.push({ kind: "del", oldNo: oldNo++, text: line.slice(1) });
    } else if (line.startsWith("\\")) {
      out.push({ kind: "meta", text: line }); // \ No newline at end of file
    } else {
      // Ligne de contexte (" x" — ou "" si un outil a rogné l'espace de fin).
      out.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    }
  }
  return out;
}
