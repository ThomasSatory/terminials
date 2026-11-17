import { describe, it, expect } from "vitest";
import {
  choisirBulle,
  memeBulle,
  ongletConcerne,
  raccourciEspace,
  reclameLAttention,
  suivreArrivees,
  texteBulle,
  type Arrivees,
  type EspaceNotifiable,
} from "./agentBubble";

const ws = (id: string, o: Partial<EspaceNotifiable> = {}): EspaceNotifiable => ({
  id,
  name: `espace-${id}`,
  cwd: `/p/${id}`,
  tabs: [{ id: `${id}-t0`, title: "claude" }, { id: `${id}-t1` }],
  activeTabId: `${id}-t0`,
  unread: false,
  unreadTabs: [],
  ...o,
});
const notif = (body = "Claude attend ta réponse", title = "api") => ({ title, body });
const attend = (id: string, o: Partial<EspaceNotifiable> = {}) =>
  ws(id, { unreadTabs: [`${id}-t0`], lastNotification: notif(), ...o });

describe("reclameLAttention", () => {
  it("oui : non actif, non lu, avec notification", () => {
    expect(reclameLAttention(attend("a"), "b")).toBe(true);
    expect(reclameLAttention(ws("a", { unread: true, lastNotification: notif() }), "b")).toBe(true);
  });
  it("non : espace actif, rien de non lu, ou aucune notification à montrer", () => {
    expect(reclameLAttention(attend("a"), "a")).toBe(false);
    expect(reclameLAttention(ws("a", { lastNotification: notif() }), "b")).toBe(false);
    expect(reclameLAttention(ws("a", { unread: true }), "b")).toBe(false);
  });
});

describe("ongletConcerne", () => {
  it("le dernier onglet signalé", () => {
    expect(ongletConcerne(ws("a", { unreadTabs: ["a-t0", "a-t1"] }))).toBe("a-t1");
  });
  it("ignore un onglet signalé mais fermé", () => {
    expect(ongletConcerne(ws("a", { unreadTabs: ["a-t0", "fantome"] }))).toBe("a-t0");
  });
  it("sans onglet signalé : l'onglet actif, puis le premier", () => {
    expect(ongletConcerne(ws("a", { unread: true, activeTabId: "a-t1" }))).toBe("a-t1");
    expect(ongletConcerne(ws("a", { activeTabId: null }))).toBe("a-t0");
    expect(ongletConcerne(ws("a", { tabs: [], activeTabId: null }))).toBeNull();
  });
});

describe("texteBulle", () => {
  it("le corps fait la question, le titre le détail", () => {
    expect(texteBulle(notif("Autoriser npm ?", "api"))).toEqual({ question: "Autoriser npm ?", detail: "api" });
  });
  it("sans corps, le titre devient la question et le détail disparaît", () => {
    expect(texteBulle(notif("  ", "api"))).toEqual({ question: "api", detail: "" });
  });
  it("titre identique au corps : pas de doublon", () => {
    expect(texteBulle(notif("ok", "ok")).detail).toBe("");
  });
});

