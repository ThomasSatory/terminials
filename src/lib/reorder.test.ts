import { describe, it, expect } from "vitest";
import { dropBoundary, finalIndex, moveItem, type RowRect } from "./reorder";

/** Trois lignes de 40 px collées, comme la sidebar : [0,40[ [40,80[ [80,120[. */
const ROWS: RowRect[] = [
  { top: 0, height: 40 },
  { top: 40, height: 40 },
  { top: 80, height: 40 },
];

describe("dropBoundary", () => {
  it("moitié haute d'une ligne → frontière avant elle", () => {
    expect(dropBoundary(ROWS, 45)).toBe(1);
  });

  it("moitié basse d'une ligne → frontière après elle", () => {
    expect(dropBoundary(ROWS, 75)).toBe(2);
  });

  it("au-dessus de la première ligne → 0", () => {
    expect(dropBoundary(ROWS, -10)).toBe(0);
  });

  it("sous la dernière ligne → longueur (insertion en fin)", () => {
    expect(dropBoundary(ROWS, 500)).toBe(ROWS.length);
  });

  it("dans la marge entre deux lignes → la frontière qui les sépare", () => {
    // Les lignes ont une marge verticale (margin: 1px 6px) : le pointeur peut
    // tomber entre deux rects sans être dans aucun.
    const spaced: RowRect[] = [
      { top: 0, height: 38 },
      { top: 40, height: 38 },
    ];
    expect(dropBoundary(spaced, 39)).toBe(1);
  });

  it("hauteurs inégales (lignes méta/status) : c'est le milieu de CHAQUE ligne qui compte", () => {
    // Ligne 0 haute (80 px) puis ligne 1 courte : un y à 50 est encore dans la
    // moitié haute de la ligne 0 → frontière 0, pas 1.
    const uneven: RowRect[] = [
      { top: 0, height: 80 },
      { top: 80, height: 20 },
    ];
    expect(dropBoundary(uneven, 30)).toBe(0);
    expect(dropBoundary(uneven, 50)).toBe(1);
    expect(dropBoundary(uneven, 95)).toBe(2);
  });

  it("liste vide → 0", () => {
    expect(dropBoundary([], 42)).toBe(0);
  });
});

describe("finalIndex", () => {
  it("descente : la frontière perd 1 (l'élément a quitté sa place avant l'insertion)", () => {
    // [a,b,c], on tire a sous c : frontière 3 → index final 2 → [b,c,a].
    expect(finalIndex(0, 3)).toBe(2);
  });

  it("montée : la frontière est déjà l'index final", () => {
    // [a,b,c], on tire c au-dessus de a : frontière 0 → index final 0.
    expect(finalIndex(2, 0)).toBe(0);
  });

  it("frontière juste avant l'élément → sa propre place (no-op)", () => {
    expect(finalIndex(1, 1)).toBe(1);
  });

  it("frontière juste après l'élément → sa propre place (no-op)", () => {
    // Le off-by-one : frontière 2 pour l'élément 1 n'est PAS un déplacement.
    expect(finalIndex(1, 2)).toBe(1);
  });
});

describe("moveItem", () => {
  it("descend un élément", () => {
    expect(moveItem(["a", "b", "c"], 0, 2)).toEqual(["b", "c", "a"]);
  });

  it("monte un élément", () => {
    expect(moveItem(["a", "b", "c"], 2, 0)).toEqual(["c", "a", "b"]);
  });

  it("déplacement d'un cran", () => {
    expect(moveItem(["a", "b", "c"], 1, 2)).toEqual(["a", "c", "b"]);
  });

  it("n'altère pas le tableau d'origine", () => {
    const arr = ["a", "b", "c"];
    moveItem(arr, 0, 2);
    expect(arr).toEqual(["a", "b", "c"]);
  });

  it("index identiques → le tableau d'origine, à l'identique (pas de re-render inutile)", () => {
    const arr = ["a", "b", "c"];
    expect(moveItem(arr, 1, 1)).toBe(arr);
  });

  it("index source hors bornes → no-op", () => {
    const arr = ["a", "b"];
    expect(moveItem(arr, 5, 0)).toBe(arr);
    expect(moveItem(arr, -1, 0)).toBe(arr);
  });

  it("index cible hors bornes → no-op (jamais de trou ni d'undefined)", () => {
    const arr = ["a", "b"];
    expect(moveItem(arr, 0, 2)).toBe(arr);
    expect(moveItem(arr, 0, -1)).toBe(arr);
  });
});
