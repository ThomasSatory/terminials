import { describe, it, expect } from "vitest";
import {
  PALETTE,
  ATTENTION_COLOR,
  STATUS_DEFAULT_COLOR,
  SIDEBAR_COLORS,
  basename,
  defaultGroupColor,
  identityColor,
} from "./palette";

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

describe("couleurs de la sidebar", () => {
  it("reprend les 16 couleurs nommées de cmux, dans son ordre", () => {
    expect(SIDEBAR_COLORS.map((c) => c.name)).toEqual([
      "Red", "Crimson", "Orange", "Amber", "Olive", "Green", "Teal", "Aqua",
      "Blue", "Navy", "Indigo", "Purple", "Magenta", "Rose", "Brown", "Charcoal",
    ]);
    for (const c of SIDEBAR_COLORS) expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(SIDEBAR_COLORS.find((c) => c.name === "Amber")?.hex).toBe("#7D6608");
    expect(SIDEBAR_COLORS.find((c) => c.name === "Charcoal")?.hex).toBe("#3E4B5E");
  });

  it("aucune ne se confond avec le bleu d'attention", () => {
    expect(SIDEBAR_COLORS.map((c) => c.hex.toLowerCase())).not.toContain(ATTENTION_COLOR);
  });

  it("defaultGroupColor parcourt les 16 couleurs sans donner deux voisines à la suite", () => {
    const seq = Array.from({ length: 16 }, (_, i) => defaultGroupColor(i));
    expect(new Set(seq).size).toBe(16);
    expect(seq.slice(0, 3)).toEqual(["#C0392B", "#196F3D", "#283593"]); // Red, Green, Indigo
    expect(defaultGroupColor(16)).toBe(seq[0]);
  });

  it("identityColor : la couleur du workspace d'abord, puis celle du groupe", () => {
    expect(identityColor({ color: "#111111" }, { color: "#222222" })).toBe("#111111");
    expect(identityColor({}, { color: "#222222" })).toBe("#222222");
    expect(identityColor({}, undefined)).toBeUndefined();
  });
});
