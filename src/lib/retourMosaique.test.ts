import { describe, it, expect } from "vitest";
import { estEchapSeul, retourArme, saisieReelle, type EtatRetour } from "./retourMosaique";

const ui = (p: Partial<EtatRetour> = {}): EtatRetour => ({
  retourMosaique: "ws:1",
  vue: "terminal",
  paletteOuverte: false,
  ...p,
});
const sansVue = { recapOuvert: false, diffOuvert: false };

describe("retourArme", () => {
  it("armé pour l'espace ouvert depuis la mosaïque, terminal affiché", () => {
    expect(retourArme(ui(), "ws:1", sansVue)).toBe(true);
  });

  it("pas pour un autre espace, ni désarmé", () => {
    expect(retourArme(ui(), "ws:2", sansVue)).toBe(false);
    expect(retourArme(ui({ retourMosaique: null }), "ws:1", sansVue)).toBe(false);
    expect(retourArme(ui(), null, sansVue)).toBe(false);
  });

  it("pas sous une autre vue ni sous la palette", () => {
    expect(retourArme(ui({ vue: "mosaique" }), "ws:1", sansVue)).toBe(false);
    expect(retourArme(ui({ paletteOuverte: true }), "ws:1", sansVue)).toBe(false);
    expect(retourArme(ui(), "ws:1", { recapOuvert: true, diffOuvert: false })).toBe(false);
    expect(retourArme(ui(), "ws:1", { recapOuvert: false, diffOuvert: true })).toBe(false);
  });
});

describe("estEchapSeul", () => {
  const touche = { type: "keydown", key: "Escape", ctrlKey: false, shiftKey: false, altKey: false, metaKey: false };
  it("Échap nu à l'enfoncement seulement", () => {
    expect(estEchapSeul(touche)).toBe(true);
    expect(estEchapSeul({ ...touche, type: "keyup" })).toBe(false);
    expect(estEchapSeul({ ...touche, ctrlKey: true })).toBe(false);
    expect(estEchapSeul({ ...touche, altKey: true })).toBe(false);
    expect(estEchapSeul({ ...touche, key: "a" })).toBe(false);
  });
});

describe("saisieReelle", () => {
  it("frappes et collages comptent", () => {
    expect(saisieReelle("l")).toBe(true);
    expect(saisieReelle("ls -la\r")).toBe(true);
    expect(saisieReelle("\x1b[A")).toBe(true); // flèche
  });

  it("rapports de focus et de souris ne comptent pas", () => {
    expect(saisieReelle("\x1b[I")).toBe(false);
    expect(saisieReelle("\x1b[O")).toBe(false);
    expect(saisieReelle("\x1b[<0;10;5M")).toBe(false);
    expect(saisieReelle("\x1b[M !!")).toBe(false);
    expect(saisieReelle("")).toBe(false);
  });
});
