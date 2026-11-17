import { describe, it, expect } from "vitest";
import {
  libelleRaccourci,
  matchShortcut,
  terminalGardeTouche,
  type KeyLike,
  type ShortcutAction,
} from "./shortcuts";

// Fabrique d'événements clavier minimaux (matching par code physique uniquement).
const k = (code: string, mods: Partial<Omit<KeyLike, "code">> = {}): KeyLike => ({
  code,
  ctrlKey: false,
  shiftKey: false,
  altKey: false,
  ...mods,
});
const cs = (code: string) => k(code, { ctrlKey: true, shiftKey: true }); // Ctrl+Shift
const c = (code: string) => k(code, { ctrlKey: true }); // Ctrl seul
const a = (code: string) => k(code, { altKey: true }); // Alt seul

describe("matchShortcut — couche Ctrl+Shift (convention gnome-terminal)", () => {
  const CASES: Array<[string, ShortcutAction]> = [
    ["KeyO", { type: "open-folder" }],
    ["KeyN", { type: "new-workspace" }],
    ["KeyT", { type: "new-tab" }],
    ["KeyW", { type: "close-tab" }],
    ["KeyQ", { type: "close-workspace" }],
    ["KeyR", { type: "rename-workspace" }],
    ["KeyD", { type: "toggle-diff" }],
    ["KeyB", { type: "toggle-dock" }],
    ["KeyM", { type: "toggle-mosaique" }],
    ["KeyH", { type: "toggle-dashboard" }],
    ["KeyG", { type: "new-group" }],
    ["KeyE", { type: "toggle-group" }],
    ["Enter", { type: "new-home-workspace" }],
    ["NumpadEnter", { type: "new-home-workspace" }],
  ];
  it.each(CASES)("Ctrl+Shift+%s", (code, expected) => {
    expect(matchShortcut(cs(code))).toEqual(expected);
  });

  it("ne matche JAMAIS Ctrl+Shift+C/V (copier/coller du terminal)", () => {
    expect(matchShortcut(cs("KeyC"))).toBeNull();
    expect(matchShortcut(cs("KeyV"))).toBeNull();
  });

  it("touche non mappée → null", () => {
    expect(matchShortcut(cs("KeyX"))).toBeNull();
  });

  it("Alt en plus → null", () => {
    expect(matchShortcut(k("KeyT", { ctrlKey: true, shiftKey: true, altKey: true }))).toBeNull();
  });
});

describe("matchShortcut — refus des Ctrl+lettre nus (réservés à readline)", () => {
  it.each([
    "KeyN", "KeyT", "KeyW", "KeyO", "KeyQ", "KeyR", "KeyD", "KeyB", "KeyH", "KeyG", "KeyE", "KeyC", "KeyV", "KeyM",
  ])(
    "Ctrl+%s nu → null",
    (code) => {
      expect(matchShortcut(c(code))).toBeNull();
    },
  );

  it("Ctrl+K est la SEULE exception : il ouvre la palette", () => {
    expect(matchShortcut(c("KeyK"))).toEqual({ type: "toggle-palette" });
    // Ctrl+Maj+K et Ctrl+Alt+K ne sont pas la palette.
    expect(matchShortcut(cs("KeyK"))).toBeNull();
    expect(matchShortcut(k("KeyK", { ctrlKey: true, altKey: true }))).toBeNull();
    expect(matchShortcut(k("KeyK"))).toBeNull();
  });

  it("Ctrl+Entrée nu → null (laissé au shell)", () => {
    expect(matchShortcut(c("Enter"))).toBeNull();
  });

  it("lettre sans modificateur → null", () => {
    expect(matchShortcut(k("KeyW"))).toBeNull();
  });
});

