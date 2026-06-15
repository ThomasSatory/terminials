import { create } from "zustand";

export type PaneNode =
  | { kind: "leaf"; paneId: string }
  | { kind: "branch"; dir: "horizontal" | "vertical"; children: PaneNode[] };

export interface Notification {
  title: string;
  body: string;
}

export interface Workspace {
  id: string;
  cwd: string;
  branch?: string;
  ports: number[];
  root: PaneNode;
  unread: boolean;
  lastNotification?: Notification;
  status?: { label: string; color?: string };
  progress?: { value: number; label?: string };
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string | null;
  /** paneId -> id du PTY backend (pour interroger les ports). */
  panePtys: Record<string, number>;
  addWorkspace: (cwd: string) => string;
  splitPane: (wsId: string, paneId: string, dir: "horizontal" | "vertical") => void;
  setNotification: (wsId: string, n: Notification) => void;
  markRead: (wsId: string) => void;
  setActive: (wsId: string) => void;
  setGit: (wsId: string, branch: string, dirty: boolean) => void;
  setPorts: (wsId: string, ports: number[]) => void;
  setStatus: (wsId: string, status: { label: string; color?: string }) => void;
  setProgress: (wsId: string, progress: { value: number; label?: string }) => void;
  setPanePty: (paneId: string, ptyId: number) => void;
  reset: () => void;
}

let counter = 0;
const uid = (prefix: string) => `${prefix}:${counter++}`;

function splitNode(node: PaneNode, target: string, dir: "horizontal" | "vertical"): PaneNode {
  if (node.kind === "leaf") {
    if (node.paneId !== target) return node;
    return { kind: "branch", dir, children: [node, { kind: "leaf", paneId: uid("pane") }] };
  }
  return { ...node, children: node.children.map((c) => splitNode(c, target, dir)) };
}

/** Renvoie le paneId du premier leaf (en profondeur) d'un arbre de panes. */
export function firstLeafPaneId(node: PaneNode): string | null {
  if (node.kind === "leaf") return node.paneId;
  for (const c of node.children) {
    const r = firstLeafPaneId(c);
    if (r) return r;
  }
  return null;
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  activeId: null,
  panePtys: {},
  addWorkspace: (cwd) => {
    const id = uid("ws");
    const ws: Workspace = {
      id,
      cwd,
      ports: [],
      unread: false,
      root: { kind: "leaf", paneId: uid("pane") },
    };
    set((s) => ({ workspaces: [...s.workspaces, ws], activeId: id }));
    return id;
  },
  splitPane: (wsId, paneId, dir) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === wsId ? { ...w, root: splitNode(w.root, paneId, dir) } : w,
      ),
    })),
  setNotification: (wsId, n) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === wsId ? { ...w, unread: true, lastNotification: n } : w,
      ),
    })),
  markRead: (wsId) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, unread: false } : w)),
    })),
  setActive: (wsId) => set({ activeId: wsId }),
  setGit: (wsId, branch, _dirty) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, branch } : w)),
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
  reset: () => {
    counter = 0;
    set({ workspaces: [], activeId: null, panePtys: {} });
  },
}));
