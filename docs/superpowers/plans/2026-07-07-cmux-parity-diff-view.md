# Parité cmux + diff viewer — Plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Copier cmux (UI + fonctionnement) : keep-alive des workspaces, dossiers réels, anneau d'attention bleu par pane, diff viewer des fichiers modifiés, raccourcis Ctrl+Shift, fermeture/restauration de workspaces.

**Architecture:** Extension du store Zustand (attention par pane, diffOpen, persistance v2) + nouvelles commandes Tauri adossées à crates/core/git.rs (git CLI) + overlay diff non destructif au-dessus de la grille de panes (jamais démonter un TerminalPane : le cleanup tue le PTY).

**Tech Stack:** Tauri v2 (plugin-dialog), React 19 + TypeScript, xterm.js 6, Zustand 5, vitest ; Rust (portable-pty, serde), git CLI.

**Spec:** docs/superpowers/specs/2026-07-07-cmux-parity-diff-view-design.md

## Global Constraints

- Ne JAMAIS démonter un TerminalPane monté (son cleanup ferme le PTY) ; les workspaces cachés passent en visibility:hidden, jamais display:none.
- Raccourcis : couche Ctrl+Shift uniquement (aucun Ctrl+lettre nu), matching par e.code (AZERTY), Ctrl+Shift+C/V jamais interceptés ; double couche attachCustomKeyEventHandler + window.
- Couleurs : ATTENTION_COLOR #3b82f6 (toute l'attention), STATUS_DEFAULT_COLOR #f5a623 (status/progress) ; plus aucune occurrence d'ALERT_COLOR.
- Git via CLI uniquement (pas de libgit2), GIT_OPTIONAL_LOCKS=0 pour status ; le diff n'est jamais pollé (fetch à l'ouverture + reload).
- Chaque tâche laisse le build vert (npm run build && cargo build) et se termine par un commit (message français, convention type(scope): du repo).
- Commentaires de code en français.

---


## Ordre d'exécution : U.0 → S.* → R.* → K.* → U.1-U.6 → D.*

### Task U.0 : Hygiène amont — retrait de la dépendance `allotment`

**Item spec :** §2 item 8a (le commit App.css est déjà fait — cette tâche ne traite QUE `allotment`)
**Files:**
- Modify: `package.json:19` (ligne `"allotment": "^1.20.5",`), `package-lock.json` (régénéré par npm)

**Interfaces:**
- Consumes: rien (tâche autonome, peut s'exécuter en premier)
- Produces: rien

- [ ] **Step 1: Vérifier qu'aucun code n'importe allotment**
```bash
cd /home/user/dev/terminals
grep -rn "allotment" src/ index.html vite.config.ts
```
Sortie attendue : **aucune ligne** (exit code 1). Les seules occurrences du mot dans le repo sont `package.json` et `package-lock.json` (vérifié : les splits sont une grille CSS dans `PaneTree.tsx`, allotment n'est plus utilisé). Si le grep trouve un import, STOP : ne pas désinstaller, signaler.

- [ ] **Step 2: Désinstaller la dépendance**
```bash
cd /home/user/dev/terminals
npm uninstall allotment
```
Sortie attendue : `removed N packages`. Vérifier que `package.json` ne contient plus la ligne `"allotment"` :
```bash
grep -c allotment package.json
```
Sortie attendue : `0` (exit 1).

- [ ] **Step 3: Build vert**
```bash
cd /home/user/dev/terminals
npm run build
```
Sortie attendue : `tsc` sans erreur puis `✓ built in …` de vite.

- [ ] **Step 4: Commit**
```bash
cd /home/user/dev/terminals
git add package.json package-lock.json && git commit -m "chore(front): retire la dépendance allotment inutilisée (splits en grille CSS depuis la refonte PaneTree)"
```

---


## Package S — Palette + Store Zustand + persistance v2

> Racine du repo : `/home/user/dev/terminals` (tous les chemins ci-dessous sont relatifs à cette racine ; toutes les commandes s'exécutent depuis elle). Baseline avant la première tâche : `npm test` → **15 tests verts** (2 fichiers). Attention : `src/App.css` est modifié dans le worktree (item 8a de la spec, traité ailleurs) — les commits de ce package ajoutent **uniquement** les fichiers listés, jamais `git add -A`.

### Task S.1 : Palette — scission ALERT_COLOR et réordonnancement

**Item spec :** §5 (D3 — scission ALERT_COLOR, collision `#5b8def`), §10 D3

**Files:**
- Modify: `src/lib/palette.ts` (fichier entier, 21 lignes)
- Modify: `src/components/PaneTree.tsx:4,94`
- Modify: `src/components/Sidebar.tsx:3,49,66,159`
- Test: `src/lib/palette.test.ts` (réécrit)

**Interfaces:**
- Consumes: rien (tâche racine du package).
- Produces (consommées par « Store — attention par pane », par le package UI anneau bleu et par le package sidebar riche) :
```ts
export const PALETTE = ["#2ecc71","#1abc9c","#9b59b6","#e91e8c","#e67e22","#f1c40f","#5b8def","#95a5a6"] as const;
export const ATTENTION_COLOR = "#3b82f6";      // toute la sémantique « un agent attend »
export const STATUS_DEFAULT_COLOR = "#f5a623"; // défaut status pill + progress bar
// ALERT_COLOR n'existe plus.
```

- [ ] **Step 1: Réécrire le test (rouge)**

Remplacer intégralement le contenu de `src/lib/palette.test.ts` par :

```ts
import { describe, it, expect } from "vitest";
import { PALETTE, ATTENTION_COLOR, STATUS_DEFAULT_COLOR, basename } from "./palette";

describe("palette", () => {
  it("contient 8 couleurs hex", () => {
    expect(PALETTE).toHaveLength(8);
    for (const c of PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("ne commence pas par #5b8def (collision visuelle avec le bleu attention)", () => {
    expect(PALETTE[0]).toBe("#2ecc71");
    expect(PALETTE.indexOf("#5b8def")).toBeGreaterThanOrEqual(4);
  });

  it("ATTENTION_COLOR est le bleu cmux, distinct de la palette", () => {
    expect(ATTENTION_COLOR).toBe("#3b82f6");
    expect(PALETTE).not.toContain(ATTENTION_COLOR);
  });

  it("STATUS_DEFAULT_COLOR est l'ambre historique", () => {
    expect(STATUS_DEFAULT_COLOR).toBe("#f5a623");
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

- [ ] **Step 2: Vérifier l'échec**

```bash
npm test
```
Attendu : `src/lib/palette.test.ts` échoue au chargement (le module `./palette` n'exporte pas `ATTENTION_COLOR` / `STATUS_DEFAULT_COLOR` — erreur du type `does not provide an export named 'ATTENTION_COLOR'`). Les 11 tests de `workspace.test.ts` restent verts.

- [ ] **Step 3: Implémenter la nouvelle palette**

Remplacer intégralement le contenu de `src/lib/palette.ts` par :

```ts
/** Palette d'identité des workspaces (assignée en round-robin à la création).
    "#5b8def" est relégué loin du début : quasi identique à ATTENTION_COLOR,
    il ne doit pas être attribué aux premiers workspaces. */
export const PALETTE = [
  "#2ecc71", // vert
  "#1abc9c", // teal
  "#9b59b6", // violet
  "#e91e8c", // rose
  "#e67e22", // orange
  "#f1c40f", // jaune
  "#5b8def", // bleu (décalé loin du bleu attention)
  "#95a5a6", // gris
] as const;

/** Bleu cmux : toute la sémantique « un agent attend »
    (anneau de pane, rail sidebar, halo de pastille). */
export const ATTENTION_COLOR = "#3b82f6";

/** Ambre : défaut du status pill et de la progress bar
    (la couleur explicite de `set-status` surcharge). */
export const STATUS_DEFAULT_COLOR = "#f5a623";

/** Dernier segment non vide d'un chemin (nom par défaut d'un workspace). */
export function basename(path: string): string {
  const segs = path.split("/").filter(Boolean);
  return segs.length ? segs[segs.length - 1] : path;
}
```

- [ ] **Step 4: Mise à jour mécanique de PaneTree.tsx**

Dans `src/components/PaneTree.tsx`, remplacer la ligne 4 :
```ts
import { ALERT_COLOR } from "../lib/palette";
```
par :
```ts
import { ATTENTION_COLOR } from "../lib/palette";
```
et à la ligne 94, remplacer :
```ts
        boxShadow: ws.unread ? `inset 0 0 0 2px ${ALERT_COLOR}` : "none",
```
par :
```ts
        boxShadow: ws.unread ? `inset 0 0 0 2px ${ATTENTION_COLOR}` : "none",
```
(Remplacement à l'identique : la **suppression** de ce halo de grille est faite par le package UI anneau bleu, pas ici.)

- [ ] **Step 5: Mise à jour mécanique de Sidebar.tsx**

Dans `src/components/Sidebar.tsx`, remplacer la ligne 3 :
```ts
import { PALETTE, ALERT_COLOR } from "../lib/palette";
```
par :
```ts
import { PALETTE, ATTENTION_COLOR, STATUS_DEFAULT_COLOR } from "../lib/palette";
```
Ligne 49 (rail unread), remplacer :
```ts
            borderLeft: `3px solid ${w.unread ? ALERT_COLOR : "transparent"}`,
```
par :
```ts
            borderLeft: `3px solid ${w.unread ? ATTENTION_COLOR : "transparent"}`,
```
Ligne 66 (halo de pastille), remplacer :
```ts
                boxShadow: w.unread ? `0 0 0 3px ${ALERT_COLOR}40` : "none",
```
par :
```ts
                boxShadow: w.unread ? `0 0 0 3px ${ATTENTION_COLOR}40` : "none",
```
Ligne 159 (progress bar — **seule exception**, elle passe sur l'ambre de statut) :
```ts
                style={{ height: 3, width: `${w.progress.value * 100}%`, background: ALERT_COLOR }}
```
par :
```ts
                style={{ height: 3, width: `${w.progress.value * 100}%`, background: STATUS_DEFAULT_COLOR }}
```

- [ ] **Step 6: Vérifier le vert**

```bash
npm test && npm run build
```
Attendu : **17 tests verts** (6 palette + 11 workspace), `tsc && vite build` sans erreur (plus aucune référence à `ALERT_COLOR` dans `src/`).

- [ ] **Step 7: Commit**
```bash
git add src/lib/palette.ts src/lib/palette.test.ts src/components/PaneTree.tsx src/components/Sidebar.tsx && git commit -m "refactor(front): scinde ALERT_COLOR en ATTENTION_COLOR (bleu cmux) et STATUS_DEFAULT_COLOR, palette réordonnée"
```

---

### Task S.2 : Store — attention par pane (unreadPanes, focus = lu, hasAttention)

**Item spec :** §5 (D3 — unread au niveau pane, clear au focus, fallback workspace)

**Files:**
- Modify: `src/store/workspace.ts:19` (interface `Workspace`), `:39-40` (interface `WorkspaceState`), `:98-107` (init `addWorkspace`), `:122-139` (`closePane`, `setActivePane`), `:156-166` (`setNotification`, `markRead`, `setActive`), fin de fichier (`hasAttention`)
- Modify: `src/components/Sidebar.tsx:17,39-42` (suppression de l'appel `markRead`)
- Test: `src/store/workspace.test.ts` (remplace le test `markRead` des lignes 88-94, ajoute 8 tests)

**Interfaces:**
- Consumes: rien de nouveau (le store importe déjà `PALETTE`/`basename`, inchangés par « Palette — scission ALERT_COLOR et réordonnancement »).
- Produces (consommées par le package UI anneau bleu, le package sidebar riche et le package routage socket) :
```ts
// dans Workspace :
unread: boolean;            // fallback niveau workspace (notif sans pane identifiable)
unreadPanes: string[];      // panes avec notification non lue (anneau bleu)
// dans WorkspaceState :
setNotification: (wsId: string, n: Notification, paneId?: string) => void; // paneId fourni et connu → unreadPanes ∪ {paneId} ; sinon unread=true
// setActivePane(wsId, paneId) retire AUSSI paneId de unreadPanes (focus = lu)
// setActive(wsId) clear AUSSI unread (fallback) mais PAS unreadPanes
// markRead SUPPRIMÉ
export function hasAttention(w: Workspace): boolean; // w.unread || w.unreadPanes.length > 0
```

- [ ] **Step 1: Écrire les tests (rouge)**

Dans `src/store/workspace.test.ts`, remplacer la ligne 2 :
```ts
import { useWorkspaceStore, MAX_PANES } from "./workspace";
```
par :
```ts
import { useWorkspaceStore, MAX_PANES, hasAttention } from "./workspace";
```
puis remplacer le test `"marque une notification lue"` (lignes 88-94) par ce bloc :

```ts
  it("setNotification sans paneId pose le fallback unread + lastNotification", () => {
    const id = store().addWorkspace("/tmp");
    store().setNotification(id, { title: "x", body: "y" });
    expect(ws(id).unread).toBe(true);
    expect(ws(id).unreadPanes).toEqual([]);
    expect(ws(id).lastNotification).toEqual({ title: "x", body: "y" });
  });

  it("setActive lit le fallback unread du workspace activé", () => {
    const a = store().addWorkspace("/a");
    store().addWorkspace("/b"); // actif = /b
    store().setNotification(a, { title: "x", body: "y" });
    store().setActive(a);
    expect(store().activeId).toBe(a);
    expect(ws(a).unread).toBe(false);
  });

  it("setNotification avec paneId allume l'anneau du pane sans fallback", () => {
    const id = store().addWorkspace("/tmp");
    store().addPane(id); // panes = [p0, p1]
    const p0 = ws(id).panes[0];
    store().setNotification(id, { title: "n", body: "" }, p0);
    expect(ws(id).unreadPanes).toEqual([p0]);
    expect(ws(id).unread).toBe(false);
    expect(ws(id).lastNotification).toEqual({ title: "n", body: "" });
    // idempotent : pas de doublon dans unreadPanes
    store().setNotification(id, { title: "n2", body: "" }, p0);
    expect(ws(id).unreadPanes).toEqual([p0]);
  });

  it("setNotification avec un paneId inconnu retombe sur le fallback workspace", () => {
    const id = store().addWorkspace("/tmp");
    store().setNotification(id, { title: "n", body: "" }, "pane:fantome");
    expect(ws(id).unreadPanes).toEqual([]);
    expect(ws(id).unread).toBe(true);
  });

  it("setActivePane éteint l'anneau du pane focusé, et seulement lui", () => {
    const id = store().addWorkspace("/tmp");
    store().addPane(id);
    const [p0, p1] = ws(id).panes;
    store().setNotification(id, { title: "a", body: "" }, p0);
    store().setNotification(id, { title: "b", body: "" }, p1);
    store().setActivePane(id, p0);
    expect(ws(id).unreadPanes).toEqual([p1]);
    expect(ws(id).activePaneId).toBe(p0);
  });

  it("setActive ne touche pas aux anneaux par pane", () => {
    const a = store().addWorkspace("/a");
    store().addWorkspace("/b");
    const p0 = ws(a).panes[0];
    store().setNotification(a, { title: "n", body: "" }, p0);
    store().setActive(a);
    expect(ws(a).unreadPanes).toEqual([p0]);
  });

  it("closePane purge l'anneau du pane fermé", () => {
    const id = store().addWorkspace("/tmp");
    store().addPane(id);
    const p1 = ws(id).panes[1];
    store().setNotification(id, { title: "n", body: "" }, p1);
    store().closePane(id, p1);
    expect(ws(id).unreadPanes).toEqual([]);
  });

  it("hasAttention dérive fallback OU anneaux par pane", () => {
    const id = store().addWorkspace("/tmp");
    expect(hasAttention(ws(id))).toBe(false);
    store().setNotification(id, { title: "n", body: "" }, ws(id).panes[0]);
    expect(hasAttention(ws(id))).toBe(true);
    store().setActivePane(id, ws(id).panes[0]);
    expect(hasAttention(ws(id))).toBe(false);
    store().setNotification(id, { title: "n", body: "" });
    expect(hasAttention(ws(id))).toBe(true);
  });
```

- [ ] **Step 2: Vérifier l'échec**

```bash
npm test
```
Attendu : `src/store/workspace.test.ts` échoue au chargement (export `hasAttention` inexistant sur `./workspace`). Les 6 tests palette restent verts.

- [ ] **Step 3: Étendre les interfaces du store**

Dans `src/store/workspace.ts`, remplacer la ligne 19 (`unread: boolean;` dans `interface Workspace`) par :
```ts
  /** Fallback niveau workspace : notification sans pane identifiable. */
  unread: boolean;
  /** Panes avec notification non lue (anneau bleu cmux). */
  unreadPanes: string[];
```
Dans `interface WorkspaceState`, remplacer les lignes 39-40 :
```ts
  setNotification: (wsId: string, n: Notification) => void;
  markRead: (wsId: string) => void;
```
par :
```ts
  setNotification: (wsId: string, n: Notification, paneId?: string) => void;
```

- [ ] **Step 4: Implémenter les réducteurs**

Toujours dans `src/store/workspace.ts` :

a) Dans `addWorkspace` (lignes 98-107), le littéral `ws` devient :
```ts
    const ws: Workspace = {
      id,
      cwd,
      name,
      color,
      panes: [paneId],
      activePaneId: paneId,
      ports: [],
      unread: false,
      unreadPanes: [],
    };
```

b) Remplacer `closePane` (lignes 122-133) par :
```ts
  closePane: (wsId, paneId) =>
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
    })),
```

c) Remplacer `setActivePane` (lignes 134-139) par :
```ts
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
```

d) Remplacer le bloc `setNotification` + `markRead` + `setActive` (lignes 156-166) par :
```ts
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
```

e) Ajouter en toute fin de fichier (après le `create(...)`) :
```ts
/** Vrai si le workspace réclame l'attention : fallback workspace OU ≥ 1 pane non lu. */
export function hasAttention(w: Workspace): boolean {
  return w.unread || w.unreadPanes.length > 0;
}
```

- [ ] **Step 5: Retirer markRead de la Sidebar**

Dans `src/components/Sidebar.tsx`, remplacer les lignes 17-18 :
```ts
  const { workspaces, activeId, addWorkspace, setActive, markRead, renameWorkspace, setColor } =
    useWorkspaceStore();
```
par :
```ts
  const { workspaces, activeId, addWorkspace, setActive, renameWorkspace, setColor } =
    useWorkspaceStore();
```
et le handler des lignes 39-42 :
```ts
          onClick={() => {
            setActive(w.id);
            markRead(w.id);
          }}
```
par :
```ts
          onClick={() => setActive(w.id)}
```
(`setActive` clear désormais lui-même le fallback `unread`. Le rail et le halo de pastille restent branchés sur `w.unread` à ce stade — le passage à `hasAttention(w)` est fait par le package UI anneau bleu.)

- [ ] **Step 6: Vérifier le vert**

```bash
npm test && npm run build
```
Attendu : **24 tests verts** (6 palette + 18 workspace), build sans erreur (`socketEvents.ts` appelle `setNotification` à 2 arguments : toujours compatible, le 3e est optionnel).

- [ ] **Step 7: Commit**
```bash
git add src/store/workspace.ts src/store/workspace.test.ts src/components/Sidebar.tsx && git commit -m "feat(front): attention par pane — unreadPanes, focus = lu, hasAttention (spec §5)"
```

---

### Task S.3 : Store — diffOpen, sidebarVisible, renameRequestId

**Item spec :** §4 (booléen `diffOpen` par workspace), §6 (Ctrl+Shift+B toggle sidebar, Ctrl+Shift+R rename inline)

**Files:**
- Modify: `src/store/workspace.ts` (interface `Workspace`, interface `WorkspaceState`, état initial, `addWorkspace`, nouveaux réducteurs, `reset`)
- Test: `src/store/workspace.test.ts` (4 tests ajoutés)

**Interfaces:**
- Consumes: état du store tel que laissé par « Store — attention par pane (unreadPanes, focus = lu, hasAttention) ».
- Produces (consommées par le package diff viewer, le package raccourcis et le package Sidebar) :
```ts
// dans Workspace :
diffOpen: boolean;                        // overlay diff ouvert (jamais persisté)
// dans WorkspaceState :
sidebarVisible: boolean;                  // défaut true
renameRequestId: string | null;           // la Sidebar ouvre l'édition inline quand ça matche un ws
toggleDiff: (wsId: string) => void;
toggleSidebar: () => void;
requestRename: (wsId: string | null) => void;
```

- [ ] **Step 1: Écrire les tests (rouge)**

Dans `src/store/workspace.test.ts`, ajouter à la fin du `describe("workspace store", ...)` (avant sa `});` finale) :

```ts
  it("toggleDiff bascule diffOpen du workspace visé uniquement", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b");
    expect(ws(a).diffOpen).toBe(false);
    store().toggleDiff(a);
    expect(ws(a).diffOpen).toBe(true);
    expect(ws(b).diffOpen).toBe(false);
    store().toggleDiff(a);
    expect(ws(a).diffOpen).toBe(false);
  });

  it("toggleSidebar bascule sidebarVisible (défaut true)", () => {
    expect(store().sidebarVisible).toBe(true);
    store().toggleSidebar();
    expect(store().sidebarVisible).toBe(false);
    store().toggleSidebar();
    expect(store().sidebarVisible).toBe(true);
  });

  it("requestRename pose et efface renameRequestId", () => {
    const id = store().addWorkspace("/tmp");
    expect(store().renameRequestId).toBeNull();
    store().requestRename(id);
    expect(store().renameRequestId).toBe(id);
    store().requestRename(null);
    expect(store().renameRequestId).toBeNull();
  });

  it("reset restaure sidebarVisible et renameRequestId", () => {
    store().toggleSidebar();
    store().requestRename("ws:0");
    store().reset();
    expect(store().sidebarVisible).toBe(true);
    expect(store().renameRequestId).toBeNull();
  });
```

- [ ] **Step 2: Vérifier l'échec**

```bash
npm test
```
Attendu : 4 nouveaux tests rouges (`expect(ws(a).diffOpen).toBe(false)` reçoit `undefined` ; `store().toggleDiff is not a function` ; `store().sidebarVisible` `undefined` ; etc.). Les 24 autres restent verts.

- [ ] **Step 3: Étendre le store**

Dans `src/store/workspace.ts` :

a) Dans `interface Workspace`, juste après `unreadPanes: string[];`, ajouter :
```ts
  /** Overlay diff ouvert sur ce workspace (état UI, jamais persisté). */
  diffOpen: boolean;
```

b) Dans `interface WorkspaceState`, juste après `toast: string | null;`, ajouter :
```ts
  /** Sidebar visible (toggle Ctrl+Shift+B). */
  sidebarVisible: boolean;
  /** Workspace dont la Sidebar doit ouvrir l'édition inline du nom (null = aucune demande). */
  renameRequestId: string | null;
```
et juste après `removePanePty: (paneId: string) => void;`, ajouter :
```ts
  toggleDiff: (wsId: string) => void;
  toggleSidebar: () => void;
  requestRename: (wsId: string | null) => void;
```

c) Dans l'état initial du `create(...)`, remplacer :
```ts
  workspaces: [],
  activeId: null,
  panePtys: {},
  toast: null,
```
par :
```ts
  workspaces: [],
  activeId: null,
  panePtys: {},
  toast: null,
  sidebarVisible: true,
  renameRequestId: null,
```

d) Dans le littéral `ws` de `addWorkspace`, juste après `unreadPanes: [],`, ajouter :
```ts
      diffOpen: false,
```

e) Juste après l'implémentation de `removePanePty`, ajouter :
```ts
  toggleDiff: (wsId) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, diffOpen: !w.diffOpen } : w)),
    })),
  toggleSidebar: () => set((s) => ({ sidebarVisible: !s.sidebarVisible })),
  requestRename: (wsId) => set({ renameRequestId: wsId }),
```

f) Remplacer l'implémentation de `reset` par :
```ts
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
```

- [ ] **Step 4: Vérifier le vert**

```bash
npm test && npm run build
```
Attendu : **28 tests verts** (6 palette + 22 workspace), build sans erreur.

- [ ] **Step 5: Commit**
```bash
git add src/store/workspace.ts src/store/workspace.test.ts && git commit -m "feat(front): état diffOpen, sidebarVisible et renameRequestId dans le store"
```

---

### Task S.4 : Store — closeWorkspace

**Item spec :** §6 (fermeture de workspace : action store, activation du voisin), §9 (tests closeWorkspace)

**Files:**
- Modify: `src/store/workspace.ts` (interface `WorkspaceState` + réducteur `closeWorkspace` après `closePane`)
- Test: `src/store/workspace.test.ts` (6 tests ajoutés)

**Interfaces:**
- Consumes: état du store tel que laissé par « Store — diffOpen, sidebarVisible, renameRequestId ».
- Produces (consommée par le package raccourcis et le bouton × de la Sidebar) :
```ts
closeWorkspace: (wsId: string) => void; // retire le ws + purge ses entrées panePtys ; si actif : activeId → voisin précédent, sinon suivant, sinon null
```
Note d'architecture : `closeWorkspace` ne tue pas les PTYs lui-même — retirer le workspace du store démonte ses `TerminalPane`, dont le cleanup appelle déjà `closePty` (`src/components/TerminalPane.tsx:74-83`).

- [ ] **Step 1: Écrire les tests (rouge)**

Dans `src/store/workspace.test.ts`, ajouter à la fin du `describe("workspace store", ...)` :

```ts
  it("closeWorkspace du ws actif du milieu active le voisin précédent", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b");
    const c = store().addWorkspace("/c");
    store().setActive(b);
    store().closeWorkspace(b);
    expect(store().workspaces.map((w) => w.id)).toEqual([a, c]);
    expect(store().activeId).toBe(a);
  });

  it("closeWorkspace du premier ws actif active le suivant", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b");
    store().setActive(a);
    store().closeWorkspace(a);
    expect(store().activeId).toBe(b);
  });

  it("closeWorkspace du dernier ws restant vide la liste (activeId null)", () => {
    const a = store().addWorkspace("/a");
    store().closeWorkspace(a);
    expect(store().workspaces).toEqual([]);
    expect(store().activeId).toBeNull();
  });

  it("closeWorkspace d'un ws inactif ne change pas activeId", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b"); // actif = b
    store().closeWorkspace(a);
    expect(store().activeId).toBe(b);
    expect(store().workspaces.map((w) => w.id)).toEqual([b]);
  });

  it("closeWorkspace purge les panePtys du ws fermé, pas ceux des autres", () => {
    const a = store().addWorkspace("/a");
    store().addPane(a);
    const b = store().addWorkspace("/b");
    const [pa0, pa1] = ws(a).panes;
    const pb0 = ws(b).panes[0];
    store().setPanePty(pa0, 10);
    store().setPanePty(pa1, 11);
    store().setPanePty(pb0, 20);
    store().closeWorkspace(a);
    expect(store().panePtys).toEqual({ [pb0]: 20 });
  });

  it("closeWorkspace d'un id inconnu est un no-op", () => {
    const a = store().addWorkspace("/a");
    store().closeWorkspace("ws:fantome");
    expect(store().workspaces.map((w) => w.id)).toEqual([a]);
    expect(store().activeId).toBe(a);
  });
