import { describe, it, expect } from "vitest";
import { heuresEnMinutes, listToText, textToList } from "./reglagesTexte";

describe("champs texte des réglages", () => {
  it("liste ⇄ texte, éléments rognés, vides écartés", () => {
    expect(listToText(["ls", "cd"], ", ")).toBe("ls, cd");
    expect(textToList(" ls , ,cd ", /,/)).toEqual(["ls", "cd"]);
    expect(textToList("A-\\d+\n\n  B-\\d+ ", /\n/)).toEqual(["A-\\d+", "B-\\d+"]);
    expect(textToList("", /,/)).toEqual([]);
  });

  it("heures décimales → minutes au quart d'heure", () => {
    expect(heuresEnMinutes("7.5")).toBe(450);
    expect(heuresEnMinutes("7,5")).toBe(450);
    expect(heuresEnMinutes("7.1")).toBe(420);
    expect(heuresEnMinutes("")).toBe(0);
    expect(heuresEnMinutes("abc")).toBe(0);
    expect(heuresEnMinutes("-2")).toBe(0);
  });
});
