import { create } from "zustand";
import { PALETTE, basename } from "../lib/palette";

export interface Notification {
  title: string;
  body: string;
}

export interface Workspace {
  id: string;
  cwd: string;
  name: string;
  color: string;
  panes: string[];
  activePaneId: string | null;
  branch?: string;
  dirty?: boolean;
  ports: number[];
  /** Fallback niveau workspace : notification sans pane identifiable. */
  unread: boolean;
  /** Panes avec notification non lue (anneau bleu cmux). */
  unreadPanes: string[];
  /** Overlay diff ouvert sur ce workspace (état UI, jamais persisté). */
  diffOpen: boolean;
  lastNotification?: Notification;
  status?: { label: string; color?: string };
  progress?: { value: number; label?: string };
}

/** Entrée de persistance v2 : liste ORDONNÉE réécrite en bloc à chaque mutation
    (pas de clé par cwd : deux workspaces sur le même dossier — worktrees — coexistent). */
export type SavedWorkspace = { cwd: string; name: string; color: string; paneCount: number };

export const MAX_PANES = 4;

interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string | null;
  /** paneId -> id du PTY backend (pour interroger les ports). */
  panePtys: Record<string, number>;
  toast: string | null;
  /** Sidebar visible (toggle Ctrl+Shift+B). */
  sidebarVisible: boolean;
  /** Workspace dont la Sidebar doit ouvrir l'édition inline du nom (null = aucune demande). */
  renameRequestId: string | null;
  /** `name` explicite (sinon basename(cwd)) : « ~ » pour un espace sur $HOME. */
  addWorkspace: (cwd: string, name?: string) => string;
  addPane: (wsId: string) => boolean;
  closePane: (wsId: string, paneId: string) => void;
  closeWorkspace: (wsId: string) => void;
  setActivePane: (wsId: string, paneId: string) => void;
  renameWorkspace: (wsId: string, name: string) => void;
  setColor: (wsId: string, color: string) => void;
  setNotification: (wsId: string, n: Notification, paneId?: string) => void;
  setActive: (wsId: string) => void;
  setGit: (wsId: string, branch: string, dirty: boolean) => void;
  setPorts: (wsId: string, ports: number[]) => void;
  setStatus: (wsId: string, status: { label: string; color?: string }) => void;
  setProgress: (wsId: string, progress: { value: number; label?: string }) => void;
  setPanePty: (paneId: string, ptyId: number) => void;
  removePanePty: (paneId: string) => void;
  toggleDiff: (wsId: string) => void;
  toggleSidebar: () => void;
  requestRename: (wsId: string | null) => void;
  restoreWorkspaces: (entries: SavedWorkspace[]) => void;
  showToast: (msg: string) => void;
  clearToast: () => void;
  reset: () => void;
}

let counter = 0;
let colorIndex = 0;
const uid = (prefix: string) => `${prefix}:${counter++}`;

// --- Persistance localStorage v2 (I/O hors réducteurs ; no-op si localStorage absent,
//     cas des tests node). L'ancienne clé v1 "terminials:workspaces" est abandonnée
//     sans migration. ---
const STORAGE_KEY = "terminials:workspaces:v2";
const LAST_FOLDER_KEY = "terminials:lastFolder";

/** Liste ordonnée des workspaces sauvegardés (pour la restauration au boot). */
export function loadSavedWorkspaces(): SavedWorkspace[] {
  if (typeof localStorage === "undefined") return [];
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (!Array.isArray(raw)) return [];
    return raw.filter(
      (e): e is SavedWorkspace =>
        typeof e === "object" &&
        e !== null &&
        typeof (e as Record<string, unknown>).cwd === "string" &&
        typeof (e as Record<string, unknown>).name === "string" &&
        typeof (e as Record<string, unknown>).color === "string" &&
        typeof (e as Record<string, unknown>).paneCount === "number",
    );
  } catch {
    return [];
  }
}

/** Dernier dossier ouvert via le dialog (sert de defaultPath au prochain dialog). */
export function getLastFolder(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    return localStorage.getItem(LAST_FOLDER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setLastFolder(path: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_FOLDER_KEY, path);
  } catch {
    /* quota dépassé ou localStorage désactivé : on ignore */
  }
}

