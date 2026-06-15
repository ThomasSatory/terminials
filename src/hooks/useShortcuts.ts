import { useEffect } from "react";
import { useWorkspaceStore, firstLeafPaneId } from "../store/workspace";

const HOME = "/home/user";

/** Raccourcis globaux : Ctrl+N nouveau workspace, Ctrl+D / Ctrl+Shift+D split. */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useWorkspaceStore.getState();
      const active = s.workspaces.find((w) => w.id === s.activeId);
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        s.addWorkspace(HOME);
      }
      if (active && e.ctrlKey && e.key === "d") {
        e.preventDefault();
        const leaf = firstLeafPaneId(active.root);
        if (leaf) s.splitPane(active.id, leaf, e.shiftKey ? "vertical" : "horizontal");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
