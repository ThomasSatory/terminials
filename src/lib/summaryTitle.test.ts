import { describe, it, expect } from "vitest";
import { splitTitle } from "./summaryTitle";

describe("splitTitle", () => {
  it("première ligne = titre, le reste = puces", () => {
    const r = splitTitle("Onglets et frise du dashboard\n\n- a\n- b");
    expect(r.title).toBe("Onglets et frise du dashboard");
    expect(r.body).toBe("- a\n- b");
  });

  it("nettoie le markdown et la ponctuation du titre", () => {
    expect(splitTitle("## **Journée de refonte.**\n\n- a").title).toBe("Journée de refonte");
  });

  it("réponse qui commence par une liste : pas de titre", () => {
    const r = splitTitle("- a\n- b");
    expect(r.title).toBe("");
    expect(r.body).toBe("- a\n- b");
  });

  it("garde jusqu'à six puces et coupe au-delà, y compris numérotées", () => {
    const r = splitTitle("T\n\n1. a\n2. b\n3. c\n4. d\n5. e\n6. f\n7. g");
    expect(r.body).toBe("1. a\n2. b\n3. c\n4. d\n5. e\n6. f");
  });

  it("vide ou blanc : tout vide", () => {
    expect(splitTitle("  \n\n")).toEqual({ title: "", body: "" });
  });

  it("fins de ligne Windows normalisées", () => {
    const r = splitTitle("T\r\n\r\n- a\r\n- b");
    expect(r.title).toBe("T");
    expect(r.body).toBe("- a\n- b");
  });
});
