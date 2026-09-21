import { useEffect, useState, type CSSProperties } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { Sidebar } from "./components/Sidebar";
import { TabbedTerminals } from "./components/TabbedTerminals";
import { DiffOverlay } from "./components/DiffOverlay";
import { DashboardOverlay } from "./components/DashboardOverlay";
import { useShortcuts } from "./hooks/useShortcuts";
import { dispatchShortcut } from "./lib/shortcutDispatch";
import { registerSocketEvents } from "./lib/socketEvents";
import { openFolderDialog } from "./lib/openFolder";
import { injectPaths } from "./lib/injectFiles";
import { resolvePaneId, toCssPoint } from "./lib/dropTarget";
import { activityApi } from "./lib/activityApi";
import { useWorkspaceStore, loadSavedState } from "./store/workspace";
import { useDashboardStore } from "./store/dashboard";
import { nextDelayMs, DIRTY_BUDGET, PORTS_BUDGET } from "./lib/pollSchedule";
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
  // Sélecteurs ciblés, jamais `useWorkspaceStore()` nu : s'abonner au store entier
  // faisait re-render tout l'arbre (Sidebar + tous les TabbedTerminals) à CHAQUE tour de sonde.
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const toast = useWorkspaceStore((s) => s.toast);
  // Actions : références stables créées une fois par Zustand.
  const clearToast = useWorkspaceStore((s) => s.clearToast);
  // Ctrl+Shift+B : consommation au rendu du booléen basculé par toggleSidebar (K.5).
  const sidebarVisible = useWorkspaceStore((s) => s.sidebarVisible);
  const dashboardOpen = useDashboardStore((s) => s.open);

  // true tant que la restauration n'a pas statué : évite le flash de l'état
  // vide « Open folder » pendant les invoke dir_exists.
  const [booting, setBooting] = useState(true);

  // Restauration des groupes et workspaces persistés au premier montage : chaque cwd
  // est validé côté Rust ; dossier disparu → skippé + toast (jamais restauré :
  // unread/status/progress/ports repartent à zéro, cf. contrat SavedWorkspace).
  // Les groupes sont tous restaurés (même vides) : les groupIndex restent valides.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = loadSavedState();
      if (saved.workspaces.length > 0 || saved.groups.length > 0) {
        const checks = await Promise.all(
          saved.workspaces.map((entry) =>
            invoke<boolean>("dir_exists", { path: entry.cwd }).catch(() => false),
          ),
        );
        if (cancelled) return;
        const valid = saved.workspaces.filter((_, i) => checks[i]);
        const missing = saved.workspaces.filter((_, i) => !checks[i]);
        const s = useWorkspaceStore.getState();
        if (missing.length > 0) {
          s.showToast(
            `dossier introuvable, workspace ignoré : ${missing.map((m) => m.cwd).join(", ")}`,
          );
        }
        s.restoreState({ groups: saved.groups, workspaces: valid });
      }
      if (!cancelled) setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Glisser-déposer de fichiers : Tauri consomme le drop OS (dragDropEnabled par
  // défaut) et émet tauri://drag-drop — l'event `drop` du DOM ne remonte donc jamais.
  // Les chemins sont écrits, quotés, dans le PTY de l'onglet survolé (Claude Code lit le
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

  // Sonde branche (~2s) : GRATUITE (`symbolic-ref` lit .git/HEAD, 0,00 s mesuré sur
  // un repo de 20 000 fichiers). Elle peut donc rester à cadence fixe et en parallèle.
  // Volontairement séparée du dirty : les fusionner faisait payer un `git status`
  // complet juste pour rafraîchir un nom de branche.
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
              const branch = await invoke<string | null>("git_branch", { cwd: w.cwd });
              // HEAD détachée / hors repo → null : on garde la dernière branche connue.
              if (branch) s.setBranch(w.id, branch);
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

  // Sonde dirty : CHÈRE et irréductible (lstat de chaque fichier suivi — 6,14 s sur
  // ~/dev/monorepo, et ~19 s-CPU de plus dans le hook fanotify d'un antivirus).
  // Boucle auto-ordonnancée : chaque workspace porte sa propre échéance, déduite du coût
  // de SA dernière sonde (pollSchedule). Un repo géant dégrade sa seule fraîcheur, sans
  // saturer le CPU ni retarder les autres.
  // Séquentiel, JAMAIS en parallèle : lancer un `git status` par workspace d'un coup
  // saturait le disque et le scan on-access de l'antivirus.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dueAt = new Map<string, number>(); // wsId -> date de la prochaine sonde

    const round = async () => {
      const { workspaces } = useWorkspaceStore.getState();
      for (const w of workspaces) {
        if (stopped) return;
        if ((dueAt.get(w.id) ?? 0) > Date.now()) continue;
        const started = performance.now();
        try {
          const dirty = await invoke<boolean>("git_dirty", { cwd: w.cwd });
          // La sonde dure des secondes : le dossier du workspace a pu changer
          // entre-temps (setCwd, édition inline du dossier). Écrire le résultat
          // sans revérifier afficherait le dirty de l'ANCIEN dossier.
          const still = useWorkspaceStore.getState().workspaces.find((x) => x.id === w.id);
          if (still?.cwd === w.cwd) useWorkspaceStore.getState().setDirty(w.id, dirty);
        } catch {
          /* commande indisponible (backend pas prêt) ou cwd hors repo */
        }
        // L'échéance est posée même en cas d'échec : sinon un cwd cassé serait resondé en boucle.
        dueAt.set(w.id, Date.now() + nextDelayMs(performance.now() - started, DIRTY_BUDGET));
      }
      const live = new Set(workspaces.map((w) => w.id));
      for (const id of [...dueAt.keys()]) if (!live.has(id)) dueAt.delete(id);
      // Réveil de contrôle à 1 s : c'est ce qui fait sonder un workspace tout juste
      // ouvert sans attendre l'échéance (jusqu'à 2 min) d'un voisin lent. Le tour
      // ne coûte qu'un parcours de Map quand aucune échéance n'est atteinte.
      if (!stopped) timer = setTimeout(round, 1000);
    };
    void round();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  // Sonde ports : union des ports ouverts par les onglets de chaque workspace. Même
  // ordonnancement adaptatif que le dirty — le parcours de /proc du sous-arbre reste
  // bien moins cher, mais pas gratuit sur un onglet qui fait tourner un node.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dueAt = new Map<string, number>();

    const round = async () => {
      const s = useWorkspaceStore.getState();
      for (const w of s.workspaces) {
        if (stopped) return;
        if ((dueAt.get(w.id) ?? 0) > Date.now()) continue;
        const started = performance.now();
        const ptyIds = w.tabs
          .map((t) => s.tabPtys[t.id])
          .filter((id): id is number => id !== undefined);
        const results = await Promise.all(
          ptyIds.map((ptyId) =>
            invoke<number[]>("workspace_ports", { ptyId }).catch(() => [] as number[]),
          ),
        );
        const ports = new Set<number>(results.flat());
        useWorkspaceStore.getState().setPorts(
          w.id,
          [...ports].sort((a, b) => a - b),
        );
        dueAt.set(w.id, Date.now() + nextDelayMs(performance.now() - started, PORTS_BUDGET));
      }
      const live = new Set(s.workspaces.map((w) => w.id));
      for (const id of [...dueAt.keys()]) if (!live.has(id)) dueAt.delete(id);
      if (!stopped) timer = setTimeout(round, 1000);
    };
    void round();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
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
                {/* Le compteur d'onglets et le + vivent désormais dans la barre d'onglets. */}
                <span style={{ color: "#6f6f6f", fontSize: 12 }}>
                  {active.tabs.length > 1 ? `${active.tabs.length} onglets` : ""}
                </span>
              </div>
            )}
            {/* Keep-alive : TOUS les workspaces (barre d'onglets + terminaux) restent montés
                en permanence, empilés. Les inactifs sont masqués en visibility:hidden —
                JAMAIS display:none (un conteneur 0×0 ferait fit() → resize_pty(0) → reflow
                shell cassé). */}
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
                  <TabbedTerminals ws={w} visible={w.id === activeId} />
                </div>
              ))}
              {/* Diff viewer : overlay au-dessus de la zone terminal (barre d'onglets incluse) —
                  sidebar et top bar restent visibles. Les terminaux restent montés dessous
                  (keep-alive) : risque PTY nul (spec §4). */}
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
