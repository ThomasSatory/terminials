import { describe, it, expect } from "vitest";
import { attributsApparence, optionsTerminal, rgbAccent, variablesApparence } from "./apparence";
import { normaliserReglages, REGLAGES_DEFAUT } from "./reglages";
import { OPTIONS_TERMINAL, THEME_TERMINAL } from "./terminalTheme";

describe("apparence", () => {
  it("l'accent par défaut redonne exactement les jetons de tokens.css", () => {
    const v = variablesApparence(REGLAGES_DEFAUT);
    expect(v["--accent"]).toBe("#8f9bff");
    expect(v["--accent-focus"]).toBeUndefined();
    expect(v["--accent-rgb"]).toBe("143, 155, 255");
    expect(v["--dock-avatar"]).toBe("40px");
  });

  it("un autre accent et une autre densité", () => {
    const r = normaliserReglages({ apparence: { accent: "#b4f461", densite: "compacte", reduireAnimations: true } });
    const v = variablesApparence(r);
    expect(v["--accent-rgb"]).toBe(rgbAccent("#b4f461"));
    // L'anneau de focus reste celui des jetons (#c3caff), quel que soit l'accent.
    expect(v["--accent-focus"]).toBeUndefined();
    expect(v["--dock-avatar"]).toBe("32px");
    expect(attributsApparence(r)).toEqual({ densite: "compacte", mouvement: "reduit" });
  });

  it("options xterm par défaut = celles de terminalTheme", () => {
    const o = optionsTerminal(REGLAGES_DEFAUT);
    expect(o.fontSize).toBe(OPTIONS_TERMINAL.fontSize);
    expect(o.fontFamily).toBe(OPTIONS_TERMINAL.fontFamily);
    expect(o.theme).toEqual(THEME_TERMINAL);
    expect(o.scrollback).toBe(1000);
  });

  it("options xterm suivent taille, police, défilement et accent", () => {
    const r = normaliserReglages({
      apparence: { accent: "#ff8a4c" },
      terminal: { taillePolice: 16, police: "systeme", defilement: 10000 },
    });
    const o = optionsTerminal(r);
    expect(o.fontSize).toBe(16);
    expect(o.fontFamily).toBe("ui-monospace, monospace");
    expect(o.scrollback).toBe(10000);
    expect(o.theme.cursor).toBe("#ff8a4c");
    expect(o.theme.selectionBackground).toBe("rgba(255, 138, 76, 0.28)");
    // Les couleurs ANSI ne bougent pas.
    expect(o.theme.blue).toBe(THEME_TERMINAL.blue);
  });
});