describe("matchShortcut — navigation de workspaces", () => {
  it("Ctrl+PageUp / Ctrl+PageDown → prev/next", () => {
    expect(matchShortcut(c("PageUp"))).toEqual({ type: "prev-workspace" });
    expect(matchShortcut(c("PageDown"))).toEqual({ type: "next-workspace" });
  });

  it("Ctrl+Digit1..9 (SANS Shift) → select-workspace 0-based", () => {
    expect(matchShortcut(c("Digit1"))).toEqual({ type: "select-workspace", index: 0 });
    expect(matchShortcut(c("Digit5"))).toEqual({ type: "select-workspace", index: 4 });
    expect(matchShortcut(c("Digit9"))).toEqual({ type: "select-workspace", index: 8 });
  });

  it("Ctrl+Shift+ArrowUp / ArrowDown → déplacement du workspace actif", () => {
    expect(matchShortcut(cs("ArrowUp"))).toEqual({ type: "move-workspace", dir: "up" });
    expect(matchShortcut(cs("ArrowDown"))).toEqual({ type: "move-workspace", dir: "down" });
  });

  it("les flèches verticales sans Ctrl+Shift ne font rien (Alt+↑/↓ rendus au shell)", () => {
    expect(matchShortcut(c("ArrowUp"))).toBeNull();
    expect(matchShortcut(k("ArrowDown", { shiftKey: true }))).toBeNull();
    expect(matchShortcut(a("ArrowUp"))).toBeNull();
    expect(matchShortcut(a("ArrowDown"))).toBeNull();
  });

  it("Ctrl+Digit0, Ctrl+Shift+Digit1, Digit1 nu → null", () => {
    expect(matchShortcut(c("Digit0"))).toBeNull();
    expect(matchShortcut(cs("Digit1"))).toBeNull();
    expect(matchShortcut(k("Digit1"))).toBeNull();
  });
});

describe("matchShortcut — onglets", () => {
  it("Alt+←/→ → onglet précédent/suivant", () => {
    expect(matchShortcut(a("ArrowLeft"))).toEqual({ type: "prev-tab" });
    expect(matchShortcut(a("ArrowRight"))).toEqual({ type: "next-tab" });
  });

  it("Ctrl+Shift+PageUp/PageDown → déplacement de l'onglet actif", () => {
    expect(matchShortcut(cs("PageUp"))).toEqual({ type: "move-tab", dir: "left" });
    expect(matchShortcut(cs("PageDown"))).toEqual({ type: "move-tab", dir: "right" });
  });

  it("Ctrl+Alt+flèche et Alt+Shift+flèche → null", () => {
    expect(matchShortcut(k("ArrowLeft", { altKey: true, ctrlKey: true }))).toBeNull();
    expect(matchShortcut(k("ArrowLeft", { altKey: true, shiftKey: true }))).toBeNull();
  });

  it("flèche nue → null", () => {
    expect(matchShortcut(k("ArrowLeft"))).toBeNull();
  });
});

describe("terminalGardeTouche — couche terminal (xterm)", () => {
  it("laisse passer Ctrl+K et Ctrl+Maj+M jusqu'à la couche window", () => {
    expect(terminalGardeTouche(c("KeyK"))).toBe(false);
    expect(terminalGardeTouche(cs("KeyM"))).toBe(false);
  });

  it("laisse passer tout raccourci de la table", () => {
    expect(terminalGardeTouche(cs("KeyN"))).toBe(false);
    expect(terminalGardeTouche(c("Digit1"))).toBe(false);
    expect(terminalGardeTouche(a("ArrowLeft"))).toBe(false);
  });

  it("garde pour le shell ce qui n'est pas un raccourci (readline, copier/coller)", () => {
    expect(terminalGardeTouche(c("KeyW"))).toBe(true);
    expect(terminalGardeTouche(c("KeyU"))).toBe(true);
    expect(terminalGardeTouche(c("KeyM"))).toBe(true); // Ctrl+M = Entrée pour le shell
    expect(terminalGardeTouche(cs("KeyC"))).toBe(true);
    expect(terminalGardeTouche(cs("KeyV"))).toBe(true);
    expect(terminalGardeTouche(k("KeyA"))).toBe(true);
  });
});

