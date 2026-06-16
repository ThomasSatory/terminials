import { describe, it, expect } from "vitest";
import { PALETTE, ALERT_COLOR, basename } from "./palette";

describe("palette", () => {
  it("contient 8 couleurs hex", () => {
    expect(PALETTE).toHaveLength(8);
    for (const c of PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("ALERT_COLOR est l'ambre fixe", () => {
    expect(ALERT_COLOR).toBe("#f5a623");
  });

  it("basename renvoie le dernier segment non vide", () => {
    expect(basename("/home/x/dev/terminals")).toBe("terminals");
    expect(basename("/tmp")).toBe("tmp");
    expect(basename("/tmp/")).toBe("tmp");
  });

  it("basename gère la racine", () => {
    expect(basename("/")).toBe("/");
  });
});
