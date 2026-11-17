import { describe, it, expect } from "vitest";
import {
  cleEtatsEspaces,
  lireCleEtats,
  pluriel,
  ligneDepot,
  texteNotification,
  detailEspace,
  infobulleEspace,
  libelleAvatar,
  raccourciEspace,
  infoPile,
  libelleEtiquette,
  type InfoEspace,
} from "./dockInfo";

const espace = (p: Partial<InfoEspace> = {}): InfoEspace => ({ name: "site-vitrine", ports: [], ...p });

describe("pluriel", () => {
  it("accorde au-delà de 1", () => {
    expect(pluriel(1, "espace")).toBe("1 espace");
    expect(pluriel(4, "espace")).toBe("4 espaces");
    expect(pluriel(0, "espace")).toBe("0 espace");
  });
});

describe("ligneDepot", () => {
  it("branche, point de modification et ports, au format des maquettes", () => {
    expect(ligneDepot({ branch: "feat/hero-anim", dirty: true, ports: [5173] })).toBe("feat/hero-anim •  ·  :5173");
    expect(ligneDepot({ branch: "main", dirty: false, ports: [] })).toBe("main");
    expect(ligneDepot({ branch: "main", ports: [3000, 9090] })).toBe("main  ·  :3000,9090");
  });

  it("hors dépôt git", () => {
    expect(ligneDepot({ ports: [] })).toBe("hors dépôt");
    expect(ligneDepot({ ports: [8080] })).toBe("hors dépôt  ·  :8080");
  });
});

describe("texteNotification", () => {
  it("le corps (la question), sinon le titre", () => {
    expect(texteNotification({ title: "Claude Code", body: "Autoriser npm run migrate ?" })).toBe(
      "Autoriser npm run migrate ?",
    );
    expect(texteNotification({ title: "Session terminée", body: "  " })).toBe("Session terminée");
    expect(texteNotification(undefined)).toBe("");
  });
});

describe("detailEspace", () => {
  it("attente : la question en accent", () => {
    const w = espace({ lastNotification: { title: "t", body: "Autoriser ?" } });
    expect(detailEspace(w, "attente")).toEqual({ texte: "Autoriser ?", ton: "attente" });
    expect(detailEspace(espace(), "attente")).toEqual({ texte: "Vous attend", ton: "attente" });
  });

  it("travail : le statut poussé, sinon un libellé générique, en cyan", () => {
    expect(detailEspace(espace({ status: { label: "Lancement des tests…" } }), "travail")).toEqual({
      texte: "Lancement des tests…",
      ton: "travail",
    });
    expect(detailEspace(espace(), "travail").texte).toBe("Au travail…");
  });

  it("repos : la ligne dépôt, discrète", () => {
    expect(detailEspace(espace({ branch: "main" }), "repos")).toEqual({ texte: "main", ton: "discret" });
  });
});

describe("infobulleEspace", () => {
  it("au repos : rien de plus que la branche sans statut ni notification", () => {
    expect(infobulleEspace(espace({ branch: "main" }), "repos")).toEqual({
      detail: "main",
      ton: "discret",
      lignes: [],
      progression: null,
    });
  });

  it("deux lignes comme la maquette : ni branche, ni statut, ni notification en plus", () => {
    const w = espace({ branch: "fix/retry", dirty: true, lastNotification: { title: "t", body: "Autoriser ?" } });
    const i = infobulleEspace(w, "attente");
    expect(i.detail).toBe("Autoriser ?");
    expect(i.lignes).toEqual([]);
    const repos = infobulleEspace(
      espace({ branch: "main", status: { label: "déploiement" }, lastNotification: { title: "Fin", body: "" } }),
      "repos",
    );
    expect(repos.lignes).toEqual([]);
  });

  it("progression poussée par la CLI : son libellé, bornée", () => {
    const i = infobulleEspace(espace({ branch: "main", progress: { value: 1.4, label: "3/4 étapes" } }), "repos");
    expect(i.lignes).toEqual(["3/4 étapes"]);
    expect(i.progression).toBe(1);
  });

  it("en relais : qui l'agent attend, au ton du texte (maquette Superviseur)", () => {
    const i = infobulleEspace(espace({ branch: "feat/hero-anim", attendDe: "api-paiements" }), "travail");
    expect(i).toMatchObject({ detail: "attend api-paiements", ton: "relais" });
  });
});

