import { describe, it, expect } from "vitest";
import {
  COULEURS_AUTO,
  couleurAuto,
  couleurEspace,
  couleurGroupe,
  normaliserHex,
  teinteLisible,
} from "./couleurEspace";
import { SIDEBAR_COLORS } from "./palette";

/** Luminance relative WCAG d'un hex #rrggbb. */
function luminance(hex: string): number {
  const canal = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}
const contrasteSurFond = (hex: string) => (luminance(hex) + 0.05) / (luminance("#050506") + 0.05);

describe("normaliserHex", () => {
  it("accepte #rgb et #rrggbb, en minuscules", () => {
    expect(normaliserHex("#ABC")).toBe("#aabbcc");
    expect(normaliserHex(" #C0392B ")).toBe("#c0392b");
  });
  it("refuse le reste", () => {
    expect(normaliserHex("red")).toBeNull();
    expect(normaliserHex("#12345")).toBeNull();
    expect(normaliserHex("#c0392b80")).toBeNull();
  });
});

describe("teinteLisible", () => {
  it("rend un hex à 6 chiffres", () => {
    expect(teinteLisible("#C0392B")).toMatch(/^#[0-9a-f]{6}$/);
  });

  it("toutes les couleurs nommées deviennent lisibles sur le fond (4.5:1)", () => {
    for (const { hex } of SIDEBAR_COLORS) {
      const t = teinteLisible(hex)!;
      expect(contrasteSurFond(t)).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("un gris reste un gris", () => {
    const t = teinteLisible("#3e3e3e")!;
    expect(t.slice(1, 3)).toBe(t.slice(3, 5));
    expect(t.slice(3, 5)).toBe(t.slice(5, 7));
  });

  it("entrée non hex → null", () => {
    expect(teinteLisible("bleu")).toBeNull();
  });
});

describe("couleurAuto / couleurEspace / couleurGroupe", () => {
  it("la teinte auto est stable et prise dans la liste", () => {
    expect(couleurAuto("/home/x/dev/app")).toBe(couleurAuto("/home/x/dev/app"));
    expect(COULEURS_AUTO).toContain(couleurAuto("/home/x/dev/app"));
  });

  it("les teintes auto se répartissent sur plusieurs dossiers", () => {
    const vues = new Set(["/a", "/b", "/c", "/d", "/e", "/f", "/g", "/h"].map(couleurAuto));
    expect(vues.size).toBeGreaterThan(2);
  });

  it("couleur propre éclaircie, sinon teinte auto, sinon (couleur invalide) teinte auto", () => {
    expect(couleurEspace({ cwd: "/a", color: "#1565C0" })).toBe(teinteLisible("#1565C0"));
    expect(couleurEspace({ cwd: "/a" })).toBe(couleurAuto("/a"));
    expect(couleurEspace({ cwd: "/a", color: "pas-une-couleur" })).toBe(couleurAuto("/a"));
  });

  it("couleur de groupe éclaircie, gris discret si invalide", () => {
    expect(couleurGroupe({ color: "#196F3D" })).toBe(teinteLisible("#196F3D"));
    expect(couleurGroupe({ color: "?" })).toBe("#9296a0");
  });
});

describe("teinteLisible sur une couleur déjà claire", () => {
  it("garde les pastels tels quels (groupes de la maquette)", () => {
    expect(teinteLisible("#a99cff")).toBe("#a99cff");
    expect(teinteLisible("#F78FC6")).toBe("#f78fc6");
    expect(couleurGroupe({ color: "#fdba74" })).toBe("#fdba74");
  });
});
