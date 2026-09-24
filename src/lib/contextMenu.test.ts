import { describe, it, expect } from "vitest";
import { menuPosition } from "./contextMenu";

const VIEWPORT = { width: 1000, height: 600 };
const SIZE = { width: 200, height: 120 };

describe("menuPosition", () => {
  it("s'ouvre au point cliqué quand la place suffit", () => {
    expect(menuPosition(100, 200, SIZE, VIEWPORT)).toEqual({ left: 100, top: 200 });
  });

  it("se recale à gauche du bord quand il déborderait à droite", () => {
    expect(menuPosition(950, 200, SIZE, VIEWPORT).left).toBe(1000 - 200 - 4);
  });

  it("remonte quand il déborderait en bas (clic sur la dernière ligne de la sidebar)", () => {
    expect(menuPosition(100, 580, SIZE, VIEWPORT).top).toBe(600 - 120 - 4);
  });

  it("ne sort jamais par le haut ni par la gauche, même dans une fenêtre minuscule", () => {
    expect(menuPosition(2, 2, SIZE, { width: 150, height: 80 })).toEqual({ left: 4, top: 4 });
  });
});
