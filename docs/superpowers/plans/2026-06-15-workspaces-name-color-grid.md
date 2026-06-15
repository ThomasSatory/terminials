# Workspaces nommés/colorés + grille de terminaux — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Donner un nom et une couleur à chaque workspace, et permettre 1 à 4 terminaux par workspace auto-arrangés en grille (1 plein, 2 colonnes, 3 = 2-haut/1-bas, 4 quadrants) sans jamais réinitialiser un terminal existant.

**Architecture:** Le store Zustand passe d'un arbre de panes (`PaneNode`) à une **liste plate** `panes: string[]` (max 4) + métadonnées `name`/`color`/`activePaneId`. Le layout est rendu en **CSS Grid** avec un **ordre de panes stable** (clés = paneId) : seul le `grid-template-areas` change selon le nombre, donc React ne démonte jamais un `TerminalPane` → PTY et buffer préservés. Nom + couleur persistent dans `localStorage` (keyed par cwd).

**Tech Stack:** React 19 + TypeScript, Zustand 5, Vitest 4 (environnement `node`, sans DOM), CSS Grid (remplace Allotment pour la zone workspace).

**Spec:** `docs/superpowers/specs/2026-06-15-workspaces-name-color-grid-design.md`

---

## Notes d'exécution

- **Tests unitaires** : seuls `src/lib/palette.ts` et `src/store/workspace.ts` sont testés en TDD
  (logique pure, runner Vitest `node`). Les composants React ne sont pas testés unitairement
  (l'environnement de test est `node` sans DOM — pattern existant du repo) : ils sont vérifiés par
  **typecheck** + smoke manuel.
- **Refactor en cascade** : la Tâche 2 supprime des symboles (`PaneNode`, `splitPane`,
  `firstLeafPaneId`) encore importés par `PaneTree.tsx`, `useShortcuts.ts`, `App.tsx`. Le projet
  **ne typecheck pas entièrement** entre la Tâche 2 et la Tâche 6 : c'est attendu. Chaque tâche UI
  vérifie que **le fichier qu'elle édite** est propre (`tsc … | grep <fichier>` → rien), et le
  build complet vert n'est exigé qu'à la **Tâche 6**.
- `localStorage` est absent en environnement de test `node` : les helpers de persistance sont
  **gardés** (`typeof localStorage === "undefined"`), donc les tests du store ne le touchent pas.

---

## Task 1: Module palette (`src/lib/palette.ts`)

**Files:**
- Create: `src/lib/palette.ts`
- Test: `src/lib/palette.test.ts`

- [ ] **Step 1: Write the failing test**

`src/lib/palette.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { PALETTE, ALERT_COLOR, basename } from "./palette";

describe("palette", () => {
  it("contient 8 couleurs hex", () => {
    expect(PALETTE).toHaveLength(8);
    for (const c of PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("ALERT_COLOR est l'ambre fixe", () => {
    expect(ALERT_COLOR).toBe("#f5a623");
  });

  it("basename renvoie le dernier segment non vide", () => {
    expect(basename("/home/x/dev/terminals")).toBe("terminals");
    expect(basename("/tmp")).toBe("tmp");
    expect(basename("/tmp/")).toBe("tmp");
  });

  it("basename gère la racine", () => {
    expect(basename("/")).toBe("/");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/palette.test.ts`
Expected: FAIL — `Failed to resolve import "./palette"` (le module n'existe pas encore).

- [ ] **Step 3: Write the implementation**

`src/lib/palette.ts` :

```ts
/** Palette d'identité des workspaces (assignée en round-robin à la création). */
export const PALETTE = [
  "#5b8def", // bleu
  "#2ecc71", // vert
  "#1abc9c", // teal
  "#9b59b6", // violet
  "#e91e8c", // rose
  "#e67e22", // orange
  "#f1c40f", // jaune
  "#95a5a6", // gris
] as const;

/** Couleur d'alerte (notification / unread), distincte de la palette d'identité. */
export const ALERT_COLOR = "#f5a623";

/** Dernier segment non vide d'un chemin (nom par défaut d'un workspace). */
export function basename(path: string): string {
  const segs = path.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1] : path;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/palette.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/palette.ts src/lib/palette.test.ts
git commit -m "feat(front): module palette (couleurs identité + alerte ambre + basename)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Refonte du store workspace (`src/store/workspace.ts`)

**Files:**
- Modify (réécriture): `src/store/workspace.ts`
- Modify (réécriture): `src/store/workspace.test.ts`

Cette tâche supprime `PaneNode`, `splitNode`, `splitPane`, `firstLeafPaneId` et introduit le
modèle à liste plate + `name`/`color`/`activePaneId`/`toast` + persistance localStorage.

- [ ] **Step 1: Write the failing tests** (réécriture complète du fichier de test)

`src/store/workspace.test.ts` :

```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore, MAX_PANES } from "./workspace";
import { PALETTE, basename } from "../lib/palette";

const store = () => useWorkspaceStore.getState();
const ws = (id: string) => store().workspaces.find((w) => w.id === id)!;

describe("workspace store", () => {
  beforeEach(() => store().reset());

  it("crée un workspace avec 1 pane, nom = basename, couleur de la palette", () => {
    const id = store().addWorkspace("/home/x/dev/terminals");
    const w = ws(id);
    expect(w.cwd).toBe("/home/x/dev/terminals");
    expect(w.name).toBe(basename("/home/x/dev/terminals"));
    expect(w.panes).toHaveLength(1);
    expect(w.activePaneId).toBe(w.panes[0]);
    expect(PALETTE).toContain(w.color);
  });

  it("assigne les couleurs en round-robin", () => {
    const a = ws(store().addWorkspace("/a"));
    const b = ws(store().addWorkspace("/b"));
    expect(a.color).toBe(PALETTE[0]);
    expect(b.color).toBe(PALETTE[1]);
  });

  it("ajoute des panes jusqu'à MAX_PANES puis refuse", () => {
    const id = store().addWorkspace("/tmp");
    expect(store().addPane(id)).toBe(true); // 2
    expect(store().addPane(id)).toBe(true); // 3
    expect(store().addPane(id)).toBe(true); // 4
    expect(ws(id).panes).toHaveLength(MAX_PANES);
    expect(store().addPane(id)).toBe(false); // 5e refusé
    expect(ws(id).panes).toHaveLength(MAX_PANES);
  });

  it("addPane rend le nouveau pane actif", () => {
    const id = store().addWorkspace("/tmp");
    store().addPane(id);
    const w = ws(id);
    expect(w.activePaneId).toBe(w.panes[1]);
  });

  it("ferme un pane, re-flow, jamais en dessous de 1", () => {
    const id = store().addWorkspace("/tmp");
    store().addPane(id);
    const second = ws(id).panes[1];
    store().closePane(id, second);
    expect(ws(id).panes).toHaveLength(1);
    const last = ws(id).panes[0];
    store().closePane(id, last); // fermer le dernier = no-op
    expect(ws(id).panes).toHaveLength(1);
  });

  it("recalcule le pane actif si l'actif est fermé", () => {
    const id = store().addWorkspace("/tmp");
    store().addPane(id); // actif = panes[1]
    store().closePane(id, ws(id).activePaneId!);
    expect(ws(id).activePaneId).toBe(ws(id).panes[0]);
  });

  it("renomme un workspace, nom vide retombe sur le basename", () => {
    const id = store().addWorkspace("/tmp");
    store().renameWorkspace(id, "mon-env");
    expect(ws(id).name).toBe("mon-env");
    store().renameWorkspace(id, "   ");
    expect(ws(id).name).toBe("tmp");
  });

  it("change la couleur d'un workspace", () => {
    const id = store().addWorkspace("/tmp");
    store().setColor(id, "#123456");
    expect(ws(id).color).toBe("#123456");
  });

  it("marque une notification lue", () => {
    const id = store().addWorkspace("/tmp");
    store().setNotification(id, { title: "x", body: "y" });
    expect(ws(id).unread).toBe(true);
    store().markRead(id);
    expect(ws(id).unread).toBe(false);
  });

  it("gère un toast transitoire", () => {
    store().showToast("max 4 terminaux");
    expect(store().toast).toBe("max 4 terminaux");
    store().clearToast();
    expect(store().toast).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run src/store/workspace.test.ts`
Expected: FAIL — `MAX_PANES`, `addPane`, `closePane`, `renameWorkspace`, `setColor`, `showToast`, etc. n'existent pas encore (l'ancien store exporte `splitPane`).

- [ ] **Step 3: Rewrite the store** (remplace TOUT le contenu de `src/store/workspace.ts`)

```ts
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
  unread: boolean;
  lastNotification?: Notification;
  status?: { label: string; color?: string };
  progress?: { value: number; label?: string };
}

export const MAX_PANES = 4;

interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string | null;
  /** paneId -> id du PTY backend (pour interroger les ports). */
  panePtys: Record<string, number>;
  toast: string | null;
  addWorkspace: (cwd: string) => string;
  addPane: (wsId: string) => boolean;
  closePane: (wsId: string, paneId: string) => void;
  setActivePane: (wsId: string, paneId: string) => void;
  renameWorkspace: (wsId: string, name: string) => void;
  setColor: (wsId: string, color: string) => void;
  setNotification: (wsId: string, n: Notification) => void;
  markRead: (wsId: string) => void;
  setActive: (wsId: string) => void;
  setGit: (wsId: string, branch: string, dirty: boolean) => void;
  setPorts: (wsId: string, ports: number[]) => void;
  setStatus: (wsId: string, status: { label: string; color?: string }) => void;
  setProgress: (wsId: string, progress: { value: number; label?: string }) => void;
  setPanePty: (paneId: string, ptyId: number) => void;
  removePanePty: (paneId: string) => void;
  showToast: (msg: string) => void;
  clearToast: () => void;
  reset: () => void;
}

let counter = 0;
let colorIndex = 0;
const uid = (prefix: string) => `${prefix}:${counter++}`;

// --- Persistance localStorage (gardée : absente en environnement de test node) ---
const STORAGE_KEY = "terminials:workspaces";
type SavedMeta = Record<string, { name: string; color: string }>;

function loadAllMeta(): SavedMeta {
  if (typeof localStorage === "undefined") return {};
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as SavedMeta;
  } catch {
    return {};
  }
}

function saveMeta(cwd: string, meta: { name: string; color: string }) {
  if (typeof localStorage === "undefined") return;
  try {
    const all = loadAllMeta();
    all[cwd] = meta;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all));
  } catch {
    /* quota dépassé ou localStorage désactivé : on ignore */
  }
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => ({
  workspaces: [],
  activeId: null,
  panePtys: {},
  toast: null,
  addWorkspace: (cwd) => {
    const id = uid("ws");
    const saved = loadAllMeta()[cwd];
    const name = saved?.name ?? basename(cwd);
    let color: string;
    if (saved?.color) {
      color = saved.color;
    } else {
      color = PALETTE[colorIndex % PALETTE.length];
      colorIndex++;
    }
    const paneId = uid("pane");
    const ws: Workspace = {
      id,
      cwd,
      name,
      color,
      panes: [paneId],
      activePaneId: paneId,
      ports: [],
      unread: false,
    };
    set((s) => ({ workspaces: [...s.workspaces, ws], activeId: id }));
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
    return true;
  },
  closePane: (wsId, paneId) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== wsId) return w;
        if (w.panes.length <= 1) return w; // toujours au moins 1 terminal
        const panes = w.panes.filter((p) => p !== paneId);
        if (panes.length === w.panes.length) return w; // paneId inconnu
        const activePaneId = w.activePaneId === paneId ? panes[0] : w.activePaneId;
        return { ...w, panes, activePaneId };
      }),
    })),
  setActivePane: (wsId, paneId) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === wsId ? { ...w, activePaneId: paneId } : w,
      ),
    })),
  renameWorkspace: (wsId, name) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== wsId) return w;
        const finalName = name.trim() || basename(w.cwd);
        saveMeta(w.cwd, { name: finalName, color: w.color });
        return { ...w, name: finalName };
      }),
    })),
  setColor: (wsId, color) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => {
        if (w.id !== wsId) return w;
        saveMeta(w.cwd, { name: w.name, color });
        return { ...w, color };
      }),
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
  showToast: (msg) => set({ toast: msg }),
  clearToast: () => set({ toast: null }),
  reset: () => {
    counter = 0;
    colorIndex = 0;
    set({ workspaces: [], activeId: null, panePtys: {}, toast: null });
  },
}));
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run src/lib/palette.test.ts src/store/workspace.test.ts`
Expected: PASS (toutes les assertions du store + palette).

- [ ] **Step 5: Commit**

```bash
git add src/store/workspace.ts src/store/workspace.test.ts
git commit -m "feat(store): modèle workspace à liste plate de panes + name/color/activePane + toast + persistance localStorage

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

