import { beforeAll, describe, it, expect } from "vitest";
import {
  GLYPHE_TERMINAL_PX,
  INTERLIGNE_TERMINAL,
  OPTIONS_TERMINAL,
  POLICE_TERMINAL,
  THEME_TERMINAL,
  pasDeLigneXterm,
} from "./terminalTheme";

/** Texte de tokens.css, lu sur disque : sous vitest, un import `?raw` d'une feuille CSS
    rend une chaîne vide (les CSS ne sont pas traitées). Module node importé par un nom
    calculé : le projet n'embarque pas les types node, seuls les tests en ont besoin. */
let jetons = "";
beforeAll(async () => {
  const nomModule = "node:fs";
  const fs = (await import(/* @vite-ignore */ nomModule)) as {
    readFileSync(chemin: URL, encodage: "utf8"): string;
  };
  jetons = fs.readFileSync(new URL("../styles/tokens.css", import.meta.url), "utf8");
});

/** Valeur d'une variable CSS de tokens.css (première déclaration, sur :root). */
function jeton(nom: string): string {
  const m = new RegExp(`${nom}\\s*:\\s*([^;]+);`).exec(jetons);
  if (!m) throw new Error(`jeton introuvable : ${nom}`);
  return m[1].trim().toLowerCase();
}

/** Luminance relative WCAG d'un hex #rrggbb. */
function luminance(hex: string): number {
  const canal = (i: number) => {
    const v = parseInt(hex.slice(i, i + 2), 16) / 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(1) + 0.7152 * canal(3) + 0.0722 * canal(5);
}
const contraste = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

describe("thème du terminal", () => {
  // xterm ne lit pas les variables CSS : ce test est le garde-fou de la synchronisation.
  it.each([
    ["background", "--fond-app"],
    ["foreground", "--texte-terminal"],
    ["cursor", "--accent"],
    ["red", "--suppression"],
    ["green", "--succes"],
    ["yellow", "--avertissement"],
    ["blue", "--accent"],
    ["cyan", "--travail"],
    ["white", "--texte"],
    ["brightBlack", "--texte-discret"],
    ["brightBlue", "--accent-focus"],
    ["brightWhite", "--texte-fort"],
  ] as const)("%s suit le jeton %s", (cle, nom) => {
    expect(THEME_TERMINAL[cle]?.toLowerCase()).toBe(jeton(nom));
  });

  it("toute couleur de texte reste lisible sur le fond (4.5:1), noir ANSI excepté", () => {
    const fond = THEME_TERMINAL.background!;
    const textes = [
      "foreground",
      "red",
      "green",
      "yellow",
      "blue",
      "magenta",
      "cyan",
      "white",
      "brightBlack",
      "brightRed",
      "brightGreen",
      "brightYellow",
      "brightBlue",
      "brightMagenta",
      "brightCyan",
      "brightWhite",
    ] as const;
    for (const cle of textes) {
      const couleur = THEME_TERMINAL[cle]!;
      expect(couleur, cle).toMatch(/^#[0-9a-f]{6}$/);
      expect(contraste(couleur, fond), cle).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("le noir ANSI se distingue du fond sans devenir un texte courant", () => {
    const c = contraste(THEME_TERMINAL.black!, THEME_TERMINAL.background!);
    expect(c).toBeGreaterThan(1.1);
    expect(c).toBeLessThan(2);
  });

  it("police : la même famille que --police-mono, en tête la variable embarquée", () => {
    expect(OPTIONS_TERMINAL.fontFamily).toBe(POLICE_TERMINAL);
    const premiere = (familles: string) => familles.split(",")[0].trim().replace(/["']/g, "").toLowerCase();
    expect(premiere(POLICE_TERMINAL)).toBe("jetbrains mono variable");
    expect(premiere(jeton("--police-mono"))).toBe(premiere(POLICE_TERMINAL));
  });

  it("corps et curseur de la maquette", () => {
    expect(OPTIONS_TERMINAL.fontSize).toBe(13);
    expect(OPTIONS_TERMINAL.cursorStyle).toBe("block");
    expect(OPTIONS_TERMINAL.cursorBlink).toBe(true);
  });

  it("interligne de la maquette (1.75 × corps) traduit pour xterm (× hauteur du glyphe)", () => {
    expect(OPTIONS_TERMINAL.lineHeight).toBe(INTERLIGNE_TERMINAL);
    const cible = 13 * 1.75; // 22,75 px dans la maquette
    const pas = pasDeLigneXterm(GLYPHE_TERMINAL_PX, INTERLIGNE_TERMINAL);
    // Pas entier le plus proche de la maquette à densité 1.
    expect(pas).toBe(23);
    expect(Math.abs(pas - cible)).toBeLessThanOrEqual(0.25);
    // L'ancienne valeur tombait un pixel trop court, recopier 1.75 bien trop haut.
    expect(pasDeLigneXterm(GLYPHE_TERMINAL_PX, 1.34)).toBe(22);
    expect(pasDeLigneXterm(GLYPHE_TERMINAL_PX, 1.75)).toBe(29);
  });

  it("pasDeLigneXterm suit l'arrondi de xterm (pixels physiques)", () => {
    expect(pasDeLigneXterm(16.4, 1.36)).toBe(23); // ceil(16,4) = 17
    expect(pasDeLigneXterm(17, 1.36, 2)).toBe(23); // floor(34 × 1,36) = 46 px physiques
  });
});
