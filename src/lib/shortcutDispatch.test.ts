import { describe, it, expect, beforeEach, vi } from "vitest";

// Mocks des modules à effets de bord (IPC Tauri, dialog natif GTK).
vi.mock("./pty", () => ({ closePty: vi.fn(), ptyCwd: vi.fn(() => Promise.resolve(null)) }));
vi.mock("./openFolder", () => ({ openFolderDialog: vi.fn(() => Promise.resolve()) }));

import { dispatchShortcut, fermerEspace, fermerTousLesEspaces } from "./shortcutDispatch";
import { closePty, ptyCwd } from "./pty";
import { openFolderDialog } from "./openFolder";
import { registerTabFocus, unregisterTabFocus } from "./tabFocus";
import { useWorkspaceStore, sidebarOrder } from "../store/workspace";
import { useUiStore } from "../store/ui";
import { useDashboardStore } from "../store/dashboard";
import { useReglagesStore } from "../store/reglages";
import { useSuperviseurStore } from "../store/superviseur";

const store = () => useWorkspaceStore.getState();
const ui = () => useUiStore.getState();
const ws = (id: string) => store().workspaces.find((w) => w.id === id)!;
const tabIds = (id: string) => ws(id).tabs.map((t) => t.id);

describe("dispatchShortcut", () => {
  beforeEach(() => {
    store().reset();
    ui().reset();
    useDashboardStore.getState().close();
    vi.clearAllMocks();
  });

  it("open-folder ouvre le dialog natif", () => {
    dispatchShortcut({ type: "open-folder" });
    expect(openFolderDialog).toHaveBeenCalledTimes(1);
  });

  it("new-workspace ouvre le popover de création sans créer de workspace", () => {
    dispatchShortcut({ type: "new-workspace" });
    expect(ui().popoverEspace).toEqual({ mode: "creer" });
    expect(store().workspaces).toHaveLength(0);
    expect(openFolderDialog).not.toHaveBeenCalled();
  });

  it("new-workspace, new-group et rename-workspace réaffichent le dock masqué", () => {
    ui().basculerDock();
    dispatchShortcut({ type: "new-workspace" });
    expect(ui().dockVisible).toBe(true);

    ui().basculerDock();
    dispatchShortcut({ type: "new-group" });
    expect(ui().dockVisible).toBe(true);
    expect(ui().formulaireGroupe).toEqual({ mode: "creer" });
    expect(store().groups).toHaveLength(0); // rien créé tant que le formulaire n'est pas validé

    ui().basculerDock();
    const id = store().addWorkspace("/a");
    dispatchShortcut({ type: "rename-workspace" });
    expect(ui().dockVisible).toBe(true);
    expect(ui().popoverEspace).toEqual({ mode: "modifier", wsId: id });
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

  it("new-tab ajoute un onglet actif au workspace actif, sans limite", async () => {
    const id = store().addWorkspace("/a");
    for (let i = 0; i < 5; i++) dispatchShortcut({ type: "new-tab" });
    await vi.waitFor(() => expect(ws(id).tabs).toHaveLength(6));
    expect(ws(id).activeTabId).toBe(tabIds(id)[5]);
    expect(store().toast).toBeNull();
  });

  it("new-tab ouvre l'onglet dans le dossier courant du shell de l'onglet actif", async () => {
    const id = store().addWorkspace("/a");
    store().setTabPty(tabIds(id)[0], 3);
    vi.mocked(ptyCwd).mockResolvedValueOnce("/a/sous-dossier");
    dispatchShortcut({ type: "new-tab" });
    await vi.waitFor(() => expect(ws(id).tabs).toHaveLength(2));
    expect(ws(id).tabs[1].cwd).toBe("/a/sous-dossier");
    expect(ptyCwd).toHaveBeenCalledWith(3);
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

  it("close-workspace active le SUIVANT dans le dock, et referme les calques de l'espace", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b");
    const c = store().addWorkspace("/c");
    store().setActive(b);
    ui().ouvrirMenuEspace(b);
    dispatchShortcut({ type: "close-workspace" });
    expect(store().workspaces.map((w) => w.id)).toEqual([a, c]);
    expect(store().activeId).toBe(c);
    expect(ui().menuEspace).toBeNull();
  });

  it("close-workspace refuse le DERNIER espace, sans toast, comme l'entrée grisée du menu", () => {
    const a = store().addWorkspace("/a");
    store().setTabPty(tabIds(a)[0], 7);
    dispatchShortcut({ type: "close-workspace" });
    expect(store().workspaces.map((w) => w.id)).toEqual([a]);
    expect(closePty).not.toHaveBeenCalledWith(7);
    expect(store().toast).toBeNull();
  });

  it("fermerEspace (menu) : même règle, id inconnu ignoré", () => {
    const a = store().addWorkspace("/a");
    expect(fermerEspace(a)).toBe(false);
    expect(store().toast).toBeNull();
    const b = store().addWorkspace("/b");
    expect(fermerEspace("ws:inconnu")).toBe(false);
    expect(fermerEspace(a)).toBe(true);
    expect(store().workspaces.map((w) => w.id)).toEqual([b]);
  });

  it("fermerTousLesEspaces ferme tout, le dernier compris, PTY d'abord, et laisse les groupes", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b");
    store().setTabPty(tabIds(a)[0], 7);
    store().setTabPty(tabIds(b)[0], 8);
    const g = store().addGroup("rangement");
    ui().ouvrirMenuEspace(b);
    ui().setVue("mosaique");
    expect(fermerTousLesEspaces()).toBe(2);
    expect(store().workspaces).toEqual([]);
    expect(store().activeId).toBeNull();
    expect(closePty).toHaveBeenCalledWith(7);
    expect(closePty).toHaveBeenCalledWith(8);
    expect(ui().menuEspace).toBeNull();
    expect(ui().vue).toBe("terminal");
    expect(store().groups.map((x) => x.id)).toEqual([g]);
  });

  it("rename-workspace ouvre le popover de modification de l'espace actif", () => {
    const id = store().addWorkspace("/a");
    dispatchShortcut({ type: "rename-workspace" });
    expect(ui().popoverEspace).toEqual({ mode: "modifier", wsId: id });
  });

  it("toggle-diff bascule diffOpen du workspace actif", () => {
    const id = store().addWorkspace("/a");
    dispatchShortcut({ type: "toggle-diff" });
    expect(ws(id).diffOpen).toBe(true);
    dispatchShortcut({ type: "toggle-diff" });
    expect(ws(id).diffOpen).toBe(false);
  });

  it("toggle-dock masque puis réaffiche le dock", () => {
    expect(ui().dockVisible).toBe(true);
    dispatchShortcut({ type: "toggle-dock" });
    expect(ui().dockVisible).toBe(false);
    dispatchShortcut({ type: "toggle-dock" });
    expect(ui().dockVisible).toBe(true);
  });

  it("toggle-palette ouvre puis ferme la palette", () => {
    dispatchShortcut({ type: "toggle-palette" });
    expect(ui().paletteOuverte).toBe(true);
    dispatchShortcut({ type: "toggle-palette" });
    expect(ui().paletteOuverte).toBe(false);
  });

  it("toggle-mosaique bascule la vue et referme récap et diff qui la masqueraient", () => {
    const id = store().addWorkspace("/a");
    store().toggleDiff(id);
    useDashboardStore.getState().toggle();
    dispatchShortcut({ type: "toggle-mosaique" });
    expect(ui().vue).toBe("mosaique");
    expect(ws(id).diffOpen).toBe(false);
    expect(useDashboardStore.getState().open).toBe(false);
    dispatchShortcut({ type: "toggle-mosaique" });
    expect(ui().vue).toBe("terminal");
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

  it("aller à un espace au clavier quitte le récap, la mosaïque et les calques", () => {
    const a = store().addWorkspace("/tmp/a");
    const b = store().addWorkspace("/tmp/b");
    store().setActive(a);

    useDashboardStore.getState().toggle();
    ui().setVue("mosaique");
    ui().ouvrirPalette();
    dispatchShortcut({ type: "select-workspace", index: 1 });
    expect(store().activeId).toBe(b);
    expect(useDashboardStore.getState().open).toBe(false);
    expect(ui().vue).toBe("terminal");
    expect(ui().paletteOuverte).toBe(false);

    ui().setVue("mosaique");
    dispatchShortcut({ type: "next-workspace" });
    expect(store().activeId).toBe(a);
    expect(ui().vue).toBe("terminal");
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
    expect(ui().popoverEspace).toBeNull();
  });

  it("toggle-parametres ouvre et ferme la vue Paramètres, et ferme le récap", () => {
    useDashboardStore.getState().toggle();
    dispatchShortcut({ type: "toggle-parametres" });
    expect(ui().parametres?.section).toBe("apparence");
    expect(useDashboardStore.getState().open).toBe(false);
    dispatchShortcut({ type: "toggle-parametres" });
    expect(ui().parametres).toBeNull();
  });

  it("aller à un espace, la mosaïque, le récap ou un nouvel onglet ferment les Paramètres", () => {
    const a = store().addWorkspace("/a");
    store().addWorkspace("/b");
    for (const action of [
      { type: "select-workspace", index: 0 },
      { type: "toggle-mosaique" },
      { type: "toggle-dashboard" },
      { type: "new-tab" },
    ] as const) {
      ui().ouvrirParametres("terminal");
      dispatchShortcut(action);
      expect(ui().parametres).toBeNull();
    }
    expect(store().activeId).toBe(a);
  });

  it("toggle-superviseur : panneau si actif, sinon son réglage dans les Paramètres", () => {
    useReglagesStore.getState().reset();
    useSuperviseurStore.getState().reset();
    dispatchShortcut({ type: "toggle-superviseur" });
    expect(useSuperviseurStore.getState().panneauOuvert).toBe(false);
    expect(ui().parametres?.section).toBe("superviseur");
    ui().fermerParametres();
    useReglagesStore.getState().setSuperviseurActif(true);
    dispatchShortcut({ type: "toggle-superviseur" });
    expect(useSuperviseurStore.getState().panneauOuvert).toBe(true);
    dispatchShortcut({ type: "toggle-superviseur" });
    expect(useSuperviseurStore.getState().panneauOuvert).toBe(false);
    useReglagesStore.getState().reset();
  });
});
