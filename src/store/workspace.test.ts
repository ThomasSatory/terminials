import { describe, it, expect, beforeEach, afterEach } from "vitest";
import {
  useWorkspaceStore,
  hasAttention,
  groupHasAttention,
  sidebarOrder,
  navigableOrder,
  loadSavedState,
  getLastFolder,
  setLastFolder,
  type SavedState,
} from "./workspace";
import { PALETTE, basename } from "../lib/palette";

const store = () => useWorkspaceStore.getState();
const ws = (id: string) => store().workspaces.find((w) => w.id === id)!;
const tabIds = (id: string) => ws(id).tabs.map((t) => t.id);

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

describe("workspace store", () => {
  beforeEach(() => store().reset());

  it("crée un workspace avec 1 onglet, nom = basename, couleur de la palette, hors-groupe", () => {
    const id = store().addWorkspace("/home/x/dev/terminals");
    const w = ws(id);
    expect(w.cwd).toBe("/home/x/dev/terminals");
    expect(w.name).toBe(basename("/home/x/dev/terminals"));
    expect(w.tabs).toHaveLength(1);
    expect(w.activeTabId).toBe(w.tabs[0].id);
    expect(w.groupId).toBeNull();
    expect(PALETTE).toContain(w.color);
  });

  it("assigne les couleurs en round-robin", () => {
    const a = ws(store().addWorkspace("/a"));
    const b = ws(store().addWorkspace("/b"));
    expect(a.color).toBe(PALETTE[0]);
    expect(b.color).toBe(PALETTE[1]);
  });

  it("addTab n'a pas de limite et rend le nouvel onglet actif", () => {
    const id = store().addWorkspace("/tmp");
    for (let i = 0; i < 6; i++) store().addTab(id);
    expect(ws(id).tabs).toHaveLength(7);
    expect(ws(id).activeTabId).toBe(ws(id).tabs[6].id);
  });

  it("closeTab ferme un onglet ; fermer le dernier ferme le workspace", () => {
    const id = store().addWorkspace("/tmp");
    store().addTab(id);
    store().closeTab(id, tabIds(id)[1]);
    expect(ws(id).tabs).toHaveLength(1);
    store().closeTab(id, tabIds(id)[0]);
    expect(store().workspaces).toEqual([]);
    expect(store().activeId).toBeNull();
  });

  it("closeTab de l'onglet actif active le voisin de GAUCHE", () => {
    const id = store().addWorkspace("/tmp");
    store().addTab(id);
    store().addTab(id); // tabs = [t0, t1, t2], actif t2
    store().closeTab(id, tabIds(id)[2]);
    expect(ws(id).activeTabId).toBe(tabIds(id)[1]);
  });

  it("closeTab du premier onglet actif active celui qui prend sa place", () => {
    const id = store().addWorkspace("/tmp");
    store().addTab(id);
    const [t0, t1] = tabIds(id);
    store().setActiveTab(id, t0);
    store().closeTab(id, t0);
    expect(ws(id).activeTabId).toBe(t1);
  });

  it("closeTab d'un onglet inactif ne change pas l'actif", () => {
    const id = store().addWorkspace("/tmp");
    store().addTab(id);
    store().addTab(id); // actif t2
    const [t0, , t2] = tabIds(id);
    store().closeTab(id, t0);
    expect(ws(id).activeTabId).toBe(t2);
    expect(ws(id).tabs).toHaveLength(2);
  });

  it("closeTab d'un id inconnu est un no-op", () => {
    const id = store().addWorkspace("/tmp");
    store().closeTab(id, "tab:fantome");
    expect(ws(id).tabs).toHaveLength(1);
  });

  it("moveTab réordonne les onglets, no-op hors bornes", () => {
    const id = store().addWorkspace("/tmp");
    store().addTab(id);
    store().addTab(id);
    const [t0, t1, t2] = tabIds(id);
    store().moveTab(id, t0, 2);
    expect(tabIds(id)).toEqual([t1, t2, t0]);
    const before = ws(id);
    store().moveTab(id, t0, 7);
    expect(ws(id)).toBe(before);
  });

  it("setTabTitle pose le titre, idempotent sur la même valeur", () => {
    const id = store().addWorkspace("/tmp");
    const t0 = tabIds(id)[0];
    store().setTabTitle(id, t0, "vim");
    expect(ws(id).tabs[0].title).toBe("vim");
    const before = store().workspaces;
    store().setTabTitle(id, t0, "vim");
    expect(store().workspaces).toBe(before);
  });

  it("renomme un workspace, nom vide retombe sur le basename", () => {
    const id = store().addWorkspace("/tmp");
    store().renameWorkspace(id, "mon-env");
    expect(ws(id).name).toBe("mon-env");
    store().renameWorkspace(id, "   ");
    expect(ws(id).name).toBe("tmp");
  });

  it("setCwd change le dossier sans toucher au nom, slash final retiré", () => {
    const id = store().addWorkspace("/tmp", "agent");
    store().setCwd(id, "/srv/app/");
    expect(ws(id).cwd).toBe("/srv/app");
    expect(ws(id).name).toBe("agent");
  });

  it("setCwd puis renameWorkspace(\"\") retombe sur le basename du NOUVEAU dossier", () => {
    const id = store().addWorkspace("/tmp");
    store().setCwd(id, "/srv/app");
    store().renameWorkspace(id, "");
    expect(ws(id).name).toBe("app");
  });

  it("setCwd ne touche que le workspace visé, et pas ses onglets", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b");
    const tabs = ws(a).tabs;
    store().setCwd(a, "/c");
    expect(ws(a).tabs).toEqual(tabs);
    expect(ws(b).cwd).toBe("/b");
  });

  it("change la couleur d'un workspace", () => {
    const id = store().addWorkspace("/tmp");
    store().setColor(id, "#123456");
    expect(ws(id).color).toBe("#123456");
  });

  it("setNotification sans tabId pose le fallback unread + lastNotification", () => {
    const id = store().addWorkspace("/tmp");
    store().setNotification(id, { title: "x", body: "y" });
    expect(ws(id).unread).toBe(true);
    expect(ws(id).unreadTabs).toEqual([]);
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

  it("setNotification avec tabId allume le point de l'onglet sans fallback", () => {
    const id = store().addWorkspace("/tmp");
    store().addTab(id);
    const t0 = tabIds(id)[0];
    store().setNotification(id, { title: "n", body: "" }, t0);
    expect(ws(id).unreadTabs).toEqual([t0]);
    expect(ws(id).unread).toBe(false);
    expect(ws(id).lastNotification).toEqual({ title: "n", body: "" });
    // idempotent : pas de doublon dans unreadTabs
    store().setNotification(id, { title: "n2", body: "" }, t0);
    expect(ws(id).unreadTabs).toEqual([t0]);
  });

  it("setNotification avec un tabId inconnu retombe sur le fallback workspace", () => {
    const id = store().addWorkspace("/tmp");
    store().setNotification(id, { title: "n", body: "" }, "tab:fantome");
    expect(ws(id).unreadTabs).toEqual([]);
    expect(ws(id).unread).toBe(true);
  });

  it("setActiveTab éteint le point de l'onglet focusé, et seulement lui", () => {
    const id = store().addWorkspace("/tmp");
    store().addTab(id);
    store().addWorkspace("/autre"); // hors écran : ses onglets peuvent s'allumer
    const [t0, t1] = tabIds(id);
    store().setNotification(id, { title: "a", body: "" }, t0);
    store().setNotification(id, { title: "b", body: "" }, t1);
    store().setActiveTab(id, t0);
    expect(ws(id).unreadTabs).toEqual([t1]);
    expect(ws(id).activeTabId).toBe(t0);
  });

  it("setActive éteint le point de l'onglet affiché, pas celui des autres", () => {
    const a = store().addWorkspace("/a");
    store().addTab(a);
    const [t0, t1] = tabIds(a);
    store().setActiveTab(a, t0);
    store().addWorkspace("/b"); // actif = /b
    store().setNotification(a, { title: "n", body: "" }, t0);
    store().setNotification(a, { title: "n", body: "" }, t1);
    store().setActive(a);
    expect(ws(a).unreadTabs).toEqual([t1]);
  });

  it("setNotification sur l'onglet visible n'allume rien", () => {
    const id = store().addWorkspace("/tmp");
    const t0 = tabIds(id)[0];
    store().setNotification(id, { title: "n", body: "" }, t0);
    expect(hasAttention(ws(id))).toBe(false);
    expect(ws(id).lastNotification).toEqual({ title: "n", body: "" });
  });

  it("closeTab purge le point de l'onglet fermé", () => {
    const id = store().addWorkspace("/tmp");
    store().addTab(id);
    const t1 = tabIds(id)[1];
    store().setNotification(id, { title: "n", body: "" }, t1);
    store().closeTab(id, t1);
    expect(ws(id).unreadTabs).toEqual([]);
  });

  it("hasAttention dérive fallback OU points par onglet", () => {
    const id = store().addWorkspace("/tmp");
    store().addWorkspace("/autre"); // hors écran : ses onglets peuvent s'allumer
    expect(hasAttention(ws(id))).toBe(false);
    store().setNotification(id, { title: "n", body: "" }, tabIds(id)[0]);
    expect(hasAttention(ws(id))).toBe(true);
    store().setActiveTab(id, tabIds(id)[0]);
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

  it("requestNewWorkspace pose et efface la demande sans rien créer", () => {
    expect(store().newWorkspaceRequested).toBe(false);
    store().requestNewWorkspace(true);
    expect(store().newWorkspaceRequested).toBe(true);
    expect(store().workspaces).toHaveLength(0);
    store().requestNewWorkspace(false);
    expect(store().newWorkspaceRequested).toBe(false);
  });

  it("reset restaure sidebarVisible, renameRequestId et newWorkspaceRequested", () => {
    store().toggleSidebar();
    store().requestRename("ws:0");
    store().requestNewWorkspace(true);
    store().reset();
    expect(store().sidebarVisible).toBe(true);
    expect(store().renameRequestId).toBeNull();
    expect(store().newWorkspaceRequested).toBe(false);
  });


  it("reset vide aussi les groupes et newGroupRequested", () => {
    store().addGroup("g");
    store().requestNewGroup(true);
    store().reset();
    expect(store().groups).toEqual([]);
    expect(store().newGroupRequested).toBe(false);
  });

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

  it("closeWorkspace réactive le voisin dans l'ordre VISIBLE (groupes), pas dans le tableau", () => {
    const g = store().addGroup("g");
    const a = store().addWorkspace("/a"); // hors-groupe
    const b = store().addWorkspace("/b");
    store().assignToGroup(b, g);
    const c = store().addWorkspace("/c"); // hérite du groupe de b (actif)
    // tableau : [a, b, c] ; visible : [a | g: b, c]. On fermera c : voisin visible = b.
    store().setActive(c);
    store().closeWorkspace(c);
    expect(store().activeId).toBe(b);
    expect(a).toBeTruthy();
  });

  it("closeWorkspace purge les tabPtys du ws fermé, pas ceux des autres", () => {
    const a = store().addWorkspace("/a");
    store().addTab(a);
    const b = store().addWorkspace("/b");
    const [ta0, ta1] = tabIds(a);
    const tb0 = tabIds(b)[0];
    store().setTabPty(ta0, 10);
    store().setTabPty(ta1, 11);
    store().setTabPty(tb0, 20);
    store().closeWorkspace(a);
    expect(store().tabPtys).toEqual({ [tb0]: 20 });
  });

  it("closeWorkspace d'un id inconnu est un no-op", () => {
    const a = store().addWorkspace("/a");
    store().closeWorkspace("ws:fantome");
    expect(store().workspaces.map((w) => w.id)).toEqual([a]);
    expect(store().activeId).toBe(a);
  });
});

describe("moveWorkspace", () => {
  beforeEach(() => store().reset());

  it("déplace un workspace à l'index demandé", () => {
    const a = store().addWorkspace("/a");
    store().addWorkspace("/b");
    store().addWorkspace("/c");
    store().moveWorkspace(a, 2);
    expect(store().workspaces.map((w) => w.cwd)).toEqual(["/b", "/c", "/a"]);
  });

  it("remonte un workspace en tête", () => {
    store().addWorkspace("/a");
    store().addWorkspace("/b");
    const c = store().addWorkspace("/c");
    store().moveWorkspace(c, 0);
    expect(store().workspaces.map((w) => w.cwd)).toEqual(["/c", "/a", "/b"]);
  });

  it("déplacer n'active pas : activeId est préservé", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b");
    store().setActive(a);
    store().moveWorkspace(b, 0);
    expect(store().activeId).toBe(a);
  });

  it("id inconnu → no-op", () => {
    store().addWorkspace("/a");
    store().addWorkspace("/b");
    store().moveWorkspace("ws:inexistant", 0);
    expect(store().workspaces.map((w) => w.cwd)).toEqual(["/a", "/b"]);
  });

  it("index hors bornes → no-op (jamais de trou dans la liste)", () => {
    const a = store().addWorkspace("/a");
    store().addWorkspace("/b");
    store().moveWorkspace(a, 5);
    store().moveWorkspace(a, -1);
    expect(store().workspaces.map((w) => w.cwd)).toEqual(["/a", "/b"]);
  });

  it("l'index est relatif à l'APPARTENANCE : les hors-groupe ne bougent pas", () => {
    const g = store().addGroup("g");
    store().addWorkspace("/x"); // hors-groupe
    const a = store().addWorkspace("/a");
    store().assignToGroup(a, g);
    const b = store().addWorkspace("/b"); // dans g (hérité)
    const c = store().addWorkspace("/c"); // dans g
    store().moveWorkspace(c, 0); // en tête DU GROUPE
    const order = sidebarOrder(store().workspaces, store().groups).map((w) => w.cwd);
    expect(order).toEqual(["/x", "/c", "/a", "/b"]);
    expect(store().workspaces.find((w) => w.id === b)?.groupId).toBe(g);
  });
});

describe("groupes", () => {
  beforeEach(() => store().reset());
  const cwds = (list: { cwd: string }[]) => list.map((w) => w.cwd);

  it("addGroup crée un groupe déplié, nom vide → « Groupe », couleur de la palette", () => {
    const g = store().addGroup("  ");
    expect(store().groups).toEqual([{ id: g, name: "Groupe", color: PALETTE[0], collapsed: false }]);
    store().addGroup("h", "#123456");
    expect(store().groups[1]).toMatchObject({ name: "h", color: "#123456" });
  });

  it("renameGroup, setGroupColor, toggleGroupCollapsed", () => {
    const g = store().addGroup("g");
    store().renameGroup(g, " projet ");
    store().renameGroup(g, "  "); // vide ignoré
    store().setGroupColor(g, "#abcdef");
    store().toggleGroupCollapsed(g);
    expect(store().groups[0]).toMatchObject({ name: "projet", color: "#abcdef", collapsed: true });
    store().toggleGroupCollapsed(g);
    expect(store().groups[0].collapsed).toBe(false);
  });

  it("assignToGroup place le workspace à l'index demandé dans le groupe", () => {
    const g = store().addGroup("g");
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b");
    const c = store().addWorkspace("/c");
    store().assignToGroup(a, g);
    store().assignToGroup(b, g);
    store().assignToGroup(c, g, 0); // en tête du groupe
    expect(cwds(sidebarOrder(store().workspaces, store().groups))).toEqual(["/c", "/a", "/b"]);
    expect(store().workspaces.every((w) => w.groupId === g)).toBe(true);
  });

  it("assignToGroup(null) dégroupe et place parmi les hors-groupe", () => {
    const g = store().addGroup("g");
    const x = store().addWorkspace("/x");
    const a = store().addWorkspace("/a");
    store().assignToGroup(a, g);
    store().assignToGroup(a, null, 0);
    expect(ws(a).groupId).toBeNull();
    expect(cwds(sidebarOrder(store().workspaces, store().groups))).toEqual(["/a", "/x"]);
    expect(x).toBeTruthy();
  });

  it("assignToGroup vers un groupe inconnu est un no-op", () => {
    const a = store().addWorkspace("/a");
    const before = store().workspaces;
    store().assignToGroup(a, "grp:fantome");
    expect(store().workspaces).toBe(before);
  });

  it("addWorkspace hérite du groupe du workspace actif et s'insère en fin de groupe", () => {
    const g = store().addGroup("g");
    const a = store().addWorkspace("/a");
    store().assignToGroup(a, g);
    const x = store().addWorkspace("/x"); // hérite de g (a actif)
    expect(ws(x).groupId).toBe(g);
    store().setActive(a);
    const y = store().addWorkspace("/y");
    expect(cwds(sidebarOrder(store().workspaces, store().groups))).toEqual(["/a", "/x", "/y"]);
    expect(y).toBeTruthy();
  });

  it("removeGroup dégroupe ses workspaces sans les fermer ni toucher aux onglets", () => {
    const g = store().addGroup("g");
    const a = store().addWorkspace("/a");
    store().addTab(a);
    store().assignToGroup(a, g);
    const tabs = ws(a).tabs;
    store().removeGroup(g);
    expect(store().groups).toEqual([]);
    expect(ws(a).groupId).toBeNull();
    expect(ws(a).tabs).toBe(tabs);
  });

  it("moveGroup réordonne les groupes, no-op hors bornes", () => {
    const g = store().addGroup("g");
    const h = store().addGroup("h");
    store().moveGroup(h, 0);
    expect(store().groups.map((x) => x.id)).toEqual([h, g]);
    const before = store().groups;
    store().moveGroup(h, 5);
    expect(store().groups).toBe(before);
  });

  it("sidebarOrder : hors-groupe d'abord, puis les groupes dans leur ordre", () => {
    const g = store().addGroup("g");
    const h = store().addGroup("h");
    const a = store().addWorkspace("/a");
    store().assignToGroup(a, h);
    store().addWorkspace("/b"); // dans h (hérité)
    store().setActive(a);
    const c = store().addWorkspace("/c");
    store().assignToGroup(c, g);
    const d = store().addWorkspace("/d");
    store().assignToGroup(d, null);
    expect(cwds(sidebarOrder(store().workspaces, store().groups))).toEqual(["/d", "/c", "/a", "/b"]);
    store().moveGroup(h, 0);
    expect(cwds(sidebarOrder(store().workspaces, store().groups))).toEqual(["/d", "/a", "/b", "/c"]);
  });

  it("navigableOrder saute les workspaces des groupes repliés", () => {
    const g = store().addGroup("g");
    const a = store().addWorkspace("/a");
    store().assignToGroup(a, g);
    store().addWorkspace("/b"); // dans g
    const c = store().addWorkspace("/c");
    store().assignToGroup(c, null);
    store().toggleGroupCollapsed(g);
    expect(cwds(navigableOrder(store().workspaces, store().groups))).toEqual(["/c"]);
    store().toggleGroupCollapsed(g);
    expect(cwds(navigableOrder(store().workspaces, store().groups))).toEqual(["/c", "/a", "/b"]);
  });

  it("groupHasAttention remonte l'attention d'un membre", () => {
    const g = store().addGroup("g");
    const a = store().addWorkspace("/a");
    store().assignToGroup(a, g);
    store().addWorkspace("/autre"); // hors écran : ses onglets peuvent s'allumer
    expect(groupHasAttention(store().workspaces, g)).toBe(false);
    store().setNotification(a, { title: "n", body: "" }, tabIds(a)[0]);
    expect(groupHasAttention(store().workspaces, g)).toBe(true);
  });
});

describe("persistance v3", () => {
  const V3_KEY = "terminials:workspaces:v3";
  const V2_KEY = "terminials:workspaces:v2";
  const saved = (): SavedState =>
    JSON.parse(localStorage.getItem(V3_KEY) ?? '{"groups":[],"workspaces":[]}') as SavedState;

  beforeEach(() => {
    (globalThis as { localStorage?: Storage }).localStorage = localStorageStub();
    store().reset();
  });

  afterEach(() => {
    delete (globalThis as { localStorage?: Storage }).localStorage;
  });

  it("addWorkspace écrit {groups, workspaces} avec tabCount et groupIndex", () => {
    store().addWorkspace("/a");
    store().addWorkspace("/b");
    expect(saved()).toEqual({
      groups: [],
      workspaces: [
        { cwd: "/a", name: "a", color: PALETTE[0], tabCount: 1, groupIndex: null },
        { cwd: "/b", name: "b", color: PALETTE[1], tabCount: 1, groupIndex: null },
      ],
    });
  });

  it("addTab et closeTab réécrivent tabCount", () => {
    const id = store().addWorkspace("/a");
    store().addTab(id);
    expect(saved().workspaces[0].tabCount).toBe(2);
    store().closeTab(id, tabIds(id)[1]);
    expect(saved().workspaces[0].tabCount).toBe(1);
  });

  it("les groupes et l'appartenance sont persistés (index dans groups)", () => {
    const g = store().addGroup("g", "#111111");
    const h = store().addGroup("h", "#222222");
    const a = store().addWorkspace("/a");
    store().assignToGroup(a, h);
    store().toggleGroupCollapsed(g);
    expect(saved().groups).toEqual([
      { name: "g", color: "#111111", collapsed: true },
      { name: "h", color: "#222222", collapsed: false },
    ]);
    expect(saved().workspaces[0].groupIndex).toBe(1);
    store().removeGroup(g);
    expect(saved().groups).toHaveLength(1);
    expect(saved().workspaces[0].groupIndex).toBe(0);
  });

  it("renameWorkspace, setColor, setCwd, moveWorkspace, closeWorkspace réécrivent la sauvegarde", () => {
    const a = store().addWorkspace("/a");
    store().renameWorkspace(a, "agent");
    store().setColor(a, "#123456");
    expect(saved().workspaces[0]).toMatchObject({ cwd: "/a", name: "agent", color: "#123456" });
    store().setCwd(a, "/z");
    expect(saved().workspaces[0].cwd).toBe("/z");
    store().addWorkspace("/b");
    store().moveWorkspace(a, 1);
    expect(saved().workspaces.map((e) => e.cwd)).toEqual(["/b", "/z"]);
    store().closeWorkspace(a);
    expect(saved().workspaces.map((e) => e.cwd)).toEqual(["/b"]);
  });

  it("les anciennes clés v1/v2 ne sont plus écrites", () => {
    store().addWorkspace("/a");
    expect(localStorage.getItem("terminials:workspaces")).toBeNull();
    expect(localStorage.getItem(V2_KEY)).toBeNull();
  });

  it("une fois v3 écrite, un v2 résiduel modifié n'est plus relu", () => {
    store().addWorkspace("/a"); // écrit v3
    localStorage.setItem(V2_KEY, JSON.stringify([{ cwd: "/old", name: "o", color: "#1", paneCount: 1 }]));
    expect(loadSavedState().workspaces.map((e) => e.cwd)).toEqual(["/a"]);
  });

  it("loadSavedState relit la sauvegarde et filtre le JSON invalide", () => {
    store().addWorkspace("/a");
    expect(loadSavedState()).toEqual({
      groups: [],
      workspaces: [{ cwd: "/a", name: "a", color: PALETTE[0], tabCount: 1, groupIndex: null }],
    });
    localStorage.setItem(V3_KEY, "{pas du json");
    expect(loadSavedState()).toEqual({ groups: [], workspaces: [] });
    localStorage.setItem(
      V3_KEY,
      JSON.stringify({
        groups: [{ name: "g", color: "#1" }, { nope: 1 }],
        workspaces: [
          { cwd: "/ok", name: "ok", color: "#111111", tabCount: 2, groupIndex: 0 },
          { cwd: "/hors", name: "h", color: "#111111", tabCount: 1, groupIndex: 9 }, // index invalide → null
          { n: 1 },
        ],
      }),
    );
    expect(loadSavedState()).toEqual({
      groups: [{ name: "g", color: "#1", collapsed: false }],
      workspaces: [
        { cwd: "/ok", name: "ok", color: "#111111", tabCount: 2, groupIndex: 0 },
        { cwd: "/hors", name: "h", color: "#111111", tabCount: 1, groupIndex: null },
      ],
    });
  });

  it("migration v2 → v3 : paneCount devient tabCount, tout hors-groupe, clé v2 conservée (retour arrière possible)", () => {
    localStorage.setItem(
      V2_KEY,
      JSON.stringify([{ cwd: "/a", name: "a", color: "#111111", paneCount: 3 }, { n: 1 }]),
    );
    expect(loadSavedState()).toEqual({
      groups: [],
      workspaces: [{ cwd: "/a", name: "a", color: "#111111", tabCount: 3, groupIndex: null }],
    });
    expect(localStorage.getItem(V2_KEY)).not.toBeNull();
  });

  it("un v3 présent (même vide) prime sur un v2 résiduel", () => {
    localStorage.setItem(V2_KEY, JSON.stringify([{ cwd: "/old", name: "o", color: "#1", paneCount: 1 }]));
    localStorage.setItem(V3_KEY, JSON.stringify({ groups: [], workspaces: [] }));
    expect(loadSavedState()).toEqual({ groups: [], workspaces: [] });
  });

  it("restoreState recrée groupes et workspaces : ids frais, tabCount ≥ 1, appartenance, actif = premier", () => {
    store().restoreState({
      groups: [{ name: "g", color: "#0000ff", collapsed: true }],
      workspaces: [
        { cwd: "/a", name: "agent", color: "#123456", tabCount: 2, groupIndex: 0 },
        { cwd: "/b", name: "b", color: "#654321", tabCount: 9, groupIndex: null },
        { cwd: "/c", name: "c", color: "#111111", tabCount: 0, groupIndex: null },
      ],
    });
    const [a, b, c] = store().workspaces;
    const [g] = store().groups;
    expect(g).toMatchObject({ name: "g", color: "#0000ff", collapsed: true });
    expect(store().activeId).toBe(a.id);
    expect(a).toMatchObject({
      cwd: "/a",
      name: "agent",
      color: "#123456",
      groupId: g.id,
      unread: false,
      unreadTabs: [],
      diffOpen: false,
      ports: [],
    });
    expect(a.tabs).toHaveLength(2);
    expect(a.activeTabId).toBe(a.tabs[0].id);
    expect(b.tabs).toHaveLength(9); // plus de borne haute
    expect(b.groupId).toBeNull();
    expect(c.tabs).toHaveLength(1); // et au minimum 1
    expect(new Set(store().workspaces.map((w) => w.id)).size).toBe(3); // ids frais uniques
    expect(saved().workspaces.map((e) => e.tabCount)).toEqual([2, 9, 1]); // sauvegarde réécrite normalisée
    expect(saved().workspaces.map((e) => e.groupIndex)).toEqual([0, null, null]);
  });

  it("restoreState concatène sans écraser les workspaces créés pendant le boot", () => {
    // Un workspace créé pendant la fenêtre des invoke dir_exists du boot (bouton +,
    // commande socket) ne doit pas être détruit par la restauration.
    const live = store().addWorkspace("/live");
    store().restoreState({
      groups: [],
      workspaces: [
        { cwd: "/a", name: "a", color: "#111111", tabCount: 1, groupIndex: null },
        { cwd: "/b", name: "b", color: "#222222", tabCount: 1, groupIndex: null },
      ],
    });
    const workspaces = store().workspaces;
    expect(workspaces).toHaveLength(3);
    expect(workspaces[0].id).toBe(live); // l'existant reste en tête
    expect(workspaces.map((w) => w.cwd)).toEqual(["/live", "/a", "/b"]);
    expect(store().activeId).toBe(live); // et toujours actif (priorité à l'existant)
    expect(saved().workspaces.map((e) => e.cwd)).toEqual(["/live", "/a", "/b"]);
  });

  it("restoreState vide laisse l'état vide", () => {
    store().restoreState({ groups: [], workspaces: [] });
    expect(store().workspaces).toEqual([]);
    expect(store().groups).toEqual([]);
    expect(store().activeId).toBeNull();
  });

  it("le round-robin de couleurs continue après les workspaces restaurés", () => {
    store().restoreState({
      groups: [],
      workspaces: [
        { cwd: "/a", name: "a", color: "#111111", tabCount: 1, groupIndex: null },
        { cwd: "/b", name: "b", color: "#222222", tabCount: 1, groupIndex: null },
      ],
    });
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
    expect(loadSavedState()).toEqual({ groups: [], workspaces: [] });
    expect(getLastFolder()).toBeUndefined();
    setLastFolder("/x"); // ne jette pas
    const id = store().addWorkspace("/a"); // ne jette pas
    expect(ws(id).cwd).toBe("/a");
  });
});

describe("sondes idempotentes (git, ports)", () => {
  beforeEach(() => store().reset());

  it("setBranch sur une valeur identique ne réalloue pas l'état", () => {
    const id = store().addWorkspace("/a");
    store().setBranch(id, "master");
    const before = store().workspaces;
    store().setBranch(id, "master");
    expect(store().workspaces).toBe(before);
  });

  it("setDirty sur une valeur identique ne réalloue pas l'état", () => {
    const id = store().addWorkspace("/a");
    store().setDirty(id, true);
    const before = store().workspaces;
    store().setDirty(id, true);
    expect(store().workspaces).toBe(before);
  });

  it("les sondes ne notifient aucun abonné quand rien ne change", () => {
    const id = store().addWorkspace("/a");
    store().setBranch(id, "master");
    store().setDirty(id, true);
    store().setPorts(id, [8080]);
    let notified = 0;
    const unsub = useWorkspaceStore.subscribe(() => notified++);
    store().setBranch(id, "master");
    store().setDirty(id, true);
    store().setPorts(id, [8080]);
    unsub();
    expect(notified).toBe(0);
  });

  it("setBranch et setDirty sont indépendants : l'une ne touche pas l'autre", () => {
    // La branche est sondée à 2 s (gratuite), le dirty bien plus rarement (cher) :
    // un rafraîchissement de branche ne doit jamais écraser le dirty connu.
    const id = store().addWorkspace("/a");
    store().setDirty(id, true);
    store().setBranch(id, "feature/x");
    expect(ws(id).dirty).toBe(true);
    expect(ws(id).branch).toBe("feature/x");
    store().setDirty(id, false);
    expect(ws(id).branch).toBe("feature/x");
    expect(ws(id).dirty).toBe(false);
  });

  it("setBranch et setDirty propagent un vrai changement", () => {
    const id = store().addWorkspace("/a");
    store().setBranch(id, "master");
    store().setBranch(id, "feature/x");
    expect(ws(id).branch).toBe("feature/x");
    store().setDirty(id, true);
    expect(ws(id).dirty).toBe(true);
  });

  it("setPorts compare le CONTENU, pas la référence du tableau", () => {
    const id = store().addWorkspace("/a");
    store().setPorts(id, [3000, 8080]);
    const before = store().workspaces;
    store().setPorts(id, [3000, 8080]); // même contenu, tableau neuf
    expect(store().workspaces).toBe(before);
  });

  it("setPorts propage un ajout, un retrait et un passage à vide", () => {
    const id = store().addWorkspace("/a");
    store().setPorts(id, [3000]);
    store().setPorts(id, [3000, 8080]);
    expect(ws(id).ports).toEqual([3000, 8080]);
    store().setPorts(id, [8080]);
    expect(ws(id).ports).toEqual([8080]);
    store().setPorts(id, []);
    expect(ws(id).ports).toEqual([]);
  });

  it("une sonde sur un workspace disparu ne réalloue pas l'état", () => {
    store().addWorkspace("/a");
    const before = store().workspaces;
    store().setBranch("ws:inexistant", "master");
    store().setDirty("ws:inexistant", true);
    store().setPorts("ws:inexistant", [1234]);
    expect(store().workspaces).toBe(before);
  });
});
