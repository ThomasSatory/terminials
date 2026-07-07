import { describe, it, expect } from "vitest";
import { PALETTE, ATTENTION_COLOR, STATUS_DEFAULT_COLOR, basename } from "./palette";

describe("palette", () => {
  it("contient 8 couleurs hex", () => {
    expect(PALETTE).toHaveLength(8);
    for (const c of PALETTE) expect(c).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it("ne commence pas par #5b8def (collision visuelle avec le bleu attention)", () => {
    expect(PALETTE[0]).toBe("#2ecc71");
    expect(PALETTE.indexOf("#5b8def")).toBeGreaterThanOrEqual(4);
  });

  it("ATTENTION_COLOR est le bleu cmux, distinct de la palette", () => {
    expect(ATTENTION_COLOR).toBe("#3b82f6");
    expect(PALETTE).not.toContain(ATTENTION_COLOR);
  });

  it("STATUS_DEFAULT_COLOR est l'ambre historique", () => {
    expect(STATUS_DEFAULT_COLOR).toBe("#f5a623");
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