describe("libellés", () => {
  it("avatar : nom, état de l'agent, actions sur l'espace ouvert", () => {
    expect(libelleAvatar("notes", "repos", false)).toBe("notes");
    expect(libelleAvatar("api", "attente", false)).toBe("api, un agent vous attend");
    expect(libelleAvatar("term", "travail", true)).toBe("term, un agent travaille : actions de l’espace");
  });

  it("étiquette de groupe", () => {
    expect(libelleEtiquette("ops", 4, false)).toBe("Replier le groupe ops (4 espaces)");
    expect(libelleEtiquette("ops", 1, true)).toBe("Déplier le groupe ops (1 espace)");
  });

  it("raccourci : rang navigable, rien au-delà de 9 ou hors navigation", () => {
    const ordre = ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j"];
    expect(raccourciEspace(ordre, "a")).toBe("Ctrl 1");
    expect(raccourciEspace(ordre, "i")).toBe("Ctrl 9");
    expect(raccourciEspace(ordre, "j")).toBe("");
    expect(raccourciEspace(ordre, "replie")).toBe("");
  });
});

describe("infoPile", () => {
  const base = { nomGroupe: "services", nbMembres: 5, attente: null, travail: null, auto: false };

  it("l'attente prime : nom · question, en accent", () => {
    const p = infoPile({ ...base, attente: { nom: "api", texte: "Autoriser ?" }, travail: { nom: "ci", texte: "…" } });
    expect(p.sousTitre).toBe("api · Autoriser ?");
    expect(p.ton).toBe("attente");
    expect(p.libelle).toBe("Déplier le groupe services, 5 espaces, un agent vous attend");
    expect(p.compte).toBe("5 espaces");
  });

  it("puis le travail, puis la raison du repli", () => {
    expect(infoPile({ ...base, travail: { nom: "ci", texte: "Analyse…" } }).sousTitre).toBe("ci · Analyse…");
    expect(infoPile({ ...base, auto: true }).sousTitre).toBe("Replié faute de place · cliquer pour déplier");
    expect(infoPile(base).sousTitre).toBe("Cliquer pour déplier");
    expect(infoPile(base).ton).toBe("discret");
  });
});

describe("clé des états d'agent", () => {
  const sources = { tabPtys: { a0: 1, b0: 2 }, busyPtys: { 2: true as const }, tabsTermines: {} };
  const espaces = [
    { id: "ws:a", tabs: [{ id: "a0" }], unread: true, unreadTabs: [] },
    { id: "ws:b", tabs: [{ id: "b0" }], unread: false, unreadTabs: [] },
    { id: "ws:c=x", tabs: [{ id: "c0" }], unread: false, unreadTabs: [] },
  ];

  it("aller-retour, ids contenant « = » compris", () => {
    const cle = cleEtatsEspaces(espaces, sources);
    expect(cle).toBe("ws:a=attente|ws:b=travail|ws:c=x=repos");
    expect([...lireCleEtats(cle)]).toEqual([
      ["ws:a", "attente"],
      ["ws:b", "travail"],
      ["ws:c=x", "repos"],
    ]);
  });

  it("chaîne vide : aucun état", () => {
    expect(lireCleEtats("").size).toBe(0);
  });

  it("onglet terminé : « termine » dans la clé, infobulle et libellé", () => {
    const fini = { ...sources, busyPtys: {}, tabsTermines: { b0: true as const } };
    expect(cleEtatsEspaces([espaces[1]], fini)).toBe("ws:b=termine");
    const info = infobulleEspace({ name: "api", ports: [], sujetTermine: "Migration" }, "termine");
    expect(info.detail).toBe("Terminé : Migration");
    expect(info.ton).toBe("termine");
    expect(libelleAvatar("api", "termine", false)).toBe("api, l’agent a terminé");
  });
});
