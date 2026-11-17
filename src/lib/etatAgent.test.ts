import { describe, it, expect } from "vitest";
import { etatEspace, etatOnglet, etatVisuelAvatar, type SourcesTravail } from "./etatAgent";

const tabs = [{ id: "t0" }, { id: "t1" }];
const calme: SourcesTravail = { tabPtys: { t0: 10, t1: 11 }, busyPtys: {} };
const occupe: SourcesTravail = { tabPtys: { t0: 10, t1: 11 }, busyPtys: { 11: true } };

describe("etatEspace", () => {
  it("repos sans notification ni PTY occupé", () => {
    expect(etatEspace({ tabs, unread: false, unreadTabs: [] }, calme)).toBe("repos");
  });

  it("travail dès qu'un onglet a son PTY occupé", () => {
    expect(etatEspace({ tabs, unread: false, unreadTabs: [] }, occupe)).toBe("travail");
  });

  it("un PTY occupé d'un autre espace ne compte pas", () => {
    expect(etatEspace({ tabs: [{ id: "t0" }], unread: false, unreadTabs: [] }, occupe)).toBe("repos");
  });

  it("onglet sans PTY (pas encore lancé) : repos", () => {
    expect(etatEspace({ tabs: [{ id: "t9" }], unread: false, unreadTabs: [] }, occupe)).toBe("repos");
  });

  it("attente sur notification d'onglet ou de repli espace, prioritaire sur le travail", () => {
    expect(etatEspace({ tabs, unread: false, unreadTabs: ["t0"] }, occupe)).toBe("attente");
    expect(etatEspace({ tabs, unread: true, unreadTabs: [] }, occupe)).toBe("attente");
    expect(etatEspace({ tabs, unread: true, unreadTabs: [] }, calme)).toBe("attente");
  });
});

describe("etatOnglet", () => {
  it("distingue chaque onglet", () => {
    const w = { unreadTabs: ["t0"] };
    expect(etatOnglet(w, "t0", occupe)).toBe("attente");
    expect(etatOnglet(w, "t1", occupe)).toBe("travail");
    expect(etatOnglet({ unreadTabs: [] }, "t0", occupe)).toBe("repos");
  });
});

describe("état « terminé »", () => {
  const fini: SourcesTravail = { tabPtys: { t0: 10, t1: 11 }, busyPtys: {}, tabsTermines: { t1: true } };

  it("un onglet terminé rend l'espace « termine »", () => {
    expect(etatEspace({ tabs, unread: false, unreadTabs: [] }, fini)).toBe("termine");
    expect(etatOnglet({ unreadTabs: [] }, "t1", fini)).toBe("termine");
    expect(etatOnglet({ unreadTabs: [] }, "t0", fini)).toBe("repos");
  });

  it("l'attente puis le travail l'emportent sur « terminé »", () => {
    expect(etatEspace({ tabs, unread: false, unreadTabs: ["t1"] }, fini)).toBe("attente");
    expect(etatOnglet({ unreadTabs: ["t1"] }, "t1", fini)).toBe("attente");
    const reparti = { ...fini, busyPtys: { 10: true as const } };
    expect(etatEspace({ tabs, unread: false, unreadTabs: [] }, reparti)).toBe("travail");
  });

  it("un onglet terminé d'un autre espace ne compte pas", () => {
    expect(etatEspace({ tabs: [{ id: "t0" }], unread: false, unreadTabs: [] }, fini)).toBe("repos");
  });

  it("l'avatar dessine « terminé » comme le repos", () => {
    expect(etatVisuelAvatar("termine")).toBe("repos");
    expect(etatVisuelAvatar("attente")).toBe("attente");
    expect(etatVisuelAvatar("travail")).toBe("travail");
  });
});
