import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks des modules à effets de bord (IPC Tauri, dialog natif GTK).
vi.mock("./pty", () => ({ closePty: vi.fn() }));
vi.mock("./openFolder", () => ({ openFolderDialog: vi.fn(() => Promise.resolve()) }));
vi.mock("./newWorkspace", () => ({ createHomeWorkspace: vi.fn(() => Promise.resolve()) }));

import { dispatchShortcut } from "./shortcutDispatch";
import { closePty } from "./pty";
import { openFolderDialog } from "./openFolder";
import { createHomeWorkspace } from "./newWorkspace";
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

  it("new-workspace crée un espace sur ~ sans passer par le dialog", () => {
    dispatchShortcut({ type: "new-workspace" });
    expect(createHomeWorkspace).toHaveBeenCalledTimes(1);
    expect(openFolderDialog).not.toHaveBeenCalled();
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
