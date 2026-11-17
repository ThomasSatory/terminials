import { describe, it, expect } from "vitest";
import { taillePastilleAvatar, taillePoliceAvatar } from "./avatar";

describe("proportions de l'avatar", () => {
  it("corps du monogramme : 12 px à 40, 9.5 px au plancher", () => {
    expect(taillePoliceAvatar(40)).toBe(12);
    expect(taillePoliceAvatar(22)).toBe(9.5);
    expect(taillePoliceAvatar(26)).toBeGreaterThan(taillePoliceAvatar(22));
  });

  it("pastille : 11 px à 40, jamais sous 8 px", () => {
    expect(taillePastilleAvatar(40)).toBe(11);
    expect(taillePastilleAvatar(28)).toBe(8);
    expect(taillePastilleAvatar(10)).toBe(8);
  });
});
