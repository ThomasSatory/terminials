import { describe, expect, it } from "vitest";
import { matchShortcut, type ShortcutAction } from "./shortcuts";
import { CODES_CANDIDATS, GROUPES_RACCOURCIS, nomToucheAffiche, rangeesRaccourcis } from "./parametresRaccourcis";

const rangees = rangeesRaccourcis();
const combos = (libelle: string) => rangees.find((r) => r.libelle === libelle)?.combos;

describe("rangeesRaccourcis (déduites de lib/shortcuts)", () => {
  it("chaque raccourci de la table a sa rangée, avec les touches du matcher", () => {
    expect(combos("Nouvel espace")).toEqual([["Ctrl", "Maj", "N"]]);
    expect(combos("Ouvrir un dossier")).toEqual([["Ctrl", "Maj", "O"]]);
    expect(combos("Palette de commandes")).toEqual([["Ctrl", "K"]]);
    expect(combos("Paramètres")).toEqual([["Ctrl", "Maj", ","]]);
    expect(combos("Panneau du superviseur")).toEqual([["Ctrl", "Maj", "Espace"]]);
    expect(combos("Fichiers modifiés")).toEqual([["Ctrl", "Maj", "D"]]);
  });

  it("regroupe les paires d'actions et résume Ctrl+1…9", () => {
    expect(combos("Aller à l’espace 1 à 9")).toEqual([["Ctrl", "1…9"]]);
    expect(combos("Espace précédent, suivant")).toEqual([
      ["Ctrl", "PgPréc"],
      ["Ctrl", "PgSuiv"],
    ]);
    expect(combos("Monter, descendre l’espace")).toEqual([
      ["Ctrl", "Maj", "↑"],
      ["Ctrl", "Maj", "↓"],
    ]);
    expect(combos("Onglet précédent, suivant")).toEqual([
      ["Alt", "←"],
      ["Alt", "→"],
    ]);
  });

  it("Entrée et Entrée du pavé ne font qu'une combinaison", () => {
    expect(combos("Nouvel espace dans le dossier de départ")).toEqual([["Ctrl", "Maj", "Entrée"]]);
  });

  it("copier et coller (au terminal, hors de la table) terminent la page", () => {
    const terminal = rangees.filter((r) => r.groupe === "Terminal").map((r) => r.libelle);
    expect(terminal).toEqual(["Copier", "Coller"]);
  });

  it("rangées dans l'ordre des groupes, ids uniques", () => {
    const ordre = rangees.map((r) => GROUPES_RACCOURCIS.indexOf(r.groupe));
    expect([...ordre].sort((a, b) => a - b)).toEqual(ordre);
    expect(new Set(rangees.map((r) => r.id)).size).toBe(rangees.length);
  });

  it("aucun raccourci de la table n'échappe à la page", () => {
    // Chaque touche reconnue par le matcher apparaît dans au moins une rangée.
    const affiches = new Set(rangees.flatMap((r) => r.combos.map((c) => c.join(" "))));
    for (const code of CODES_CANDIDATS) {
      for (const [ctrlKey, shiftKey, altKey, mods] of [
        [true, true, false, "Ctrl Maj"],
        [true, false, false, "Ctrl"],
        [false, false, true, "Alt"],
      ] as const) {
        const a = matchShortcut({ code, ctrlKey, shiftKey, altKey });
        if (!a) continue;
        const attendu = a.type === "select-workspace" ? `${mods} 1…9` : `${mods} ${nomToucheAffiche(code)}`;
        expect(affiches.has(attendu), attendu).toBe(true);
      }
    }
  });

  it("suit la table : une touche déplacée change la page", () => {
    const faux = (e: { code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }): ShortcutAction | null =>
      e.ctrlKey && e.altKey && !e.shiftKey && e.code === "KeyP" ? { type: "toggle-parametres" } : null;
    expect(rangeesRaccourcis(faux).find((r) => r.libelle === "Paramètres")?.combos).toEqual([["Ctrl", "Alt", "P"]]);
    // Une action sans touche ne s'affiche pas.
    expect(rangeesRaccourcis(faux).some((r) => r.libelle === "Nouvel espace")).toBe(false);
  });

  it("les mots-clés retrouvent une rangée par ses touches", () => {
    expect(rangees.find((r) => r.libelle === "Fichiers modifiés")?.motsCles).toContain("Ctrl Maj D");
  });
});
