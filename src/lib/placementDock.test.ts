import { describe, it, expect } from "vitest";
import { placerSurDock } from "./placementDock";

describe("placerSurDock", () => {
  const fenetre = { largeur: 1440, hauteur: 900 };

  it("centre le calque sur l'ancre quand il tient dans le dock", () => {
    const dock = { left: 300, top: 820, largeur: 800 };
    const p = placerSurDock(700, dock, 300, fenetre);
    expect(p.left).toBe(550);
    expect(p.pointe).toBe(150);
    expect(p.bottom).toBe(900 - 820 + 14);
  });

  it("borne le calque aux bords du dock, la pointe suit l'ancre", () => {
    const dock = { left: 300, top: 820, largeur: 800 };
    const gauche = placerSurDock(332, dock, 300, fenetre);
    expect(gauche.left).toBe(300);
    expect(gauche.pointe).toBe(32);
    const droite = placerSurDock(1070, dock, 300, fenetre);
    expect(droite.left).toBe(800);
    expect(droite.pointe).toBe(270);
  });

  it("plus large que le dock : centré sur le dock, quelle que soit l'ancre", () => {
    // Dock de 263 px (un espace) centré dans la fenêtre, popover de création de 372 px.
    const dock = { left: 588.5, top: 820, largeur: 263 };
    const p = placerSurDock(588.5 + 101, dock, 372, fenetre);
    expect(p.left).toBe(588.5 + (263 - 372) / 2);
    expect(p.pointe).toBeCloseTo(101 + (372 - 263) / 2);
  });

  it("ne sort jamais de la fenêtre et garde la pointe dans le calque", () => {
    const dock = { left: 0, top: 820, largeur: 200 };
    const p = placerSurDock(4, dock, 372, fenetre);
    expect(p.left).toBe(12);
    expect(p.pointe).toBe(6);
  });
});
