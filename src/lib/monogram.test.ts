import { describe, it, expect } from "vitest";
import { monogramme } from "./monogram";

describe("monogramme", () => {
  it.each([
    ["terminials", "te"],
    ["site-vitrine", "si"],
    ["api-paiements", "ap"],
    ["notes", "no"],
    ["Infra", "in"],
    ["-x", "x"],
    ["2fa-service", "2f"],
    ["écrits", "éc"],
    [".config", "co"],
  ])("%s → %s", (nom, attendu) => {
    expect(monogramme(nom)).toBe(attendu);
  });

  it("nom sans lettre ni chiffre → « ·· »", () => {
    expect(monogramme("~")).toBe("··");
    expect(monogramme("")).toBe("··");
    expect(monogramme("--")).toBe("··");
  });
});