describe("suivreArrivees", () => {
  it("numérote les nouvelles notifications dans l'ordre", () => {
    const a = attend("a");
    const b = attend("b");
    const r = suivreArrivees(new Map(), 0, [a, b]);
    expect(r.arrivees.get("a")?.rang).toBe(1);
    expect(r.arrivees.get("b")?.rang).toBe(2);
    expect(r.compteur).toBe(2);
  });
  it("garde le rang tant que l'objet notification est le même, en donne un nouveau sinon", () => {
    const a = attend("a");
    const r1 = suivreArrivees(new Map(), 0, [a]);
    const r2 = suivreArrivees(r1.arrivees, r1.compteur, [a]);
    expect(r2.arrivees.get("a")?.rang).toBe(1);
    const r3 = suivreArrivees(r2.arrivees, r2.compteur, [{ ...a, lastNotification: notif() }]);
    expect(r3.arrivees.get("a")?.rang).toBe(2);
  });
  it("oublie les espaces disparus", () => {
    const r1 = suivreArrivees(new Map(), 0, [attend("a")]);
    expect(suivreArrivees(r1.arrivees, r1.compteur, []).arrivees.size).toBe(0);
  });
  it("rend la même table quand rien n'a changé, une nouvelle sinon", () => {
    const a = attend("a");
    const b = attend("b");
    const r1 = suivreArrivees(new Map(), 0, [a, b, ws("c")]);
    const r2 = suivreArrivees(r1.arrivees, r1.compteur, [a, b, ws("c")]);
    expect(r2.arrivees).toBe(r1.arrivees);
    expect(r2.compteur).toBe(r1.compteur);
    // Un espace notifié disparu : même taille impossible, nouvelle table.
    expect(suivreArrivees(r1.arrivees, r1.compteur, [a]).arrivees).not.toBe(r1.arrivees);
  });
});

describe("choisirBulle", () => {
  const arr = (rangs: Record<string, number>): Arrivees =>
    new Map(Object.entries(rangs).map(([id, rang]) => [id, { notif: notif(), rang }]));

  it("null quand personne n'attend", () => {
    expect(choisirBulle([ws("a"), ws("b")], "a", arr({}), 0)).toBeNull();
  });
  it("la plus récente des notifications, une seule", () => {
    const b = choisirBulle([attend("a"), attend("b"), attend("c")], "c", arr({ a: 1, b: 2, c: 3 }), 0);
    expect(b?.wsId).toBe("b");
    expect(b?.rang).toBe(2);
  });
  it("décrit l'espace : monogramme, contexte, onglet visé", () => {
    const b = choisirBulle([attend("a", { name: "api-paiements", branch: "fix/retry" })], null, arr({ a: 1 }), 0);
    expect(b).toMatchObject({
      mono: "ap",
      contexte: "fix/retry · onglet claude",
      tabId: "a-t0",
      question: "Claude attend ta réponse",
      detail: "api",
    });
    expect(b?.couleur).toMatch(/^#[0-9a-f]{6}$/);
  });
  it("hors dépôt et onglet sans titre", () => {
    const b = choisirBulle([attend("a", { unreadTabs: ["a-t1"] })], null, arr({ a: 1 }), 0);
    expect(b?.contexte).toBe("hors dépôt · onglet terminal");
  });
  it("la croix écarte la bulle et les plus anciennes, pas les nouvelles", () => {
    const espaces = [attend("a"), attend("b")];
    expect(choisirBulle(espaces, null, arr({ a: 1, b: 2 }), 2)).toBeNull();
    expect(choisirBulle(espaces, null, arr({ a: 1, b: 3 }), 2)?.wsId).toBe("b");
  });
  it("consulter l'espace (devenu actif) retire sa bulle", () => {
    expect(choisirBulle([attend("a")], "a", arr({ a: 1 }), 0)).toBeNull();
  });
});

describe("memeBulle / raccourciEspace", () => {
  it("compare les champs affichés", () => {
    const e = [attend("a")];
    const a = choisirBulle(e, null, new Map([["a", { notif: notif(), rang: 1 }]]), 0);
    const b = choisirBulle(e, null, new Map([["a", { notif: notif(), rang: 1 }]]), 0);
    expect(memeBulle(a, b)).toBe(true);
    expect(memeBulle(a, null)).toBe(false);
    expect(memeBulle(null, null)).toBe(true);
    expect(memeBulle(a, b && { ...b, question: "autre" })).toBe(false);
  });
  it("Ctrl 1 à Ctrl 9 seulement", () => {
    expect(raccourciEspace(0)).toBe("Ctrl 1");
    expect(raccourciEspace(8)).toBe("Ctrl 9");
    expect(raccourciEspace(9)).toBeNull();
    expect(raccourciEspace(-1)).toBeNull();
  });
});