```

- [ ] **Step 2: Vérifier l'échec**

```bash
npm test
```
Attendu : 6 nouveaux tests rouges avec `TypeError: store().closeWorkspace is not a function`. Les 28 autres restent verts.

- [ ] **Step 3: Implémenter closeWorkspace**

Dans `src/store/workspace.ts` :

a) Dans `interface WorkspaceState`, juste après `closePane: (wsId: string, paneId: string) => void;`, ajouter :
```ts
  closeWorkspace: (wsId: string) => void;
```

b) Juste après l'implémentation de `closePane`, ajouter :
```ts
  closeWorkspace: (wsId) =>
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
    }),
```

- [ ] **Step 4: Vérifier le vert**

```bash
npm test && npm run build
```
Attendu : **34 tests verts** (6 palette + 28 workspace), build sans erreur.

- [ ] **Step 5: Commit**
```bash
git add src/store/workspace.ts src/store/workspace.test.ts && git commit -m "feat(front): closeWorkspace — purge des panePtys et activation du voisin"
```

---

### Task S.5 : Persistance v2 — SavedWorkspace[], helpers localStorage, restoreWorkspaces

**Item spec :** §7 (restauration de la liste des workspaces), §6 (dernier dossier ouvert pour le dialog)

**Files:**
- Modify: `src/store/workspace.ts` (suppression du bloc v1 `STORAGE_KEY`/`SavedMeta`/`loadAllMeta`/`saveMeta` — lignes 57-79 du fichier d'origine —, nouveaux helpers v2, réécriture après chaque action mutante, `restoreWorkspaces`)
- Test: `src/store/workspace.test.ts` (nouveau `describe` « persistance v2 », 11 tests, stub localStorage)

**Interfaces:**
- Consumes: `closeWorkspace` de « Store — closeWorkspace » (persistance branchée dessus) ; champs `unreadPanes`/`diffOpen` de « Store — attention par pane… » et « Store — diffOpen… » (init des workspaces restaurés).
- Produces (consommées par le package open-folder/boot — restauration au démarrage et `defaultPath` du dialog) :
```ts
export type SavedWorkspace = { cwd: string; name: string; color: string; paneCount: number };
export function loadSavedWorkspaces(): SavedWorkspace[];   // clé "terminials:workspaces:v2"
export function getLastFolder(): string | undefined;       // clé "terminials:lastFolder"
export function setLastFolder(path: string): void;
// dans WorkspaceState :
restoreWorkspaces: (entries: SavedWorkspace[]) => void;    // ids frais, paneCount panes chacun (clampé 1..MAX_PANES), activeId = premier
// La sauvegarde v2 (SavedWorkspace[] ORDONNÉ) est réécrite après addWorkspace/renameWorkspace/
// setColor/addPane/closePane/closeWorkspace/restoreWorkspaces. Clé v1 "terminials:workspaces" abandonnée.
// Comportement retiré : addWorkspace ne restaure plus name/color depuis la clé v1 par cwd —
// la restauration passe désormais par loadSavedWorkspaces() + restoreWorkspaces() au boot.
```

Déviation assumée vs spec §7 (« persister `{id, cwd, name, color, paneCount}` keyé par id ») : la v2 persiste une liste **ordonnée sans `id`** — les ids sont volatils par session (compteur en mémoire, régénérés au restore), les garder serait inutile ; l'ordre + l'absence de clé par cwd satisfont l'intention de la spec (pas de fusion par cwd des worktrees). Un relecteur ne doit pas traiter cet écart comme un manque.

- [ ] **Step 1: Écrire les tests (rouge)**

Dans `src/store/workspace.test.ts` :

a) Remplacer les imports (lignes 1-3) par :
```ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  useWorkspaceStore,
  MAX_PANES,
  hasAttention,
  loadSavedWorkspaces,
  getLastFolder,
  setLastFolder,
  type SavedWorkspace,
} from "./workspace";
import { PALETTE, basename } from "../lib/palette";
```

b) Juste après les helpers `store`/`ws` du haut de fichier, ajouter :
```ts
/** Stub localStorage minimal (les tests tournent en environnement node, sans DOM). */
function localStorageStub(): Storage {
  const data = new Map<string, string>();
  return {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => {
      data.set(k, v);
    },
    removeItem: (k: string) => {
      data.delete(k);
    },
    clear: () => data.clear(),
    key: (i: number) => [...data.keys()][i] ?? null,
    get length() {
      return data.size;
    },
  };
}
```

c) Ajouter en fin de fichier (après la `});` du `describe("workspace store", ...)`) un nouveau `describe` :
```ts
describe("persistance v2", () => {
  const V2_KEY = "terminials:workspaces:v2";
  const saved = (): SavedWorkspace[] =>
    JSON.parse(localStorage.getItem(V2_KEY) ?? "[]") as SavedWorkspace[];

  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = localStorageStub();
    store().reset();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("addWorkspace écrit la liste ordonnée {cwd,name,color,paneCount}", () => {
    store().addWorkspace("/a");
    store().addWorkspace("/b");
    expect(saved()).toEqual([
      { cwd: "/a", name: "a", color: PALETTE[0], paneCount: 1 },
      { cwd: "/b", name: "b", color: PALETTE[1], paneCount: 1 },
    ]);
  });

  it("addPane et closePane réécrivent paneCount", () => {
    const id = store().addWorkspace("/a");
    store().addPane(id);
    expect(saved()[0].paneCount).toBe(2);
    store().closePane(id, ws(id).panes[1]);
    expect(saved()[0].paneCount).toBe(1);
  });

  it("renameWorkspace et setColor réécrivent la sauvegarde", () => {
    const id = store().addWorkspace("/a");
    store().renameWorkspace(id, "agent");
    store().setColor(id, "#123456");
    expect(saved()[0]).toEqual({ cwd: "/a", name: "agent", color: "#123456", paneCount: 1 });
  });

  it("closeWorkspace retire l'entrée persistée", () => {
    const a = store().addWorkspace("/a");
    store().addWorkspace("/b");
    store().closeWorkspace(a);
    expect(saved().map((e) => e.cwd)).toEqual(["/b"]);
  });

  it("l'ancienne clé v1 n'est plus écrite", () => {
    const id = store().addWorkspace("/a");
    store().renameWorkspace(id, "agent");
    store().setColor(id, "#123456");
    expect(localStorage.getItem("terminials:workspaces")).toBeNull();
  });

  it("loadSavedWorkspaces relit la sauvegarde et filtre le JSON invalide", () => {
    store().addWorkspace("/a");
    expect(loadSavedWorkspaces()).toEqual([
      { cwd: "/a", name: "a", color: PALETTE[0], paneCount: 1 },
    ]);
    localStorage.setItem(V2_KEY, "{pas du json");
    expect(loadSavedWorkspaces()).toEqual([]);
    localStorage.setItem(
      V2_KEY,
      JSON.stringify([{ cwd: "/ok", name: "ok", color: "#111111", paneCount: 2 }, { n: 1 }]),
    );
    expect(loadSavedWorkspaces()).toEqual([
      { cwd: "/ok", name: "ok", color: "#111111", paneCount: 2 },
    ]);
  });

  it("restoreWorkspaces recrée les workspaces : ids frais, paneCount clampé, actif = premier", () => {
    store().restoreWorkspaces([
      { cwd: "/a", name: "agent", color: "#123456", paneCount: 2 },
      { cwd: "/b", name: "b", color: "#654321", paneCount: 9 },
      { cwd: "/c", name: "c", color: "#111111", paneCount: 0 },
    ]);
    const [a, b, c] = store().workspaces;
    expect(store().activeId).toBe(a.id);
    expect(a).toMatchObject({
      cwd: "/a",
      name: "agent",
      color: "#123456",
      unread: false,
      unreadPanes: [],
      diffOpen: false,
      ports: [],
    });
    expect(a.panes).toHaveLength(2);
    expect(a.activePaneId).toBe(a.panes[0]);
    expect(b.panes).toHaveLength(MAX_PANES); // paneCount aberrant clampé à MAX_PANES
    expect(c.panes).toHaveLength(1); // et au minimum 1
    expect(new Set(store().workspaces.map((w) => w.id)).size).toBe(3); // ids frais uniques
    expect(saved().map((e) => e.paneCount)).toEqual([2, 4, 1]); // sauvegarde réécrite normalisée
  });

  it("restoreWorkspaces([]) laisse l'état vide", () => {
    store().restoreWorkspaces([]);
    expect(store().workspaces).toEqual([]);
    expect(store().activeId).toBeNull();
  });

  it("le round-robin de couleurs continue après les workspaces restaurés", () => {
    store().restoreWorkspaces([
      { cwd: "/a", name: "a", color: "#111111", paneCount: 1 },
      { cwd: "/b", name: "b", color: "#222222", paneCount: 1 },
    ]);
    const d = store().addWorkspace("/d");
    expect(ws(d).color).toBe(PALETTE[2]);
  });

  it("getLastFolder/setLastFolder font l'aller-retour, absent → undefined", () => {
    expect(getLastFolder()).toBeUndefined();
    setLastFolder("/home/x/dev");
    expect(getLastFolder()).toBe("/home/x/dev");
    expect(localStorage.getItem("terminials:lastFolder")).toBe("/home/x/dev");
  });

  it("sans localStorage : helpers no-op, actions du store inchangées", () => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
    expect(loadSavedWorkspaces()).toEqual([]);
    expect(getLastFolder()).toBeUndefined();
    setLastFolder("/x"); // ne jette pas
    const id = store().addWorkspace("/a"); // ne jette pas
    expect(ws(id).cwd).toBe("/a");
  });
});
```

- [ ] **Step 2: Vérifier l'échec**

```bash
npm test
```
Attendu : `workspace.test.ts` échoue au chargement (exports `loadSavedWorkspaces`/`getLastFolder`/`setLastFolder` inexistants sur `./workspace`). Les tests palette restent verts.

- [ ] **Step 3: Remplacer la persistance v1 par la v2**

Dans `src/store/workspace.ts` :

a) Juste après `export interface Workspace { ... }`, ajouter :
```ts
/** Entrée de persistance v2 : liste ORDONNÉE réécrite en bloc à chaque mutation
    (pas de clé par cwd : deux workspaces sur le même dossier — worktrees — coexistent). */
export type SavedWorkspace = { cwd: string; name: string; color: string; paneCount: number };
```

b) Dans `interface WorkspaceState`, juste après `requestRename: (wsId: string | null) => void;`, ajouter :
```ts
  restoreWorkspaces: (entries: SavedWorkspace[]) => void;
```

c) Supprimer intégralement le bloc v1 (du commentaire `// --- Persistance localStorage (gardée : absente en environnement de test node) ---` jusqu'à la fin de `saveMeta` incluse — lignes 57-79 du fichier d'origine : `STORAGE_KEY = "terminials:workspaces"`, `type SavedMeta`, `loadAllMeta`, `saveMeta`) et le remplacer par :
```ts
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
```

- [ ] **Step 4: Brancher la réécriture sur les actions mutantes + restoreWorkspaces**

Toujours dans `src/store/workspace.ts` :

a) Remplacer `addWorkspace` en entier (le lookup v1 `loadAllMeta()[cwd]` disparaît) :
```ts
  addWorkspace: (cwd) => {
    const id = uid("ws");
    const color = PALETTE[colorIndex % PALETTE.length];
    colorIndex++;
    const paneId = uid("pane");
    const ws: Workspace = {
      id,
      cwd,
      name: basename(cwd),
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
```

b) Dans `addPane`, insérer `persistWorkspaces(get().workspaces);` juste avant le `return true;`.

c) Transformer `closePane` en corps-instruction pour persister — remplacer sa première et sa dernière ligne :
```ts
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
```

d) De même pour `closeWorkspace` :
```ts
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
```

e) Remplacer `renameWorkspace` et `setColor` (les appels `saveMeta` disparaissent) :
```ts
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
```

f) Juste après l'implémentation de `requestRename`, ajouter :
```ts
  restoreWorkspaces: (entries) => {
    const workspaces = entries.map((e): Workspace => {
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
    set({ workspaces, activeId: workspaces[0]?.id ?? null });
    persistWorkspaces(get().workspaces);
  },
```
(On ne restaure jamais `unread`/`unreadPanes`/`status`/`progress`/`ports` — spec §7.)

- [ ] **Step 5: Vérifier le vert**

```bash
npm test && npm run build
```
Attendu : **45 tests verts** (6 palette + 28 « workspace store » + 11 « persistance v2 »), build sans erreur. Vérifier aussi qu'il ne reste aucune référence v1 :
```bash
grep -rn "loadAllMeta\|saveMeta\|SavedMeta\|terminials:workspaces\"" src/
```
Attendu : aucune sortie.

- [ ] **Step 6: Commit**
```bash
git add src/store/workspace.ts src/store/workspace.test.ts && git commit -m "feat(front): persistance v2 des workspaces (liste ordonnée) + restoreWorkspaces, abandon de la clé v1"
```
### Task R.1 : changed_files() dans crates/core/src/git.rs

**Item spec :** §4 (Données), §8 (hors repo → liste vide), §9 (tests Rust)
**Files:**
- Modify: `/home/user/dev/terminals/crates/core/Cargo.toml` (ajout `[dev-dependencies]` en fin de fichier)
- Modify: `/home/user/dev/terminals/crates/core/src/git.rs` (types + fonction insérés après `git_info` ligne 34, tests dans le mod `tests` existant lignes 36-60)

**Interfaces:**
- Consumes: rien (git CLI uniquement, pas de libgit2)
- Produces:
  ```rust
  pub struct ChangedFile { pub path: String, pub status: FileStatus, pub orig_path: Option<String>, pub added: Option<u32>, pub deleted: Option<u32> } // Serialize camelCase → { path, status, origPath?, added?, deleted? }
  pub enum FileStatus { Modified, Added, Deleted, Renamed, Untracked }   // Serialize minuscules
  pub fn changed_files(cwd: &str) -> Vec<ChangedFile>
  ```
  Consommé par la tâche « Commandes Tauri git_changed_files / git_file_diff / dir_exists ».

