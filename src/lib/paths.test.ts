import { describe, it, expect } from "vitest";
import { abbreviateHome } from "./paths";

describe("abbreviateHome", () => {
  it("remplace le préfixe home par ~", () => {
    expect(abbreviateHome("/home/x/dev/terminals", "/home/x")).toBe("~/dev/terminals");
  });

  it("chemin égal au home → ~", () => {
    expect(abbreviateHome("/home/x", "/home/x")).toBe("~");
  });

  it("tolère le slash final renvoyé par homeDir()", () => {
    expect(abbreviateHome("/home/x/dev", "/home/x/")).toBe("~/dev");
  });

  it("ne tronque pas un préfixe partiel de segment (/home/xy)", () => {
    expect(abbreviateHome("/home/xy/dev", "/home/x")).toBe("/home/xy/dev");
  });

  it("chemin hors du home → inchangé", () => {
    expect(abbreviateHome("/tmp/a", "/home/x")).toBe("/tmp/a");
  });

  it("home vide (pas encore résolu) → inchangé", () => {
    expect(abbreviateHome("/tmp/a", "")).toBe("/tmp/a");
  });
});
