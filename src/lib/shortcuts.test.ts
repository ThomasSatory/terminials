import { describe, it, expect } from "vitest";
import { matchShortcut, paneNavTarget, type KeyLike, type ShortcutAction } from "./shortcuts";

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
    ["KeyT", { type: "new-pane" }],
    ["KeyW", { type: "close-pane" }],
    ["KeyQ", { type: "close-workspace" }],
    ["KeyR", { type: "rename-workspace" }],
    ["KeyD", { type: "toggle-diff" }],
    ["KeyB", { type: "toggle-sidebar" }],
    ["KeyH", { type: "toggle-dashboard" }],
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
  it.each(["KeyN", "KeyT", "KeyW", "KeyO", "KeyQ", "KeyR", "KeyD", "KeyB", "KeyH", "KeyC", "KeyV"])(
    "Ctrl+%s nu → null",
    (code) => {
      expect(matchShortcut(c(code))).toBeNull();
    },
  );

  it("lettre sans modificateur → null", () => {
    expect(matchShortcut(k("KeyW"))).toBeNull();
  });
});

describe("matchShortcut — navigation de workspaces", () => {
  it("Ctrl+PageUp / Ctrl+PageDown → prev/next", () => {
    expect(matchShortcut(c("PageUp"))).toEqual({ type: "prev-workspace" });
    expect(matchShortcut(c("PageDown"))).toEqual({ type: "next-workspace" });
  });

  it("Ctrl+Shift+PageUp/PageDown → null (hors table)", () => {
    expect(matchShortcut(cs("PageUp"))).toBeNull();
    expect(matchShortcut(cs("PageDown"))).toBeNull();
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

  it("les flèches verticales sans Ctrl+Shift ne déplacent rien", () => {
    // Ctrl seul et Shift seul restent au shell (readline, sélection) ; Alt+flèches
    // sont déjà le focus directionnel de pane.
    expect(matchShortcut(c("ArrowUp"))).toBeNull();
    expect(matchShortcut(k("ArrowDown", { shiftKey: true }))).toBeNull();
    expect(matchShortcut(a("ArrowUp"))).toEqual({ type: "focus-pane", dir: "up" });
  });

  it("Ctrl+Digit0, Ctrl+Shift+Digit1, Digit1 nu → null", () => {
    expect(matchShortcut(c("Digit0"))).toBeNull();
    expect(matchShortcut(cs("Digit1"))).toBeNull();
    expect(matchShortcut(k("Digit1"))).toBeNull();
  });
});

describe("matchShortcut — focus directionnel Alt+flèches", () => {
  const DIRS: Array<[string, "left" | "right" | "up" | "down"]> = [
    ["ArrowLeft", "left"],
    ["ArrowRight", "right"],
    ["ArrowUp", "up"],
    ["ArrowDown", "down"],
  ];
  it.each(DIRS)("Alt+%s", (code, dir) => {
    expect(matchShortcut(a(code))).toEqual({ type: "focus-pane", dir });
  });

  it("Ctrl+Alt+flèche et Alt+Shift+flèche → null", () => {
    expect(matchShortcut(k("ArrowLeft", { altKey: true, ctrlKey: true }))).toBeNull();
    expect(matchShortcut(k("ArrowLeft", { altKey: true, shiftKey: true }))).toBeNull();
  });

  it("flèche nue → null", () => {
    expect(matchShortcut(k("ArrowLeft"))).toBeNull();
  });
});

describe("paneNavTarget — géométries de la grille fixe (PaneTree gridStyle)", () => {
  it("1 pane [a] : aucune direction", () => {
    for (const dir of ["left", "right", "up", "down"] as const) {
      expect(paneNavTarget(1, 0, dir)).toBeNull();
    }
  });

  it("2 panes [a b]", () => {
    expect(paneNavTarget(2, 0, "right")).toBe(1);
    expect(paneNavTarget(2, 1, "left")).toBe(0);
    expect(paneNavTarget(2, 0, "left")).toBeNull();
    expect(paneNavTarget(2, 0, "up")).toBeNull();
    expect(paneNavTarget(2, 0, "down")).toBeNull();
    expect(paneNavTarget(2, 1, "right")).toBeNull();
  });

  it("3 panes [a b / c c] (c s'étend sur les 2 colonnes ; up depuis c → a)", () => {
    expect(paneNavTarget(3, 0, "right")).toBe(1);
    expect(paneNavTarget(3, 0, "down")).toBe(2);
    expect(paneNavTarget(3, 1, "left")).toBe(0);
    expect(paneNavTarget(3, 1, "down")).toBe(2);
    expect(paneNavTarget(3, 2, "up")).toBe(0);
    expect(paneNavTarget(3, 0, "left")).toBeNull();
    expect(paneNavTarget(3, 0, "up")).toBeNull();
    expect(paneNavTarget(3, 1, "right")).toBeNull();
    expect(paneNavTarget(3, 1, "up")).toBeNull();
    expect(paneNavTarget(3, 2, "down")).toBeNull();
    expect(paneNavTarget(3, 2, "left")).toBeNull();
    expect(paneNavTarget(3, 2, "right")).toBeNull();
  });

  it("4 panes [a b / c d]", () => {
    expect(paneNavTarget(4, 0, "right")).toBe(1);
    expect(paneNavTarget(4, 0, "down")).toBe(2);
    expect(paneNavTarget(4, 1, "left")).toBe(0);
    expect(paneNavTarget(4, 1, "down")).toBe(3);
    expect(paneNavTarget(4, 2, "right")).toBe(3);
    expect(paneNavTarget(4, 2, "up")).toBe(0);
    expect(paneNavTarget(4, 3, "left")).toBe(2);
    expect(paneNavTarget(4, 3, "up")).toBe(1);
    expect(paneNavTarget(4, 0, "left")).toBeNull();
    expect(paneNavTarget(4, 0, "up")).toBeNull();
    expect(paneNavTarget(4, 1, "right")).toBeNull();
    expect(paneNavTarget(4, 1, "up")).toBeNull();
    expect(paneNavTarget(4, 2, "left")).toBeNull();
    expect(paneNavTarget(4, 2, "down")).toBeNull();
    expect(paneNavTarget(4, 3, "right")).toBeNull();
    expect(paneNavTarget(4, 3, "down")).toBeNull();
  });

  it("count ou current hors géométrie → null", () => {
    expect(paneNavTarget(4, 4, "left")).toBeNull();
    expect(paneNavTarget(0, 0, "left")).toBeNull();
    expect(paneNavTarget(5, 0, "right")).toBeNull();
    expect(paneNavTarget(2, -1, "right")).toBeNull();
  });
});
