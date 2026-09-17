import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Sidebar } from "./components/Sidebar";
import { PaneTree } from "./components/PaneTree";
import { DiffOverlay } from "./components/DiffOverlay";
import { DashboardOverlay } from "./components/DashboardOverlay";
import { useShortcuts } from "./hooks/useShortcuts";
import { dispatchShortcut } from "./lib/shortcutDispatch";
import { registerSocketEvents } from "./lib/socketEvents";
import { openFolderDialog } from "./lib/openFolder";
import { injectPaths } from "./lib/injectFiles";
import { resolvePaneId, toCssPoint } from "./lib/dropTarget";
import { activityApi } from "./lib/activityApi";
import { useWorkspaceStore, MAX_PANES, loadSavedWorkspaces } from "./store/workspace";
import { useDashboardStore } from "./store/dashboard";
import "./App.css";

const EMPTY_BTN: CSSProperties = {
  padding: "10px 18px",
  fontSize: 14,
  background: "#242424",
  color: "#ddd",
  border: "1px solid #3a3a3a",
  borderRadius: 6,
  cursor: "pointer",
};

export default function App() {
  useShortcuts();
  const { workspaces, activeId, addPane, showToast, toast, clearToast } = useWorkspaceStore();
  // Ctrl+Shift+B : consommation au rendu du booléen basculé par toggleSidebar (K.5).
  const sidebarVisible = useWorkspaceStore((s) => s.sidebarVisible);
  const dashboardOpen = useDashboardStore((s) => s.open);

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

  // Glisser-déposer de fichiers : Tauri consomme le drop OS (dragDropEnabled par
  // défaut) et émet tauri://drag-drop — l'event `drop` du DOM ne remonte donc jamais.
  // Les chemins sont écrits, quotés, dans le PTY du pane survolé (Claude Code lit le
  // fichier). Tous types de fichiers : Claude Code lit aussi bien un .ts qu'un .png.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      // position en pixels PHYSIQUES ; elementFromPoint attend des pixels CSS.
      const { x, y } = toCssPoint(event.payload.position, window.devicePixelRatio);
      const paneId = resolvePaneId(document.elementFromPoint(x, y) as HTMLElement | null);
      if (!injectPaths(paneId, event.payload.paths)) {
        useWorkspaceStore.getState().showToast("aucun terminal cible pour les fichiers déposés");
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Branche les events backend (socket-command, agent-notification, activity-*).
  useEffect(() => {
    const cleanup = registerSocketEvents();
    return () => {
      cleanup.then((fn) => fn());
    };
  }, []);

  // Le collecteur d'activité (dashboard) a besoin de connaître les workspaces
  // ouverts pour rattacher les événements (commits, prompts…) à leur dossier.
  // Dépendance sur la liste jointe des cwd (et non `workspaces`) : un seul appel
  // par changement RÉEL de dossiers, pas à chaque tick des pollers ports/git.
  const workspaceCwds = workspaces.map((w) => w.cwd).join("\n");
  useEffect(() => {
    const dirs = workspaceCwds ? workspaceCwds.split("\n") : [];
    activityApi.registerWorkspaces(dirs).catch(() => {});
  }, [workspaceCwds]);

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
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0, position: "relative" }}>
        {booting ? null : workspaces.length === 0 ? (
          /* État vide : formulaire nom+dossier dans la Sidebar, ou dialog natif. */
          <div
            style={{
              flex: 1,
              display: "flex",
              gap: 10,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <button
              // Même chemin que Ctrl+Shift+N : révèle la Sidebar puis y ouvre
              // le formulaire nom+dossier (masquée, elle ne consommerait pas la demande).
              onClick={() => dispatchShortcut({ type: "new-workspace" })}
              style={EMPTY_BTN}
            >
              Nouvel espace (Ctrl+Shift+N)
            </button>
            <button onClick={() => void openFolderDialog()} style={EMPTY_BTN}>
              Ouvrir un dossier (Ctrl+Shift+O)
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
              {/* Diff viewer : overlay au-dessus de la grille seule — sidebar et top bar restent visibles.
                  La grille reste montée dessous (keep-alive) : risque PTY nul (spec §4). */}
              {active?.diffOpen && <DiffOverlay ws={active} />}
            </div>
          </>
        )}
        {/* Dashboard d'activité (Ctrl+Shift+H) : global, pas lié à un workspace — couvre
            la grille ET l'état vide, mais jamais la sidebar (spec §8). */}
        {dashboardOpen && <DashboardOverlay />}
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
