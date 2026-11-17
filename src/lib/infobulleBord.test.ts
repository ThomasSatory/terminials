import { describe, expect, it } from "vitest";
import { decalageInfobulle } from "./infobulleBord";

describe("decalageInfobulle", () => {
  const zone = { gauche: 100, droite: 500 };

  it("ne bouge pas une infobulle qui tient dans la zone", () => {
    expect(decalageInfobulle({ gauche: 200, largeur: 120 }, zone, 28)).toBe(0);
  });

  it("la ramène à droite du bord gauche estompé", () => {
    expect(decalageInfobulle({ gauche: 90, largeur: 120 }, zone, 28)).toBe(38);
  });

  it("la ramène à gauche du bord droit estompé", () => {
    expect(decalageInfobulle({ gauche: 420, largeur: 120 }, zone, 28)).toBe(-68);
  });

  it("trop large : collée au bord gauche", () => {
    expect(decalageInfobulle({ gauche: 50, largeur: 600 }, zone, 0)).toBe(50);
  });
});
