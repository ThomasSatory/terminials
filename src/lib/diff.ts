import { pluriel } from "./pluriel";

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

/**
 * Libellé et jeton de couleur d'un statut de fichier (lettre colorée de la liste), et le
 * fond de la lettre : la couleur à 12 % (« 1f » de la maquette), écrit en rgba plutôt
 * qu'en color-mix(), pas garanti sur les webviews visés (valeurs des jetons de tokens.css).
 */
export const STATUT_FICHIER: Record<
  ChangedFile["status"],
  { lettre: string; libelle: string; couleur: string; fond: string }
> = {
  modified: { lettre: "M", libelle: "modifié", couleur: "var(--avertissement)", fond: "rgba(227, 179, 65, 0.12)" },
  added: { lettre: "A", libelle: "ajouté", couleur: "var(--succes)", fond: "rgba(126, 231, 135, 0.12)" },
  deleted: { lettre: "D", libelle: "supprimé", couleur: "var(--suppression)", fond: "rgba(255, 157, 148, 0.12)" },
  renamed: { lettre: "R", libelle: "renommé", couleur: "var(--accent)", fond: "var(--accent-doux)" },
  untracked: { lettre: "?", libelle: "non suivi", couleur: "var(--texte-discret)", fond: "rgba(146, 150, 160, 0.12)" },
};

/** Accord en nombre partagé (lib/pluriel), réexporté pour les vues qui l'importaient d'ici. */
export { pluriel };

/** Chemin coupé en dossier (avec « / » final, « ./ » à la racine) et nom de fichier. */
export function scinderChemin(chemin: string): { dir: string; nom: string } {
  const i = chemin.lastIndexOf("/");
  return i < 0 ? { dir: "./", nom: chemin } : { dir: chemin.slice(0, i + 1), nom: chemin.slice(i + 1) };
}

/** Totaux de la barre d'en-tête ; un binaire (numstat absent) compte pour zéro. */
export function totauxDiff(fichiers: ChangedFile[]): { ajouts: number; suppressions: number } {
  return {
    ajouts: fichiers.reduce((n, f) => n + (f.added ?? 0), 0),
    suppressions: fichiers.reduce((n, f) => n + (f.deleted ?? 0), 0),
  };
}

/** Filtre sous-chaîne insensible à la casse sur le chemin ; vide = tout. */
export function filtrerFichiers(fichiers: ChangedFile[], filtre: string): ChangedFile[] {
  const q = filtre.trim().toLowerCase();
  return q ? fichiers.filter((f) => f.path.toLowerCase().includes(q)) : fichiers;
}

/** Phrase lue par un lecteur d'écran pour une ligne de la liste. */
export function libelleFichier(f: ChangedFile): string {
  const base = `${f.path}, ${STATUT_FICHIER[f.status].libelle}`;
  if (f.added === undefined && f.deleted === undefined) return `${base}, binaire`;
  return `${base}, ${pluriel(f.added ?? 0, "ajout")}, ${pluriel(f.deleted ?? 0, "suppression")}`;
}

const ENTETE_HUNK_RE = /^(@@ -\d+(?:,\d+)? \+\d+(?:,\d+)? @@)\s?(.*)$/;

/** Sépare « @@ -a,b +c,d @@ section » en plage (grisée) et section (fonction englobante). */
export function scinderEnteteHunk(texte: string): { plage: string; section: string } {
  const m = ENTETE_HUNK_RE.exec(texte);
  return m ? { plage: m[1], section: m[2] } : { plage: texte, section: "" };
}
