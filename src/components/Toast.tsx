import { useWorkspaceStore } from "../store/workspace";

/**
 * Message bref de l'app (dossier introuvable, échec de collage…), en bas à droite
 * au-dessus du dock, annoncé aux lecteurs d'écran (role="status"). Son retrait après
 * 2 s est un effet d'App.
 */
export function Toast() {
  const toast = useWorkspaceStore((s) => s.toast);
  if (!toast) return null;
  return (
    // `key` : un nouveau message rejoue l'entrée.
    <div key={toast} className="app-toast" role="status" aria-live="polite">
      <span className="app-toast-point" aria-hidden="true" />
      <span className="app-toast-texte">{toast}</span>
    </div>
  );
}
