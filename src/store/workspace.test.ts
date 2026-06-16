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
