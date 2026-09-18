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

const store = () => useWorkspaceStore.getState();
const ws = (id: string) => store().workspaces.find((w) => w.id === id)!;

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

  it("setCwd ne touche que le workspace visé, et pas ses panes", () => {
    const a = store().addWorkspace("/a");
    const b = store().addWorkspace("/b");
    const panes = ws(a).panes;
    store().setCwd(a, "/c");
    expect(ws(a).panes).toEqual(panes);
    expect(ws(b).cwd).toBe("/b");
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
});

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

  it("setCwd réécrit la sauvegarde", () => {
    const id = store().addWorkspace("/a", "agent");
    store().setCwd(id, "/b");
    expect(saved()[0].cwd).toBe("/b");
  });

  it("moveWorkspace réécrit l'ordre persisté (l'ordre survit au redémarrage)", () => {
    const a = store().addWorkspace("/a");
    store().addWorkspace("/b");
    store().moveWorkspace(a, 1);
    expect(saved().map((e) => e.cwd)).toEqual(["/b", "/a"]);
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

  it("restoreWorkspaces concatène sans écraser les workspaces créés pendant le boot", () => {
    // Un workspace créé pendant la fenêtre des invoke dir_exists du boot (bouton +,
    // commande socket) ne doit pas être détruit par la restauration.
    const live = store().addWorkspace("/live");
    store().restoreWorkspaces([
      { cwd: "/a", name: "a", color: "#111111", paneCount: 1 },
      { cwd: "/b", name: "b", color: "#222222", paneCount: 1 },
    ]);
    const workspaces = store().workspaces;
    expect(workspaces).toHaveLength(3);
    expect(workspaces[0].id).toBe(live); // l'existant reste en tête
    expect(workspaces.map((w) => w.cwd)).toEqual(["/live", "/a", "/b"]);
    expect(store().activeId).toBe(live); // et toujours actif (priorité à l'existant)
    // La sauvegarde réécrite reflète bien les 3 workspaces.
    expect(saved().map((e) => e.cwd)).toEqual(["/live", "/a", "/b"]);
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

/** Les pollers git et ports réécrivent l'état à chaque tick, même quand rien n'a bougé.
    Sans court-circuit, chaque tick réallouait `workspaces` → Zustand notifie → re-render
    de tout l'arbre (App s'abonne au store entier). Les sondes doivent être idempotentes. */
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
