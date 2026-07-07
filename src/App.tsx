import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Sidebar } from "./components/Sidebar";
import { PaneTree } from "./components/PaneTree";
import { useShortcuts } from "./hooks/useShortcuts";
import { registerSocketEvents } from "./lib/socketEvents";
import { openFolderDialog } from "./lib/openFolder";
import { useWorkspaceStore, MAX_PANES, loadSavedWorkspaces } from "./store/workspace";
import "./App.css";

export default function App() {
  useShortcuts();
  const { workspaces, activeId, addPane, showToast, toast, clearToast } = useWorkspaceStore();
  // Ctrl+Shift+B : consommation au rendu du booléen basculé par toggleSidebar (K.5).
  const sidebarVisible = useWorkspaceStore((s) => s.sidebarVisible);

  // true tant que la restauration n'a pas statué : évite le flash de l'état
  // vide « Open folder » pendant les invoke dir_exists.
  const [booting, setBooting] = useState(true);

  // Restauration des workspaces persistés au premier montage : chaque cwd est
  // validé côté Rust ; dossier disparu → skippé + toast (jamais restauré :
  // unread/status/progress/ports repartent à zéro, cf. contrat SavedWorkspace).
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = loadSavedWorkspaces();
      if (saved.length > 0) {
        const checks = await Promise.all(
          saved.map((entry) =>
            invoke<boolean>("dir_exists", { path: entry.cwd }).catch(() => false),
          ),
        );
        if (cancelled) return;
        const valid = saved.filter((_, i) => checks[i]);
        const missing = saved.filter((_, i) => !checks[i]);
        const s = useWorkspaceStore.getState();
        if (missing.length > 0) {
          s.showToast(
            `dossier introuvable, workspace ignoré : ${missing.map((m) => m.cwd).join(", ")}`,
          );
        }
        if (valid.length > 0) s.restoreWorkspaces(valid);
      }
      if (!cancelled) setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

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
  // Workspaces interrogés en parallèle (Promise.all) ; garde in-flight : sur un
  // repo lent (NFS), le tick suivant ne se superpose pas au précédent.
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const s = useWorkspaceStore.getState();
        await Promise.all(
          s.workspaces.map(async (w) => {
            try {
              const info = await invoke<{ branch: string | null; dirty: boolean }>("git_info", {
                cwd: w.cwd,
              });
              if (info.branch) s.setGit(w.id, info.branch, info.dirty);
            } catch {
              /* commande indisponible (backend pas prêt) ou cwd hors repo */
            }
          }),
        );
      } finally {
        running = false;
      }
    };
    const h = setInterval(tick, 2000);
    tick();
    return () => clearInterval(h);
  }, []);

  // Poller ports (~2s) : union des ports ouverts par tous les panes de chaque
  // workspace. Workspaces ET panes en parallèle ; même garde in-flight.
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const s = useWorkspaceStore.getState();
        await Promise.all(
          s.workspaces.map(async (w) => {
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
          }),
        );
      } finally {
        running = false;
      }
    };
    const h = setInterval(tick, 2000);
    tick();
    return () => clearInterval(h);
  }, []);

  const active = workspaces.find((w) => w.id === activeId);
  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", background: "#1e1e1e" }}>
      {/* Ctrl+Shift+B : démonter la Sidebar est sans risque PTY (aucun TerminalPane dedans). */}
      {sidebarVisible && <Sidebar />}
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {booting ? null : workspaces.length === 0 ? (
          /* État vide : aucun workspace — l'utilisateur choisit un dossier réel. */
          <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <button
              onClick={() => void openFolderDialog()}
              style={{
                padding: "10px 18px",
                fontSize: 14,
                background: "#242424",
                color: "#ddd",
                border: "1px solid #3a3a3a",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              Open folder (Ctrl+Shift+O)
            </button>
          </div>
        ) : (
          <>
            {active && (
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
                  {active.branch && <span style={{ color: "#6f6f6f" }}> — {active.branch}</span>}
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
                    title="Nouveau terminal (Ctrl+Shift+T)"
                  >
                    +
                  </button>
                </span>
              </div>
            )}
            {/* Keep-alive : TOUS les workspaces restent montés en permanence, empilés.
                Les inactifs sont masqués en visibility:hidden — JAMAIS display:none
                (un conteneur 0×0 ferait fit() → resize_pty(0) → reflow shell cassé). */}
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              {workspaces.map((w) => (
                <div
                  key={w.id}
                  style={{
                    position: "absolute",
                    inset: 0,
                    visibility: w.id === activeId ? "visible" : "hidden",
                  }}
                >
                  <PaneTree ws={w} visible={w.id === activeId} />
                </div>
              ))}
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
