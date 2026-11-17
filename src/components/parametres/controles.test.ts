import { describe, expect, it } from "vitest";
import { rangFleche } from "./controles";

describe("rangFleche (clavier d'un radiogroup)", () => {
  it("flèches : option voisine, bouclée ; Début et Fin : extrémités", () => {
    expect(rangFleche("ArrowRight", 0, 3)).toBe(1);
    expect(rangFleche("ArrowDown", 2, 3)).toBe(0);
    expect(rangFleche("ArrowLeft", 0, 3)).toBe(2);
    expect(rangFleche("ArrowUp", 1, 3)).toBe(0);
    expect(rangFleche("Home", 2, 3)).toBe(0);
    expect(rangFleche("End", 0, 3)).toBe(2);
  });

  it("autre touche, ou groupe vide : rien", () => {
    expect(rangFleche("Enter", 0, 3)).toBeNull();
    expect(rangFleche("ArrowRight", 0, 0)).toBeNull();
  });
});
