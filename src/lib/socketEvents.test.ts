import { describe, expect, it } from "vitest";
import { tabIdForPty } from "./socketEvents";

describe("tabIdForPty", () => {
  const tabPtys = { "t:1": 4, "t:2": 7 };

  it("retrouve l'onglet porteur du PTY", () => {
    expect(tabIdForPty(tabPtys, 7)).toBe("t:2");
  });

  it("undefined si le PTY n'est plus dans aucun onglet", () => {
    expect(tabIdForPty(tabPtys, 9)).toBeUndefined();
  });

  it("undefined sans ptyId numérique (CLI hors onglet)", () => {
    expect(tabIdForPty(tabPtys, undefined)).toBeUndefined();
    expect(tabIdForPty(tabPtys, "7")).toBeUndefined();
  });
});
