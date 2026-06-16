import { useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import { PaneTree } from "./components/PaneTree";
import { useShortcuts } from "./hooks/useShortcuts";
import { registerSocketEvents } from "./lib/socketEvents";
import { useWorkspaceStore, MAX_PANES } from "./store/workspace";
import "./App.css";

const HOME = "/home/user";

export default function App() {
  useShortcuts();
  const { workspaces, activeId, addWorkspace, addPane, showToast, toast, clearToast } =
    useWorkspaceStore();

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

  // Auto-dismiss du toast après 2 s.
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => clearToast(), 2000);
    return () => clearTimeout(h);
  }, [toast, clearToast]);

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

  // Poller ports (~2s) : union des ports ouverts par tous les panes de chaque workspace.
  useEffect(() => {
    const tick = async () => {
      const s = useWorkspaceStore.getState();
      for (const w of s.workspaces) {
        const ports = new Set<number>();
        for (const paneId of w.panes) {
          const ptyId = s.panePtys[paneId];
          if (ptyId === undefined) continue;
          try {
            const p = await invoke<number[]>("workspace_ports", { ptyId });
            for (const port of p) ports.add(port);
          } catch {
            /* backend pas prêt */
          }
        }
        s.setPorts(w.id, [...ports].sort((a, b) => a - b));
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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {active && (
          <>
            <div
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "space-between",
                padding: "4px 8px",
                background: "#222",
                color: "#ccc",
                fontSize: 12,
              }}
            >
              <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                <span
                  style={{ width: 8, height: 8, borderRadius: "50%", background: active.color }}
                />
                {active.name}
                <span style={{ color: "#666" }}>
                  {active.panes.length}/{MAX_PANES}
                </span>
              </span>
              <button
                onClick={() => {
                  if (!addPane(active.id)) showToast(`max ${MAX_PANES} terminaux`);
                }}
                title="Nouveau terminal (Ctrl+T)"
              >
                + Terminal
              </button>
            </div>
            <div style={{ flex: 1, minHeight: 0 }}>
              <PaneTree ws={active} />
            </div>
          </>
        )}
      </div>
      {toast && (
        <div
          style={{
            position: "fixed",
            bottom: 16,
            left: "50%",
            transform: "translateX(-50%)",
            background: "#333",
            color: "#fff",
            padding: "8px 16px",
            borderRadius: 6,
            fontSize: 13,
            boxShadow: "0 2px 8px rgba(0,0,0,0.4)",
            zIndex: 1000,
          }}
        >
          {toast}
        </div>
      )}
    </div>
  );
}
