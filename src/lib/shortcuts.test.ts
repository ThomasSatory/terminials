import { describe, it, expect } from "vitest";
import { matchShortcut, type KeyLike, type ShortcutAction } from "./shortcuts";

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
    ["KeyB", { type: "toggle-sidebar" }],
    ["KeyG", { type: "new-group" }],
    ["KeyE", { type: "toggle-group" }],
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
  it.each(["KeyN", "KeyT", "KeyW", "KeyO", "KeyQ", "KeyR", "KeyD", "KeyB", "KeyG", "KeyE", "KeyC", "KeyV"])(
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
