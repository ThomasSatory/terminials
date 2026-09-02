/** Caractères qu'on peut écrire nus dans le PTY sans que le shell les réinterprète.
    Tout le reste (espace, $, `, ', ...) passe par des quotes simples. */
const SAFE = /^[A-Za-z0-9._/-]+$/;

/** Quote un chemin pour qu'il traverse un shell (ou le prompt de Claude Code) intact.
    Quotes simples = aucune expansion possible ; l'apostrophe interne est refermée puis
    échappée (`'\''`), seule façon de la faire passer dans une chaîne single-quoted.
    Pure, testable sans DOM. */
export function quotePathForShell(path: string): string {
  if (SAFE.test(path)) return path;
  // replace(/'/g) et pas replaceAll : la lib TS du projet est ES2020 (cf. tsconfig).
  return `'${path.replace(/'/g, "'\\''")}'`;
}

/** Texte à injecter dans le PTY pour une liste de chemins (collage d'image, drop de
    fichiers) : chemins quotés séparés par un espace, plus un espace final pour que
    l'utilisateur enchaîne sa phrase sans coller au chemin. Liste vide → rien à écrire. */
export function formatPathsForPrompt(paths: string[]): string {
  if (paths.length === 0) return "";
  return paths.map(quotePathForShell).join(" ") + " ";
}

/** Extension de fichier déduite du type MIME d'un blob collé. Le sous-type est renvoyé
    tel quel (paramètres et suffixe `+xml` retirés) : l'allowlist des formats réellement
    acceptés vit côté Rust (`images.rs`), un seul endroit fait autorité. null = pas une
    image, on ne sollicite pas le backend. */
export function extFromMime(mime: string): string | null {
  const [type, subtype] = mime.split(";")[0].trim().toLowerCase().split("/");
  if (type !== "image" || !subtype) return null;
  return subtype.split("+")[0] || null;
}
