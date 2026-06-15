import { useEffect } from "react";
import { useWorkspaceStore, type PaneNode } from "../store/workspace";

const HOME = "/home/user";

function firstLeaf(node: PaneNode): string | null {
  if (node.kind === "leaf") return node.paneId;
  for (const c of node.children) {
    const r = firstLeaf(c);
    if (r) return r;
  }
  return null;
}

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
        const leaf = firstLeaf(active.root);
        if (leaf) s.splitPane(active.id, leaf, e.shiftKey ? "vertical" : "horizontal");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
