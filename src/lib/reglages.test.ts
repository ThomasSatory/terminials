import { describe, it, expect } from "vitest";
import {
  REGLAGES_DEFAUT,
  avecPaire,
  clePaire,
  compterEchange,
  couleurHex,
  normaliserReglages,
  paireAutorisee,
  reglagesReinitialises,
  sansPaire,
  shellEffectif,
} from "./reglages";

describe("normaliserReglages", () => {
  it("rend les défauts pour une entrée vide ou illisible", () => {
    expect(normaliserReglages(undefined)).toEqual(REGLAGES_DEFAUT);
    expect(normaliserReglages("x")).toEqual(REGLAGES_DEFAUT);
    expect(normaliserReglages({})).toEqual(REGLAGES_DEFAUT);
  });

  it("le superviseur est désactivé par défaut, au niveau Observer", () => {
    expect(REGLAGES_DEFAUT.superviseur.actif).toBe(false);
    expect(REGLAGES_DEFAUT.superviseur.niveau).toBe("observer");
  });

  it("complète un JSON partiel", () => {
    const r = normaliserReglages({ superviseur: { actif: true, niveau: "agir" } });
    expect(r.superviseur.actif).toBe(true);
    expect(r.superviseur.niveau).toBe("agir");
    expect(r.superviseur.nom).toBe("Superviseur");
    expect(r.terminal).toEqual(REGLAGES_DEFAUT.terminal);
  });

  it("ramène les valeurs dans leur domaine (mêmes règles que le Rust)", () => {
    const r = normaliserReglages({
      apparence: { accent: " #B4F461 ", densite: "géante" },
      terminal: { taillePolice: 99, defilement: 4000, dossierDepart: "  ", police: "comic" },
      superviseur: { nom: "   ", niveau: "tout" },
    });
    expect(r.apparence.accent).toBe("#b4f461");
    expect(r.apparence.densite).toBe("normale");
    expect(r.terminal.taillePolice).toBe(20);
    expect(r.terminal.defilement).toBe(5000);
    expect(r.terminal.dossierDepart).toBe("~");
    expect(r.terminal.police).toBe("integree");
    expect(r.superviseur.nom).toBe("Superviseur");
    expect(r.superviseur.niveau).toBe("observer");
    expect(normaliserReglages({ terminal: { taillePolice: 3 } }).terminal.taillePolice).toBe(10);
    expect(normaliserReglages({ apparence: { accent: "rouge" } }).apparence.accent).toBe("#8f9bff");
  });

  it("tronque le nom du superviseur à 16 caractères", () => {
    expect(normaliserReglages({ superviseur: { nom: "Une vigie au nom bien trop long" } }).superviseur.nom).toHaveLength(16);
  });

  it("dédoublonne les paires sans tenir compte de l'ordre, retire les réflexives et les vides", () => {
    const p = (a: string, b: string) => ({ a, b, depuis: 1, echanges: 0 });
    const r = normaliserReglages({
      superviseur: { paires: [p("/a", "/b"), p("/b", "/a"), p("/a", "/a"), p("", "/c"), p("/c", "superviseur"), 3] },
    });
    expect(r.superviseur.paires).toEqual([p("/a", "/b"), p("/c", "superviseur")]);
  });

  it("est idempotente", () => {
    const une = normaliserReglages({ terminal: { defilement: 12 }, superviseur: { nom: " Vigie " } });
    expect(normaliserReglages(une)).toEqual(une);
  });
});

describe("paires", () => {
  it("clé indépendante de l'ordre", () => {
    expect(clePaire("/a", "/b")).toBe(clePaire("/b", "/a"));
    expect(clePaire("/a", "/b")).not.toBe(clePaire("/a", "/c"));
  });

  it("ajouter, retrouver, compter, retirer", () => {
    let paires = avecPaire([], "/site", "/api", 10);
    expect(paireAutorisee(paires, "/api", "/site")).toBe(true);
    expect(avecPaire(paires, "/api", "/site", 20)).toHaveLength(1);
    expect(avecPaire(paires, "/x", "/x", 20)).toHaveLength(1);
    paires = compterEchange(paires, "/api", "/site");
    expect(paires[0].echanges).toBe(1);
    expect(sansPaire(paires, "/api", "/site")).toEqual([]);
  });
});

describe("reglagesReinitialises", () => {
  it("remet tout aux défauts mais garde les paires", () => {
    const r = normaliserReglages({
      apparence: { accent: "#ff8a4c" },
      superviseur: { actif: true, nom: "Vigie", paires: [{ a: "/a", b: "/b", depuis: 1, echanges: 2 }] },
    });
    const z = reglagesReinitialises(r);
    expect(z.apparence.accent).toBe("#8f9bff");
    expect(z.superviseur.actif).toBe(false);
    expect(z.superviseur.nom).toBe("Superviseur");
    expect(z.superviseur.paires).toEqual(r.superviseur.paires);
  });
});

describe("couleurHex et shellEffectif", () => {
  it("couleurHex", () => {
    expect(couleurHex("#ABCDEF")).toBe("#abcdef");
    expect(couleurHex("#abc")).toBeNull();
    expect(couleurHex(3)).toBeNull();
  });

  it("shell : réglage, sinon session, sinon bash", () => {
    const r = normaliserReglages({});
    expect(shellEffectif(r, "/usr/bin/zsh")).toBe("/usr/bin/zsh");
    expect(shellEffectif(r, null)).toBe("/bin/bash");
    expect(shellEffectif(normaliserReglages({ terminal: { shell: "fish" } }), "/usr/bin/zsh")).toBe("fish");
  });
});
