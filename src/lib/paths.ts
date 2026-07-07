/** Abréviation d'un chemin pour l'affichage : remplace le préfixe $HOME par `~`.
    `home` vide → chemin inchangé (répertoire home pas encore résolu côté Tauri).
    Tolère le slash final que `homeDir()` peut renvoyer. Pure, testable sans Tauri. */
export function abbreviateHome(path: string, home: string): string {
  if (!home) return path;
  const h = home.endsWith("/") ? home.slice(0, -1) : home;
  if (path === h) return "~";
  if (path.startsWith(h + "/")) return "~" + path.slice(h.length);
  return path;
}
