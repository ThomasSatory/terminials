import { describe, it, expect } from "vitest";
import { pluriel } from "./pluriel";

describe("pluriel", () => {
  it("garde le singulier pour 0 et 1", () => {
    expect(pluriel(0, "fichier")).toBe("0 fichier");
    expect(pluriel(1, "espace")).toBe("1 espace");
  });

  it("ajoute un s au-delà de 1", () => {
    expect(pluriel(2, "onglet")).toBe("2 onglets");
  });

  it("accepte un pluriel irrégulier", () => {
    expect(pluriel(1, "travail", "travaux")).toBe("1 travail");
    expect(pluriel(3, "travail", "travaux")).toBe("3 travaux");
  });
});