describe("Paramètres et superviseur", () => {
  it("Ctrl+Maj+, → Paramètres, Ctrl+Maj+Espace → superviseur", () => {
    expect(matchShortcut(cs("Comma"))).toEqual({ type: "toggle-parametres" });
    expect(matchShortcut(cs("Space"))).toEqual({ type: "toggle-superviseur" });
  });

  it("Ctrl+Espace et Ctrl+, nus restent au shell", () => {
    expect(matchShortcut(c("Space"))).toBeNull();
    expect(matchShortcut(c("Comma"))).toBeNull();
    expect(terminalGardeTouche(c("Space"))).toBe(true);
    expect(terminalGardeTouche(cs("Space"))).toBe(false);
  });

  it("libellés de la maquette", () => {
    expect(libelleRaccourci({ type: "toggle-parametres" })).toBe("Ctrl+Maj+,");
    expect(libelleRaccourci({ type: "toggle-superviseur" })).toBe("Ctrl+Maj+Espace");
  });
});

describe("libelleRaccourci", () => {
  it("nomme la couche Ctrl+Maj d'après la table", () => {
    expect(libelleRaccourci({ type: "new-workspace" })).toBe("Ctrl+Maj+N");
    expect(libelleRaccourci({ type: "toggle-mosaique" })).toBe("Ctrl+Maj+M");
    expect(libelleRaccourci({ type: "new-home-workspace" })).toBe("Ctrl+Maj+Entrée");
    expect(libelleRaccourci({ type: "move-workspace", dir: "up" })).toBe("Ctrl+Maj+↑");
    expect(libelleRaccourci({ type: "move-tab", dir: "right" })).toBe("Ctrl+Maj+PageDown");
  });

  it("nomme les couches Ctrl seul et Alt seul", () => {
    expect(libelleRaccourci({ type: "toggle-palette" })).toBe("Ctrl K");
    expect(libelleRaccourci({ type: "next-workspace" })).toBe("Ctrl PageDown");
    expect(libelleRaccourci({ type: "prev-tab" })).toBe("Alt+←");
  });

  it("Ctrl 1…9 pour les neuf premiers espaces seulement", () => {
    expect(libelleRaccourci({ type: "select-workspace", index: 0 })).toBe("Ctrl 1");
    expect(libelleRaccourci({ type: "select-workspace", index: 8 })).toBe("Ctrl 9");
    expect(libelleRaccourci({ type: "select-workspace", index: 9 })).toBeUndefined();
  });

  it("chaque libellé redonne son action au clavier", () => {
    const actions: ShortcutAction[] = [
      { type: "close-tab" },
      { type: "toggle-palette" },
      { type: "next-tab" },
      { type: "prev-workspace" },
    ];
    const codes: Record<string, string> = { W: "KeyW", K: "KeyK", "→": "ArrowRight", PageUp: "PageUp" };
    for (const a of actions) {
      const libelle = libelleRaccourci(a)!;
      const touche = libelle.split(/[+ ]/).pop()!;
      const ev = k(codes[touche], {
        ctrlKey: libelle.startsWith("Ctrl"),
        shiftKey: libelle.includes("Maj"),
        altKey: libelle.startsWith("Alt"),
      });
      expect(matchShortcut(ev)).toEqual(a);
    }
  });
});

describe("M et virgule selon la disposition du clavier", () => {
  const csk = (code: string, key: string) => ({ code, key, ctrlKey: true, shiftKey: true, altKey: false });
  it("AZERTY : la touche « , » (position KeyM) ouvre les paramètres", () => {
    expect(matchShortcut(csk("KeyM", "?"))).toEqual({ type: "toggle-parametres" });
    expect(matchShortcut(csk("KeyM", ","))).toEqual({ type: "toggle-parametres" });
  });
  it("AZERTY : la touche « M » (position Semicolon) bascule la mosaïque", () => {
    expect(matchShortcut(csk("Semicolon", "M"))).toEqual({ type: "toggle-mosaique" });
  });
  it("QWERTY : inchangé", () => {
    expect(matchShortcut(csk("KeyM", "M"))).toEqual({ type: "toggle-mosaique" });
    expect(matchShortcut(csk("Comma", "<"))).toEqual({ type: "toggle-parametres" });
  });
});
