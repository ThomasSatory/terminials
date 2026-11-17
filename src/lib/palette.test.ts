import { describe, it, expect } from "vitest";
import {
  PALETTE,
  ATTENTION_COLOR,
  SIDEBAR_COLORS,
  basename,
  defaultGroupColor,
  libelleCouleur,
  nomCouleur,
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

  it("basename renvoie le dernier segment non vide", () => {
    expect(basename("/home/x/dev/terminals")).toBe("terminals");
    expect(basename("/tmp")).toBe("tmp");
    expect(basename("/tmp/")).toBe("tmp");
  });

  it("basename gère la racine", () => {
    expect(basename("/")).toBe("/");
  });
});

describe("noms des couleurs", () => {
  it("nomme en français une couleur de la palette, casse ignorée, sinon rend l'hex", () => {
    expect(nomCouleur("#C0392B")).toBe("Rouge");
    expect(nomCouleur("#3e4b5e")).toBe("Anthracite");
    expect(nomCouleur("#123456")).toBe("#123456");
  });

  it("donne à chaque couleur un nom français distinct", () => {
    expect(new Set(SIDEBAR_COLORS.map((c) => c.nom)).size).toBe(SIDEBAR_COLORS.length);
  });

  it("libelleCouleur : nom et hex, « Automatique » sans couleur", () => {
    expect(libelleCouleur("#1565c0")).toBe("Bleu · #1565C0");
    expect(libelleCouleur(null)).toBe("Automatique");
    expect(libelleCouleur(undefined)).toBe("Automatique");
    expect(libelleCouleur("#abcdef")).toBe("#abcdef");
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
});
