import { describe, it, expect } from "vitest";
import { vuePleinEcran, type EntreesVue } from "./vuePleinEcran";

const base: EntreesVue = { demarrage: false, nbEspaces: 2, recapOuvert: false, diffOuvert: false, vue: "terminal" };

describe("vuePleinEcran", () => {
  it("terminal par défaut", () => {
    expect(vuePleinEcran(base)).toBeNull();
  });

  it("mosaïque quand elle est demandée", () => {
    expect(vuePleinEcran({ ...base, vue: "mosaique" })).toBe("mosaique");
  });

  it("le diff de l'espace actif passe devant la mosaïque", () => {
    expect(vuePleinEcran({ ...base, vue: "mosaique", diffOuvert: true })).toBe("diff");
  });

  it("l'accueil quand aucun espace n'est ouvert, même si la mosaïque était demandée", () => {
    expect(vuePleinEcran({ ...base, nbEspaces: 0, vue: "mosaique" })).toBe("accueil");
  });

  it("le récap passe devant tout", () => {
    expect(vuePleinEcran({ ...base, nbEspaces: 0, recapOuvert: true })).toBe("recap");
    expect(vuePleinEcran({ ...base, diffOuvert: true, recapOuvert: true })).toBe("recap");
  });

  it("pendant le démarrage : ni accueil ni mosaïque", () => {
    expect(vuePleinEcran({ ...base, demarrage: true, nbEspaces: 0 })).toBeNull();
    expect(vuePleinEcran({ ...base, demarrage: true, vue: "mosaique" })).toBeNull();
  });

  it("les Paramètres passent devant l'accueil, le diff et la mosaïque, pas devant le récap", () => {
    expect(vuePleinEcran({ ...base, parametresOuverts: true, nbEspaces: 0 })).toBe("parametres");
    expect(vuePleinEcran({ ...base, parametresOuverts: true, diffOuvert: true, vue: "mosaique" })).toBe("parametres");
    expect(vuePleinEcran({ ...base, parametresOuverts: true, recapOuvert: true })).toBe("recap");
  });
});

describe("vuePleinEcran — poste de suivi du superviseur", () => {
  const sup = { ...base, superviseurOuvert: true };

  it("passe devant les Paramètres, l'accueil, le diff et la mosaïque", () => {
    expect(vuePleinEcran(sup)).toBe("superviseur");
    expect(vuePleinEcran({ ...sup, parametresOuverts: true })).toBe("superviseur");
    expect(vuePleinEcran({ ...sup, nbEspaces: 0 })).toBe("superviseur");
    expect(vuePleinEcran({ ...sup, diffOuvert: true })).toBe("superviseur");
    expect(vuePleinEcran({ ...sup, vue: "mosaique" })).toBe("superviseur");
  });

  it("le récap passe devant lui", () => {
    expect(vuePleinEcran({ ...sup, recapOuvert: true })).toBe("recap");
  });

  it("pendant le démarrage : aucune vue", () => {
    expect(vuePleinEcran({ ...sup, demarrage: true })).toBeNull();
  });

  it("fermé, il révèle ce qui était dessous", () => {
    expect(vuePleinEcran({ ...base, vue: "mosaique", superviseurOuvert: false })).toBe("mosaique");
  });
});