> ⚠️ À ce stade, `PaneTree.tsx`, `useShortcuts.ts` et `App.tsx` ne compilent plus (ils référencent
> les symboles supprimés). C'est attendu : on les migre dans les tâches 3 à 6.

---

## Task 3: Layout CSS Grid (`src/components/PaneTree.tsx`)

**Files:**
- Modify (réécriture): `src/components/PaneTree.tsx`

`TerminalPane.tsx` reste **inchangé** : le focus (clic) et le bouton de fermeture sont gérés par le
wrapper `PaneCell` ci-dessous, ce qui évite de toucher au cycle de vie xterm/PTY.

- [ ] **Step 1: Rewrite the component** (remplace TOUT le contenu de `src/components/PaneTree.tsx`)

```tsx
import { useState, type CSSProperties } from "react";
import type { Workspace } from "../store/workspace";
import { useWorkspaceStore } from "../store/workspace";
import { ALERT_COLOR } from "../lib/palette";
import { TerminalPane } from "./TerminalPane";

const AREAS = ["a", "b", "c", "d"];

/** Géométrie de la grille selon le nombre de panes (1..4). Ordre des cellules : a,b,c,d. */
function gridStyle(count: number): CSSProperties {
  switch (count) {
    case 1:
      return { gridTemplateAreas: '"a"', gridTemplateColumns: "1fr", gridTemplateRows: "1fr" };
    case 2:
      return {
        gridTemplateAreas: '"a b"',
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr",
      };
    case 3:
      return {
        gridTemplateAreas: '"a b" "c c"',
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
      };
    default: // 4
      return {
        gridTemplateAreas: '"a b" "c d"',
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
      };
  }
}

function PaneCell({ ws, paneId, area }: { ws: Workspace; paneId: string; area: string }) {
  const setActivePane = useWorkspaceStore((s) => s.setActivePane);
  const closePane = useWorkspaceStore((s) => s.closePane);
  const [hover, setHover] = useState(false);
  const isActive = ws.activePaneId === paneId;
  const canClose = ws.panes.length > 1;
  return (
    <div
      onMouseDownCapture={() => setActivePane(ws.id, paneId)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        gridArea: area,
        position: "relative",
        minWidth: 0,
        minHeight: 0,
        boxSizing: "border-box",
        border: `1px solid ${isActive ? ws.color : "transparent"}`,
      }}
    >
      {canClose && hover && (
        <button
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={() => closePane(ws.id, paneId)}
          title="Fermer le terminal (Ctrl+W)"
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            zIndex: 3,
            width: 18,
            height: 18,
            padding: 0,
            lineHeight: "16px",
            border: "none",
            borderRadius: 3,
            background: "rgba(0,0,0,0.55)",
            color: "#ddd",
            cursor: "pointer",
          }}
        >
          ×
        </button>
      )}
      <TerminalPane wsId={ws.id} paneId={paneId} cwd={ws.cwd} />
    </div>
  );
}

export function PaneTree({ ws }: { ws: Workspace }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
        boxShadow: ws.unread ? `inset 0 0 0 2px ${ALERT_COLOR}` : "none",
      }}
    >
      <div
        style={{
          display: "grid",
          width: "100%",
          height: "100%",
          gap: 2,
          ...gridStyle(ws.panes.length),
        }}
      >
        {ws.panes.map((paneId, i) => (
          <PaneCell key={paneId} ws={ws} paneId={paneId} area={AREAS[i]} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Verify the edited file typechecks clean**

Run: `npx tsc --noEmit 2>&1 | grep "PaneTree.tsx" || echo "PaneTree.tsx CLEAN"`
Expected: `PaneTree.tsx CLEAN` (des erreurs subsistent dans `App.tsx`/`useShortcuts.ts` non encore migrés — normal).

- [ ] **Step 3: Commit**

```bash
git add src/components/PaneTree.tsx
git commit -m "feat(front): layout en CSS Grid 1→4 (ordre de panes stable, focus + close par cellule)

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Sidebar — nom, couleur, renommage inline (`src/components/Sidebar.tsx`)

