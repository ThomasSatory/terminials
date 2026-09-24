import { describe, it, expect } from "vitest";
import { nextCopyName } from "./copyName";

describe("nextCopyName", () => {
  it("suffixe « 2 » quand aucune copie n'existe", () => {
    expect(nextCopyName("app", ["app"])).toBe("app 2");
  });

  it("prend le premier rang libre quand des copies existent", () => {
    expect(nextCopyName("app", ["app", "app 2", "app 3"])).toBe("app 4");
  });

  it("dupliquer une copie repart de la racine, sans empiler les suffixes", () => {
    expect(nextCopyName("app 2", ["app", "app 2"])).toBe("app 3");
  });

  it("comble un rang libéré au milieu", () => {
    expect(nextCopyName("app", ["app", "app 3"])).toBe("app 2");
  });

  it("ne confond pas un nom qui commence pareil", () => {
    expect(nextCopyName("app", ["app", "appli 2"])).toBe("app 2");
  });

  it("garde un nom composé de chiffres comme racine", () => {
    expect(nextCopyName("42", ["42"])).toBe("42 2");
  });
});