/** Réécrit la sauvegarde complète (après chaque action qui change la liste des workspaces). */
function persistWorkspaces(workspaces: Workspace[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const saved: SavedWorkspace[] = workspaces.map((w) => ({
      cwd: w.cwd,
      name: w.name,
      color: w.color,
      paneCount: w.panes.length,
    }));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    /* quota dépassé ou localStorage désactivé : on ignore */
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeId: null,
  panePtys: {},
  toast: null,
  sidebarVisible: true,
  renameRequestId: null,
  addWorkspace: (cwd, name) => {
    const id = uid("ws");
    const color = PALETTE[colorIndex % PALETTE.length];
    colorIndex++;
    const paneId = uid("pane");
    const ws: Workspace = {
      id,
      cwd,
      name: name ?? basename(cwd),
      color,
      panes: [paneId],
      activePaneId: paneId,
      ports: [],
      unread: false,
      unreadPanes: [],
      diffOpen: false,
    };
    set((s) => ({ workspaces: [...s.workspaces, ws], activeId: id }));
    persistWorkspaces(get().workspaces);
    return id;
  },
  addPane: (wsId) => {
    const ws = get().workspaces.find((w) => w.id === wsId);
    if (!ws || ws.panes.length >= MAX_PANES) return false;
    const paneId = uid("pane");
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === wsId ? { ...w, panes: [...w.panes, paneId], activePaneId: paneId } : w,
      ),
    }));
    persistWorkspaces(get().workspaces);
    return true;
  },
  closePane: (wsId, paneId) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== wsId) return w;
        if (w.panes.length <= 1) return w; // toujours au moins 1 terminal
        const panes = w.panes.filter((p) => p !== paneId);
        if (panes.length === w.panes.length) return w; // paneId inconnu
        // si le pane actif est fermé, on retombe sur le premier pane restant
        const activePaneId = w.activePaneId === paneId ? panes[0] : w.activePaneId;
        // un pane fermé ne peut plus réclamer l'attention
        const unreadPanes = w.unreadPanes.filter((p) => p !== paneId);
        return { ...w, panes, activePaneId, unreadPanes };
      }),
    }));
    persistWorkspaces(get().workspaces);
  },
  closeWorkspace: (wsId) => {
    set((s) => {
      const idx = s.workspaces.findIndex((w) => w.id === wsId);
      if (idx === -1) return {};
      const closed = s.workspaces[idx];
      const workspaces = s.workspaces.filter((w) => w.id !== wsId);
      // Purge des mappings pane→PTY : les PTYs eux-mêmes sont fermés par le
      // démontage des TerminalPane du workspace (cleanup closePty).
      const panePtys = { ...s.panePtys };
      for (const paneId of closed.panes) delete panePtys[paneId];
      // Si le workspace fermé était actif : voisin précédent, sinon suivant, sinon rien.
      const activeId =
        s.activeId === wsId
          ? (workspaces[idx - 1]?.id ?? workspaces[idx]?.id ?? null)
          : s.activeId;
      return { workspaces, panePtys, activeId };
    });
    persistWorkspaces(get().workspaces);
  },
  setActivePane: (wsId, paneId) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === wsId && w.panes.includes(paneId)
          ? {
              ...w,
              activePaneId: paneId,
              // focus = lu : l'anneau bleu de ce pane s'éteint
              unreadPanes: w.unreadPanes.filter((p) => p !== paneId),
            }
          : w,
      ),
    })),
  renameWorkspace: (wsId, name) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === wsId ? { ...w, name: name.trim() || basename(w.cwd) } : w,
      ),
    }));
    persistWorkspaces(get().workspaces);
  },
  setColor: (wsId, color) => {
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, color } : w)),
    }));
    persistWorkspaces(get().workspaces);
  },
  setNotification: (wsId, n, paneId) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== wsId) return w;
        if (paneId !== undefined && w.panes.includes(paneId)) {
          // anneau bleu sur le pane émetteur, pas de fallback workspace
          const unreadPanes = w.unreadPanes.includes(paneId)
            ? w.unreadPanes
            : [...w.unreadPanes, paneId];
          return { ...w, unreadPanes, lastNotification: n };
        }
        // pane inconnu ou non fourni (CLI hors pane, pane fermé) : fallback workspace
        return { ...w, unread: true, lastNotification: n };
      }),
    })),
  setActive: (wsId) =>
    set((s) => ({
      activeId: wsId,
      // activer le workspace lit le fallback, PAS les anneaux par pane
      workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, unread: false } : w)),
    })),
  setGit: (wsId, branch, dirty) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, branch, dirty } : w)),
    })),
  setPorts: (wsId, ports) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, ports } : w)),
    })),
  setStatus: (wsId, status) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, status } : w)),
    })),
  setProgress: (wsId, progress) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, progress } : w)),
    })),
  setPanePty: (paneId, ptyId) =>
    set((s) => ({ panePtys: { ...s.panePtys, [paneId]: ptyId } })),
  removePanePty: (paneId) =>
    set((s) => {
      const { [paneId]: _removed, ...rest } = s.panePtys;
      return { panePtys: rest };
    }),
  toggleDiff: (wsId) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, diffOpen: !w.diffOpen } : w)),
    })),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  requestRename: (wsId) => set({ renameRequestId: wsId }),
  restoreWorkspaces: (entries) => {
    const restored = entries.map((e): Workspace => {
      // paneCount vient du disque : clamp défensif dans [1, MAX_PANES] (la grille fixe a 4 cellules)
      const paneCount = Math.min(MAX_PANES, Math.max(1, Math.floor(e.paneCount)));
      const panes = Array.from({ length: paneCount }, () => uid("pane"));
      colorIndex++; // le round-robin des prochaines créations continue après les restaurés
      return {
        id: uid("ws"),
        cwd: e.cwd,
        name: e.name,
        color: e.color,
        panes,
        activePaneId: panes[0],
        ports: [],
        unread: false,
        unreadPanes: [],
        diffOpen: false,
      };
    });
    // Concaténation (jamais remplacement) : un workspace créé pendant la fenêtre des
    // invoke dir_exists du boot (bouton +, commande socket new-workspace) ne doit pas
    // être détruit avec son PTY. Les workspaces déjà présents gardent la priorité
    // d'activation ; sinon on active le premier restauré.
    set((s) => ({
      workspaces: [...s.workspaces, ...restored],
      activeId: s.activeId ?? restored[0]?.id ?? null,
    }));
    persistWorkspaces(get().workspaces);
  },
  showToast: (msg) => set({ toast: msg }),
  clearToast: () => set({ toast: null }),
  reset: () => {
    counter = 0;
    colorIndex = 0;
    set({
      workspaces: [],
      activeId: null,
      panePtys: {},
      toast: null,
      sidebarVisible: true,
      renameRequestId: null,
    });
  },
}));

/** Vrai si le workspace réclame l'attention : fallback workspace OU ≥ 1 pane non lu. */
export function hasAttention(w: Workspace): boolean {
  return w.unread || w.unreadPanes.length > 0;
}