**Files:**
- Modify (réécriture): `src/components/Sidebar.tsx`

- [ ] **Step 1: Rewrite the component** (remplace TOUT le contenu de `src/components/Sidebar.tsx`)

```tsx
import { useState } from "react";
import { useWorkspaceStore } from "../store/workspace";
import { PALETTE, ALERT_COLOR } from "../lib/palette";

const HOME = "/home/user";

export function Sidebar() {
  const { workspaces, activeId, addWorkspace, setActive, markRead, renameWorkspace, setColor } =
    useWorkspaceStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [paletteFor, setPaletteFor] = useState<string | null>(null);

  return (
    <div
      style={{
        width: 240,
        background: "#181818",
        color: "#ddd",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      <button onClick={() => addWorkspace(HOME)} style={{ margin: 8 }}>
        + Workspace
      </button>
      {workspaces.map((w) => (
        <div
          key={w.id}
          onClick={() => {
            setActive(w.id);
            markRead(w.id);
          }}
          style={{
            padding: "8px 12px",
            cursor: "pointer",
            background: w.id === activeId ? "#2a2a2a" : "transparent",
            borderLeft: `3px solid ${w.unread ? ALERT_COLOR : w.color}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <span
              onClick={(e) => {
                e.stopPropagation();
                setPaletteFor(paletteFor === w.id ? null : w.id);
              }}
              title="Changer la couleur"
              style={{
                width: 10,
                height: 10,
                borderRadius: "50%",
                background: w.color,
                flexShrink: 0,
                cursor: "pointer",
              }}
            />
            {editingId === w.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => {
                  renameWorkspace(w.id, draft);
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    renameWorkspace(w.id, draft);
                    setEditingId(null);
                  } else if (e.key === "Escape") {
                    setEditingId(null);
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "#111",
                  color: "#eee",
                  border: "1px solid #444",
                  font: "inherit",
                }}
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setDraft(w.name);
                  setEditingId(w.id);
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {w.name}
              </span>
            )}
            {w.unread && <span style={{ color: ALERT_COLOR }}>●</span>}
          </div>

          {paletteFor === w.id && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}
            >
              {PALETTE.map((c) => (
                <span
                  key={c}
                  onClick={() => {
                    setColor(w.id, c);
                    setPaletteFor(null);
                  }}
                  style={{
                    width: 16,
                    height: 16,
                    borderRadius: 3,
                    background: c,
                    cursor: "pointer",
                    outline: c === w.color ? "2px solid #fff" : "none",
                  }}
                />
              ))}
            </div>
          )}

          <div style={{ fontSize: 11, color: "#888" }}>
            {w.branch ? `⎇ ${w.branch}${w.dirty ? " *" : ""}` : ""}{" "}
            {w.ports.length ? `:${w.ports.join(",")}` : ""}
          </div>
          {w.status && (
            <div style={{ fontSize: 11, color: w.status.color ?? "#aaa" }}>{w.status.label}</div>
          )}
          {w.progress && (
            <div style={{ height: 3, background: "#333", marginTop: 4 }}>
              <div
                style={{ height: 3, width: `${w.progress.value * 100}%`, background: ALERT_COLOR }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 2: Verify the edited file typechecks clean**

Run: `npx tsc --noEmit 2>&1 | grep "Sidebar.tsx" || echo "Sidebar.tsx CLEAN"`
Expected: `Sidebar.tsx CLEAN`.

- [ ] **Step 3: Commit**

```bash
git add src/components/Sidebar.tsx
git commit -m "feat(front): sidebar avec nom (renommage inline), pastille/accent couleur, popover palette

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Raccourcis Ctrl+T / Ctrl+W (`src/hooks/useShortcuts.ts`)

**Files:**
- Modify (réécriture): `src/hooks/useShortcuts.ts`

- [ ] **Step 1: Rewrite the hook** (remplace TOUT le contenu de `src/hooks/useShortcuts.ts`)

```ts
import { useEffect } from "react";
import { useWorkspaceStore, MAX_PANES } from "../store/workspace";

const HOME = "/home/user";

/**
 * Raccourcis globaux :
 *  - Ctrl+N : nouveau workspace
 *  - Ctrl+T : nouveau terminal dans le workspace actif (bloqué à MAX_PANES → toast)
 *  - Ctrl+W : ferme le terminal actif du workspace actif (min 1)
 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useWorkspaceStore.getState();
      const active = s.workspaces.find((w) => w.id === s.activeId);
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        s.addWorkspace(HOME);
      } else if (active && e.ctrlKey && e.key === "t") {
        e.preventDefault();
        if (!s.addPane(active.id)) s.showToast(`max ${MAX_PANES} terminaux`);
      } else if (active && e.ctrlKey && e.key === "w") {
        e.preventDefault();
        if (active.activePaneId) s.closePane(active.id, active.activePaneId);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
```

- [ ] **Step 2: Verify the edited file typechecks clean**

Run: `npx tsc --noEmit 2>&1 | grep "useShortcuts.ts" || echo "useShortcuts.ts CLEAN"`
Expected: `useShortcuts.ts CLEAN` (il peut rester des erreurs dans `App.tsx`, migré en Tâche 6).

- [ ] **Step 3: Commit**

```bash
git add src/hooks/useShortcuts.ts
git commit -m "feat(front): raccourcis Ctrl+T (nouveau terminal) / Ctrl+W (fermer), suppression des splits libres

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: App — bouton + Terminal, toast, poller ports multi-panes (`src/App.tsx`)

**Files:**
- Modify: `src/App.tsx`

- [ ] **Step 1: Rewrite the component** (remplace TOUT le contenu de `src/App.tsx`)

```tsx
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
```

- [ ] **Step 2: Full typecheck — now green**

Run: `npx tsc --noEmit`
Expected: aucune erreur (tous les références aux symboles supprimés sont migrées).

- [ ] **Step 3: Full test suite — green**

Run: `npm test`
Expected: PASS (palette + store).

- [ ] **Step 4: Production build — green**

Run: `npm run build`
Expected: build Vite OK (tsc + vite build sans erreur).

- [ ] **Step 5: Commit**

```bash
git add src/App.tsx
git commit -m "feat(front): bouton + Terminal, toast max-panes, poller ports multi-panes

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Smoke test manuel (après Task 6, optionnel mais recommandé)

Nécessite `libwebkit2gtk-4.1-dev` installé pour `npm run tauri dev`.

- [ ] Lancer `npm run tauri dev`.
- [ ] Le workspace initial s'affiche, nom = `terminals`, pastille colorée dans la sidebar.
- [ ] **Double-clic** sur le nom → renommer en « mon-env », Enter → le nom change.
- [ ] Clic sur la **pastille** → choisir une autre couleur → accent + pastille mis à jour.
- [ ] Lancer une commande longue dans le terminal (ex. `top`), puis **+ Terminal** (ou Ctrl+T) :
      le 2e terminal apparaît à droite, **le 1er continue de tourner sans réinitialisation**.
- [ ] Ajouter un 3e (2 en haut, 1 en bas) puis un 4e (quadrants). Vérifier les arrangements.
- [ ] Tenter un **5e** terminal → toast « max 4 terminaux », aucun pane ajouté.
- [ ] Survoler un pane → bouton **×** ; fermer un pane → re-flow vers le layout N-1, les autres
      terminaux **intacts**.
- [ ] Fermer puis relancer l'app → le **nom et la couleur** du workspace sont conservés
      (localStorage).

---

## Self-review (effectué à la rédaction)

- **Couverture spec** : nom + renommage inline (T2/T4) ✓ ; couleur palette + pastille/accent +
  popover (T1/T2/T4) ✓ ; multi-terminaux auto-layout 1→4 (T3) ✓ ; max 4 + toast (T2/T5/T6) ✓ ;
  alerte ambre distincte (T1, utilisée T3/T4) ✓ ; persistance localStorage (T2) ✓ ; poller ports
  multi-panes (T6) ✓ ; raccourcis Ctrl+T/Ctrl+W + suppression splits (T5) ✓ ; préservation des
  terminaux via ordre stable CSS Grid (T3) ✓.
- **Cohérence des types** : `addPane(): boolean` consommé en T5/T6 ✓ ; `MAX_PANES` exporté (T2),
  importé en T5/T6 ✓ ; `PALETTE`/`ALERT_COLOR`/`basename` exportés (T1), importés en T2/T3/T4 ✓ ;
  `setActivePane`/`closePane`/`renameWorkspace`/`setColor`/`showToast`/`clearToast` signatures
  alignées entre store et appelants ✓.
- **Placeholders** : aucun — chaque étape contient le code complet.
```
