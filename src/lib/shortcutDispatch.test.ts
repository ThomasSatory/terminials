import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks des modules à effets de bord (IPC Tauri, dialog natif GTK).
vi.mock("./pty", () => ({ closePty: vi.fn() }));
vi.mock("./openFolder", () => ({ openFolderDialog: vi.fn(() => Promise.resolve()) }));

import { dispatchShortcut } from "./shortcutDispatch";
import { closePty } from "./pty";
import { openFolderDialog } from "./openFolder";
import { registerTabFocus, unregisterTabFocus } from "./tabFocus";
import { useWorkspaceStore, sidebarOrder } from "../store/workspace";

const store = () => useWorkspaceStore.getState();
const ws = (id: string) => store().workspaces.find((w) => w.id === id)!;
const tabIds = (id: string) => ws(id).tabs.map((t) => t.id);

describe("dispatchShortcut", () => {
  beforeEach(() => {
    store().reset();
    vi.clearAllMocks();
  });

  it("open-folder ouvre le dialog natif", () => {
    dispatchShortcut({ type: "open-folder" });
    expect(openFolderDialog).toHaveBeenCalledTimes(1);
  });

  it("new-workspace demande le formulaire nom+dossier sans créer de workspace", () => {
    dispatchShortcut({ type: "new-workspace" });
    expect(store().newWorkspaceRequested).toBe(true);
    expect(store().workspaces).toHaveLength(0);
    expect(openFolderDialog).not.toHaveBeenCalled();
  });

  it("new-workspace, new-group et rename-workspace révèlent la sidebar masquée", () => {
    store().toggleSidebar();
    dispatchShortcut({ type: "new-workspace" });
    expect(store().sidebarVisible).toBe(true);

    store().toggleSidebar();
    dispatchShortcut({ type: "new-group" });
    expect(store().sidebarVisible).toBe(true);
    expect(store().newGroupRequested).toBe(true);
    expect(store().groups).toHaveLength(0); // rien créé tant que le formulaire n'est pas validé

    store().toggleSidebar();
    const id = store().addWorkspace("/a");
    dispatchShortcut({ type: "rename-workspace" });
    expect(store().sidebarVisible).toBe(true);
    expect(store().renameRequestId).toBe(id);
  });

  it("toggle-group replie/déplie le groupe du workspace actif, no-op hors-groupe", () => {
    const g = store().addGroup("g");
    const a = store().addWorkspace("/a");
    dispatchShortcut({ type: "toggle-group" });
    expect(store().groups[0].collapsed).toBe(false);
    store().assignToGroup(a, g);
    dispatchShortcut({ type: "toggle-group" });
    expect(store().groups[0].collapsed).toBe(true);
  });

  it("new-tab ajoute un onglet actif au workspace actif, sans limite", () => {
    const id = store().addWorkspace("/a");
    for (let i = 0; i < 5; i++) dispatchShortcut({ type: "new-tab" });
    expect(ws(id).tabs).toHaveLength(6);
    expect(ws(id).activeTabId).toBe(tabIds(id)[5]);
    expect(store().toast).toBeNull();
  });

  it("close-tab ferme l'onglet actif ; sur le dernier, ferme les PTYs et le workspace", () => {
    const id = store().addWorkspace("/a");
    store().addTab(id); // actif = t1
    const [t0, t1] = tabIds(id);
    store().setTabPty(t0, 10);
    store().setTabPty(t1, 11);
    dispatchShortcut({ type: "close-tab" });
    expect(ws(id).tabs).toHaveLength(1);
    expect(closePty).not.toHaveBeenCalled(); // le cleanup du TerminalPane s'en charge
    dispatchShortcut({ type: "close-tab" });
    expect(closePty).toHaveBeenCalledWith(10);
    expect(store().workspaces).toEqual([]);
  });

  it("close-workspace ferme les PTYs de tous les onglets puis retire le workspace", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b"); // actif = b
    store().addTab(b);
    const [t1, t2] = tabIds(b);
    store().setTabPty(t1, 11);
    store().setTabPty(t2, 22);
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

  it("prev/next-workspace suivent l'ordre visible avec wrap", () => {
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

  it("prev/next-workspace et select-workspace sautent les groupes repliés et suivent l'ordre visible", () => {
    const g = store().addGroup("g");
    const a = store().addWorkspace("/a");
    store().assignToGroup(a, g);
    const b = store().addWorkspace("/b"); // dans g
    const c = store().addWorkspace("/c");
    store().assignToGroup(c, null); // hors-groupe → affiché en TÊTE
    const d = store().addWorkspace("/d"); // hors-groupe (hérite de c actif)
    // visible : [c, d | g: a, b]
    store().setActive(d);
    dispatchShortcut({ type: "next-workspace" });
    expect(store().activeId).toBe(a);
    dispatchShortcut({ type: "select-workspace", index: 0 });
    expect(store().activeId).toBe(c);
    store().toggleGroupCollapsed(g);
    dispatchShortcut({ type: "prev-workspace" }); // depuis c : wrap → d (a et b sautés)
    expect(store().activeId).toBe(d);
    dispatchShortcut({ type: "select-workspace", index: 2 }); // plus que 2 visibles → no-op
    expect(store().activeId).toBe(d);
    expect(b).toBeTruthy();
  });

  it("move-workspace déplace le workspace actif dans son appartenance", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b");
    const c = store().addWorkspace("/c");
    store().setActive(b);
    dispatchShortcut({ type: "move-workspace", dir: "up" });
    expect(store().workspaces.map((w) => w.id)).toEqual([b, a, c]);
    dispatchShortcut({ type: "move-workspace", dir: "down" });
    expect(store().workspaces.map((w) => w.id)).toEqual([a, b, c]);
    expect(store().activeId).toBe(b); // déplacer ne change pas le workspace actif
  });

  it("move-workspace aux extrémités de l'appartenance est un no-op (pas de wrap)", () => {
    const g = store().addGroup("g");
    const x = store().addWorkspace("/x");
    const a = store().addWorkspace("/a");
    store().assignToGroup(a, g);
    const b = store().addWorkspace("/b"); // dans g
    store().setActive(a);
    dispatchShortcut({ type: "move-workspace", dir: "up" }); // déjà en tête de g : no-op
    expect(sidebarOrder(store().workspaces, store().groups).map((w) => w.id)).toEqual([x, a, b]);
    store().setActive(b);
    dispatchShortcut({ type: "move-workspace", dir: "down" });
    expect(sidebarOrder(store().workspaces, store().groups).map((w) => w.id)).toEqual([x, a, b]);
  });

  it("select-workspace cible l'index visible, hors bornes = no-op", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b"); // actif = b
    dispatchShortcut({ type: "select-workspace", index: 0 });
    expect(store().activeId).toBe(a);
    dispatchShortcut({ type: "select-workspace", index: 8 }); // pas de 9e workspace
    expect(store().activeId).toBe(a);
    dispatchShortcut({ type: "select-workspace", index: 1 });
    expect(store().activeId).toBe(b);
  });

  it("prev/next-tab changent l'onglet actif avec wrap et focus le terminal cible", () => {
    const id = store().addWorkspace("/a");
    store().addTab(id);
    store().addTab(id); // [t0, t1, t2], actif t2
    const [t0, t1, t2] = tabIds(id);
    const cb = vi.fn();
    registerTabFocus(t0, cb);
    dispatchShortcut({ type: "next-tab" }); // wrap → t0
    expect(ws(id).activeTabId).toBe(t0);
    expect(cb).toHaveBeenCalledTimes(1);
    dispatchShortcut({ type: "prev-tab" }); // wrap → t2
    expect(ws(id).activeTabId).toBe(t2);
    dispatchShortcut({ type: "prev-tab" });
    expect(ws(id).activeTabId).toBe(t1);
    unregisterTabFocus(t0);
  });

  it("move-tab déplace l'onglet actif, no-op aux extrémités", () => {
    const id = store().addWorkspace("/a");
    store().addTab(id);
    store().addTab(id); // [t0, t1, t2], actif t2
    const [t0, t1, t2] = tabIds(id);
    dispatchShortcut({ type: "move-tab", dir: "right" }); // déjà à droite
    expect(tabIds(id)).toEqual([t0, t1, t2]);
    dispatchShortcut({ type: "move-tab", dir: "left" });
    expect(tabIds(id)).toEqual([t0, t2, t1]);
    expect(ws(id).activeTabId).toBe(t2);
  });

  it("sans workspace actif, les actions de workspace sont des no-ops", () => {
    dispatchShortcut({ type: "new-tab" });
    dispatchShortcut({ type: "close-tab" });
    dispatchShortcut({ type: "close-workspace" });
    dispatchShortcut({ type: "rename-workspace" });
    dispatchShortcut({ type: "next-workspace" });
    dispatchShortcut({ type: "next-tab" });
    dispatchShortcut({ type: "toggle-group" });
    expect(store().workspaces).toHaveLength(0);
    expect(store().toast).toBeNull();
  });
});
