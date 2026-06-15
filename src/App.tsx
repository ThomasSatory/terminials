import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import { PaneTree } from "./components/PaneTree";
import { useShortcuts } from "./hooks/useShortcuts";
import { registerSocketEvents } from "./lib/socketEvents";
import { useWorkspaceStore, firstLeafPaneId } from "./store/workspace";
import "./App.css";

const HOME = "/home/user";

export default function App() {
  useShortcuts();
  const { workspaces, activeId, addWorkspace } = useWorkspaceStore();

  // Crée un workspace initial au premier montage.
  useEffect(() => {
    if (useWorkspaceStore.getState().workspaces.length === 0) addWorkspace(HOME);
  }, [addWorkspace]);

  // Branche les events backend (socket-command, agent-notification).
  useEffect(() => {
    const cleanup = registerSocketEvents();
    return () => {
      cleanup.then((fn) => fn());
    };
  }, []);

  // Poller git (~2s) : rafraîchit la branche affichée dans la sidebar.
  useEffect(() => {
    const tick = async () => {
      const s = useWorkspaceStore.getState();
      for (const w of s.workspaces) {
        try {
          const info = await invoke<{ branch: string | null; dirty: boolean }>("git_info", {
            cwd: w.cwd,
          });
          if (info.branch) s.setGit(w.id, info.branch, info.dirty);
        } catch {
          /* commande indisponible (backend pas prêt) ou cwd hors repo */
        }
      }
    };
    const h = setInterval(tick, 2000);
    tick();
    return () => clearInterval(h);
  }, []);

  // Poller ports (~2s) : interroge le PTY du premier pane de chaque workspace.
  useEffect(() => {
    const tick = async () => {
      const s = useWorkspaceStore.getState();
      for (const w of s.workspaces) {
        const paneId = firstLeafPaneId(w.root);
        const ptyId = paneId ? s.panePtys[paneId] : undefined;
        if (ptyId === undefined) continue;
        try {
          const ports = await invoke<number[]>("workspace_ports", { ptyId });
          s.setPorts(w.id, ports);
        } catch {
          /* backend pas prêt */
        }
      }
    };
    const h = setInterval(tick, 2000);
    tick();
    return () => clearInterval(h);
  }, []);

  const active = workspaces.find((w) => w.id === activeId);
  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", background: "#1e1e1e" }}>
      <Sidebar />
      <div style={{ flex: 1 }}>{active && <PaneTree ws={active} />}</div>
    </div>
  );
}
