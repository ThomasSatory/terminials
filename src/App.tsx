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

  // Auto-dismiss du toast après 2 s. (clearToast est stable : défini une fois par Zustand.)
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
  // Les requêtes des panes d'un workspace partent en parallèle (Promise.all) pour réduire
  // la latence du tick et la fenêtre de recouvrement entre deux ticks ; une erreur sur un
  // pane (backend pas prêt) renvoie [] sans avorter l'union.
  useEffect(() => {
    const tick = async () => {
      const s = useWorkspaceStore.getState();
      for (const w of s.workspaces) {
        const ptyIds = w.panes
          .map((paneId) => s.panePtys[paneId])
          .filter((id): id is number => id !== undefined);
        const results = await Promise.all(
          ptyIds.map((ptyId) =>
            invoke<number[]>("workspace_ports", { ptyId }).catch(() => [] as number[]),
          ),
        );
        const ports = new Set<number>(results.flat());
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
                padding: "0 10px",
                height: 30,
                background: "#1e1e1e",
                borderBottom: "1px solid #242424",
                color: "#ddd",
                fontSize: 13,
              }}
            >
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {active.name}
              </span>
              <span style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {/* Compteur de panes : pastille pleine = pane actif (remplace « 2/4 »). */}
                <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  {active.panes.map((paneId) => (
                    <span
                      key={paneId}
                      style={{
                        width: 7,
                        height: 7,
                        borderRadius: "50%",
                        background: paneId === active.activePaneId ? active.color : "#3a3a3a",
                      }}
                    />
                  ))}
                </span>
                <button
                  className="icon-btn"
                  onClick={() => {
                    if (!addPane(active.id)) showToast(`max ${MAX_PANES} terminaux`);
                  }}
                  title="Nouveau terminal (Ctrl+T)"
                >
                  +
                </button>
              </span>
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