Formats git vérifiés sur le git du poste (2.34.1) :
- `git status --porcelain=v1 -z` : entrées `XY path\0` ; renommage = `R  nouveau\0ancien\0` (nouveau chemin d'abord, ordre inversé du format long — doc git : « the field order is reversed »).
- `git diff --numstat -z` : `add\tdel\tpath\0` ; renommage = `add\tdel\t\0pré-image\0post-image\0` (champ chemin vide, puis deux champs) ; binaire = `-\t-\tpath\0`.

- [ ] **Step 1: dev-dependency serde_json pour les tests de sérialisation**

À la fin de `/home/user/dev/terminals/crates/core/Cargo.toml` (après le bloc `[dependencies]`), ajouter :
```toml

[dev-dependencies]
serde_json = { workspace = true }
```

- [ ] **Step 2: types + stub (le rouge TDD sera un échec d'assertion, pas de compilation)**

Dans `/home/user/dev/terminals/crates/core/src/git.rs`, insérer après la fin de `git_info` (ligne 34), avant `#[cfg(test)]` :
```rust
/// Statut d'un fichier modifié. Un fichier à la fois staged et modifié (porcelain `MM`)
/// produit UNE seule entrée : le code XY de `git status --porcelain` fusionne déjà
/// index et worktree.
#[derive(Debug, Clone, Copy, PartialEq, serde::Serialize)]
#[serde(rename_all = "lowercase")]
pub enum FileStatus {
    Modified,
    Added,
    Deleted,
    Renamed,
    Untracked,
}

/// Un fichier modifié du repo, avec ses compteurs +/− (None = binaire, ou untracked
/// — les fichiers untracked sont invisibles pour `git diff --numstat`).
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangedFile {
    pub path: String,
    pub status: FileStatus,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub orig_path: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub added: Option<u32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub deleted: Option<u32>,
}

/// Fichiers modifiés du repo (index + worktree), triés par chemin. Hors repo → vide.
pub fn changed_files(cwd: &str) -> Vec<ChangedFile> {
    let _ = cwd;
    Vec::new() // stub TDD : implémenté à l'étape suivante
}
```

- [ ] **Step 3: tests (rouges) dans le mod `tests` de git.rs**

Ajouter à la fin du mod `tests` existant (avant l'accolade fermante ligne 60) :
```rust
    // ---- changed_files ----

    /// Exécute git dans `dir` et panique avec stderr si la commande échoue.
    fn git(dir: &std::path::Path, args: &[&str]) {
        let out = Command::new("git").args(args).current_dir(dir).output().unwrap();
        assert!(
            out.status.success(),
            "git {args:?} a échoué: {}",
            String::from_utf8_lossy(&out.stderr)
        );
    }

    /// Crée un repo git temporaire vierge (branche main, user configuré).
    fn tmp_repo(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("terminials-cf-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        git(&dir, &["init", "-q", "-b", "main"]);
        git(&dir, &["config", "user.email", "test@test.local"]);
        git(&dir, &["config", "user.name", "test"]);
        dir
    }

    fn write_file(dir: &std::path::Path, name: &str, content: &[u8]) {
        std::fs::write(dir.join(name), content).unwrap();
    }

    #[test]
    fn changed_files_modified_worktree() {
        let dir = tmp_repo("modified");
        write_file(&dir, "a.txt", b"ligne1\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "a.txt", b"ligne2\n");
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "a.txt");
        assert_eq!(files[0].status, FileStatus::Modified);
        assert_eq!(files[0].added, Some(1));
        assert_eq!(files[0].deleted, Some(1));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_added_staged() {
        let dir = tmp_repo("added");
        write_file(&dir, "a.txt", b"x\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "b.txt", b"un\ndeux\n");
        git(&dir, &["add", "b.txt"]);
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "b.txt");
        assert_eq!(files[0].status, FileStatus::Added);
        assert_eq!(files[0].added, Some(2));
        assert_eq!(files[0].deleted, Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_deleted_worktree() {
        let dir = tmp_repo("deleted");
        write_file(&dir, "a.txt", b"x\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        std::fs::remove_file(dir.join("a.txt")).unwrap();
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, FileStatus::Deleted);
        assert_eq!(files[0].deleted, Some(1));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_renamed_staged() {
        let dir = tmp_repo("renamed");
        write_file(&dir, "a.txt", b"x\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        git(&dir, &["mv", "a.txt", "c.txt"]);
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "c.txt");
        assert_eq!(files[0].status, FileStatus::Renamed);
        assert_eq!(files[0].orig_path.as_deref(), Some("a.txt"));
        assert_eq!(files[0].added, Some(0));
        assert_eq!(files[0].deleted, Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_untracked() {
        let dir = tmp_repo("untracked");
        write_file(&dir, "nouveau.txt", b"contenu\n");
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].path, "nouveau.txt");
        assert_eq!(files[0].status, FileStatus::Untracked);
        // Les untracked n'apparaissent pas dans numstat : pas de compteurs.
        assert_eq!(files[0].added, None);
        assert_eq!(files[0].deleted, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_staged_and_modified_appears_once() {
        // Porcelain `MM` : staged ET re-modifié dans le worktree → UNE entrée,
        // compteurs = somme des deux numstat (--cached : +1 ; worktree : +1).
        let dir = tmp_repo("mm");
        write_file(&dir, "a.txt", b"un\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "a.txt", b"un\ndeux\n");
        git(&dir, &["add", "a.txt"]);
        write_file(&dir, "a.txt", b"un\ndeux\ntrois\n");
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, FileStatus::Modified);
        assert_eq!(files[0].added, Some(2));
        assert_eq!(files[0].deleted, Some(0));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_binary_has_no_counts() {
        let dir = tmp_repo("binaire");
        write_file(&dir, "bin.dat", &[0u8, 1, 2, 3]);
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "bin.dat", &[0u8, 1, 2, 3, 4]);
        let files = changed_files(dir.to_str().unwrap());
        assert_eq!(files.len(), 1);
        assert_eq!(files[0].status, FileStatus::Modified);
        // numstat émet `-\t-` pour un binaire → None.
        assert_eq!(files[0].added, None);
        assert_eq!(files[0].deleted, None);
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_files_outside_repo_is_empty() {
        let dir = std::env::temp_dir().join(format!("terminials-cf-norepo-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        assert!(changed_files(dir.to_str().unwrap()).is_empty());
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn changed_file_serializes_camel_case_and_lowercase_status() {
        // Verrouille le contrat JSON consommé par le front (origPath, statuts minuscules).
        let f = ChangedFile {
            path: "a".into(),
            status: FileStatus::Renamed,
            orig_path: Some("b".into()),
            added: Some(1),
            deleted: None,
        };
        let v = serde_json::to_value(&f).unwrap();
        assert_eq!(v, serde_json::json!({"path": "a", "status": "renamed", "origPath": "b", "added": 1}));
    }
```

- [ ] **Step 4: lancer les tests — rouge attendu**
```bash
cd /home/user/dev/terminals && cargo test -p terminials-core
```
Attendu : `7 failed` — `changed_files_modified_worktree`, `changed_files_added_staged`, `changed_files_deleted_worktree`, `changed_files_renamed_staged`, `changed_files_untracked`, `changed_files_staged_and_modified_appears_once`, `changed_files_binary_has_no_counts` échouent sur ``assertion `left == right` failed / left: 0 / right: 1`` (le stub renvoie une liste vide). `changed_files_outside_repo_is_empty` et `changed_file_serializes_camel_case_and_lowercase_status` passent (trivialement / serde pur).

- [ ] **Step 5: implémentation**

Dans git.rs : remplacer la ligne d'import `use std::process::Command;` (ligne 3) par :
```rust
use std::collections::HashMap;
use std::process::Command;
```
Puis remplacer le stub `changed_files` par :
```rust
/// Exécute git dans `cwd` avec GIT_OPTIONAL_LOCKS=0 (jamais de prise de verrou d'index
/// par une commande de lecture). Retourne None si git échoue (hors repo, git absent).
fn git_out(cwd: &str, args: &[&str]) -> Option<Vec<u8>> {
    Command::new("git")
        .args(args)
        .current_dir(cwd)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| o.stdout)
}

/// Fichiers modifiés du repo (index + worktree fusionnés par `status --porcelain`),
/// enrichis des compteurs +/− de `diff --numstat` (worktree) et `diff --cached --numstat`
/// (staged), sommés par chemin. added/deleted None = binaire (ou untracked, absent des
/// numstat). Hors repo git → liste vide. Résultat trié par chemin.
pub fn changed_files(cwd: &str) -> Vec<ChangedFile> {
    let Some(raw) = git_out(cwd, &["status", "--porcelain=v1", "-z"]) else {
        return Vec::new();
    };
    // Format -z : `XY path\0` ; renommage/copie : `XY nouveau\0ancien\0` (ordre inversé
    // du format long, cf. doc git-status « the field order is reversed »).
    let fields: Vec<&[u8]> = raw.split(|&b| b == 0).collect();
    let mut files: Vec<ChangedFile> = Vec::new();
    let mut i = 0;
    while i < fields.len() {
        let f = fields[i];
        i += 1;
        if f.len() < 4 {
            continue; // champ final vide après le dernier NUL
        }
        let (x, y) = (f[0] as char, f[1] as char);
        let path = String::from_utf8_lossy(&f[3..]).into_owned();
        let orig_path = if matches!(x, 'R' | 'C') {
            let orig = fields.get(i).map(|o| String::from_utf8_lossy(o).into_owned());
            i += 1; // consomme le champ chemin d'origine
            orig
        } else {
            None
        };
        let status = match (x, y) {
            ('?', '?') => FileStatus::Untracked,
            ('R' | 'C', _) => FileStatus::Renamed,
            ('A', _) | (_, 'A') => FileStatus::Added,
            ('D', _) | (_, 'D') => FileStatus::Deleted,
            _ => FileStatus::Modified,
        };
        files.push(ChangedFile { path, status, orig_path, added: None, deleted: None });
    }

    // Compteurs +/− : worktree + staged, sommés. Un côté binaire (None) rend le total None.
    let mut stats: HashMap<String, (Option<u32>, Option<u32>)> = HashMap::new();
    for args in [&["diff", "--numstat", "-z"][..], &["diff", "--cached", "--numstat", "-z"][..]] {
        let Some(out) = git_out(cwd, args) else { continue };
        for (path, add, del) in parse_numstat_z(&out) {
            let e = stats.entry(path).or_insert((Some(0), Some(0)));
            e.0 = e.0.zip(add).map(|(a, b)| a + b);
            e.1 = e.1.zip(del).map(|(a, b)| a + b);
        }
    }
    for f in &mut files {
        if let Some((a, d)) = stats.get(&f.path) {
            f.added = *a;
            f.deleted = *d;
        }
    }
    files.sort_by(|a, b| a.path.cmp(&b.path));
    files
}

/// Parse `git diff --numstat -z` : `add\tdel\tpath\0` par entrée ; pour un renommage le
/// champ chemin est vide et suivi de `pré-image\0post-image\0` (stats affectées à la
/// post-image). `-` (binaire) → None.
fn parse_numstat_z(raw: &[u8]) -> Vec<(String, Option<u32>, Option<u32>)> {
    let fields: Vec<String> =
        raw.split(|&b| b == 0).map(|f| String::from_utf8_lossy(f).into_owned()).collect();
    let mut out = Vec::new();
    let mut i = 0;
    while i < fields.len() {
        let rec = &fields[i];
        if rec.is_empty() {
            i += 1;
            continue;
        }
        let mut parts = rec.splitn(3, '\t');
        let (Some(a), Some(d), Some(path)) = (parts.next(), parts.next(), parts.next()) else {
            i += 1;
            continue;
        };
        let add = a.parse::<u32>().ok();
        let del = d.parse::<u32>().ok();
        if path.is_empty() {
            if let Some(post) = fields.get(i + 2) {
                out.push((post.clone(), add, del));
            }
            i += 3;
        } else {
            out.push((path.to_string(), add, del));
            i += 1;
        }
    }
    out
}
```

- [ ] **Step 6: tests verts + build**
```bash
cd /home/user/dev/terminals && cargo test -p terminials-core && cargo build
```
Attendu : `test result: ok` (0 failed) sur terminials-core, build du workspace vert.

- [ ] **Step 7: Commit**
```bash
cd /home/user/dev/terminals && git add crates/core/Cargo.toml crates/core/src/git.rs && git commit -m "feat(core): changed_files — fichiers modifiés via git status --porcelain -z + numstat (spec §4)"
```

---

### Task R.2 : file_diff() dans crates/core/src/git.rs

**Item spec :** §4 (Données), §8 (`--no-index` exit 1 = normal, binaire « Binary files »)
**Files:**
- Modify: `/home/user/dev/terminals/crates/core/src/git.rs` (après `parse_numstat_z` ajouté par la tâche « changed_files() dans crates/core/src/git.rs » ; tests dans le mod `tests`)

**Interfaces:**
- Consumes: helpers de test `tmp_repo` / `git` / `write_file` et fonction `git_out`, produits par la tâche « changed_files() dans crates/core/src/git.rs »
- Produces: `pub fn file_diff(cwd: &str, path: &str, staged: bool) -> String` — consommé par la tâche « Commandes Tauri git_changed_files / git_file_diff / dir_exists »

- [ ] **Step 1: stub**

Dans git.rs, après `parse_numstat_z`, ajouter :
```rust
/// Diff unifié d'un fichier. Stub TDD : implémenté à l'étape suivante.
pub fn file_diff(cwd: &str, path: &str, staged: bool) -> String {
    let _ = (cwd, path, staged);
    String::new()
}
```

- [ ] **Step 2: tests (rouges)**

À la fin du mod `tests` de git.rs :
```rust
    // ---- file_diff ----

    #[test]
    fn file_diff_modified_contains_plus_minus() {
        let dir = tmp_repo("fd-mod");
        write_file(&dir, "a.txt", b"ligne1\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "a.txt", b"ligne2\n");
        let d = file_diff(dir.to_str().unwrap(), "a.txt", false);
        assert!(d.contains("-ligne1"), "diff: {d}");
        assert!(d.contains("+ligne2"), "diff: {d}");
        assert!(d.contains("@@"), "diff: {d}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_diff_untracked_via_no_index() {
        // Un untracked est invisible pour `git diff` : repli sur --no-index /dev/null,
        // dont le code de sortie 1 (différences trouvées) est normal.
        let dir = tmp_repo("fd-untracked");
        write_file(&dir, "nouveau.txt", b"contenu\n");
        let d = file_diff(dir.to_str().unwrap(), "nouveau.txt", false);
        assert!(d.contains("+contenu"), "diff: {d}");
        assert!(d.contains("/dev/null"), "diff: {d}");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_diff_staged_uses_cached() {
        let dir = tmp_repo("fd-staged");
        write_file(&dir, "a.txt", b"un\n");
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "a.txt", b"deux\n");
        git(&dir, &["add", "a.txt"]);
        let staged = file_diff(dir.to_str().unwrap(), "a.txt", true);
        assert!(staged.contains("+deux"), "diff staged: {staged}");
        // Worktree == index : diff non-staged vide, et PAS de repli --no-index
        // (le fichier est suivi).
        assert_eq!(file_diff(dir.to_str().unwrap(), "a.txt", false), "");
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn file_diff_binary_says_binary() {
        let dir = tmp_repo("fd-bin");
        write_file(&dir, "bin.dat", &[0u8, 1, 2, 3]);
        git(&dir, &["add", "."]);
        git(&dir, &["commit", "-q", "-m", "init"]);
        write_file(&dir, "bin.dat", &[0u8, 1, 2, 3, 4]);
        let d = file_diff(dir.to_str().unwrap(), "bin.dat", false);
        assert!(d.contains("Binary files"), "diff: {d}");
        let _ = std::fs::remove_dir_all(&dir);
    }
```

- [ ] **Step 3: lancer — rouge attendu**
```bash
cd /home/user/dev/terminals && cargo test -p terminials-core file_diff
```
Attendu : `4 failed` — `file_diff_modified_contains_plus_minus`, `file_diff_untracked_via_no_index`, `file_diff_binary_says_binary` échouent sur `assertion failed: d.contains(...)` ; `file_diff_staged_uses_cached` échoue sur l'assertion `staged.contains("+deux")` (le stub renvoie "").

- [ ] **Step 4: implémentation**

Remplacer le stub par :
```rust
/// Diff unifié d'un fichier : `git diff [--cached] --no-color -- <path>`.
/// Si le diff est vide et que le fichier n'est pas suivi, repli sur
/// `git diff --no-index /dev/null <path>` (untracked → diff « tout ajouté »).
/// `--no-index` sort avec le code 1 quand il y a des différences : normal, pas une erreur.
/// Fichier binaire : git émet « Binary files ... differ », renvoyé tel quel.
pub fn file_diff(cwd: &str, path: &str, staged: bool) -> String {
    let mut args: Vec<&str> = vec!["diff"];
    if staged {
        args.push("--cached");
    }
    args.extend_from_slice(&["--no-color", "--", path]);
    if let Some(out) = git_out(cwd, &args) {
        if !out.is_empty() {
            return String::from_utf8_lossy(&out).into_owned();
        }
    }
    if !staged && is_untracked(cwd, path) {
        // Pas de filtre sur le code de sortie : 1 = différences trouvées.
        if let Ok(o) = Command::new("git")
            .args(["diff", "--no-color", "--no-index", "--", "/dev/null", path])
            .current_dir(cwd)
            .env("GIT_OPTIONAL_LOCKS", "0")
            .output()
        {
            return String::from_utf8_lossy(&o.stdout).into_owned();
        }
    }
    String::new()
}

/// Vrai si `path` n'est pas dans l'index (fichier untracked).
fn is_untracked(cwd: &str, path: &str) -> bool {
    Command::new("git")
        .args(["ls-files", "--error-unmatch", "--", path])
        .current_dir(cwd)
        .env("GIT_OPTIONAL_LOCKS", "0")
        .output()
        .map(|o| !o.status.success())
        .unwrap_or(false)
}
```

- [ ] **Step 5: tests verts + build**
```bash
cd /home/user/dev/terminals && cargo test -p terminials-core && cargo build
```
Attendu : `test result: ok`, build vert.

- [ ] **Step 6: Commit**
```bash
cd /home/user/dev/terminals && git add crates/core/src/git.rs && git commit -m "feat(core): file_diff — diff unifié par fichier, untracked via --no-index (spec §4)"
```

---

### Task R.3 : Commandes Tauri git_changed_files / git_file_diff / dir_exists

**Item spec :** §4 (deux commandes Tauri, pattern `git_info`) + restauration §7 (`dir_exists` pour valider les cwd au boot)
**Files:**
- Modify: `/home/user/dev/terminals/src-tauri/src/lib.rs` (commandes après `git_info` lignes 85-88 ; `generate_handler` lignes 104-111)

**Interfaces:**
- Consumes: `changed_files` (tâche « changed_files() dans crates/core/src/git.rs ») et `file_diff` (tâche « file_diff() dans crates/core/src/git.rs »)
- Produces (pour les tâches front du diff viewer et de la restauration) :
  - `invoke<ChangedFile[]>("git_changed_files", { cwd })` → `[{ path, status: "modified"|"added"|"deleted"|"renamed"|"untracked", origPath?, added?, deleted? }]`
  - `invoke<string>("git_file_diff", { cwd, path, staged })`
  - `invoke<boolean>("dir_exists", { path })`

- [ ] **Step 1: ajouter les trois commandes**

Dans `/home/user/dev/terminals/src-tauri/src/lib.rs`, juste après la commande `git_info` (après la ligne 88), sur le même pattern :
```rust
#[tauri::command]
fn git_changed_files(cwd: String) -> Vec<terminials_core::git::ChangedFile> {
    terminials_core::git::changed_files(&cwd)
}

#[tauri::command]
fn git_file_diff(cwd: String, path: String, staged: bool) -> String {
    terminials_core::git::file_diff(&cwd, &path, staged)
}

/// Existence d'un dossier (validation des cwd restaurés au boot).
#[tauri::command]
fn dir_exists(path: String) -> bool {
    std::path::Path::new(&path).is_dir()
}
```

- [ ] **Step 2: enregistrer dans generate_handler**

Remplacer le bloc lignes 104-111 :
```rust
        .invoke_handler(tauri::generate_handler![
            spawn_pty,
            write_pty,
            resize_pty,
            close_pty,
            git_info,
            git_changed_files,
            git_file_diff,
            dir_exists,
            workspace_ports
        ])
```

- [ ] **Step 3: vérification build**
```bash
cd /home/user/dev/terminals && cargo build
```
Attendu : build vert, aucun warning nouveau.

- [ ] **Step 4: Commit**
```bash
cd /home/user/dev/terminals && git add src-tauri/src/lib.rs && git commit -m "feat(tauri): commandes git_changed_files / git_file_diff / dir_exists (spec §4)"
```

---

### Task R.4 : ptyId dans le payload agent-notification

**Item spec :** §5 (« Backend : ajouter "ptyId": id au payload agent-notification — le id est en scope à l'emit »)
**Files:**
- Modify: `/home/user/dev/terminals/src-tauri/src/lib.rs:41-51` (bloc emit dans le thread lecteur de `spawn_pty`)

**Interfaces:**
- Consumes: rien
- Produces (pour la tâche front d'anneau bleu par pane) : event Tauri `agent-notification` avec payload `{ workspaceId: string; ptyId: number; title: string; body: string }` — `ptyId` est le `PtyId` (u32) du PTY émetteur, le même id que celui retourné par `invoke("spawn_pty", …)` et stocké dans `panePtys` côté store ; le front l'inverse en paneId.

- [ ] **Step 1: enrichir le payload de l'emit**

Dans `/home/user/dev/terminals/src-tauri/src/lib.rs`, le bloc actuel (lignes 41-49) :
```rust
                    for notif in scanner.feed(chunk) {
                        let _ = app.emit(
                            "agent-notification",
                            serde_json::json!({
                                "workspaceId": workspace_id,
                                "title": notif.title,
                                "body": notif.body,
                            }),
                        );
```
devient (une ligne ajoutée ; `id` est `Copy`, déjà capturé par la closure pour l'event `pty-exit` ligne 59) :
```rust
                    for notif in scanner.feed(chunk) {
                        let _ = app.emit(
                            "agent-notification",
                            serde_json::json!({
                                "workspaceId": workspace_id,
                                "ptyId": id,
                                "title": notif.title,
                                "body": notif.body,
                            }),
                        );
```

- [ ] **Step 2: vérification build**
```bash
cd /home/user/dev/terminals && cargo build
```
Attendu : build vert. Vérification manuelle différée à la tâche front (interface `AgentNotification` de `src/lib/socketEvents.ts` à étendre avec `ptyId: number`, inversion de `panePtys` → `setNotification(wsId, n, paneId)`).

- [ ] **Step 3: Commit**
```bash
cd /home/user/dev/terminals && git add src-tauri/src/lib.rs && git commit -m "feat(tauri): ptyId du PTY émetteur dans le payload agent-notification (spec §5)"
```

---

### Task R.5 : Injection de TERMINIALS_WORKSPACE_ID / TERMINIALS_PTY_ID dans l'env du shell

**Item spec :** §7 (Routage socket : « spawn_pty injecte TERMINIALS_WORKSPACE_ID (et TERMINIALS_PTY_ID) dans l'env du shell »)
**Files:**
- Modify: `/home/user/dev/terminals/src-tauri/src/pty.rs:39-75` (signature + corps de `spawn_pty`), `:112-118` (test existant `spawn_write_resize_roundtrip`)
- Modify: `/home/user/dev/terminals/src-tauri/src/lib.rs:29-30` (site d'appel)
- Test: nouveau test dans le mod `tests` de pty.rs

**Interfaces:**
- Consumes: rien
- Produces (pour la tâche « CLI — workspaceId joint aux params notify/set-status/set-progress ») : tout shell lancé par l'app a `TERMINIALS_WORKSPACE_ID=<id du workspace>` et `TERMINIALS_PTY_ID=<PtyId u32>` dans son environnement. La commande Tauri `spawn_pty` garde la même signature côté front (le front passe déjà `workspaceId`, `src/lib/pty.ts:16-23` — aucun changement front).

Point vérifié dans pty.rs : l'id est allouable AVANT le spawn — `reg.next_id()` (ligne 69 actuelle) n'est qu'un compteur atomique sans effet de bord ; on le remonte avant le `CommandBuilder` pour pouvoir injecter `TERMINIALS_PTY_ID`. `CommandBuilder` de portable-pty expose `.env(key, value)`.

- [ ] **Step 1: test rouge (nouvelle signature → le rouge est d'abord une erreur de compilation)**

Dans le mod `tests` de `/home/user/dev/terminals/src-tauri/src/pty.rs`, remplacer le test `spawn_write_resize_roundtrip` (lignes 111-118) et ajouter le nouveau test :
```rust
    #[test]
    fn spawn_write_resize_roundtrip() {
        let reg = PtyRegistry::new();
        let (id, _reader) = spawn_pty(&reg, "/bin/sh", "/", "ws-test", 80, 24).unwrap();
        assert!(reg.handles.lock().unwrap().contains_key(&id));
        write_pty(&reg, id, b"echo hi\n").unwrap();
        resize_pty(&reg, id, 100, 30).unwrap();
    }

    #[test]
    fn spawn_injects_workspace_and_pty_ids_in_env() {
        use std::io::Read;
        let reg = PtyRegistry::new();
        let (id, mut reader) = spawn_pty(&reg, "/bin/sh", "/", "ws-test", 80, 24).unwrap();
        write_pty(&reg, id, b"echo ID=$TERMINIALS_WORKSPACE_ID:$TERMINIALS_PTY_ID; exit\n")
            .unwrap();
        // `exit` termine le shell → EOF : la boucle de lecture se termine toujours.
        let mut out = Vec::new();
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) | Err(_) => break,
                Ok(n) => out.extend_from_slice(&buf[..n]),
            }
        }
        let text = String::from_utf8_lossy(&out);
        // L'écho du terminal contient la forme littérale `$TERMINIALS_…` ; seule la
        // sortie d'echo contient la forme développée `ID=ws-test:<id>`.
        assert!(text.contains(&format!("ID=ws-test:{id}")), "sortie du shell: {text}");
    }
```
Lancer :
```bash
cd /home/user/dev/terminals && cargo test -p terminials --lib
```
Attendu : erreur de compilation `E0061: this function takes 5 arguments but 6 arguments were supplied` sur les deux appels `spawn_pty(&reg, "/bin/sh", "/", "ws-test", 80, 24)`.

- [ ] **Step 2: implémentation — spawn_pty prend workspace_id et réserve l'id avant le spawn**

Remplacer la fonction `spawn_pty` de pty.rs (lignes 37-75) par :
```rust
/// Ouvre un PTY, lance `shell` dans `cwd`, enregistre le handle et retourne (id, reader).
/// Le reader est destiné à un thread lecteur dédié (lectures bloquantes).
/// Injecte TERMINIALS_WORKSPACE_ID / TERMINIALS_PTY_ID dans l'env du shell : la CLI
/// `terminials` les relit pour router notify/set-status/set-progress vers le
/// workspace émetteur (spec §7).
pub fn spawn_pty(
    reg: &PtyRegistry,
    shell: &str,
    cwd: &str,
    workspace_id: &str,
    cols: u16,
    rows: u16,
) -> std::io::Result<(PtyId, Box<dyn std::io::Read + Send>)> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    // L'id est réservé AVANT le spawn (simple compteur atomique) pour pouvoir
    // l'injecter dans l'env du shell. En cas d'échec du spawn, l'id est juste perdu.
    let id = reg.next_id();
    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(cwd);
    cmd.env("TERMINIALS_WORKSPACE_ID", workspace_id);
    cmd.env("TERMINIALS_PTY_ID", id.to_string());
    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    drop(pair.slave);

    let pid = child.process_id();
    let reader = pair
        .master
        .try_clone_reader()
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    let writer = pair
        .master
        .take_writer()
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    reg.handles
        .lock()
        .unwrap()
        .insert(id, PtyHandle { writer, master: pair.master, pid, _child: child });
    Ok((id, reader))
}
```
Et dans `/home/user/dev/terminals/src-tauri/src/lib.rs`, le site d'appel (lignes 29-30) :
```rust
    let (id, mut reader) = pty::spawn_pty(reg.inner(), &shell, &cwd, &workspace_id, cols, rows)
        .map_err(|e| e.to_string())?;
```
(`&workspace_id` : l'emprunt se termine à la fin de l'instruction, la String est ensuite déplacée dans la closure du thread comme avant.)

- [ ] **Step 3: tests verts**
```bash
cd /home/user/dev/terminals && cargo test -p terminials --lib && cargo build
```
Attendu : `test result: ok` (dont `spawn_injects_workspace_and_pty_ids_in_env`), build vert.

- [ ] **Step 4: Commit**
```bash
cd /home/user/dev/terminals && git add src-tauri/src/pty.rs src-tauri/src/lib.rs && git commit -m "feat(tauri): TERMINIALS_WORKSPACE_ID et TERMINIALS_PTY_ID injectés dans l'env du shell (spec §7)"
```

---

### Task R.6 : CLI — workspaceId joint aux params notify/set-status/set-progress

**Item spec :** §7 (Routage socket : « la CLI les lit et les joint aux params »)
**Files:**
- Modify: `/home/user/dev/terminals/crates/cli/src/lib.rs` (helper + tests unitaires en fin de fichier, après la ligne 27)
- Modify: `/home/user/dev/terminals/crates/cli/src/main.rs:2` (import) et `:78-92` (construction des params)
- Test: `/home/user/dev/terminals/crates/cli/tests/roundtrip.rs` (test d'intégration binaire réel + faux serveur, sur le pattern existant)

**Interfaces:**
- Consumes: variable d'env `TERMINIALS_WORKSPACE_ID` posée par la tâche « Injection de TERMINIALS_WORKSPACE_ID / TERMINIALS_PTY_ID dans l'env du shell »
- Produces (pour la tâche front de routage socket) : les requêtes socket `notify` / `set-status` / `set-progress` portent `"workspaceId": "<id>"` dans `params` quand la CLI tourne dans un shell lancé par l'app (le serveur socket relaie `params` tel quel dans l'event `socket-command`, `src-tauri/src/socket.rs:65-75` — aucun changement backend). Le front ciblera `params.workspaceId ?? activeId`.
  ```rust
  pub fn with_workspace_id(params: serde_json::Value) -> serde_json::Value // crates/cli/src/lib.rs
  ```

Déviation assumée vs spec §7 (« la CLI les lit et les joint aux params ») : `TERMINIALS_PTY_ID` (injecté par R.5) n'est volontairement **pas** joint aux params — seul `workspaceId` l'est. Conséquence : l'anneau d'attention **par pane** ne couvre que les notifications OSC (payload `ptyId` de `agent-notification`, R.4) ; un `terminials notify` lancé dans un pane cible son workspace (rail sidebar) sans allumer l'anneau du pane émetteur. Extension possible plus tard sans changement backend socket : joindre `ptyId` dans `with_workspace_id` et router côté front via l'inversion `panePtys` (comme K.7 le fait pour `agent-notification`).

- [ ] **Step 1: stub + test unitaire rouge**

À la fin de `/home/user/dev/terminals/crates/cli/src/lib.rs` :
```rust
/// Ajoute `workspaceId` aux params si TERMINIALS_WORKSPACE_ID est présent dans l'env
/// (shell lancé par l'app terminials) : le front route alors la commande vers le
/// workspace émetteur au lieu du workspace actif.
pub fn with_workspace_id(params: serde_json::Value) -> serde_json::Value {
    params // stub TDD : implémenté à l'étape suivante
}

#[cfg(test)]
mod tests {
    use super::*;

    // Un seul test manipule TERMINIALS_WORKSPACE_ID (set + remove dans le même test) :
    // pas de course avec les autres tests du binaire, exécutés en parallèle.
    #[test]
    fn with_workspace_id_joins_env_var_when_present() {
        std::env::remove_var("TERMINIALS_WORKSPACE_ID");
        let p = with_workspace_id(serde_json::json!({"title": "t"}));
        assert_eq!(p.get("workspaceId"), None);

        std::env::set_var("TERMINIALS_WORKSPACE_ID", "ws-42");
        let p = with_workspace_id(serde_json::json!({"title": "t"}));
        assert_eq!(p.get("workspaceId").and_then(|v| v.as_str()), Some("ws-42"));
        std::env::remove_var("TERMINIALS_WORKSPACE_ID");
    }
}
```
Lancer :
```bash
cd /home/user/dev/terminals && cargo test -p terminials-cli --lib
```
Attendu : `1 failed` — `with_workspace_id_joins_env_var_when_present` échoue sur ``assertion `left == right` failed / left: None / right: Some("ws-42")``.

- [ ] **Step 2: implémentation du helper**

Remplacer le corps du stub :
```rust
pub fn with_workspace_id(mut params: serde_json::Value) -> serde_json::Value {
    if let Ok(ws) = std::env::var("TERMINIALS_WORKSPACE_ID") {
        if !ws.is_empty() {
            if let Some(obj) = params.as_object_mut() {
                obj.insert("workspaceId".to_string(), serde_json::Value::String(ws));
            }
        }
    }
    params
}
```
Relancer `cargo test -p terminials-cli --lib` → attendu : `test result: ok`.

- [ ] **Step 3: test d'intégration rouge (binaire réel, pattern du faux serveur existant)**

À la fin de `/home/user/dev/terminals/crates/cli/tests/roundtrip.rs` (les imports du fichier — `BufRead`, `BufReader`, `Write`, `UnixListener`, `thread` — couvrent déjà ce test) :
```rust
/// Lance le vrai binaire `terminials notify` avec TERMINIALS_WORKSPACE_ID dans son env
/// et XDG_RUNTIME_DIR pointé sur un dossier de test (socket_path() → <dir>/terminials.sock),
/// puis vérifie que la requête reçue par le faux serveur contient workspaceId.
#[test]
fn notify_binary_joins_workspace_id_from_env() {
    let dir = std::env::temp_dir().join(format!("terminials-xdg-{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let listener = UnixListener::bind(dir.join("terminials.sock")).unwrap();

    let handle = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        let mut w = stream;
        w.write_all(b"{\"status\":\"ok\"}\n").unwrap();
        line
    });

    let status = std::process::Command::new(env!("CARGO_BIN_EXE_terminials"))
        .args(["notify", "--title", "t", "--body", "b"])
        .env("XDG_RUNTIME_DIR", &dir)
        .env("TERMINIALS_WORKSPACE_ID", "ws-77")
        .status()
        .unwrap();
    assert!(status.success());

    let line = handle.join().unwrap();
    assert!(line.contains("\"workspaceId\":\"ws-77\""), "ligne reçue: {line}");
    let _ = std::fs::remove_dir_all(&dir);
}
```
Lancer :
```bash
cd /home/user/dev/terminals && cargo test -p terminials-cli --test roundtrip
```
Attendu : `1 failed` — `notify_binary_joins_workspace_id_from_env` échoue sur `assertion failed: line.contains(...)` (main.rs n'appelle pas encore le helper).

- [ ] **Step 4: câbler main.rs**

Dans `/home/user/dev/terminals/crates/cli/src/main.rs`, ligne 2 :
```rust
use terminials_cli::{send_request, socket_path, with_workspace_id};
```
et remplacer le match lignes 78-92 :
```rust
    let (method, params) = match cli.cmd {
        Cmd::Ping => ("ping", serde_json::Value::Null),
        Cmd::Notify { title, subtitle, body } => (
            "notify",
            with_workspace_id(
                serde_json::json!({"title": title, "subtitle": subtitle, "body": body}),
            ),
        ),
        Cmd::NewWorkspace { cwd } => ("new-workspace", serde_json::json!({"cwd": cwd})),
        Cmd::SetStatus { label, color } => (
            "set-status",
            with_workspace_id(serde_json::json!({"label": label, "color": color})),
        ),
        Cmd::SetProgress { value, label } => (
            "set-progress",
            with_workspace_id(serde_json::json!({"value": value, "label": label})),
        ),
        Cmd::Hooks { .. } => unreachable!("traité plus haut"),
    };
```
(`new-workspace` et `ping` ne sont volontairement pas enrichis : ils ne ciblent pas un workspace émetteur.)

- [ ] **Step 5: tests verts + build**
```bash
cd /home/user/dev/terminals && cargo test -p terminials-cli && cargo build
```
Attendu : `test result: ok` sur les tests lib ET les tests d'intégration (dont `notify_binary_joins_workspace_id_from_env`), build workspace vert.

- [ ] **Step 6: Commit**
```bash
cd /home/user/dev/terminals && git add crates/cli/src/lib.rs crates/cli/src/main.rs crates/cli/tests/roundtrip.rs && git commit -m "feat(cli): notify/set-status/set-progress joignent workspaceId depuis l'env (spec §7)"
```
### Task K.1 : Table de raccourcis (matchShortcut + paneNavTarget)

**Item spec :** §6 (table des raccourcis, matching par `e.code`, refus des Ctrl+lettre nus et de Ctrl+Shift+C/V)
**Files:**
- Create: `src/lib/shortcuts.ts`
- Test: `src/lib/shortcuts.test.ts`

**Interfaces:**
- Consumes: rien (module pur, zéro dépendance).
- Produces:
  - `export type ShortcutAction = { type: "open-folder" } | { type: "new-pane" } | { type: "close-pane" } | { type: "close-workspace" } | { type: "rename-workspace" } | { type: "toggle-diff" } | { type: "toggle-sidebar" } | { type: "prev-workspace" } | { type: "next-workspace" } | { type: "select-workspace"; index: number } | { type: "focus-pane"; dir: "left" | "right" | "up" | "down" }`
  - `export interface KeyLike { code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean; }`
  - `export function matchShortcut(e: KeyLike): ShortcutAction | null`
  - `export function paneNavTarget(count: number, current: number, dir: "left"|"right"|"up"|"down"): number | null`
  - Consommé par les tâches « Dispatch des raccourcis (refactor useShortcuts) » et « Couche terminal des raccourcis + focus xterm ».

- [ ] **Step 1: Écrire le test exhaustif (rouge)**

Créer `src/lib/shortcuts.test.ts` :

```ts
import { describe, it, expect } from "vitest";
import { matchShortcut, paneNavTarget, type KeyLike, type ShortcutAction } from "./shortcuts";

// Fabrique d'événements clavier minimaux (matching par code physique uniquement).
const k = (code: string, mods: Partial<Omit<KeyLike, "code">> = {}): KeyLike => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});
const cs = (code: string) => k(code, { ctrlKey: true, shiftKey: true }); // Ctrl+Shift
const c = (code: string) => k(code, { ctrlKey: true }); // Ctrl seul
const a = (code: string) => k(code, { altKey: true }); // Alt seul

describe("matchShortcut — couche Ctrl+Shift (convention gnome-terminal)", () => {
  const CASES: Array<[string, ShortcutAction]> = [
    ["KeyO", { type: "open-folder" }],
    ["KeyN", { type: "open-folder" }],
    ["KeyT", { type: "new-pane" }],
    ["KeyW", { type: "close-pane" }],
    ["KeyQ", { type: "close-workspace" }],
    ["KeyR", { type: "rename-workspace" }],
    ["KeyD", { type: "toggle-diff" }],
    ["KeyB", { type: "toggle-sidebar" }],
  ];
  it.each(CASES)("Ctrl+Shift+%s", (code, expected) => {
    expect(matchShortcut(cs(code))).toEqual(expected);
  });

  it("ne matche JAMAIS Ctrl+Shift+C/V (copier/coller du terminal)", () => {
    expect(matchShortcut(cs("KeyC"))).toBeNull();
    expect(matchShortcut(cs("KeyV"))).toBeNull();
  });

  it("touche non mappée → null", () => {
    expect(matchShortcut(cs("KeyX"))).toBeNull();
  });

  it("Alt en plus → null", () => {
    expect(matchShortcut(k("KeyT", { ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull();
  });
});

describe("matchShortcut — refus des Ctrl+lettre nus (réservés à readline)", () => {
  it.each(["KeyN", "KeyT", "KeyW", "KeyO", "KeyQ", "KeyR", "KeyD", "KeyB", "KeyC", "KeyV"])(
    "Ctrl+%s nu → null",
    (code) => {
      expect(matchShortcut(c(code))).toBeNull();
    },
  );

  it("lettre sans modificateur → null", () => {
    expect(matchShortcut(k("KeyW"))).toBeNull();
  });
});

describe("matchShortcut — navigation de workspaces", () => {
  it("Ctrl+PageUp / Ctrl+PageDown → prev/next", () => {
    expect(matchShortcut(c("PageUp"))).toEqual({ type: "prev-workspace" });
    expect(matchShortcut(c("PageDown"))).toEqual({ type: "next-workspace" });
  });

  it("Ctrl+Shift+PageUp/PageDown → null (hors table)", () => {
    expect(matchShortcut(cs("PageUp"))).toBeNull();
    expect(matchShortcut(cs("PageDown"))).toBeNull();
  });

  it("Ctrl+Digit1..9 (SANS Shift) → select-workspace 0-based", () => {
    expect(matchShortcut(c("Digit1"))).toEqual({ type: "select-workspace", index: 0 });
    expect(matchShortcut(c("Digit5"))).toEqual({ type: "select-workspace", index: 4 });
    expect(matchShortcut(c("Digit9"))).toEqual({ type: "select-workspace", index: 8 });
  });

  it("Ctrl+Digit0, Ctrl+Shift+Digit1, Digit1 nu → null", () => {
    expect(matchShortcut(c("Digit0"))).toBeNull();
    expect(matchShortcut(cs("Digit1"))).toBeNull();
    expect(matchShortcut(k("Digit1"))).toBeNull();
  });
});

describe("matchShortcut — focus directionnel Alt+flèches", () => {
  const DIRS: Array<[string, "left" | "right" | "up" | "down"]> = [
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
  ];
  it.each(DIRS)("Alt+%s", (code, dir) => {
    expect(matchShortcut(a(code))).toEqual({ type: "focus-pane", dir });
  });

  it("Ctrl+Alt+flèche et Alt+Shift+flèche → null", () => {
    expect(matchShortcut(k("ArrowLeft", { altKey: true, ctrlKey: true }))).toBeNull();
    expect(matchShortcut(k("ArrowLeft", { altKey: true, shiftKey: true }))).toBeNull();
  });

  it("flèche nue → null", () => {
    expect(matchShortcut(k("ArrowLeft"))).toBeNull();
  });
});

describe("paneNavTarget — géométries de la grille fixe (PaneTree gridStyle)", () => {
  it("1 pane [a] : aucune direction", () => {
    for (const dir of ["left", "right", "up", "down"] as const) {
      expect(paneNavTarget(1, 0, dir)).toBeNull();
    }
  });

  it("2 panes [a b]", () => {
    expect(paneNavTarget(2, 0, "right")).toBe(1);
    expect(paneNavTarget(2, 1, "left")).toBe(0);
    expect(paneNavTarget(2, 0, "left")).toBeNull();
    expect(paneNavTarget(2, 0, "up")).toBeNull();
    expect(paneNavTarget(2, 0, "down")).toBeNull();
    expect(paneNavTarget(2, 1, "right")).toBeNull();
  });

  it("3 panes [a b / c c] (c s'étend sur les 2 colonnes ; up depuis c → a)", () => {
    expect(paneNavTarget(3, 0, "right")).toBe(1);
    expect(paneNavTarget(3, 0, "down")).toBe(2);
    expect(paneNavTarget(3, 1, "left")).toBe(0);
    expect(paneNavTarget(3, 1, "down")).toBe(2);
    expect(paneNavTarget(3, 2, "up")).toBe(0);
    expect(paneNavTarget(3, 0, "left")).toBeNull();
    expect(paneNavTarget(3, 0, "up")).toBeNull();
    expect(paneNavTarget(3, 1, "right")).toBeNull();
    expect(paneNavTarget(3, 1, "up")).toBeNull();
    expect(paneNavTarget(3, 2, "down")).toBeNull();
    expect(paneNavTarget(3, 2, "left")).toBeNull();
    expect(paneNavTarget(3, 2, "right")).toBeNull();
  });

  it("4 panes [a b / c d]", () => {
    expect(paneNavTarget(4, 0, "right")).toBe(1);
    expect(paneNavTarget(4, 0, "down")).toBe(2);
    expect(paneNavTarget(4, 1, "left")).toBe(0);
    expect(paneNavTarget(4, 1, "down")).toBe(3);
    expect(paneNavTarget(4, 2, "right")).toBe(3);
    expect(paneNavTarget(4, 2, "up")).toBe(0);
    expect(paneNavTarget(4, 3, "left")).toBe(2);
    expect(paneNavTarget(4, 3, "up")).toBe(1);
    expect(paneNavTarget(4, 0, "left")).toBeNull();
    expect(paneNavTarget(4, 0, "up")).toBeNull();
    expect(paneNavTarget(4, 1, "right")).toBeNull();
    expect(paneNavTarget(4, 1, "up")).toBeNull();
    expect(paneNavTarget(4, 2, "left")).toBeNull();
    expect(paneNavTarget(4, 2, "down")).toBeNull();
    expect(paneNavTarget(4, 3, "right")).toBeNull();
    expect(paneNavTarget(4, 3, "down")).toBeNull();
  });

  it("count ou current hors géométrie → null", () => {
    expect(paneNavTarget(4, 4, "left")).toBeNull();
    expect(paneNavTarget(0, 0, "left")).toBeNull();
    expect(paneNavTarget(5, 0, "right")).toBeNull();
    expect(paneNavTarget(2, -1, "right")).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer le test — échec attendu**

```bash
cd /home/user/dev/terminals && npm test -- src/lib/shortcuts.test.ts
```

Échec attendu : `Error: Failed to resolve import "./shortcuts" from "src/lib/shortcuts.test.ts". Does the file exist?`

- [ ] **Step 3: Implémenter `src/lib/shortcuts.ts`**

```ts
/**
 * Table unique des raccourcis clavier, consommée par les deux couches :
 * la couche window (hook useShortcuts) et la couche terminal
 * (attachCustomKeyEventHandler de chaque xterm).
 * Matching par `e.code` UNIQUEMENT (position physique — indépendant d'AZERTY).
 */
export type ShortcutAction =
  | { type: "open-folder" }
  | { type: "new-pane" }
  | { type: "close-pane" }
  | { type: "close-workspace" }
  | { type: "rename-workspace" }
  | { type: "toggle-diff" }
  | { type: "toggle-sidebar" }
  | { type: "prev-workspace" }
  | { type: "next-workspace" }
  | { type: "select-workspace"; index: number } // 0-based, Digit1..Digit9
  | { type: "focus-pane"; dir: "left" | "right" | "up" | "down" };

/** Sous-ensemble de KeyboardEvent nécessaire au matching (testable sans DOM). */
export interface KeyLike {
  code: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

/** Couche Ctrl+Shift+lettre (convention gnome-terminal). KeyC et KeyV sont
 *  volontairement ABSENTS : Ctrl+Shift+C/V = copier/coller du terminal. */
const CTRL_SHIFT: Record<string, ShortcutAction> = {
  KeyO: { type: "open-folder" },
  KeyN: { type: "open-folder" }, // « nouveau workspace » = ouvrir un dossier
  KeyT: { type: "new-pane" },
  KeyW: { type: "close-pane" },
  KeyQ: { type: "close-workspace" },
  KeyR: { type: "rename-workspace" },
  KeyD: { type: "toggle-diff" },
  KeyB: { type: "toggle-sidebar" },
};

/**
 * Matche un événement clavier sur la table des raccourcis de l'app.
 * Retourne null si l'événement doit suivre son cours (shell/readline : ^W
 * kill-word, ^T transpose-chars… ne sont jamais interceptés).
 */
export function matchShortcut(e: KeyLike): ShortcutAction | null {
  const { code, ctrlKey, shiftKey, altKey } = e;

  // Alt+flèches : focus directionnel de pane (sans Ctrl ni Shift).
  if (altKey) {
    if (ctrlKey || shiftKey) return null;
    switch (code) {
      case "ArrowLeft":
        return { type: "focus-pane", dir: "left" };
      case "ArrowRight":
        return { type: "focus-pane", dir: "right" };
      case "ArrowUp":
        return { type: "focus-pane", dir: "up" };
      case "ArrowDown":
        return { type: "focus-pane", dir: "down" };
      default:
        return null;
    }
  }

  if (!ctrlKey) return null;

  if (shiftKey) return CTRL_SHIFT[code] ?? null;

  // Couche Ctrl seul (sans Shift) : navigation de workspaces uniquement,
  // jamais de Ctrl+lettre nu.
  if (code === "PageUp") return { type: "prev-workspace" };
  if (code === "PageDown") return { type: "next-workspace" };
  const digit = /^Digit([1-9])$/.exec(code);
  if (digit) return { type: "select-workspace", index: Number(digit[1]) - 1 };
  return null;
}

type Dir = "left" | "right" | "up" | "down";

/** Voisin directionnel dans la grille fixe de PaneTree :
 *  1:[a]  2:[a b]  3:[a b / c c]  4:[a b / c d].
 *  Pour 3 panes, « up » depuis c (qui s'étend sur les 2 colonnes) cible a. */
const NAV_TABLE: Record<number, Array<Partial<Record<Dir, number>>>> = {
  1: [{}],
  2: [{ right: 1 }, { left: 0 }],
  3: [{ right: 1, down: 2 }, { left: 0, down: 2 }, { up: 0 }],
  4: [
    { right: 1, down: 2 },
    { left: 0, down: 3 },
    { right: 3, up: 0 },
    { left: 2, up: 1 },
  ],
};

/** Index du pane cible, ou null au bord de la grille / hors géométrie. */
export function paneNavTarget(count: number, current: number, dir: Dir): number | null {
  return NAV_TABLE[count]?.[current]?.[dir] ?? null;
}
```

- [ ] **Step 4: Relancer le test — succès attendu**

```bash
cd /home/user/dev/terminals && npm test -- src/lib/shortcuts.test.ts
```

Attendu : tous les tests passent (`Test Files 1 passed`).

- [ ] **Step 5: Build vert**

```bash
cd /home/user/dev/terminals && npm run build
```

Attendu : `tsc` sans erreur puis `vite build` → `✓ built in …`.

- [ ] **Step 6: Commit**

```bash
cd /home/user/dev/terminals && git add src/lib/shortcuts.ts src/lib/shortcuts.test.ts && git commit -m "feat(front): table unique de raccourcis matchShortcut + paneNavTarget (TDD, spec §6)"
```

---

### Task K.2 : Registre de focus des panes (paneFocus)

**Item spec :** §6 (Alt+flèches : focus directionnel de pane — il faut pouvoir focus le xterm d'un pane sans couplage React)
**Files:**
- Create: `src/lib/paneFocus.ts`
- Test: `src/lib/paneFocus.test.ts`

**Interfaces:**
- Consumes: rien.
- Produces:
  - `export function registerPaneFocus(paneId: string, focus: () => void): void`
  - `export function unregisterPaneFocus(paneId: string): void`
  - `export function focusPane(paneId: string): void` (no-op si non enregistré)
  - Consommé par « Dispatch des raccourcis (refactor useShortcuts) » (appel de `focusPane`) et « Couche terminal des raccourcis + focus xterm » (register/unregister).

- [ ] **Step 1: Écrire le test (rouge)**

Créer `src/lib/paneFocus.test.ts` :

```ts
import { describe, it, expect, vi } from "vitest";
import { registerPaneFocus, unregisterPaneFocus, focusPane } from "./paneFocus";

describe("paneFocus — registre paneId → focus du xterm", () => {
  it("focusPane appelle le callback enregistré", () => {
    const cb = vi.fn();
    registerPaneFocus("p1", cb);
    focusPane("p1");
    expect(cb).toHaveBeenCalledTimes(1);
    unregisterPaneFocus("p1");
  });

  it("focusPane sur un pane inconnu est un no-op silencieux", () => {
    expect(() => focusPane("fantome")).not.toThrow();
  });

  it("unregisterPaneFocus désactive le focus", () => {
    const cb = vi.fn();
    registerPaneFocus("p2", cb);
    unregisterPaneFocus("p2");
    focusPane("p2");
    expect(cb).not.toHaveBeenCalled();
  });

  it("un second register remplace le callback (remontage du pane)", () => {
    const ancien = vi.fn();
    const nouveau = vi.fn();
    registerPaneFocus("p3", ancien);
    registerPaneFocus("p3", nouveau);
    focusPane("p3");
    expect(ancien).not.toHaveBeenCalled();
    expect(nouveau).toHaveBeenCalledTimes(1);
    unregisterPaneFocus("p3");
  });
});
```

- [ ] **Step 2: Lancer le test — échec attendu**

```bash
cd /home/user/dev/terminals && npm test -- src/lib/paneFocus.test.ts
```

Échec attendu : `Failed to resolve import "./paneFocus"`.

- [ ] **Step 3: Implémenter `src/lib/paneFocus.ts`**

```ts
/**
 * Registre paneId → callback de focus du xterm correspondant.
 * Chaque TerminalPane s'enregistre au montage (() => term.focus()) et se
 * désenregistre au démontage ; le dispatch des raccourcis (Alt+flèches)
 * peut ainsi focus un terminal sans passer par React.
 */
const registry = new Map<string, () => void>();

export function registerPaneFocus(paneId: string, focus: () => void): void {
  registry.set(paneId, focus);
}

export function unregisterPaneFocus(paneId: string): void {
  registry.delete(paneId);
}

/** Focus le terminal du pane (no-op si non enregistré). */
export function focusPane(paneId: string): void {
  registry.get(paneId)?.();
}
```

- [ ] **Step 4: Relancer le test — succès attendu**

```bash
cd /home/user/dev/terminals && npm test -- src/lib/paneFocus.test.ts
```

Attendu : 4 tests verts.

- [ ] **Step 5: Commit**

```bash
cd /home/user/dev/terminals && git add src/lib/paneFocus.ts src/lib/paneFocus.test.ts && git commit -m "feat(front): registre de focus des panes pour la navigation Alt+flèches (TDD)"
```

---

### Task K.3 : Keep-alive des workspaces

**Item spec :** §3 (item 0 — bloquant : changer de workspace ne doit plus tuer les PTYs)
**Files:**
- Modify: `src/App.tsx:82-135` (rendu : empiler tous les workspaces)
- Modify: `src/components/PaneTree.tsx:35, :82, :87, :106-108` (prop `visible` traversante)
- Modify: `src/components/TerminalPane.tsx` (restructuration de l'effet : garde fit 0×0 + refit à la révélation)

**Interfaces:**
- Consumes: rien de nouveau (état actuel du store).
- Produces: `PaneTree({ ws, visible }: { ws: Workspace; visible: boolean })` et `TerminalPane({ wsId, paneId, cwd, visible })` — la prop `visible` devra être préservée par toute tâche ultérieure touchant ces composants.

Contexte pour l'exécutant : aujourd'hui `App.tsx:87` ne monte que le `PaneTree` du workspace actif ; au switch, le démontage de `TerminalPane` exécute son cleanup (`TerminalPane.tsx:74-83`) qui appelle `closePty()` → les shells/agents des workspaces inactifs sont tués. Le fix : monter TOUS les workspaces en permanence, masquer les inactifs en `visibility:hidden` (jamais `display:none` : un conteneur 0×0 ferait `fit()` → `resize_pty(0)` → reflow shell cassé). Un élément `visibility:hidden` conserve ses dimensions, donc le ResizeObserver existant ne se déclenche pas au switch ; si la fenêtre est redimensionnée pendant qu'un workspace est caché, le RO se déclenche (l'élément garde une boîte de layout) mais par sécurité on refit aussi explicitement à la révélation, et on court-circuite tout fit/resize si les dimensions sont nulles.

- [ ] **Step 1: TerminalPane — garde 0×0 + refit à la révélation**

Remplacer intégralement `src/components/TerminalPane.tsx` par :

```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { spawnPty, closePty, type Pty } from "../lib/pty";
import { useWorkspaceStore } from "../store/workspace";

const SHELL = "/bin/bash";

export function TerminalPane({
  wsId,
  paneId,
  cwd,
  visible,
}: {
  wsId: string;
  paneId: string;
  cwd: string;
  visible: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Refit courant, rempli par l'effet principal ; rappelé à la révélation du workspace.
  const refitRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({ fontFamily: "monospace", fontSize: 13, cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // Renderer WebGL avec fallback DOM (xterm 6 : le renderer canvas a été supprimé).
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* fallback DOM implicite */
    }

    let pty: Pty | null = null;
    // Garde-fou keep-alive : ne jamais fit/resize un conteneur sans dimensions
    // (fit() à 0×0 → resize_pty(0) → reflow du shell cassé).
    const refit = () => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      fit.fit();
      pty?.resize(term.cols, term.rows);
    };
    refitRef.current = refit;
    refit();

    let disposed = false;
    let unlistenExit: UnlistenFn | null = null;
    let buffer: Uint8Array[] = [];
    let flushScheduled = false;
    const flush = () => {
      flushScheduled = false;
      for (const chunk of buffer) term.write(chunk);
      buffer = [];
    };

    spawnPty({ workspaceId: wsId, shell: SHELL, cwd, cols: term.cols, rows: term.rows }, (bytes) => {
      // Batch à ~1 frame pour éviter le layout thrashing.
      buffer.push(bytes);
      if (!flushScheduled) {
        flushScheduled = true;
        requestAnimationFrame(flush);
      }
    }).then((p) => {
      if (disposed) {
        closePty(p.id);
        return;
      }
      pty = p;
      useWorkspaceStore.getState().setPanePty(paneId, p.id);
      term.onData((d) => p.write(d));
      // Le shell est mort : on l'indique au lieu de laisser un terminal figé.
      listen<{ id: number }>("pty-exit", (e) => {
        if (e.payload.id === p.id) term.write("\r\n[Processus terminé]\r\n");
      }).then((un) => {
        if (disposed) un();
        else unlistenExit = un;
      });
    });

    const ro = new ResizeObserver(refit);
    ro.observe(host);

    return () => {
      disposed = true;
      refitRef.current = () => {};
      ro.disconnect();
      unlistenExit?.();
      if (pty) {
        closePty(pty.id);
        useWorkspaceStore.getState().removePanePty(paneId);
      }
      term.dispose();
    };
  }, [wsId, paneId, cwd]);

  // Révélation du workspace (visibility hidden → visible) : les dimensions ont pu
  // changer pendant la période masquée → refit explicite (le garde-fou dans refit
  // rend l'appel inoffensif si le conteneur n'est pas encore dimensionné).
  useEffect(() => {
    if (visible) refitRef.current();
  }, [visible]);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}
```

- [ ] **Step 2: PaneTree — prop `visible` traversante**

Dans `src/components/PaneTree.tsx`, remplacer la signature de `PaneCell` (ligne 35) :

```tsx
function PaneCell({ ws, paneId, area }: { ws: Workspace; paneId: string; area: string }) {
```

par :

```tsx
function PaneCell({
  ws,
  paneId,
  area,
  visible,
}: {
  ws: Workspace;
  paneId: string;
  area: string;
  visible: boolean;
}) {
```

remplacer l'appel à `TerminalPane` (ligne 82) :

```tsx
      <TerminalPane wsId={ws.id} paneId={paneId} cwd={ws.cwd} />
```

par :

```tsx
      <TerminalPane wsId={ws.id} paneId={paneId} cwd={ws.cwd} visible={visible} />
```

remplacer la signature de `PaneTree` (ligne 87) :

```tsx
export function PaneTree({ ws }: { ws: Workspace }) {
```

par :

```tsx
export function PaneTree({ ws, visible }: { ws: Workspace; visible: boolean }) {
```

et l'appel à `PaneCell` (lignes 106-108) :

```tsx
        {ws.panes.map((paneId, i) => (
          <PaneCell key={paneId} ws={ws} paneId={paneId} area={AREAS[i]} />
        ))}
```

par :

```tsx
        {ws.panes.map((paneId, i) => (
          <PaneCell key={paneId} ws={ws} paneId={paneId} area={AREAS[i]} visible={visible} />
        ))}
```

(Ne pas toucher au reste du fichier — le halo `boxShadow` de la ligne 94 est retiré par la tâche « attention bleue » d'un autre lot.)

- [ ] **Step 3: App.tsx — empiler tous les workspaces**

Dans `src/App.tsx`, remplacer le bloc de rendu (lignes 82-136, de `const active = …` à la fermeture du conteneur colonne) :

```tsx
  const active = workspaces.find((w) => w.id === activeId);
  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", background: "#1e1e1e" }}>
      <Sidebar />
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
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
      </div>
```

(Le bloc `{toast && …}` et la fermeture du composant restent inchangés.)

- [ ] **Step 4: Vérifier le build**

```bash
cd /home/user/dev/terminals && npm run build && npm test
```

Attendu : `tsc` sans erreur, `✓ built in …`, tests existants verts.

- [ ] **Step 5: Vérification manuelle (critère obligatoire, spec §3/§9)**

Lancer `npm run tauri dev`. Dans le workspace 1, lancer `top` (ou `sleep 300` puis `jobs`). Créer un second workspace (Ctrl+N à ce stade), y rester 10 s, redimensionner la fenêtre, revenir au workspace 1. Critères : `top` tourne toujours (le PTY a survécu), l'affichage se refit correctement aux nouvelles dimensions, aucun texte replié à une largeur fantôme.

- [ ] **Step 6: Commit**

```bash
cd /home/user/dev/terminals && git add src/App.tsx src/components/PaneTree.tsx src/components/TerminalPane.tsx && git commit -m "feat(front): keep-alive des workspaces — montage empilé visibility:hidden, garde fit 0x0, refit à la révélation (spec item 0)"
```

---

### Task K.4 : Open folder natif + état vide

**Item spec :** §6 (item 1 — dossiers réels), §8 (dialog annulé = no-op, spawnPty rejeté → message dans le xterm)
**Files:**
- Modify: `src-tauri/Cargo.toml:28` (dépendance `tauri-plugin-dialog`)
- Modify: `src-tauri/src/lib.rs:102` (init du plugin)
- Modify: `src-tauri/capabilities/default.json:6-9` (permission `dialog:default`)
- Modify: `package.json` (via `npm install @tauri-apps/plugin-dialog`)
- Create: `src/lib/openFolder.ts`
- Modify: `src/App.tsx:10, :17-20` + rendu (état vide)
- Modify: `src/components/Sidebar.tsx:5, :17, :166-170`
- Modify: `src/hooks/useShortcuts.ts:4, :17-19`
- Modify: `src/components/TerminalPane.tsx` (`.catch` sur `spawnPty`)

**Interfaces:**
- Consumes: `getLastFolder(): string | undefined` et `setLastFolder(path: string): void` exportés par `src/store/workspace.ts` (store étendu, package S — contrat verrouillé, déjà en place).
- Produces: `export async function openFolderDialog(): Promise<void>` — consommé par « Dispatch des raccourcis (refactor useShortcuts) » et par le bouton + de la sidebar.

- [ ] **Step 1: Dépendance Rust**

Dans `src-tauri/Cargo.toml`, après la ligne 28 (`tauri-plugin-opener = "2"`), ajouter :

```toml
tauri-plugin-dialog = "2"
```

- [ ] **Step 2: Init du plugin dans le Builder**

Dans `src-tauri/src/lib.rs`, la chaîne du Builder (ligne 101-102) est actuellement :

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
```

Ajouter la ligne du dialog juste après celle de l'opener :

```rust
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
```

- [ ] **Step 3: Permission de capability**

Remplacer intégralement `src-tauri/capabilities/default.json` par :

```json
{
  "$schema": "../gen/schemas/desktop-schema.json",
  "identifier": "default",
  "description": "Capability for the main window",
  "windows": ["main"],
  "permissions": [
    "core:default",
    "opener:default",
    "dialog:default"
  ]
}
```

Déviation assumée vs spec §6 (« permission minimale `open` ») : on garde `dialog:default` — c'est le contrat inter-packages verrouillé, et le set par défaut du plugin reste confiné aux dialogs natifs (open/save/message/ask/confirm), sans accès au système de fichiers ; resserrer sur `dialog:allow-open` reste possible en hygiène ultérieure sans autre changement.

- [ ] **Step 4: Dépendance npm + build Rust**

```bash
cd /home/user/dev/terminals && npm install @tauri-apps/plugin-dialog
cd /home/user/dev/terminals && cargo build
```

Attendu : `package.json` gagne `"@tauri-apps/plugin-dialog": "^2.x"` dans `dependencies` ; `cargo build` compile sans erreur (la validation ACL de tauri-build accepte `dialog:default` maintenant que la crate est présente).

- [ ] **Step 5: Créer `src/lib/openFolder.ts`**

```ts
import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore, getLastFolder, setLastFolder } from "../store/workspace";

// Guard module-level anti double-ouverture : un second Ctrl+Shift+O (ou
// double-clic sur le bouton +) pendant l'await ouvrirait deux dialogs GTK.
let dialogOpen = false;

/** Ouvre le sélecteur de dossier natif (GTK) et crée un workspace sur le
 *  dossier choisi. Annulation (null) → no-op strict. */
export async function openFolderDialog(): Promise<void> {
  if (dialogOpen) return;
  dialogOpen = true;
  try {
    const path = await open({ directory: true, defaultPath: getLastFolder() });
    if (typeof path !== "string") return; // annulation
    useWorkspaceStore.getState().addWorkspace(path);
    setLastFolder(path);
  } finally {
    dialogOpen = false;
  }
}
```

- [ ] **Step 6: App.tsx — purge du HOME, état vide**

Dans `src/App.tsx` :

1. Supprimer la ligne 10 : `const HOME = "/home/user";`
2. Supprimer le bloc d'auto-création (lignes 17-20) :

```tsx
  // Crée un workspace initial au premier montage.
  useEffect(() => {
    if (useWorkspaceStore.getState().workspaces.length === 0) addWorkspace(HOME);
  }, [addWorkspace]);
```

3. Ajouter l'import :

```tsx
import { openFolderDialog } from "./lib/openFolder";
```

4. Dans la déstructuration du store (ligne 14-15), retirer `addWorkspace` (devenu inutilisé — `noUnusedLocals` est actif) :

```tsx
  const { workspaces, activeId, addPane, showToast, toast, clearToast } = useWorkspaceStore();
```

5. Dans le conteneur colonne (structure issue de la tâche « Keep-alive des workspaces »), envelopper la top bar et la pile de grilles dans un ternaire d'état vide :

```tsx
      <div style={{ flex: 1, display: "flex", flexDirection: "column", minWidth: 0 }}>
        {workspaces.length === 0 ? (
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
              /* … top bar existante, inchangée … */
            )}
            <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
              {/* … pile des PaneTree existante, inchangée … */}
            </div>
          </>
        )}
      </div>
```

(Seule la structure change : la top bar et la pile gardent exactement leur contenu de la tâche « Keep-alive des workspaces ».)

- [ ] **Step 7: Sidebar — bouton + → dialog**

Dans `src/components/Sidebar.tsx` :

1. Supprimer la ligne 5 : `const HOME = "/home/user";`
2. Retirer `addWorkspace` de la déstructuration du store (ligne 17 sur master — la ligne exacte peut avoir bougé après le lot store/sidebar ; retirer simplement le symbole devenu inutilisé).
3. Ajouter l'import :

```tsx
import { openFolderDialog } from "../lib/openFolder";
```

4. Remplacer le bloc du bouton (lignes 166-170) :

```tsx
      <div style={{ marginTop: "auto", padding: "6px 10px" }}>
        <button className="icon-btn" onClick={() => addWorkspace(HOME)} title="Nouveau workspace">
          +
        </button>
      </div>
```

par :

```tsx
      <div style={{ marginTop: "auto", padding: "6px 10px" }}>
        <button
          className="icon-btn"
          onClick={() => void openFolderDialog()}
          title="Ouvrir un dossier (Ctrl+Shift+O)"
        >
          +
        </button>
      </div>
```

- [ ] **Step 8: useShortcuts — retrait du HOME (état transitoire)**

Dans `src/hooks/useShortcuts.ts`, supprimer la ligne 4 (`const HOME = …`), ajouter `import { openFolderDialog } from "../lib/openFolder";` et remplacer le corps du premier `if` (lignes 17-19) :

```ts
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        s.addWorkspace(HOME);
      }
```

par :

```ts
      if (e.ctrlKey && e.key === "n") {
        e.preventDefault();
        void openFolderDialog(); // transitoire : migré vers Ctrl+Shift dans le refactor du dispatch
      }
```

(Le reste du hook est intégralement remplacé par la tâche « Dispatch des raccourcis (refactor useShortcuts) ».)

- [ ] **Step 9: TerminalPane — `.catch` sur spawnPty**

Dans `src/components/TerminalPane.tsx`, sur la chaîne `spawnPty(...).then((p) => { … })`, ajouter après le `.then` :

```tsx
    }).catch((err) => {
      // Échec du spawn (shell introuvable, cwd disparu…) : visible dans le
      // terminal plutôt qu'un pane muet.
      term.write(`\r\n\x1b[31m[terminials] échec du lancement du shell : ${String(err)}\x1b[0m\r\n`);
    });
```

- [ ] **Step 10: Vérifier le build**

```bash
cd /home/user/dev/terminals && npm run build && npm test && cargo build
```

Attendu : tout vert. Vérification manuelle : `npm run tauri dev` démarre sur l'état vide ; le bouton « Open folder (Ctrl+Shift+O) » ouvre le dialog GTK ; annuler ne crée rien ; choisir un dossier crée le workspace dessus ; le + de la sidebar rouvre le dialog avec le dernier dossier comme point de départ.

- [ ] **Step 11: Commit**

```bash
cd /home/user/dev/terminals && git add src-tauri/Cargo.toml src-tauri/src/lib.rs src-tauri/capabilities/default.json package.json package-lock.json Cargo.lock src/lib/openFolder.ts src/App.tsx src/components/Sidebar.tsx src/hooks/useShortcuts.ts src/components/TerminalPane.tsx && git commit -m "feat(front): open folder natif (tauri-plugin-dialog), état vide, purge du HOME hardcodé, .catch spawnPty (spec item 1)"
```

---

### Task K.5 : Dispatch des raccourcis (refactor useShortcuts)

**Item spec :** §6 (items 5/6 — table complète, migration des Ctrl+N/T/W nus, mise à jour des `title=`)
**Files:**
- Create: `src/lib/shortcutDispatch.ts`
- Test: `src/lib/shortcutDispatch.test.ts`
- Modify: `src/hooks/useShortcuts.ts` (réécriture complète)
- Modify: `src/App.tsx` (`title="Nouveau terminal (Ctrl+T)"` → Ctrl+Shift+T)
- Modify: `src/components/PaneTree.tsx:62` (`title="Fermer le terminal (Ctrl+W)"` → Ctrl+Shift+W)

**Interfaces:**
- Consumes:
  - `matchShortcut(e: KeyLike): ShortcutAction | null` et `paneNavTarget(count, current, dir): number | null` (tâche « Table de raccourcis (matchShortcut + paneNavTarget) »)
  - `focusPane(paneId: string): void` (tâche « Registre de focus des panes (paneFocus) »)
  - `openFolderDialog(): Promise<void>` (tâche « Open folder natif + état vide »)
  - `closePty(id: number): void` (`src/lib/pty.ts:33`, existant)
  - Store étendu (package S, contrat verrouillé) : `closeWorkspace(wsId)`, `requestRename(wsId | null)`, `toggleDiff(wsId)`, `toggleSidebar()`, `renameRequestId`, `sidebarVisible`, `panePtys`
- Produces: `export function dispatchShortcut(action: ShortcutAction): void` — point UNIQUE de dispatch, consommé par `useShortcuts` (couche window). La couche terminal (tâche « Couche terminal des raccourcis + focus xterm ») ne dispatche PAS : elle retourne `false` à xterm et laisse le keydown buller jusqu'au listener window.

- [ ] **Step 1: Écrire le test du dispatch (rouge)**

Créer `src/lib/shortcutDispatch.test.ts` :

```ts
import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks des modules à effets de bord (IPC Tauri, dialog natif GTK).
vi.mock("./pty", () => ({ closePty: vi.fn() }));
vi.mock("./openFolder", () => ({ openFolderDialog: vi.fn(() => Promise.resolve()) }));

import { dispatchShortcut } from "./shortcutDispatch";
import { closePty } from "./pty";
import { openFolderDialog } from "./openFolder";
import { registerPaneFocus, unregisterPaneFocus } from "./paneFocus";
import { useWorkspaceStore, MAX_PANES } from "../store/workspace";

const store = () => useWorkspaceStore.getState();
const ws = (id: string) => store().workspaces.find((w) => w.id === id)!;

describe("dispatchShortcut", () => {
  beforeEach(() => {
    store().reset();
    vi.clearAllMocks();
  });

  it("open-folder ouvre le dialog natif", () => {
    dispatchShortcut({ type: "open-folder" });
    expect(openFolderDialog).toHaveBeenCalledTimes(1);
  });

  it("new-pane ajoute un pane au workspace actif, toast à MAX_PANES", () => {
    const id = store().addWorkspace("/a");
    dispatchShortcut({ type: "new-pane" });
    expect(ws(id).panes).toHaveLength(2);
    store().addPane(id);
    store().addPane(id); // 4 = MAX_PANES
    dispatchShortcut({ type: "new-pane" });
    expect(ws(id).panes).toHaveLength(MAX_PANES);
    expect(store().toast).toBe(`max ${MAX_PANES} terminaux`);
  });

  it("close-pane ferme le pane actif", () => {
    const id = store().addWorkspace("/a");
    store().addPane(id); // actif = panes[1]
    dispatchShortcut({ type: "close-pane" });
    expect(ws(id).panes).toHaveLength(1);
  });

  it("close-workspace ferme les PTYs de tous les panes puis retire le workspace", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b"); // actif = b
    store().addPane(b);
    const [p1, p2] = ws(b).panes;
    store().setPanePty(p1, 11);
    store().setPanePty(p2, 22);
    dispatchShortcut({ type: "close-workspace" });
    expect(closePty).toHaveBeenCalledWith(11);
    expect(closePty).toHaveBeenCalledWith(22);
    expect(store().workspaces.map((w) => w.id)).toEqual([a]);
    expect(store().activeId).toBe(a);
  });

  it("rename-workspace demande l'édition inline du workspace actif", () => {
    const id = store().addWorkspace("/a");
    dispatchShortcut({ type: "rename-workspace" });
    expect(store().renameRequestId).toBe(id);
  });

  it("toggle-diff bascule diffOpen du workspace actif", () => {
    const id = store().addWorkspace("/a");
    dispatchShortcut({ type: "toggle-diff" });
    expect(ws(id).diffOpen).toBe(true);
    dispatchShortcut({ type: "toggle-diff" });
    expect(ws(id).diffOpen).toBe(false);
  });

  it("toggle-sidebar bascule sidebarVisible", () => {
    expect(store().sidebarVisible).toBe(true);
    dispatchShortcut({ type: "toggle-sidebar" });
    expect(store().sidebarVisible).toBe(false);
  });

  it("prev/next-workspace suivent l'ordre du tableau avec wrap", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b");
    const c = store().addWorkspace("/c"); // actif = c
    dispatchShortcut({ type: "next-workspace" });
    expect(store().activeId).toBe(a); // wrap avant
    dispatchShortcut({ type: "prev-workspace" });
    expect(store().activeId).toBe(c); // wrap arrière
    dispatchShortcut({ type: "prev-workspace" });
    expect(store().activeId).toBe(b);
  });

  it("select-workspace cible l'index du tableau, hors bornes = no-op", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b"); // actif = b
    dispatchShortcut({ type: "select-workspace", index: 0 });
    expect(store().activeId).toBe(a);
    dispatchShortcut({ type: "select-workspace", index: 8 }); // pas de 9e workspace
    expect(store().activeId).toBe(a);
    dispatchShortcut({ type: "select-workspace", index: 1 });
    expect(store().activeId).toBe(b);
  });

  it("focus-pane déplace le pane actif et focus le terminal cible", () => {
    const id = store().addWorkspace("/a");
    store().addPane(id); // [p0, p1]
    const [p0, p1] = ws(id).panes;
    store().setActivePane(id, p0);
    const cb = vi.fn();
    registerPaneFocus(p1, cb);
    dispatchShortcut({ type: "focus-pane", dir: "right" });
    expect(ws(id).activePaneId).toBe(p1);
    expect(cb).toHaveBeenCalledTimes(1);
    unregisterPaneFocus(p1);
  });

  it("focus-pane au bord de la grille est un no-op", () => {
    const id = store().addWorkspace("/a");
    store().addPane(id);
    const [p0] = ws(id).panes;
    store().setActivePane(id, p0);
    dispatchShortcut({ type: "focus-pane", dir: "left" }); // bord gauche
    expect(ws(id).activePaneId).toBe(p0);
  });

  it("sans workspace actif, les actions de workspace sont des no-ops", () => {
    dispatchShortcut({ type: "new-pane" });
    dispatchShortcut({ type: "close-workspace" });
    dispatchShortcut({ type: "rename-workspace" });
    dispatchShortcut({ type: "next-workspace" });
    expect(store().workspaces).toHaveLength(0);
    expect(store().toast).toBeNull();
  });
});
```

- [ ] **Step 2: Lancer le test — échec attendu**

```bash
cd /home/user/dev/terminals && npm test -- src/lib/shortcutDispatch.test.ts
```

Échec attendu : `Failed to resolve import "./shortcutDispatch"`.

- [ ] **Step 3: Implémenter `src/lib/shortcutDispatch.ts`**

```ts
import { closePty } from "./pty";
import { openFolderDialog } from "./openFolder";
import { focusPane } from "./paneFocus";
import { paneNavTarget, type ShortcutAction } from "./shortcuts";
import { useWorkspaceStore, MAX_PANES } from "../store/workspace";

/**
 * Exécute une action de raccourci sur le store. Point UNIQUE de dispatch :
 * seule la couche window (useShortcuts) l'appelle. La couche terminal
 * (attachCustomKeyEventHandler) se contente de retourner false à xterm ;
 * le keydown bulle ensuite jusqu'au listener window — dispatcher aux deux
 * niveaux exécuterait chaque action deux fois.
 */
export function dispatchShortcut(action: ShortcutAction): void {
  const s = useWorkspaceStore.getState();
  const active = s.workspaces.find((w) => w.id === s.activeId);
  switch (action.type) {
    case "open-folder":
      void openFolderDialog();
      return;
    case "new-pane":
      if (active && !s.addPane(active.id)) s.showToast(`max ${MAX_PANES} terminaux`);
      return;
    case "close-pane":
      // Le PTY est fermé par le cleanup du TerminalPane démonté.
      if (active?.activePaneId) s.closePane(active.id, active.activePaneId);
      return;
    case "close-workspace": {
      if (!active) return;
      // Ferme explicitement les PTYs AVANT de retirer le workspace :
      // closeWorkspace purge panePtys, on ne dépend pas de l'ordre de
      // démontage React pour tuer les shells.
      for (const paneId of active.panes) {
        const ptyId = s.panePtys[paneId];
        if (ptyId !== undefined) closePty(ptyId);
      }
      s.closeWorkspace(active.id);
      return;
    }
    case "rename-workspace":
      if (active) s.requestRename(active.id);
      return;
    case "toggle-diff":
      // Uniquement si le workspace a un dossier : le diff s'appuie sur git dans cwd.
      if (active?.cwd) s.toggleDiff(active.id);
      return;
    case "toggle-sidebar":
      s.toggleSidebar();
      return;
    case "prev-workspace":
    case "next-workspace": {
      if (s.workspaces.length === 0) return;
      const idx = s.workspaces.findIndex((w) => w.id === s.activeId);
      const delta = action.type === "next-workspace" ? 1 : -1;
      const next =
        idx === -1
          ? s.workspaces[0]
          : s.workspaces[(idx + delta + s.workspaces.length) % s.workspaces.length];
      s.setActive(next.id);
      return;
    }
    case "select-workspace": {
      const target = s.workspaces[action.index];
      if (target) s.setActive(target.id);
      return;
    }
    case "focus-pane": {
      if (!active || !active.activePaneId) return;
      const current = active.panes.indexOf(active.activePaneId);
      const target = paneNavTarget(active.panes.length, current, action.dir);
      if (target === null) return;
      const targetPaneId = active.panes[target];
      s.setActivePane(active.id, targetPaneId);
      focusPane(targetPaneId);
      return;
    }
  }
}
```

- [ ] **Step 4: Relancer le test — succès attendu**

```bash
cd /home/user/dev/terminals && npm test -- src/lib/shortcutDispatch.test.ts
```

Attendu : 12 tests verts.

- [ ] **Step 5: Réécrire `src/hooks/useShortcuts.ts` (suppression des Ctrl+N/T/W nus)**

Remplacer intégralement le fichier par :

```ts
import { useEffect } from "react";
import { matchShortcut } from "../lib/shortcuts";
import { dispatchShortcut } from "../lib/shortcutDispatch";

/**
 * Couche window des raccourcis : matche sur la table unique (lib/shortcuts)
 * et fait l'UNIQUE dispatch de l'app. Les keydown nés dans un xterm bullent
 * jusqu'ici (la couche terminal retourne false à xterm sans stopPropagation).
 * Plus aucun Ctrl+lettre nu : ^W kill-word, ^T transpose, ^N next-history
 * repartent au shell.
 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const action = matchShortcut(e);
      if (!action) return;
      // preventDefault systématique : WebKitGTK mappe Alt+←/→ sur l'historique
      // du webview, et Ctrl+PageUp/Down peut scroller le document.
      e.preventDefault();
      dispatchShortcut(action);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
```

- [ ] **Step 6: Mettre à jour les `title=` des boutons**

Dans `src/App.tsx` (top bar), remplacer :

```tsx
                title="Nouveau terminal (Ctrl+T)"
```

par :

```tsx
                title="Nouveau terminal (Ctrl+Shift+T)"
```

Dans `src/components/PaneTree.tsx:62`, remplacer :

```tsx
          title="Fermer le terminal (Ctrl+W)"
```

par :

```tsx
          title="Fermer le terminal (Ctrl+Shift+W)"
```

- [ ] **Step 7: Build + tests complets**

```bash
cd /home/user/dev/terminals && npm run build && npm test
```

Attendu : tout vert (le hook ne référence plus `useWorkspaceStore` ni `MAX_PANES` ni `openFolderDialog` directement — imports nettoyés, `noUnusedLocals` passe).

- [ ] **Step 8: Commit**

```bash
cd /home/user/dev/terminals && git add src/lib/shortcutDispatch.ts src/lib/shortcutDispatch.test.ts src/hooks/useShortcuts.ts src/App.tsx src/components/PaneTree.tsx && git commit -m "feat(front): dispatch complet des raccourcis Ctrl+Shift, migration des Ctrl+N/T/W nus (spec §6, TDD)"
```

---

### Task K.6 : Couche terminal des raccourcis + focus xterm

**Item spec :** §6 (« Implémentation en double couche obligatoire » : `attachCustomKeyEventHandler` sur chaque Terminal + listener window)
**Files:**
- Modify: `src/components/TerminalPane.tsx` (handler custom xterm + register/unregister du focus)

**Interfaces:**
- Consumes:
  - `matchShortcut` (tâche « Table de raccourcis (matchShortcut + paneNavTarget) ») — `KeyboardEvent` satisfait structurellement `KeyLike`.
  - `registerPaneFocus` / `unregisterPaneFocus` (tâche « Registre de focus des panes (paneFocus) »).
- Produces: rien de nouveau (comportement).

Contexte API xterm (vérifié dans `node_modules/@xterm/xterm/typings/xterm.d.ts:1072` et le source v6) : `attachCustomKeyEventHandler(handler: (event: KeyboardEvent) => boolean): void`. Le handler est appelé pour keydown/keypress/keyup AVANT le traitement xterm ; retourner `false` fait sortir xterm immédiatement (rien n'est transmis au PTY) SANS `preventDefault` ni `stopPropagation` — l'événement continue donc de buller jusqu'au listener window de `useShortcuts`, qui fait l'unique dispatch. C'est pour cela qu'on ne dispatche PAS ici (sinon double exécution).

- [ ] **Step 1: Brancher la couche terminal**

Dans `src/components/TerminalPane.tsx` :

1. Ajouter les imports :

```tsx
import { matchShortcut } from "../lib/shortcuts";
import { registerPaneFocus, unregisterPaneFocus } from "../lib/paneFocus";
```

2. Dans l'effet principal, juste après `term.open(host);`, ajouter :

```tsx
    // Couche terminal des raccourcis : return false = xterm n'avale pas la
    // combinaison (rien ne part au PTY). Pas de dispatch ici : le keydown
    // bulle jusqu'au listener window (useShortcuts) qui fait l'unique
    // preventDefault + dispatch. Ctrl+W nu ne matche pas → part au shell
    // (kill-word readline préservé). Ctrl+Shift+C/V ne matchent jamais.
    term.attachCustomKeyEventHandler((e) => matchShortcut(e) === null);

    // Focus programmatique (Alt+flèches via focusPane) : ce pane expose son focus.
    registerPaneFocus(paneId, () => term.focus());
```

3. Dans le cleanup de l'effet (le `return () => { … }`), ajouter la ligne `unregisterPaneFocus(paneId);` juste avant `term.dispose();` :

```tsx
      unregisterPaneFocus(paneId);
      term.dispose();
```

- [ ] **Step 2: Vérifier le build**

```bash
cd /home/user/dev/terminals && npm run build && npm test
```

Attendu : tout vert.

- [ ] **Step 3: Vérification manuelle (critères obligatoires, spec §9)**

Lancer `npm run tauri dev`, focus dans un terminal bash :
- Taper `echo un deux` puis **Ctrl+W** : readline efface « deux » (kill-word) — le raccourci n'est PAS intercepté.
- **Ctrl+Shift+W** : le pane actif se ferme (action app, une seule fois — pas de double fermeture).
- Avec 2 panes, **Alt+→ / Alt+←** : la bordure active change ET le curseur clignote dans le pane cible (le focus xterm a suivi) ; le webview ne navigue pas dans l'historique.
- Sélectionner du texte puis **Ctrl+Shift+C**, **Ctrl+Shift+V** : copier/coller normal du terminal.
- Sur AZERTY, avec 2 workspaces : **Ctrl+1** / **Ctrl+2** (rangée des chiffres, sans Shift) sélectionnent le 1er / 2e workspace — le matching `e.code` `Digit1..9` ignore le caractère produit (`&`, `é`, …).

- [ ] **Step 4: Commit**

```bash
cd /home/user/dev/terminals && git add src/components/TerminalPane.tsx && git commit -m "feat(front): couche terminal des raccourcis (attachCustomKeyEventHandler) + focus programmatique des panes (spec §6)"
```

---

### Task K.7 : Restauration au boot, pollers durcis, routage socket

**Item spec :** §7 (item 7 — restauration ; compléments — routage socket, pollers parallélisés + garde in-flight), §8 (cwd disparu → skip + toast)
**Files:**
- Modify: `src/App.tsx` (effet de restauration + état `booting` + réécriture des deux pollers, lignes 37-55 et 61-80 sur master)
- Modify: `src/lib/socketEvents.ts` (réécriture complète : routage `workspaceId`, inversion `panePtys`)

**Interfaces:**
- Consumes:
  - Store étendu (package S, contrat verrouillé) : `loadSavedWorkspaces(): SavedWorkspace[]`, `restoreWorkspaces(entries: SavedWorkspace[]): void`, `setNotification(wsId: string, n: Notification, paneId?: string): void`
  - Commandes Rust (package R, contrat verrouillé) : `invoke<boolean>("dir_exists", { path })` ; event `agent-notification` enrichi de `ptyId` ; la CLI joint `"workspaceId"` aux `params` de `notify`/`set-status`/`set-progress` quand `TERMINIALS_WORKSPACE_ID` est présent.
- Produces: rien de nouveau (comportements).

- [ ] **Step 1: Réécrire `src/lib/socketEvents.ts`**

Remplacer intégralement le fichier par :

```ts
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../store/workspace";

interface SocketCommand {
  method: string;
  params: Record<string, any>;
}
interface AgentNotification {
  workspaceId: string;
  /** id du PTY émetteur ; absent si la notification ne vient pas d'un pane. */
  ptyId?: number;
  title: string;
  body: string;
}

/** Écoute les events émis par le backend (socket-command, agent-notification) → store. */
export function registerSocketEvents(): Promise<UnlistenFn> {
  const store = () => useWorkspaceStore.getState();

  const p1 = listen<SocketCommand>("socket-command", (e) => {
    const s = store();
    const { method, params } = e.payload;
    // Routage : la CLI joint workspaceId (env TERMINIALS_WORKSPACE_ID injectée
    // dans le shell du pane) ; fallback sur le workspace actif (CLI hors pane).
    // Un workspaceId qui ne résout plus (workspace fermé) → commande ignorée.
    const targetId = (params.workspaceId as string | undefined) ?? s.activeId;
    const target = s.workspaces.find((w) => w.id === targetId);
    switch (method) {
      case "new-workspace":
        s.addWorkspace(params.cwd ?? "/home");
        break;
      case "notify":
        if (target) s.setNotification(target.id, { title: params.title, body: params.body });
        break;
      case "set-status":
        if (target) s.setStatus(target.id, { label: params.label, color: params.color });
        break;
      case "set-progress":
        if (target) s.setProgress(target.id, { value: params.value, label: params.label });
        break;
      default:
        break;
    }
  });

  const p2 = listen<AgentNotification>("agent-notification", (e) => {
    const s = store();
    const { workspaceId, ptyId, title, body } = e.payload;
    // Inversion panePtys (ptyId → paneId) : cible le pane émetteur (anneau bleu).
    // Pane introuvable (fermé entre-temps, ptyId absent) → fallback unread
    // au niveau workspace (setNotification sans paneId).
    const entry =
      ptyId === undefined
        ? undefined
        : Object.entries(s.panePtys).find(([, id]) => id === ptyId);
    s.setNotification(workspaceId, { title, body }, entry?.[0]);
  });

  return Promise.all([p1, p2]).then((fns) => () => fns.forEach((f) => f()));
}
```

- [ ] **Step 2: App.tsx — restauration au montage**

1. Passer l'import React à `import { useEffect, useState } from "react";` et compléter l'import du store :

```tsx
import { useWorkspaceStore, MAX_PANES, loadSavedWorkspaces } from "./store/workspace";
```

2. Dans le composant `App`, ajouter en tête :

```tsx
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
```

3. Dans le rendu, remplacer la condition d'état vide `{workspaces.length === 0 ? (` (posée par la tâche « Open folder natif + état vide ») par :

```tsx
        {booting ? null : workspaces.length === 0 ? (
```

(le reste du ternaire est inchangé).

- [ ] **Step 3: App.tsx — pollers parallélisés + garde in-flight**

Remplacer le poller git (lignes 37-55 sur master) par :

```tsx
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
```

Remplacer le poller ports (lignes 61-80 sur master) par :

```tsx
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
```

- [ ] **Step 4: Build + tests**

```bash
cd /home/user/dev/terminals && npm run build && npm test
```

Attendu : `tsc` sans erreur, `✓ built in …`, tous les tests verts.

- [ ] **Step 5: Vérification manuelle**

`npm run tauri dev` : ouvrir 2 dossiers, renommer l'un des workspaces, quitter, relancer → les 2 workspaces reviennent (nom, couleur, nombre de panes ; actif = premier). Quitter, `mv` un des deux dossiers, relancer → toast « dossier introuvable… », seul l'autre workspace revient. Dans un pane, `terminials notify --title test --body corps` pendant qu'on regarde un AUTRE workspace → la notification atterrit sur le workspace émetteur (rail sidebar), pas sur l'actif.

- [ ] **Step 6: Commit**

```bash
cd /home/user/dev/terminals && git add src/App.tsx src/lib/socketEvents.ts && git commit -m "feat(front): restauration des workspaces au boot, pollers parallèles avec garde in-flight, routage socket par workspace émetteur (spec item 7 + compléments)"
```

---

### Task K.8 : Consommer sidebarVisible + renameRequestId (Ctrl+Shift+B / Ctrl+Shift+R)

**Item spec :** §6 (Ctrl+Shift+B toggle sidebar — effet visuel au rendu ; Ctrl+Shift+R — ouverture de l'édition inline du nom)
**Files:**
- Modify: `src/App.tsx` (rendu conditionnel `{sidebarVisible && <Sidebar />}`)
- Modify: `src/components/Sidebar.tsx` (effet consommant `renameRequestId` → édition inline)

**Interfaces:**
- Consumes (contrat verrouillé, package S « Store — diffOpen, sidebarVisible, renameRequestId ») :
  - `sidebarVisible: boolean` et `renameRequestId: string | null` de `WorkspaceState`
  - `requestRename: (wsId: string | null) => void` du store
  - State local existant de la Sidebar : `editingId` / `draft` / `paletteFor` (le même chemin que le double-clic sur le nom)
- Produces: rien de nouveau (comportement) — Ctrl+Shift+B et Ctrl+Shift+R, déjà dispatchés par K.5, deviennent effectifs à l'écran.

Contexte pour l'exécutant : K.5 bascule `sidebarVisible` (`toggleSidebar`) et pose `renameRequestId` (`requestRename(active.id)`), mais rien ne les consomme encore : `App.tsx` rend `<Sidebar />` inconditionnellement, et l'édition inline de la Sidebar ne s'ouvre qu'au double-clic (state local `editingId`). Cette tâche câble les deux. Démonter la Sidebar est SANS risque PTY (aucun `TerminalPane` dedans — la contrainte keep-alive ne concerne que la grille de panes) ; la perte de son state local au démontage (`editingId`, `paletteFor`…) est sans conséquence.

- [ ] **Step 1: App.tsx — rendu conditionnel de la Sidebar**

Dans `src/App.tsx` (état post-K.4/K.7 : la déstructuration du store est `const { workspaces, activeId, addPane, showToast, toast, clearToast } = useWorkspaceStore();`), ajouter juste après cette déstructuration un sélecteur Zustand dédié :

```tsx
  // Ctrl+Shift+B : consommation au rendu du booléen basculé par toggleSidebar (K.5).
  const sidebarVisible = useWorkspaceStore((s) => s.sidebarVisible);
```

puis, dans le rendu, remplacer le premier enfant du conteneur racine :

```tsx
      <Sidebar />
```

par :

```tsx
      {/* Ctrl+Shift+B : démonter la Sidebar est sans risque PTY (aucun TerminalPane dedans). */}
      {sidebarVisible && <Sidebar />}
```

- [ ] **Step 2: Sidebar.tsx — ouvrir l'édition inline sur renameRequestId**

Dans `src/components/Sidebar.tsx` (état post-S.2/K.4 : le handler de ligne est `onClick={() => setActive(w.id)}`, le bouton + appelle `openFolderDialog`) :

1. Compléter l'import React (ligne 1) :

```tsx
import { useEffect, useState, useRef } from "react";
```

(U.3 pose plus tard ce même état final d'import — pas de conflit.)

2. Dans le corps de `Sidebar()`, juste après la ligne `const blurShouldCommit = useRef(true);`, ajouter :

```tsx
  // Ctrl+Shift+R : le dispatch (K.5) pose renameRequestId sur le workspace actif.
  // Quand il matche un workspace, on ouvre l'édition inline (même chemin que le
  // double-clic sur le nom), puis on consomme la demande (requestRename(null)) —
  // sinon un second Ctrl+Shift+R sur le même workspace ne redéclencherait pas l'effet.
  const renameRequestId = useWorkspaceStore((s) => s.renameRequestId);
  useEffect(() => {
    if (!renameRequestId) return;
    const w = workspaces.find((x) => x.id === renameRequestId);
    if (w) {
      setDraft(w.name);
      setPaletteFor(null);
      setEditingId(w.id);
    }
    useWorkspaceStore.getState().requestRename(null);
  }, [renameRequestId]);
```

(`workspaces` vient de la déstructuration existante du store en tête de composant ; le re-render déclenché par `requestRename(active.id)` garantit une closure fraîche au moment où l'effet tire.)

- [ ] **Step 3: Vérifier le build + critères manuels (spec §6/§9)**

```bash
cd /home/user/dev/terminals && npm run build && npm test
```

Attendu : `tsc` sans erreur, `✓ built in …`, tests verts. Puis `npm run tauri dev` :
- **Ctrl+Shift+B** : la sidebar disparaît (la grille s'élargit, les terminaux se refit) ; un second Ctrl+Shift+B la réaffiche.
- **Ctrl+Shift+R** : le nom du workspace actif passe en édition inline, texte sélectionné ; Enter valide le renommage, Escape annule. Refaire **Ctrl+Shift+R** après validation : l'édition se rouvre (la demande a bien été consommée par `requestRename(null)`).
- Sidebar masquée puis **Ctrl+Shift+R** puis **Ctrl+Shift+B** : l'édition s'ouvre à la réapparition (la demande en attente est consommée au montage) — comportement accepté.

- [ ] **Step 4: Commit**

```bash
cd /home/user/dev/terminals && git add src/App.tsx src/components/Sidebar.tsx && git commit -m "feat(front): Ctrl+Shift+B masque la sidebar au rendu, Ctrl+Shift+R ouvre l'édition inline du nom (spec §6)"
```

---

### Task U.1 : Anneau bleu par pane + suppression du halo de grille

**Item spec :** §5 (attention bleue D3) — anneau du pane émetteur, suppression du halo inset ambre de la grille entière **dans le même commit**
**Files:**
- Modify: `src/components/PaneTree.tsx` (import ligne 4 ; conteneur `PaneTree` lignes 87-96 — le `boxShadow: ws.unread ? …` à la ligne 94 ; style de `PaneCell` lignes 46-53)

**Interfaces:**
- Consumes (contrat verrouillé, produit par le package S « store/palette ») :
  - `export const ATTENTION_COLOR = "#3b82f6";` depuis `src/lib/palette.ts`
  - `Workspace.unreadPanes: string[]` depuis `src/store/workspace.ts`
- Produces: rien (feuille UI)

Contexte pour un lecteur sans contexte : `PaneTree` rend une grille CSS de 1 à 4 `PaneCell` ; chaque cellule porte une bordure 1px de la couleur d'identité du workspace quand elle est active. Aujourd'hui une notification allume un halo inset ambre autour de **toute** la grille (`ws.unread`) ; la cible cmux est un anneau **bleu** autour du **seul pane émetteur** (`ws.unreadPanes`).

⚠️ **Relire le fichier réel avant édition : K.3 y a ajouté la prop `visible`** (traversante `PaneTree` → `PaneCell` → `TerminalPane`, contrat verrouillé « à préserver par toute tâche ultérieure ») — les états finaux ci-dessous l'incluent ; la supprimer casserait `tsc` (`TerminalPane` exige `visible`, `App.tsx` la passe à `PaneTree`). Les seuls changements réels de cette tâche : suppression de la ligne `boxShadow` du conteneur de grille + ajout `isUnread`/`boxShadow`/`zIndex` sur la cellule.

- [ ] **Step 1: Remplacer l'import et supprimer le halo de grille**
Dans `src/components/PaneTree.tsx`, la ligne d'import de la palette (ligne 4 au moment de l'analyse : `import { ALERT_COLOR } from "../lib/palette";` — le package S a pu la renommer mécaniquement) devient :
```tsx
import { ATTENTION_COLOR } from "../lib/palette";
```
Et le conteneur de `PaneTree` perd sa ligne `boxShadow` (état final complet de la fonction — la prop `visible` posée par K.3 est conservée) :
```tsx
export function PaneTree({ ws, visible }: { ws: Workspace; visible: boolean }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
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
          <PaneCell key={paneId} ws={ws} paneId={paneId} area={AREAS[i]} visible={visible} />
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Anneau bleu sur la cellule d'un pane non lu**
Dans `PaneCell` (même fichier), ajouter la dérivation et le style. Début de la fonction et div racine, état final (la prop `visible` posée par K.3 est conservée dans la signature et le destructuring) :
```tsx
function PaneCell({
  ws,
  paneId,
  area,
  visible,
}: {
  ws: Workspace;
  paneId: string;
  area: string;
  visible: boolean;
}) {
  const setActivePane = useWorkspaceStore((s) => s.setActivePane);
  const closePane = useWorkspaceStore((s) => s.closePane);
  const [hover, setHover] = useState(false);
  const isActive = ws.activePaneId === paneId;
  // Anneau bleu cmux : un agent attend dans CE pane (sémantique attention, distincte
  // de la bordure active 1px couleur d'identité qui, elle, reste inchangée).
  const isUnread = ws.unreadPanes.includes(paneId);
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
        boxShadow: isUnread
          ? `0 0 0 2px ${ATTENTION_COLOR}, 0 0 8px ${ATTENTION_COLOR}80`
          : "none",
        // Le glow 8px déborde sur les cellules voisines (gap 2px) : on le fait
        // passer au-dessus pour qu'il ne soit pas rogné.
        zIndex: isUnread ? 2 : "auto",
      }}
    >
```
Le reste de `PaneCell` (bouton × au survol, `<TerminalPane wsId={ws.id} paneId={paneId} cwd={ws.cwd} visible={visible} />` posé par K.3) est inchangé.

- [ ] **Step 3: Build vert**
```bash
cd /home/user/dev/terminals && npm run build
```
Sortie attendue : `tsc` sans erreur, `✓ built in …`.

- [ ] **Step 4: Vérification manuelle (critère précis)**
Lancer `npm run tauri dev`, ouvrir un workspace avec 2 panes. Dans le pane 1 : `(sleep 3; printf '\e]9;fini\a') &` puis cliquer dans le pane 2. Après 3 s : anneau bleu 2px + glow autour du **pane 1 uniquement** (pas de halo ambre autour de la grille), rail sidebar allumé. Cliquer dans le pane 1 → l'anneau disparaît (focus = lu). NB : le ciblage par pane exige l'enrichissement `ptyId` de l'event `agent-notification` (tâche backend du package routage socket) — tant qu'elle n'est pas mergée, la notification retombe sur le fallback workspace (aucun anneau de pane) : c'est attendu, revalider après assemblage.

- [ ] **Step 5: Commit**
```bash
cd /home/user/dev/terminals
git add src/components/PaneTree.tsx && git commit -m "feat(front): anneau bleu cmux par pane émetteur, suppression du halo ambre de grille (spec §5)"
```

---

### Task U.2 : Sidebar — attention bleue sur `hasAttention`

**Item spec :** §5 — rail 3px et halo de pastille passent au bleu attention, éteints quand tous les panes sont lus
**Files:**
- Modify: `src/components/Sidebar.tsx` (import ligne 3 ; rail ligne 49 `borderLeft: …w.unread ? ALERT_COLOR…` ; halo pastille ligne 66 `boxShadow: w.unread ? …` ; barre de progression ligne 159 `background: ALERT_COLOR`)

**Interfaces:**
- Consumes (contrat verrouillé, package S « store/palette ») :
  - `ATTENTION_COLOR`, `STATUS_DEFAULT_COLOR` depuis `src/lib/palette.ts`
  - `export function hasAttention(w: Workspace): boolean` depuis `src/store/workspace.ts` (`w.unread || w.unreadPanes.length > 0`)
- Produces: rien

- [ ] **Step 1: Import**
Dans `src/components/Sidebar.tsx`, remplacer l'import palette (ligne 3 au moment de l'analyse : `import { PALETTE, ALERT_COLOR } from "../lib/palette";`) par :
```tsx
import { PALETTE, ATTENTION_COLOR, STATUS_DEFAULT_COLOR } from "../lib/palette";
```
et ajouter `hasAttention` à l'import du store (ligne 2) :
```tsx
import { useWorkspaceStore, hasAttention } from "../store/workspace";
```

- [ ] **Step 2: Rail gauche 3px (ligne 49)**
```tsx
        borderLeft: `3px solid ${hasAttention(w) ? ATTENTION_COLOR : "transparent"}`,
```

- [ ] **Step 3: Halo de la pastille couleur (ligne 66)**
```tsx
                boxShadow: hasAttention(w) ? `0 0 0 3px ${ATTENTION_COLOR}40` : "none",
```

- [ ] **Step 4: Barre de progression → couleur status par défaut (ligne 159)**
La progress bar n'est PAS de la sémantique attention (contrat : `STATUS_DEFAULT_COLOR` = défaut status pill + progress bar). État final de la div interne :
```tsx
              <div
                style={{ height: 3, width: `${w.progress.value * 100}%`, background: STATUS_DEFAULT_COLOR }}
              />
```
(Si le package S a déjà fait ce remplacement mécaniquement, ce step est un no-op — vérifier que c'est bien `STATUS_DEFAULT_COLOR`.)

- [ ] **Step 5: Build vert + commit**
```bash
cd /home/user/dev/terminals && npm run build
```
Sortie attendue : `✓ built in …`. Puis :
```bash
git add src/components/Sidebar.tsx && git commit -m "feat(front): sidebar — rail et halo d'attention en bleu hasAttention, progress bar sur la couleur status (spec §5)"
```

---

### Task U.3 : Ligne sidebar complète — cwd abrégé, dernière notification, clic meta → diff

**Item spec :** §7 item 4 (ordre : nom / meta git / cwd / dernière notif / status / progress) + §4 (« clic sur la ligne meta git de la sidebar » ouvre le diff)
**Files:**
- Create: `src/lib/paths.ts`, `src/lib/paths.test.ts`
- Modify: `src/components/Sidebar.tsx` (imports lignes 1-3 ; corps du composant ; bloc meta git lignes 146-150)
- Test: `npm test`

**Interfaces:**
- Consumes (contrat verrouillé, package S « store/palette ») :
  - `toggleDiff: (wsId: string) => void` et `setActive: (wsId: string) => void` du store `src/store/workspace.ts`
  - `Workspace.lastNotification?: { title: string; body: string }` (déjà présent dans le store actuel, jamais rendu)
  - `homeDir(): Promise<string>` de `@tauri-apps/api/path` (API core Tauri v2, couverte par la permission `core:default` déjà présente dans `src-tauri/capabilities/default.json` — aucune capability à ajouter)
- Produces: `export function abbreviateHome(path: string, home: string): string` dans `src/lib/paths.ts` (réutilisable par toute UI affichant un chemin)

- [ ] **Step 1: Test qui échoue — `abbreviateHome`**
Créer `src/lib/paths.test.ts` :
```ts
import { describe, it, expect } from "vitest";
import { abbreviateHome } from "./paths";

describe("abbreviateHome", () => {
  it("remplace le préfixe home par ~", () => {
    expect(abbreviateHome("/home/x/dev/terminals", "/home/x")).toBe("~/dev/terminals");
  });

  it("chemin égal au home → ~", () => {
    expect(abbreviateHome("/home/x", "/home/x")).toBe("~");
  });

  it("tolère le slash final renvoyé par homeDir()", () => {
    expect(abbreviateHome("/home/x/dev", "/home/x/")).toBe("~/dev");
  });

  it("ne tronque pas un préfixe partiel de segment (/home/xy)", () => {
    expect(abbreviateHome("/home/xy/dev", "/home/x")).toBe("/home/xy/dev");
  });

  it("chemin hors du home → inchangé", () => {
    expect(abbreviateHome("/tmp/a", "/home/x")).toBe("/tmp/a");
  });

  it("home vide (pas encore résolu) → inchangé", () => {
    expect(abbreviateHome("/tmp/a", "")).toBe("/tmp/a");
  });
});
```
```bash
cd /home/user/dev/terminals && npm test
```
Échec attendu : `Failed to resolve import "./paths" from "src/lib/paths.test.ts"` (le module n'existe pas encore).

- [ ] **Step 2: Implémenter `src/lib/paths.ts`**
```ts
/** Abréviation d'un chemin pour l'affichage : remplace le préfixe $HOME par `~`.
    `home` vide → chemin inchangé (répertoire home pas encore résolu côté Tauri).
    Tolère le slash final que `homeDir()` peut renvoyer. Pure, testable sans Tauri. */
export function abbreviateHome(path: string, home: string): string {
  if (!home) return path;
  const h = home.endsWith("/") ? home.slice(0, -1) : home;
  if (path === h) return "~";
  if (path.startsWith(h + "/")) return "~" + path.slice(h.length);
  return path;
}
```
```bash
cd /home/user/dev/terminals && npm test
```
Succès attendu : les 6 tests `abbreviateHome` passent (et la suite existante reste verte).

- [ ] **Step 3: Résoudre le home dans la Sidebar**
Dans `src/components/Sidebar.tsx`, compléter les imports (état final des lignes d'import) :
```tsx
import { useEffect, useState, useRef } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { useWorkspaceStore, hasAttention } from "../store/workspace";
import { PALETTE, ATTENTION_COLOR, STATUS_DEFAULT_COLOR } from "../lib/palette";
import { abbreviateHome } from "../lib/paths";
```
Dans le corps de `Sidebar()`, ajouter le state et la résolution (une fois au montage) après les `useState` existants :
```tsx
  // Home résolu une fois via Tauri ; tant qu'il est vide, abbreviateHome est un no-op.
  const [home, setHome] = useState("");
  useEffect(() => {
    homeDir()
      .then(setHome)
      .catch(() => {});
  }, []);
```
Ajouter `setActive` et `toggleDiff` au destructuring du store en tête de composant (le `markRead` d'origine a été supprimé par le package S ; le clic de ligne est devenu `onClick={() => setActive(w.id)}` seul — `setActive` clear le fallback `unread` d'après le contrat) :
```tsx
  const { workspaces, activeId, setActive, toggleDiff, renameWorkspace, setColor } =
    useWorkspaceStore();
```
(Conserver tel quel tout autre membre déjà destructuré par les tâches précédentes, p. ex. le handler du bouton +.)

- [ ] **Step 4: Ligne meta git cliquable → diff**
Remplacer le bloc meta git (lignes 146-150 au moment de l'analyse) par :
```tsx
          {metaLine(w.branch, w.dirty, w.ports) && (
            <div
              onClick={(e) => {
                // Le clic active le workspace ET ouvre son diff (sans déclencher le onClick de la ligne).
                e.stopPropagation();
                setActive(w.id);
                toggleDiff(w.id);
              }}
              title="Voir les fichiers modifiés (Ctrl+Shift+D)"
              style={{ fontSize: 11, color: "#6f6f6f", marginLeft: 17, marginTop: 3, cursor: "pointer" }}
            >
              {metaLine(w.branch, w.dirty, w.ports)}
            </div>
          )}
```

- [ ] **Step 5: Lignes cwd et dernière notification**
Immédiatement APRÈS le bloc meta git et AVANT le bloc `{w.status && …}` (ordre spec : nom / meta git / cwd / dernière notif / status / progress), insérer :
```tsx
          <div
            style={{
              fontSize: 11,
              color: "#6f6f6f",
              marginLeft: 17,
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {abbreviateHome(w.cwd, home)}
          </div>
          {w.lastNotification && (
            <div
              style={{
                fontSize: 11,
                color: "#8a8a8a",
                marginLeft: 17,
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {w.lastNotification.title}
            </div>
          )}
```

- [ ] **Step 6: Build vert + vérification manuelle**
```bash
cd /home/user/dev/terminals && npm run build
```
Sortie attendue : `✓ built in …`. Critère manuel (`npm run tauri dev`) : chaque ligne workspace affiche le cwd en `~/…` sous la ligne git ; `printf '\e]777;notify;Titre;Corps\a'` fait apparaître « Titre » ellipsé sous le cwd ; un clic sur la ligne git (curseur main) active le workspace et bascule `diffOpen` (visible dès que l'overlay du package diff est mergé — hors dépendance de build).

- [ ] **Step 7: Commit**
```bash
cd /home/user/dev/terminals
git add src/lib/paths.ts src/lib/paths.test.ts src/components/Sidebar.tsx && git commit -m "feat(front): ligne sidebar complète — cwd abrégé ~, dernière notification, clic meta git ouvre le diff (spec §7 item 4)"
```

---

### Task U.4 : Bouton × de fermeture de workspace au survol de la ligne sidebar

**Item spec :** §6 (fermeture de workspace, D5) — bouton × au survol + fermeture des PTYs avant `closeWorkspace`
**Files:**
- Modify: `src/components/Sidebar.tsx` (state de survol dans `Sidebar()` ; handlers `onMouseEnter/Leave` sur la div de ligne — lignes 36-51 au moment de l'analyse ; bouton × dans la première ligne flex nom/pastille — lignes 52-119)

**Interfaces:**
- Consumes (contrat verrouillé, package S « store/workspace ») :
  - `closeWorkspace: (wsId: string) => void` — retire le ws, purge ses entrées `panePtys`, active le voisin précédent sinon suivant sinon null
  - `panePtys: Record<string, number>` (paneId → id PTY backend) du store
  - `closePty(id: number): void` de `src/lib/pty.ts` (existant, `invoke("close_pty")`)
- Produces: rien

Pattern de référence : le bouton × au survol de `PaneCell` (`src/components/PaneTree.tsx:55-81`) — `useState(hover)`, `onMouseDown` avec `stopPropagation()+preventDefault()` pour ne pas voler le focus/activer la ligne, `onClick` qui agit.

- [ ] **Step 1: State de survol par ligne + accès store**
Dans `Sidebar()` : ajouter `closeWorkspace` et `panePtys` au destructuring du store (mêmes lignes que la tâche « Ligne sidebar complète — cwd abrégé, dernière notification, clic meta → diff ») :
```tsx
  const { workspaces, activeId, setActive, toggleDiff, closeWorkspace, panePtys, renameWorkspace, setColor } =
    useWorkspaceStore();
```
et un state de ligne survolée (une seule ligne à la fois, pas besoin d'un composant enfant) :
```tsx
  const [hoverId, setHoverId] = useState<string | null>(null);
```
Ajouter l'import de `closePty` :
```tsx
import { closePty } from "../lib/pty";
```

- [ ] **Step 2: Handlers de survol sur la div de ligne**
Sur la div de chaque workspace (celle qui porte `onClick={() => setActive(w.id)}`), ajouter :
```tsx
          onMouseEnter={() => setHoverId(w.id)}
          onMouseLeave={() => setHoverId((cur) => (cur === w.id ? null : cur))}
```

- [ ] **Step 3: Bouton × en fin de ligne nom**
Dans la première ligne flex (`<div style={{ display: "flex", alignItems: "center", gap: 7 }}>`), APRÈS le span du nom (ou l'input d'édition), ajouter en dernier enfant — rendu en permanence mais invisible hors survol pour ne pas faire re-flow le nom :
```tsx
            <button
              onMouseDown={(e) => {
                // Comme le × de PaneCell : ne pas voler le mousedown (pas d'activation de la ligne).
                e.stopPropagation();
                e.preventDefault();
              }}
              onClick={(e) => {
                e.stopPropagation();
                // Ferme d'abord les PTYs backend de tous les panes (même chemin que Ctrl+Shift+Q),
                // puis retire le workspace du store (closeWorkspace purge panePtys et réactive un voisin).
                for (const paneId of w.panes) {
                  const ptyId = panePtys[paneId];
                  if (ptyId !== undefined) closePty(ptyId);
                }
                closeWorkspace(w.id);
              }}
              title="Fermer le workspace (Ctrl+Shift+Q)"
              style={{
                width: 16,
                height: 16,
                padding: 0,
                lineHeight: "14px",
                flexShrink: 0,
                border: "none",
                borderRadius: 3,
                background: "transparent",
                color: "#8a8a8a",
                cursor: "pointer",
                visibility: hoverId === w.id ? "visible" : "hidden",
              }}
            >
              ×
            </button>
```

- [ ] **Step 4: Build vert + vérification manuelle**
```bash
cd /home/user/dev/terminals && npm run build
```
Sortie attendue : `✓ built in …`. Critère manuel (`npm run tauri dev`, 2 workspaces) : le × n'apparaît qu'au survol de la ligne ; le clic ne change pas le workspace actif avant fermeture ; après fermeture, le workspace voisin devient actif et `ps` ne montre plus les shells du workspace fermé (PTYs tués). NB : le démontage des `TerminalPane` appelle aussi `closePty` dans son cleanup — le double `close_pty` sur un id déjà retiré de la map backend est un no-op silencieux, pas une erreur.

- [ ] **Step 5: Commit**
```bash
cd /home/user/dev/terminals
git add src/components/Sidebar.tsx && git commit -m "feat(front): bouton × de fermeture de workspace au survol de la ligne sidebar (spec §6)"
```

---

### Task U.5 : Titles des boutons sur les nouveaux raccourcis + branche dans la top bar

**Item spec :** §6 (« Mettre à jour les `title=` des boutons ») + §4 (toolbar diff : « nom workspace + branche » — la top bar adopte la même signature « nom — branche »)
**Files:**
- Modify: `src/App.tsx:102-104` (span du nom dans la top bar)
- Verify (aucune édition attendue) : les `title=` déjà posés par K.4 Step 7 et K.5 Step 6 — `src/App.tsx` (+ Terminal), `src/components/Sidebar.tsx` (+ de la sidebar), `src/components/PaneTree.tsx` (× de pane)

**Interfaces:**
- Consumes: `Workspace.branch?: string` (déjà peuplé par le poller `git_info` de `App.tsx:38-55`)
- Produces: rien

NB dédoublonnage : les steps 1/3/4 sont de **simples vérifications** — les `title=` Ctrl+Shift ont déjà été posés par le package K (K.5 Step 6 pour + Terminal et × de pane, K.4 Step 7 pour le + de la sidebar). Ne pas chercher les anciens textes (« Ctrl+T », « Ctrl+W », « Nouveau workspace ») : ils n'existent plus à ce stade.

- [ ] **Step 1: Vérification — bouton + Terminal (App.tsx)**
Déjà posé par K.5 Step 6 — vérifier (sans éditer) que le title est bien :
```tsx
                  title="Nouveau terminal (Ctrl+Shift+T)"
```

- [ ] **Step 2: Top bar « nom — branche »**
Remplacer le span du nom (`src/App.tsx:102-104`) par :
```tsx
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {active.name}
                {active.branch && <span style={{ color: "#6f6f6f" }}> — {active.branch}</span>}
              </span>
```

- [ ] **Step 3: Vérification — bouton + de la sidebar (Sidebar.tsx)**
Déjà posé par K.4 Step 7 (le `onClick` est sur `openFolderDialog()`) — vérifier (sans éditer) que le title est bien :
```tsx
          title="Ouvrir un dossier (Ctrl+Shift+O)"
```

- [ ] **Step 4: Vérification — × de pane (PaneTree.tsx)**
Déjà posé par K.5 Step 6 — vérifier (sans éditer) que le title est bien :
```tsx
          title="Fermer le terminal (Ctrl+Shift+W)"
```

- [ ] **Step 5: Build vert + commit**
```bash
cd /home/user/dev/terminals && npm run build
```
Sortie attendue : `✓ built in …`. Critère manuel : survol des trois boutons → tooltips avec les raccourcis `Ctrl+Shift+…` ; top bar affiche `terminals — master` (branche en gris discret) sur un workspace dans un repo git, juste `terminals` hors repo.
```bash
git add src/App.tsx && git commit -m "feat(front): branche git dans la top bar ; titles Ctrl+Shift vérifiés (posés par K.4/K.5) (spec §6, §4)"
```

---

### Task U.6 : README — raccourcis et fonctionnalités à jour

**Item spec :** §2 item 8b (hygiène aval). Tâche documentaire pure — à exécuter EN DERNIER dans le plan assemblé (elle décrit des fonctionnalités livrées par les autres packages : diff viewer, open folder, restauration, table de raccourcis).
**Files:**
- Modify: `README.md:7-15` (section « Fonctionnalités (v1) ») et `README.md:59-65` (section « Raccourcis »)

**Interfaces:**
- Consumes: la table de raccourcis du contrat `src/lib/shortcuts.ts` (source de vérité : la table commentée dans ce module)
- Produces: rien

- [ ] **Step 1: Remplacer la section « Fonctionnalités (v1) »**
Remplacer intégralement les lignes 7-15 du README (de `## Fonctionnalités (v1)` à `Hors périmètre v1 : …` inclus) par :
```markdown
## Fonctionnalités

- **Terminaux** xterm.js (rendu WebGL avec repli DOM) sur PTY natifs (`portable-pty`). Les workspaces restent montés en arrière-plan : changer de workspace ne tue pas les shells.
- **Workspaces sur dossier réel** : le bouton + de la sidebar et `Ctrl+Shift+O` ouvrent un dialog GTK natif ; la liste des workspaces (dossier, nom, couleur, nombre de terminaux) est restaurée au démarrage (un dossier disparu est ignoré avec un toast).
- **Splits** : grille fixe de 1 à 4 terminaux par workspace (`Ctrl+Shift+T`), focus directionnel `Alt+←→↑↓`.
- **Sidebar riche** : branche git (+ indicateur dirty), ports TCP en écoute du sous-arbre de process, répertoire abrégé (`~/…`), dernière notification, status pills et barre de progression. Un clic sur la ligne git ouvre le diff viewer ; `Ctrl+Shift+B` masque la sidebar.
- **Diff viewer** (`Ctrl+Shift+D`, copie du diff viewer cmux) : colonne « Files » (statut coloré, stats +/− par fichier), diff unifié concaténé avec en-têtes sticky et numéros de ligne, filtre `/`, navigation `j`/`k`/`g g`/`Shift+G`, `Échap` ferme.
- **Notifications agents** : capture des séquences `OSC 9 / 99 / 777` dans le flux du terminal → **anneau bleu** autour du pane émetteur (signature cmux), rail bleu dans la sidebar, notification desktop D-Bus + demande d'attention de la fenêtre. Aussi déclenchables par la CLI et par un hook Claude Code ; les commandes lancées dans un pane ciblent leur workspace d'origine (`TERMINIALS_WORKSPACE_ID` injecté dans l'environnement du shell).
- **CLI + socket Unix** (`$XDG_RUNTIME_DIR/terminials.sock`, JSON-par-ligne) pour scripter l'app.

Hors périmètre : onglets/surfaces par pane, navigateur intégré, splits libres redimensionnables, command palette.
```

- [ ] **Step 2: Remplacer la section « Raccourcis »**
Remplacer intégralement les lignes de `## Raccourcis` à la fin de sa table (lignes 59-65 de la version analysée : l'ancienne table `Ctrl+N` / `Ctrl+D` / `Ctrl+Shift+D` split est obsolète) par :
```markdown
## Raccourcis

Couche `Ctrl+Shift` (convention gnome-terminal), matching par touche physique (`e.code`, compatible AZERTY). Aucun `Ctrl+lettre` nu n'est intercepté — `Ctrl+N/T/W…` vont au shell (readline intact) — et `Ctrl+Shift+C/V` restent le copier/coller du terminal.

| Raccourci | Action |
|---|---|
| `Ctrl+Shift+O` ou `Ctrl+Shift+N` | Ouvrir un dossier (nouveau workspace) |
| `Ctrl+Shift+T` | Nouveau terminal (pane) |
| `Ctrl+Shift+W` | Fermer le pane actif |
| `Ctrl+Shift+Q` | Fermer le workspace actif |
| `Ctrl+Shift+R` | Renommer le workspace (édition inline) |
| `Ctrl+Shift+D` | Ouvrir/fermer le diff viewer |
| `Ctrl+Shift+B` | Afficher/masquer la sidebar |
| `Ctrl+PageUp` / `Ctrl+PageDown` | Workspace précédent / suivant |
| `Ctrl+1` … `Ctrl+9` | Sélection directe de workspace |
| `Alt+←` `Alt+→` `Alt+↑` `Alt+↓` | Focus directionnel de pane |
| `Échap` | Ferme le diff viewer (quand il est ouvert) |

Conflits assumés : `Ctrl+PageUp/Down` (navigation de fenêtres tmux) et `Ctrl+2..8` (codes de contrôle rarissimes) sont capturés par l'app.
```

- [ ] **Step 3: Vérifier le rendu et l'exactitude**
```bash
cd /home/user/dev/terminals
grep -n "Ctrl+" README.md
```
Vérifier que chaque raccourci listé correspond exactement à la table du module `src/lib/shortcuts.ts` mergé (source de vérité) — en particulier : pas de `Ctrl+N` nu, `Digit1..9` sans Shift, `Ctrl+Shift+D` = diff (plus « split vertical »).

- [ ] **Step 4: Commit**
```bash
cd /home/user/dev/terminals
git add README.md && git commit -m "docs(readme): raccourcis Ctrl+Shift, open folder, diff viewer, anneau bleu — mise à jour parité cmux (spec §2 item 8b)"
```
### Task D.1 : parseUnifiedDiff (lib/diff.ts)

**Item spec :** §4 (« Main scrollable : diff unifié […] numéros de ligne ») et §8 (« Binary files … differ → afficher tel quel, pas de crash de parsing »)
**Files:**
- Create: `src/lib/diff.ts`
- Test: `src/lib/diff.test.ts`

**Interfaces:**
- Consumes: rien (module pur, zéro dépendance).
- Produces (contrat verrouillé, consommé par la tâche « Composant DiffOverlay ») :
  ```ts
  export interface DiffLine { kind: "add" | "del" | "ctx" | "hunk" | "meta"; oldNo?: number; newNo?: number; text: string; }
  export function parseUnifiedDiff(text: string): DiffLine[];
  export interface ChangedFile { path: string; status: "modified"|"added"|"deleted"|"renamed"|"untracked"; origPath?: string; added?: number; deleted?: number; }
  ```

Contexte pour un lecteur sans historique : le repo est un front Vite/React 19/TS strict dont les tests unitaires tournent avec vitest en environnement **node** (voir `vite.config.ts`, bloc `test: { environment: "node", globals: true }`) — ce module est de la logique pure, donc testable en TDD. Convention de sémantique choisie ici (les tests en font foi) : le marqueur `+`/`-`/espace est **retiré** de `text` pour les lignes `add`/`del`/`ctx` (le `kind` porte l'information) ; les lignes `hunk` et `meta` gardent leur texte intégral.

- [ ] **Step 1 : Écrire le test (échoue — le module n'existe pas)**

Créer `src/lib/diff.test.ts` avec exactement ce contenu :

```ts
import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "./diff";

/** Diff git classique : un fichier, un hunk (sortie réelle de `git diff --no-color`). */
const SIMPLE = [
  "diff --git a/f.txt b/f.txt",
  "index 1111111..2222222 100644",
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,3 +1,4 @@",
  " un",
  "-deux",
  "+deux bis",
  "+trois",
  " quatre",
  "",
].join("\n");

const MULTI = [
  "diff --git a/m.ts b/m.ts",
  "index 3333333..4444444 100644",
  "--- a/m.ts",
  "+++ b/m.ts",
  "@@ -10,3 +10,3 @@ fn main()",
  " ctx1",
  "-a",
  "+b",
  " ctx1b",
  "@@ -40,1 +40,2 @@",
  " ctx2",
  "+c",
  "",
].join("\n");

const NO_NEWLINE = [
  "diff --git a/n.txt b/n.txt",
  "index 5555555..6666666 100644",
  "--- a/n.txt",
  "+++ b/n.txt",
  "@@ -1 +1 @@",
  "-ancien",
  "\\ No newline at end of file",
  "+nouveau",
  "\\ No newline at end of file",
  "",
].join("\n");

const BINARY = [
  "diff --git a/img.png b/img.png",
  "index 7777777..8888888 100644",
  "Binary files a/img.png and b/img.png differ",
  "",
].join("\n");

const TWO_FILES = [
  "diff --git a/a.txt b/a.txt",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1 +1 @@",
  "-x",
  "+y",
  "diff --git a/b.txt b/b.txt",
  "--- a/b.txt",
  "+++ b/b.txt",
  "@@ -5 +5 @@",
  " z",
  "",
].join("\n");

/** Sortie de `git diff --no-index /dev/null <fichier>` pour un fichier untracked. */
const UNTRACKED = [
  "diff --git a/dev/null b/newfile.txt",
  "new file mode 100644",
  "index 0000000..257cc56",
  "--- /dev/null",
  "+++ b/newfile.txt",
  "@@ -0,0 +1,2 @@",
  "+l1",
  "+l2",
  "",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("diff vide → []", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("en-têtes diff --git / index / --- / +++ → meta (texte intégral conservé)", () => {
    expect(parseUnifiedDiff(SIMPLE).slice(0, 4)).toEqual([
      { kind: "meta", text: "diff --git a/f.txt b/f.txt" },
      { kind: "meta", text: "index 1111111..2222222 100644" },
      { kind: "meta", text: "--- a/f.txt" },
      { kind: "meta", text: "+++ b/f.txt" },
    ]);
  });

  it("hunk simple : numéros old/new corrects, marqueur retiré du texte", () => {
    expect(parseUnifiedDiff(SIMPLE).slice(4)).toEqual([
      { kind: "hunk", text: "@@ -1,3 +1,4 @@" },
      { kind: "ctx", oldNo: 1, newNo: 1, text: "un" },
      { kind: "del", oldNo: 2, text: "deux" },
      { kind: "add", newNo: 2, text: "deux bis" },
      { kind: "add", newNo: 3, text: "trois" },
      { kind: "ctx", oldNo: 3, newNo: 4, text: "quatre" },
    ]);
  });

  it("multi-hunks : les compteurs repartent de chaque en-tête @@ (suffixe de section conservé)", () => {
    expect(parseUnifiedDiff(MULTI).slice(4)).toEqual([
      { kind: "hunk", text: "@@ -10,3 +10,3 @@ fn main()" },
      { kind: "ctx", oldNo: 10, newNo: 10, text: "ctx1" },
      { kind: "del", oldNo: 11, text: "a" },
      { kind: "add", newNo: 11, text: "b" },
      { kind: "ctx", oldNo: 12, newNo: 12, text: "ctx1b" },
      { kind: "hunk", text: "@@ -40,1 +40,2 @@" },
      { kind: "ctx", oldNo: 40, newNo: 40, text: "ctx2" },
      { kind: "add", newNo: 41, text: "c" },
    ]);
  });

  it("« \\ No newline at end of file » → meta ; en-tête @@ sans virgule accepté", () => {
    expect(parseUnifiedDiff(NO_NEWLINE).slice(4)).toEqual([
      { kind: "hunk", text: "@@ -1 +1 @@" },
      { kind: "del", oldNo: 1, text: "ancien" },
      { kind: "meta", text: "\\ No newline at end of file" },
      { kind: "add", newNo: 1, text: "nouveau" },
      { kind: "meta", text: "\\ No newline at end of file" },
    ]);
  });

  it("Binary files … differ → tout en meta, pas de crash", () => {
    expect(parseUnifiedDiff(BINARY)).toEqual([
      { kind: "meta", text: "diff --git a/img.png b/img.png" },
      { kind: "meta", text: "index 7777777..8888888 100644" },
      { kind: "meta", text: "Binary files a/img.png and b/img.png differ" },
    ]);
  });

  it("deuxième fichier : diff --git re-bascule en meta (---/+++ ne deviennent pas del/add)", () => {
    const lines = parseUnifiedDiff(TWO_FILES);
    expect(lines[6]).toEqual({ kind: "meta", text: "diff --git a/b.txt b/b.txt" });
    expect(lines[7]).toEqual({ kind: "meta", text: "--- a/b.txt" });
    expect(lines[8]).toEqual({ kind: "meta", text: "+++ b/b.txt" });
    expect(lines[10]).toEqual({ kind: "ctx", oldNo: 5, newNo: 5, text: "z" });
  });

  it("fichier untracked via --no-index : nouvelles lignes numérotées depuis 1", () => {
    expect(parseUnifiedDiff(UNTRACKED).slice(5)).toEqual([
      { kind: "hunk", text: "@@ -0,0 +1,2 @@" },
      { kind: "add", newNo: 1, text: "l1" },
      { kind: "add", newNo: 2, text: "l2" },
    ]);
  });
});
```

- [ ] **Step 2 : Lancer le test et constater l'échec**

```bash
cd /home/user/dev/terminals && npx vitest run src/lib/diff.test.ts
```

Échec attendu : `Error: Failed to resolve import "./diff" from "src/lib/diff.test.ts"` (le module n'existe pas encore).

- [ ] **Step 3 : Implémenter src/lib/diff.ts**

Créer `src/lib/diff.ts` avec exactement ce contenu :

```ts
/** Une ligne de diff unifié prête à rendre : type + numéros de ligne + texte sans marqueur. */
export interface DiffLine {
  kind: "add" | "del" | "ctx" | "hunk" | "meta";
  oldNo?: number;
  newNo?: number;
  text: string;
}

/** Fichier modifié tel que sérialisé par la commande Tauri `git_changed_files` (camelCase). */
export interface ChangedFile {
  path: string;
  status: "modified" | "added" | "deleted" | "renamed" | "untracked";
  origPath?: string;
  /** Lignes ajoutées/supprimées (numstat) ; absents = fichier binaire. */
  added?: number;
  deleted?: number;
}

/** En-tête de hunk : `@@ -old[,n] +new[,m] @@[ section]` — les comptes sont optionnels. */
const HUNK_RE = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/;

/**
 * Parse un diff unifié (`git diff --no-color`, un ou plusieurs fichiers concaténés)
 * en lignes annotées :
 * - en-têtes (`diff --git`, `index`, `---`, `+++`, `new file mode`, `Binary files …`) → "meta" ;
 * - `\ No newline at end of file` → "meta" ;
 * - numéros old/new calculés depuis les en-têtes `@@` ;
 * - le marqueur `+`/`-`/espace est retiré de `text` pour add/del/ctx (le kind le porte).
 */
export function parseUnifiedDiff(text: string): DiffLine[] {
  if (text === "") return [];
  const lines = text.split("\n");
  if (lines[lines.length - 1] === "") lines.pop(); // newline final du diff
  const out: DiffLine[] = [];
  let oldNo = 0;
  let newNo = 0;
  let inHunk = false;
  for (const line of lines) {
    const m = HUNK_RE.exec(line);
    if (m) {
      oldNo = parseInt(m[1], 10);
      newNo = parseInt(m[2], 10);
      inHunk = true;
      out.push({ kind: "hunk", text: line });
    } else if (!inHunk || line.startsWith("diff --git ")) {
      // Avant le premier @@ d'un fichier, tout est en-tête ; un `diff --git` non préfixé
      // (jamais produit comme ligne de contenu, qui commence par espace/+/-) rouvre les en-têtes.
      inHunk = false;
      out.push({ kind: "meta", text: line });
    } else if (line.startsWith("+")) {
      out.push({ kind: "add", newNo: newNo++, text: line.slice(1) });
    } else if (line.startsWith("-")) {
      out.push({ kind: "del", oldNo: oldNo++, text: line.slice(1) });
    } else if (line.startsWith("\\")) {
      out.push({ kind: "meta", text: line }); // \ No newline at end of file
    } else {
      // Ligne de contexte (" x" — ou "" si un outil a rogné l'espace de fin).
      out.push({ kind: "ctx", oldNo: oldNo++, newNo: newNo++, text: line.slice(1) });
    }
  }
  return out;
}
```

- [ ] **Step 4 : Relancer les tests (succès attendu)**

```bash
cd /home/user/dev/terminals && npx vitest run src/lib/diff.test.ts
```

Attendu : `Test Files  1 passed`, `Tests  8 passed`. Puis la suite complète :

```bash
cd /home/user/dev/terminals && npm test
```

Attendu : toutes les suites passent (diff, palette, store).

- [ ] **Step 5 : Vérifier le build (tsc type-check aussi les tests, `include: ["src"]`)**

```bash
cd /home/user/dev/terminals && npm run build
```

Attendu : sortie vite « built in … », zéro erreur TypeScript.

- [ ] **Step 6 : Commit**

```bash
cd /home/user/dev/terminals && git add src/lib/diff.ts src/lib/diff.test.ts && git commit -m "feat(front): parseUnifiedDiff — parsing du diff unifié en lignes annotées (spec §4)"
```

---

### Task D.2 : Composant DiffOverlay

**Item spec :** §4 (placement, ouverture/fermeture — volet focus, UI complète, rafraîchissement, état vide) et §8 (« Pas un dépôt git », binaires)
**Files:**
- Create: `src/components/DiffOverlay.tsx`
- Modify: `src/App.css` (ajout des classes `.diff-*` à la fin du fichier ; le fichier fait ~50 lignes et se termine aujourd'hui par la règle `.icon-btn:hover`)

**Interfaces:**
- Consumes:
  - `parseUnifiedDiff(text: string): DiffLine[]`, `interface ChangedFile`, `interface DiffLine` — de la tâche « parseUnifiedDiff (lib/diff.ts) » (`src/lib/diff.ts`).
  - `Workspace` (avec le champ `diffOpen: boolean`) et `toggleDiff(wsId: string): void` — état étendu du store `src/store/workspace.ts` (contrat verrouillé, tâche store du package S).
  - `focusPane(paneId: string): void` — `src/lib/paneFocus.ts` (contrat verrouillé, tâche paneFocus du package K).
  - Commandes Tauri **runtime** (pas de dépendance de build) : `invoke<ChangedFile[]>("git_changed_files", { cwd })` et `invoke<string>("git_file_diff", { cwd, path, staged })` — tâches git du package R.
- Produces: `export const DiffOverlay: React.MemoExoticComponent<(props: { ws: Workspace }) => JSX.Element>` — rendu par la tâche « Intégration du diff viewer dans App » via `<DiffOverlay ws={active} />`.

Contexte : l'overlay recouvre la zone de grille (`position:absolute; inset:0; z-index:500`, sous le toast à 1000), fond `#1e1e1e`. Il est **mémoïsé** : l'objet `ws` change d'identité toutes les 2 s (pollers git/ports réécrivent le tableau `workspaces`), mais l'overlay ne consomme que `id`/`cwd`/`name` en props — la branche passe par un sélecteur Zustand étroit (primitive) pour que seuls les vrais changements de branche re-rendent. Choix front pour `staged` (les commandes prennent le flag, `changed_files` fusionne worktree+staged) : on fetch `staged:false` d'abord ; si vide et fichier non-untracked, on retombe sur `staged:true` (changement uniquement indexé). Un seul chargement par fichier, déclenché lazy par IntersectionObserver (marge 300 px).

Edge case assumé (v1) : l'état vide « Pas un dépôt git » est dérivé de l'absence de `branch` (peuplé par le poller `git_info`), pas d'un vrai test « is a repo ». Deux imprécisions tolérées : un repo en HEAD détaché (`symbolic-ref` échoue → `branch` indéfini) et sans changement affichera à tort « Pas un dépôt git » ; un vrai non-repo peut brièvement afficher « Aucun changement » pendant les ~2 premières secondes (timing du poller). Fix propre si besoin ultérieur : test backend explicite (`git rev-parse --is-inside-work-tree`) via un retour `Option`/`Result` de `git_changed_files` ou un invoke `git_info` à l'ouverture de l'overlay.

- [ ] **Step 1 : Créer src/components/DiffOverlay.tsx**

Contenu complet :

```tsx
import { memo, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore, type Workspace } from "../store/workspace";
import { focusPane } from "../lib/paneFocus";
import { parseUnifiedDiff, type ChangedFile, type DiffLine } from "../lib/diff";

/** Lettre + couleur de statut par fichier (fidèle cmux). */
const STATUS_BADGE: Record<ChangedFile["status"], { letter: string; color: string }> = {
  modified: { letter: "M", color: "#e67e22" },
  added: { letter: "A", color: "#1abc9c" },
  deleted: { letter: "D", color: "#e74c3c" },
  renamed: { letter: "R", color: "#9b59b6" },
  untracked: { letter: "?", color: "#95a5a6" },
};

/** Compteurs +n / −n (verts/rouges) ; absents pour un binaire (numstat vide). */
function Stats({ added, deleted }: { added?: number; deleted?: number }) {
  return (
    <span className="diff-stats">
      {added !== undefined && <span style={{ color: "#2ecc71" }}>+{added}</span>}
      {deleted !== undefined && <span style={{ color: "#e74c3c" }}>−{deleted}</span>}
    </span>
  );
}

/**
 * Section d'un fichier dans le panneau principal : header sticky + lignes du diff.
 * Le diff est chargé lazy : un IntersectionObserver (root = .diff-main, marge 300px)
 * signale l'approche de la section ; le parent fetch une seule fois par fichier.
 */
function FileSection({
  file,
  lines,
  onVisible,
  refCb,
}: {
  file: ChangedFile;
  lines: DiffLine[] | undefined;
  onVisible: (f: ChangedFile) => void;
  refCb: (el: HTMLDivElement | null) => void;
}) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const loaded = lines !== undefined;

  useEffect(() => {
    const el = localRef.current;
    if (!el || loaded) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onVisible(file);
      },
      { root: el.closest(".diff-main"), rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loaded, file, onVisible]);

  // Les meta (en-têtes git) sont masquées, sauf « Binary files … differ » (spec §8).
  const visible = (lines ?? []).filter(
    (l) => l.kind !== "meta" || l.text.startsWith("Binary files"),
  );

  return (
    <div
      ref={(el) => {
        localRef.current = el;
        refCb(el);
      }}
      className="diff-file"
    >
      <div className="diff-file-header">
        <span className="diff-file-path">
          {file.origPath ? `${file.origPath} → ${file.path}` : file.path}
        </span>
        <Stats added={file.added} deleted={file.deleted} />
      </div>
      {visible.map((l, i) => (
        <div key={i} className={`diff-line diff-line-${l.kind}`}>
          <span className="diff-gutter">{l.oldNo ?? ""}</span>
          <span className="diff-gutter">{l.newNo ?? ""}</span>
          <span className="diff-text">
            {l.kind === "add" ? "+" : l.kind === "del" ? "-" : l.kind === "ctx" ? " " : ""}
            {l.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function DiffOverlayInner({ ws }: { ws: Workspace }) {
  const { id: wsId, cwd, name } = ws;
  const toggleDiff = useWorkspaceStore((s) => s.toggleDiff);
  // Sélecteur étroit (primitive) : l'overlay ne doit re-render que si la branche change,
  // pas à chaque tick des pollers ports/git qui réécrivent le tableau workspaces.
  const branch = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === wsId)?.branch);

  const containerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const requested = useRef<Set<string>>(new Set());

  const [files, setFiles] = useState<ChangedFile[] | null>(null); // null = chargement
  const [diffs, setDiffs] = useState<Record<string, DiffLine[]>>({});

  // Fetch de la liste des fichiers : à l'ouverture + bouton reload. Jamais pollé (spec §4).
  const loadFiles = useCallback(async () => {
    setFiles(null);
    setDiffs({});
    requested.current.clear();
    try {
      const list = await invoke<ChangedFile[]>("git_changed_files", { cwd });
      setFiles([...list].sort((a, b) => a.path.localeCompare(b.path)));
    } catch {
      setFiles([]); // backend indisponible : même rendu que « aucun changement »
    }
  }, [cwd]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  // Focus : l'overlay prend le focus au montage (blur implicite du textarea xterm) ;
  // au démontage, le focus revient au textarea du pane actif du workspace (spec §4).
  useEffect(() => {
    containerRef.current?.focus();
    return () => {
      const s = useWorkspaceStore.getState();
      const w = s.workspaces.find((x) => x.id === wsId);
      if (w?.activePaneId) focusPane(w.activePaneId);
    };
  }, [wsId]);

  // Un seul fetch par fichier ; fallback --cached si le diff worktree est vide (changement staged).
  const loadFile = useCallback(
    async (f: ChangedFile) => {
      if (requested.current.has(f.path)) return;
      requested.current.add(f.path);
      try {
        let text = await invoke<string>("git_file_diff", { cwd, path: f.path, staged: false });
        if (!text && f.status !== "untracked") {
          text = await invoke<string>("git_file_diff", { cwd, path: f.path, staged: true });
        }
        setDiffs((d) => ({ ...d, [f.path]: parseUnifiedDiff(text) }));
      } catch {
        setDiffs((d) => ({ ...d, [f.path]: [] }));
      }
    },
    [cwd],
  );

  const totalAdded = (files ?? []).reduce((n, f) => n + (f.added ?? 0), 0);
  const totalDeleted = (files ?? []).reduce((n, f) => n + (f.deleted ?? 0), 0);

  return (
    <div ref={containerRef} tabIndex={-1} className="diff-overlay">
      <div className="diff-toolbar">
        <span className="diff-toolbar-title">
          {name}
          {branch ? ` — ${branch}` : ""}
        </span>
        <span className="diff-toolbar-right">
          {files && files.length > 0 && (
            <>
              <span style={{ color: "#8a8a8a" }}>
                {files.length} fichier{files.length > 1 ? "s" : ""}
              </span>
              <span style={{ color: "#2ecc71" }}>+{totalAdded}</span>
              <span style={{ color: "#e74c3c" }}>−{totalDeleted}</span>
            </>
          )}
          <button className="icon-btn" title="Rafraîchir" onClick={() => void loadFiles()}>
            ⟳
          </button>
          <button className="icon-btn" title="Fermer (Escape)" onClick={() => toggleDiff(wsId)}>
            ×
          </button>
        </span>
      </div>
      {files === null ? (
        <div className="diff-empty">chargement…</div>
      ) : files.length === 0 ? (
        <div className="diff-empty">{branch ? "Aucun changement" : "Pas un dépôt git"}</div>
      ) : (
        <div className="diff-body">
          <div className="diff-aside">
            {files.map((f) => (
              <div
                key={f.path}
                className="diff-aside-row"
                onClick={() =>
                  sectionRefs.current[f.path]?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
              >
                <span
                  className="diff-status-letter"
                  style={{ color: STATUS_BADGE[f.status].color }}
                >
                  {STATUS_BADGE[f.status].letter}
                </span>
                <span className="diff-aside-path" title={f.path}>
                  {f.path}
                </span>
                <Stats added={f.added} deleted={f.deleted} />
              </div>
            ))}
          </div>
          <div className="diff-main" ref={mainRef}>
            {files.map((f) => (
              <FileSection
                key={f.path}
                file={f}
                lines={diffs[f.path]}
                onVisible={loadFile}
                refCb={(el) => {
                  sectionRefs.current[f.path] = el;
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Mémoïsé : l'objet ws change d'identité à chaque tick des pollers (ports/branch/dirty),
 * mais l'overlay n'en consomme que id/cwd/name — la branche passe par son propre sélecteur.
 */
export const DiffOverlay = memo(
  DiffOverlayInner,
  (prev, next) =>
    prev.ws.id === next.ws.id && prev.ws.cwd === next.ws.cwd && prev.ws.name === next.ws.name,
);
```

- [ ] **Step 2 : Ajouter les styles .diff-* dans src/App.css**

Ajouter à la **fin** de `src/App.css` (après la règle `.icon-btn:hover` existante) :

```css
/* ---- Diff viewer : overlay au-dessus de la zone de grille (spec §4) ---- */
.diff-overlay {
  position: absolute;
  inset: 0;
  z-index: 500; /* sous le toast (1000) */
  background: #1e1e1e;
  display: flex;
  flex-direction: column;
  outline: none; /* le conteneur est focusé (tabIndex=-1) : pas d'anneau natif */
}

.diff-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 30px;
  flex-shrink: 0;
  padding: 0 10px;
  border-bottom: 1px solid #242424;
  color: #ddd;
  font-size: 13px;
}

.diff-toolbar-title {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-toolbar-right {
  display: flex;
  align-items: center;
  gap: 10px;
}

.diff-empty {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #6f6f6f;
  font-size: 13px;
}

.diff-body {
  flex: 1;
  display: flex;
  min-height: 0;
}

/* Aside « Files » ~220px, fidèle cmux. */
.diff-aside {
  width: 220px;
  flex-shrink: 0;
  overflow-y: auto;
  border-right: 1px solid #242424;
  padding: 4px 0;
}

.diff-aside-row {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 3px 10px;
  font-size: 12px;
  cursor: pointer;
}

.diff-aside-row:hover {
  background: #242424;
}

.diff-status-letter {
  width: 12px;
  flex-shrink: 0;
  font-weight: 600;
  font-family: monospace;
}

/* Path ellipsé à gauche (direction rtl) : la fin du chemin reste lisible. */
.diff-aside-path {
  flex: 1;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  direction: rtl;
  text-align: left;
  color: #cfcfcf;
}

.diff-stats {
  display: flex;
  gap: 5px;
  font-family: monospace;
  font-size: 11px;
  flex-shrink: 0;
}

.diff-main {
  flex: 1;
  overflow-y: auto;
  min-width: 0;
}

.diff-file-header {
  position: sticky;
  top: 0;
  z-index: 1;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 5px 10px;
  background: #1e1e1e;
  border-top: 1px solid #242424;
  border-bottom: 1px solid #242424;
  font-size: 12px;
  color: #ddd;
}

.diff-file-path {
  font-family: monospace;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diff-line {
  display: flex;
  font-family: monospace;
  font-size: 12px;
  line-height: 1.5;
}

.diff-gutter {
  width: 44px;
  flex-shrink: 0;
  text-align: right;
  padding-right: 8px;
  color: #565656;
  user-select: none;
}

.diff-text {
  flex: 1;
  min-width: 0;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.diff-line-add {
  background: rgba(46, 204, 113, 0.12);
}

.diff-line-del {
  background: rgba(231, 76, 60, 0.12);
}

.diff-line-hunk {
  color: #6f6f6f;
  background: #242424;
}

/* Seules les meta « Binary files … differ » sont rendues. */
.diff-line-meta {
  color: #6f6f6f;
  font-style: italic;
}
```

- [ ] **Step 3 : Vérifier build et tests**

```bash
cd /home/user/dev/terminals && npm run build && npm test
```

Attendu : build vert (le composant compile en TS strict, il n'est encore importé nulle part — un export non consommé ne déclenche pas `noUnusedLocals`), tous les tests passent.

Critère de vérification manuelle : différé — le composant n'est monté qu'à la tâche « Intégration du diff viewer dans App », dont le step manuel couvre toolbar, aside, sections, lazy-load et états vides.

- [ ] **Step 4 : Commit**

```bash
cd /home/user/dev/terminals && git add src/components/DiffOverlay.tsx src/App.css && git commit -m "feat(front): composant DiffOverlay — toolbar, liste Files, diff unifié lazy (spec §4)"
```

---

### Task D.3 : Clavier de l'overlay diff

**Item spec :** §4 (« Clavier (overlay focus uniquement) : j/k scroll, chord g g haut, Shift+G bas, / filtre, Escape ferme »)
**Files:**
- Modify: `src/components/DiffOverlay.tsx` (créé par la tâche « Composant DiffOverlay » — les blocs à remplacer ci-dessous en citent le texte exact)
- Modify: `src/App.css` (ajout de `.diff-filter` à la fin)

**Interfaces:**
- Consumes: `toggleDiff(wsId)` (déjà importé dans le composant) ; l'état/refs du composant de la tâche « Composant DiffOverlay ».
- Produces: rien de nouveau pour les autres tâches (comportement interne).

Règles : handler `onKeyDown` posé **sur le conteneur focusé** (`tabIndex=-1`) — AUCUN listener `window` (spec : « écouté uniquement quand l'overlay est ouvert » ; le focus du conteneur le garantit structurellement). Matching par `e.key` (caractères produits — correct en AZERTY pour des lettres/`/`, contrairement aux raccourcis Ctrl+Shift qui matchent `e.code`). Quand l'événement vient de l'input de filtre, seul Escape est traité (retour du focus à l'overlay) : taper « j » dans le filtre ne doit pas scroller, et un second Escape ferme l'overlay.

- [ ] **Step 1 : Étendre les imports et l'état du composant**

Dans `src/components/DiffOverlay.tsx`, remplacer la ligne :

```tsx
import { memo, useCallback, useEffect, useRef, useState } from "react";
```

par :

```tsx
import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
```

Puis, dans `DiffOverlayInner`, remplacer :

```tsx
  const [files, setFiles] = useState<ChangedFile[] | null>(null); // null = chargement
  const [diffs, setDiffs] = useState<Record<string, DiffLine[]>>({});
```

par :

```tsx
  const [files, setFiles] = useState<ChangedFile[] | null>(null); // null = chargement
  const [diffs, setDiffs] = useState<Record<string, DiffLine[]>>({});
  const [filter, setFilter] = useState(""); // filtre sous-chaîne de l'aside Files (touche « / »)
  const filterRef = useRef<HTMLInputElement>(null);
  const lastG = useRef(0); // timestamp du dernier « g » (chord « g g » < 500 ms)
```

- [ ] **Step 2 : Ajouter le handler clavier et la liste filtrée**

Toujours dans `DiffOverlayInner`, remplacer :

```tsx
  const totalAdded = (files ?? []).reduce((n, f) => n + (f.added ?? 0), 0);
  const totalDeleted = (files ?? []).reduce((n, f) => n + (f.deleted ?? 0), 0);
```

par :

```tsx
  const totalAdded = (files ?? []).reduce((n, f) => n + (f.added ?? 0), 0);
  const totalDeleted = (files ?? []).reduce((n, f) => n + (f.deleted ?? 0), 0);

  // Le filtre ne s'applique qu'à l'aside Files ; le main garde toutes les sections.
  const shownFiles = (files ?? []).filter((f) =>
    f.path.toLowerCase().includes(filter.toLowerCase()),
  );

  // Clavier de l'overlay — uniquement sur le conteneur focusé, aucun listener window (spec §4).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Événements venant de l'input de filtre : seul Escape est géré (retour du focus à l'overlay).
    if (e.target === filterRef.current) {
      if (e.key === "Escape") containerRef.current?.focus();
      return;
    }
    const main = mainRef.current;
    switch (e.key) {
      case "j":
        main?.scrollBy({ top: 60 });
        break;
      case "k":
        main?.scrollBy({ top: -60 });
        break;
      case "G": // Shift+G : bas du diff
        if (main) main.scrollTop = main.scrollHeight;
        break;
      case "g": {
        // Chord « g g » (deux g en < 500 ms) : haut du diff.
        const now = Date.now();
        if (now - lastG.current < 500) {
          if (main) main.scrollTop = 0;
          lastG.current = 0;
        } else {
          lastG.current = now;
        }
        break;
      }
      case "/":
        e.preventDefault(); // sinon le « / » serait tapé dans l'input fraîchement focusé
        filterRef.current?.focus();
        break;
      case "Escape":
        toggleDiff(wsId);
        break;
    }
  };
```

- [ ] **Step 3 : Brancher le handler et l'input de filtre dans le JSX**

Remplacer la ligne d'ouverture du conteneur :

```tsx
    <div ref={containerRef} tabIndex={-1} className="diff-overlay">
```

par :

```tsx
    <div ref={containerRef} tabIndex={-1} className="diff-overlay" onKeyDown={onKeyDown}>
```

Puis remplacer le début de l'aside :

```tsx
          <div className="diff-aside">
            {files.map((f) => (
```

par :

```tsx
          <div className="diff-aside">
            <input
              ref={filterRef}
              className="diff-filter"
              placeholder="filtrer ( / )"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {shownFiles.map((f) => (
```

(la fermeture `))}` de ce `.map` et le reste de la ligne de fichier ne changent pas — seul le tableau source passe de `files` à `shownFiles`).

- [ ] **Step 4 : Style de l'input de filtre**

Ajouter à la fin de `src/App.css` :

```css
/* Input de filtre de l'aside Files du diff viewer (touche « / »). */
.diff-filter {
  display: block;
  width: calc(100% - 20px);
  margin: 4px 10px 6px;
  box-sizing: border-box;
  background: #111;
  color: #eee;
  border: 1px solid #333;
  border-radius: 4px;
  padding: 3px 6px;
  font: inherit;
  font-size: 12px;
  outline: none;
}

.diff-filter:focus {
  border-color: #555;
}
```

- [ ] **Step 5 : Vérifier build et tests**

```bash
cd /home/user/dev/terminals && npm run build && npm test
```

Attendu : build vert, tests verts.

Critères de vérification manuelle (à dérouler une fois l'overlay monté — step manuel de la tâche « Intégration du diff viewer dans App ») :
1. `j`/`k` scrollent le panneau principal de ±60 px ; `Shift+G` va en bas ; `g` puis `g` (< 500 ms) remonte en haut ; un `g` isolé suivi d'un `g` après ~600 ms ne scrolle pas.
2. `/` focus l'input de filtre ; taper `src` réduit la liste Files aux chemins contenant « src » (insensible à la casse) ; le panneau principal garde toutes les sections.
3. `j` tapé DANS l'input de filtre écrit « j », ne scrolle pas.
4. Escape dans l'input rend le focus à l'overlay (l'overlay reste ouvert) ; un second Escape ferme l'overlay.
5. Après un clic sur une ligne de l'aside, Escape ferme toujours (le conteneur `tabIndex=-1` récupère le focus au clic).
6. Revue : aucun `window.addEventListener` dans `DiffOverlay.tsx` (`grep -n "addEventListener" src/components/DiffOverlay.tsx` → aucune sortie).

- [ ] **Step 6 : Commit**

```bash
cd /home/user/dev/terminals && git add src/components/DiffOverlay.tsx src/App.css && git commit -m "feat(front): clavier du diff viewer — j/k, chord gg, Shift+G, filtre /, Escape (spec §4)"
```

---

### Task D.4 : Intégration du diff viewer dans App

**Item spec :** §4 (placement : overlay au-dessus de la zone de grille uniquement, sidebar et top bar visibles ; isolation des re-renders des pollers) et §9 (test manuel : « diff viewer sur ce repo même »)
**Files:**
- Modify: `src/App.tsx` (avant ce chantier : le rendu de la grille est `<div style={{ flex: 1, minHeight: 0 }}><PaneTree ws={active} /></div>` à App.tsx:131-133 ; la tâche « Keep-alive des workspaces » du package K le remplace par un conteneur `position:"relative"` empilant TOUS les PaneTree en `position:absolute; inset:0` — cette tâche-ci s'applique APRÈS)

**Interfaces:**
- Consumes:
  - `DiffOverlay` (props `{ ws: Workspace }`, mémoïsé) — tâche « Composant DiffOverlay ».
  - `Workspace.diffOpen: boolean` — état étendu du store (tâche store du package S).
  - Structure keep-alive de la zone de grille — tâche « Keep-alive des workspaces » (package K).
- Produces: rendu conditionnel de l'overlay ; c'est le point d'ancrage visuel que les déclencheurs `toggle-diff` (raccourci Ctrl+Shift+D et clic sur la ligne meta git de la sidebar, autres packages) rendent visible.

- [ ] **Step 1 : Ajouter l'import**

Dans `src/App.tsx`, après la ligne existante :

```tsx
import { PaneTree } from "./components/PaneTree";
```

ajouter :

```tsx
import { DiffOverlay } from "./components/DiffOverlay";
```

- [ ] **Step 2 : Rendre l'overlay dans le conteneur relatif de la zone de grille**

Localiser le conteneur de la zone de grille posé par la tâche « Keep-alive des workspaces » : c'est le `div` avec `position: "relative"` (et `flex: 1, minHeight: 0`) qui contient les wrappers `position: "absolute", inset: 0` des `PaneTree` de tous les workspaces. Ajouter l'overlay comme **dernier enfant** de ce conteneur (après le `.map` des PaneTree — le `z-index: 500` de `.diff-overlay` garantit de toute façon qu'il passe au-dessus). L'optional chaining est requis : dans la structure K.3/K.4, ce conteneur n'est PAS sous la garde `{active && …}` (seule la top bar l'est), donc `active` est `Workspace | undefined` — `active?.diffOpen` narrowe `active` dans le `&&` (TS strict) :

```tsx
            {/* Diff viewer : overlay au-dessus de la grille seule — sidebar et top bar restent visibles.
                La grille reste montée dessous (keep-alive) : risque PTY nul (spec §4). */}
            {active?.diffOpen && <DiffOverlay ws={active} />}
```

Structure cible attendue (la mise en forme exacte des wrappers peut différer selon la tâche keep-alive — l'invariant est : conteneur relatif, overlay dernier enfant) :

```tsx
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
```

Note : si le refactor d'une tâche intermédiaire a remis le conteneur relatif sous une garde `{active && (…)}`, `active.diffOpen` redevient valide — mais `active?.diffOpen` reste correct dans tous les cas ; le conserver. L'isolation des re-renders est déjà portée par le composant lui-même (mémoïsé sur `ws.id/cwd/name`, branche via sélecteur dédié) : App peut continuer à re-render toutes les 2 s sans que l'overlay ne soit reconcilié.

- [ ] **Step 3 : Vérifier build et tests**

```bash
cd /home/user/dev/terminals && npm run build && npm test
```

Attendu : build vert, tests verts.

- [ ] **Step 4 : Vérification manuelle sur le repo terminials lui-même**

```bash
cd /home/user/dev/terminals && npm run tauri dev
```

Pré-requis : un déclencheur de `toggle-diff` est mergé (Ctrl+Shift+D de la tâche raccourcis, ou clic sur la ligne meta git de la sidebar). Si aucun ne l'est encore, ajouter provisoirement (non commité) `onClick={() => useWorkspaceStore.getState().toggleDiff(active.id)}` sur le span du nom dans la top bar de App.tsx, vérifier, puis retirer.

Dérouler, avec un workspace ouvert sur `~/dev/terminals` (créer au préalable un fichier modifié + un untracked : `echo test >> README.md && touch /home/user/dev/terminals/zz-untracked.txt`) :
1. Ouvrir le diff : l'overlay couvre la grille seule ; sidebar + top bar restent visibles ; toolbar = « terminals — master », compteur de fichiers, `+N` vert / `−M` rouge cohérents avec `git diff --stat`.
2. Aside : `README.md` avec lettre `M` orange et `+1`, `zz-untracked.txt` avec `?` gris ; liste triée par chemin ; clic sur un fichier → scroll smooth vers sa section.
3. Main : header de section sticky pendant le scroll ; lignes `+` fond vert translucide avec numéro new seul, lignes `−` fond rouge avec numéro old seul, contexte avec les deux numéros ; `@@` grisé sur fond #242424 ; mono 12 px.
4. Lazy : avec beaucoup de fichiers modifiés, la DevTools réseau/console ne montre les `git_file_diff` qu'au fur et à mesure du scroll (ou : les sections lointaines apparaissent vides puis se remplissent à l'approche).
5. Reload ⟳ : modifier un fichier pendant que l'overlay est ouvert → la liste ne bouge pas seule (jamais pollé) ; clic ⟳ → stats mises à jour.
6. Fermeture : bouton × et Escape ferment ; le focus revient au terminal actif (taper une commande fonctionne immédiatement, sans clic).
7. Isolation pollers : overlay ouvert > 10 s, position de scroll et texte du filtre stables, aucun clignotement au rythme des ticks 2 s.
8. États vides : workspace sur un dossier hors git (ex. `/tmp`) → « Pas un dépôt git » ; sur un repo propre → « Aucun changement ».
9. Dérouler les critères clavier 1-6 de la tâche « Clavier de l'overlay diff ».
10. Nettoyage : `git checkout README.md && rm /home/user/dev/terminals/zz-untracked.txt`.

- [ ] **Step 5 : Commit**

```bash
cd /home/user/dev/terminals && git add src/App.tsx && git commit -m "feat(front): intégration du diff viewer — overlay au-dessus de la grille keep-alive (spec §4)"
```
