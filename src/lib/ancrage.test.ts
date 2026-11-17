import { describe, it, expect } from "vitest";
import { placerAuDessus, selecteurAncre } from "./ancrage";

describe("selecteurAncre", () => {
  it("un sélecteur d'attribut par type d'ancre", () => {
    expect(selecteurAncre({ type: "espace", wsId: "ws:3" })).toBe('[data-ws-id="ws:3"]');
    expect(selecteurAncre({ type: "ajout" })).toBe("[data-dock-add]");
    expect(selecteurAncre({ type: "groupe", groupId: "grp:0" })).toBe('[data-dock-group="grp:0"]');
  });

  it("échappe guillemets et barres obliques inverses", () => {
    expect(selecteurAncre({ type: "espace", wsId: 'a"b\\c' })).toBe('[data-ws-id="a\\"b\\\\c"]');
  });
});

describe("placerAuDessus", () => {
  const fenetre = { largeur: 1440, hauteur: 900 };

  it("centre le calque sur l'ancre, au-dessus de son haut", () => {
    const p = placerAuDessus({ centreX: 700, haut: 817 }, 340, fenetre);
    expect(p.left).toBe(530);
    expect(p.bottom).toBe(900 - 817 + 14);
    expect(p.pointe).toBe(170);
  });

  it("reste dans la fenêtre et décale la pointe vers l'ancre", () => {
    const gauche = placerAuDessus({ centreX: 30, haut: 800 }, 340, fenetre);
    expect(gauche.left).toBe(12);
    expect(gauche.pointe).toBe(20); // jamais dans l'arrondi
    const droite = placerAuDessus({ centreX: 1430, haut: 800 }, 340, fenetre);
    expect(droite.left).toBe(1440 - 340 - 12);
    expect(droite.pointe).toBe(340 - 20);
  });

  it("fenêtre plus étroite que le calque : collé à la marge gauche", () => {
    expect(placerAuDessus({ centreX: 100, haut: 500 }, 400, { largeur: 300, hauteur: 600 }).left).toBe(12);
  });

  it("écart et marge réglables", () => {
    const p = placerAuDessus({ centreX: 700, haut: 800 }, 292, fenetre, 22, 16);
    expect(p.bottom).toBe(122);
  });
});
