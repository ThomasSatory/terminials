import { describe, it, expect } from "vitest";
import { ligneBranche, libelleBoutonDiff, texteBoutonDiff } from "./barreEspace";

describe("ligneBranche", () => {
  it("rien tant que la sonde git n'a pas répondu (pas de « hors dépôt » à l'ouverture)", () => {
    expect(ligneBranche(undefined, undefined, [], false)).toBe("");
    expect(ligneBranche(undefined, undefined, [], true)).toBe("hors dépôt");
    expect(ligneBranche("main", false, [], false)).toBe("main");
  });

  it("affiche la branche seule quand l'arbre est propre", () => {
    expect(ligneBranche("main", false, [])).toBe("main");
  });

  it("marque les modifications non commitées d'un point", () => {
    expect(ligneBranche("feat/dock", true, [])).toBe("feat/dock •");
  });

  it("dit « hors dépôt » sans branche connue, même modifié", () => {
    expect(ligneBranche(undefined, true, [])).toBe("hors dépôt");
  });

  it("suffixe les ports ouverts", () => {
    expect(ligneBranche("main", true, [3000, 5173])).toBe("main • · :3000,5173");
    expect(ligneBranche(undefined, false, [8080])).toBe("hors dépôt · :8080");
  });
});

describe("bouton des fichiers modifiés", () => {
  it("reste générique tant que le compte est inconnu", () => {
    expect(texteBoutonDiff(null)).toBe("modifiés");
    expect(libelleBoutonDiff(null)).toBe("Fichiers modifiés");
  });

  it("accorde le compte", () => {
    expect(texteBoutonDiff(1)).toBe("1 fichier");
    expect(texteBoutonDiff(4)).toBe("4 fichiers");
    expect(libelleBoutonDiff(1)).toBe("1 fichier modifié");
    expect(libelleBoutonDiff(4)).toBe("4 fichiers modifiés");
  });
});
