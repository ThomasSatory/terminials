import { describe, it, expect } from "vitest";
import { CLASSES, decider, peutValider, type AppelGarde, type ContexteGardeFou } from "./gardeFou";
import { PAIRE_SUPERVISEUR, type NiveauAutonomie } from "./reglages";
import type { Origine, OutilId } from "./outilsProtocole";

const SUP: Origine = { type: "superviseur" };
const ESPACE: Origine = { type: "espace", workspaceId: "ws:1", ptyId: 4 };
const EXTERNE: Origine = { type: "externe" };

const ctx = (o: Partial<ContexteGardeFou> = {}): ContexteGardeFou => ({
  actif: true,
  pause: false,
  niveau: "agir",
  paires: [],
  ...o,
});
const appel = (outil: OutilId, o: Partial<AppelGarde> = {}): AppelGarde => ({
  outil,
  origine: SUP,
  paire: null,
  cibleBloquee: false,
  cibleOccupee: false,
  ...o,
});
const type = (a: AppelGarde, c: ContexteGardeFou) => decider(a, c).type;

const OBSERVER: OutilId[] = ["espaces.etat", "terminal.lire", "notifier"];
const REORGANISER: OutilId[] = [
  "espace.creer",
  "espace.renommer",
  "espace.deplacer",
  "espace.fermer",
  "groupe.creer",
  "onglet.ouvrir",
  "espace.focus",
];
const ECRIRE: OutilId[] = ["terminal.ecrire", "session.demander", "session.repondre"];

describe("classes des outils", () => {
  // Même table que `classes_des_outils` de crates/protocol.
  it("table identique au Rust", () => {
    expect(CLASSES).toEqual({
      "espaces.etat": "observer",
      "terminal.lire": "observer",
      notifier: "observer",
      demander: "observer",
      "espace.creer": "reorganiser",
      "espace.renommer": "reorganiser",
      "espace.deplacer": "reorganiser",
      "espace.fermer": "reorganiser",
      "groupe.creer": "reorganiser",
      "onglet.ouvrir": "reorganiser",
      "espace.focus": "reorganiser",
      "terminal.ecrire": "ecrire",
      "session.demander": "ecrire",
      "session.repondre": "ecrire",
    });
  });
});

describe("garde-fou — superviseur", () => {
  it("désactivé ou en pause : tout est refusé", () => {
    for (const o of [...OBSERVER, ...REORGANISER, ...ECRIRE]) {
      expect(type(appel(o), ctx({ actif: false }))).toBe("refuser");
      expect(type(appel(o), ctx({ pause: true }))).toBe("refuser");
    }
  });

  it.each<[NiveauAutonomie, string, string, string]>([
    ["observer", "executer", "refuser", "refuser"],
    ["reorganiser", "executer", "executer", "refuser"],
    ["agir", "executer", "executer", "valider"],
  ])("niveau %s : observer → %s, réorganiser → %s, écrire → %s", (niveau, obs, reorg, ecr) => {
    for (const o of OBSERVER) expect(type(appel(o), ctx({ niveau }))).toBe(obs);
    for (const o of REORGANISER) expect(type(appel(o), ctx({ niveau }))).toBe(reorg);
    for (const o of ECRIRE) expect(type(appel(o), ctx({ niveau }))).toBe(ecr);
  });

  it("une paire autorisée dispense de validation les seuls échanges", () => {
    const c = ctx({ paires: [{ a: "/api", b: "/site", depuis: 0, echanges: 0 }] });
    const paire = ["/site", "/api"] as const;
    expect(type(appel("session.demander", { paire }), c)).toBe("executer");
    expect(type(appel("session.repondre", { paire }), c)).toBe("executer");
    // Écriture libre dans un terminal : toujours une carte.
    expect(type(appel("terminal.ecrire", { paire }), c)).toBe("valider");
    // Autre paire : carte.
    expect(type(appel("session.repondre", { paire: ["/site", "/infra"] }), c)).toBe("valider");
  });

  it("paire espace ↔ superviseur", () => {
    const c = ctx({ paires: [{ a: "/notif", b: PAIRE_SUPERVISEUR, depuis: 0, echanges: 0 }] });
    expect(type(appel("session.repondre", { paire: [PAIRE_SUPERVISEUR, "/notif"] }), c)).toBe("executer");
  });

  it("jamais d'écriture sans validation dans une session bloquée sur une autorisation", () => {
    const c = ctx({ paires: [{ a: "/api", b: "/site", depuis: 0, echanges: 0 }] });
    const d = decider(appel("session.demander", { paire: ["/site", "/api"], cibleBloquee: true }), c);
    expect(d.type).toBe("valider");
    // Bloquée mais niveau insuffisant : refus, pas de carte.
    expect(type(appel("terminal.ecrire", { cibleBloquee: true }), ctx({ niveau: "reorganiser" }))).toBe("refuser");
  });

  it("ne ferme pas un espace où un agent travaille ou attend", () => {
    expect(type(appel("espace.fermer", { cibleOccupee: true }), ctx())).toBe("refuser");
    expect(type(appel("espace.fermer"), ctx({ niveau: "reorganiser" }))).toBe("executer");
  });

  it("le superviseur ne se sert pas de « demander »", () => {
    expect(type(appel("demander"), ctx())).toBe("refuser");
  });

  it("les refus portent une raison", () => {
    const d = decider(appel("espace.creer"), ctx({ niveau: "observer" }));
    expect(d.type === "refuser" && d.raison.length > 0).toBe(true);
  });
});

describe("garde-fou — depuis un espace ou l'extérieur", () => {
  it("observer : permis, même superviseur désactivé", () => {
    for (const o of OBSERVER) {
      expect(type(appel(o, { origine: ESPACE }), ctx({ actif: false }))).toBe("executer");
      expect(type(appel(o, { origine: EXTERNE }), ctx({ niveau: "observer" }))).toBe("executer");
    }
  });

  it("réorganiser et écrire : réservés au superviseur, quel que soit le niveau", () => {
    for (const o of [...REORGANISER, ...ECRIRE]) {
      expect(type(appel(o, { origine: ESPACE }), ctx())).toBe("refuser");
      expect(type(appel(o, { origine: EXTERNE }), ctx())).toBe("refuser");
    }
  });

  it("demander : depuis un espace, superviseur actif et hors pause", () => {
    expect(type(appel("demander", { origine: ESPACE }), ctx({ niveau: "observer" }))).toBe("executer");
    expect(type(appel("demander", { origine: ESPACE }), ctx({ actif: false }))).toBe("refuser");
    expect(type(appel("demander", { origine: ESPACE }), ctx({ pause: true }))).toBe("refuser");
    expect(type(appel("demander", { origine: EXTERNE }), ctx())).toBe("refuser");
  });
});

describe("peutValider", () => {
  it("niveau Agir, actif, hors pause", () => {
    expect(peutValider(ctx()).ok).toBe(true);
    expect(peutValider(ctx({ niveau: "reorganiser" })).ok).toBe(false);
    expect(peutValider(ctx({ pause: true })).ok).toBe(false);
    expect(peutValider(ctx({ actif: false })).ok).toBe(false);
  });
});
