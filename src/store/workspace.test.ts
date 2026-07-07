import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore, MAX_PANES, hasAttention } from "./workspace";
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

  it("recalcule le pane actif en fermant un pane du milieu", () => {
    const id = store().addWorkspace("/tmp");
    store().addPane(id); // 2
    store().addPane(id); // 3 → panes = [p0, p1, p2]
    const middle = ws(id).panes[1];
    store().setActivePane(id, middle);
    store().closePane(id, middle);
    expect(ws(id).panes).toHaveLength(2);
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

  it("gère un toast transitoire", () => {
    store().showToast("max 4 terminaux");
    expect(store().toast).toBe("max 4 terminaux");
    store().clearToast();
    expect(store().toast).toBeNull();
  });
});
