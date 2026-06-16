import { useEffect } from "react";
import { useWorkspaceStore, MAX_PANES } from "../store/workspace";

const HOME = "/home/user";

/**
 * Raccourcis globaux :
 *  - Ctrl+N : nouveau workspace
 *  - Ctrl+T : nouveau terminal dans le workspace actif (bloqué à MAX_PANES → toast)
 *  - Ctrl+W : ferme le terminal actif du workspace actif (min 1)
 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useWorkspaceStore.getState();
      const active = s.workspaces.find((w) => w.id === s.activeId);
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        s.addWorkspace(HOME);
      } else if (active && e.ctrlKey && e.key === "t") {
        e.preventDefault();
        if (!s.addPane(active.id)) s.showToast(`max ${MAX_PANES} terminaux`);
      } else if (active && e.ctrlKey && e.key === "w") {
        e.preventDefault();
        if (active.activePaneId) s.closePane(active.id, active.activePaneId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
