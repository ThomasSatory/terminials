import { describe, it, expect } from "vitest";
import { splitSummary } from "./summaryFold";

describe("splitSummary", () => {
  it("garde le premier paragraphe en tête, le reste replié", () => {
    const { head, rest } = splitSummary(
      "Journée sur les remplaçants.\n\nDeux MR ouvertes.\n\nReste la doc.",
    );
    expect(head).toBe("Journée sur les remplaçants.");
    expect(rest).toBe("Deux MR ouvertes.\n\nReste la doc.");
  });

  it("un seul paragraphe : rien à déplier", () => {
    const { head, rest } = splitSummary("Rien de notable aujourd'hui.");
    expect(head).toBe("Rien de notable aujourd'hui.");
    expect(rest).toBe("");
  });

  it("texte vide ou blanc : tout est vide", () => {
    expect(splitSummary("")).toEqual({ head: "", rest: "" });
    expect(splitSummary("   \n\n  ")).toEqual({ head: "", rest: "" });
  });

  it("liste longue : les premiers items en tête, les suivants repliés", () => {
    const { head, rest } = splitSummary(
      "- un\n- deux\n- trois\n- quatre\n- cinq",
      3,
    );
    expect(head).toBe("- un\n- deux\n- trois");
    expect(rest).toBe("- quatre\n- cinq");
  });

  it("liste courte : rien à déplier", () => {
    const { head, rest } = splitSummary("- un\n- deux", 3);
    expect(head).toBe("- un\n- deux");
    expect(rest).toBe("");
  });

  it("liste numérotée tronquée comme une liste à puces", () => {
    const { head, rest } = splitSummary("1. un\n2. deux\n3. trois", 2);
    expect(head).toBe("1. un\n2. deux");
    expect(rest).toBe("3. trois");
  });

  it("un titre en tête ne compte pas pour le bloc visible", () => {
    // Un `## Bilan` seul en tête ne dit rien : on lui rattache le bloc suivant,
    // sinon le résumé replié n'afficherait qu'un intertitre.
    const { head, rest } = splitSummary("## Bilan\n\nDeux MR ouvertes.\n\nReste la doc.");
    expect(head).toBe("## Bilan\n\nDeux MR ouvertes.");
    expect(rest).toBe("Reste la doc.");
  });

  it("liste tronquée après un titre", () => {
    const { head, rest } = splitSummary("## Bilan\n\n- un\n- deux\n- trois", 2);
    expect(head).toBe("## Bilan\n\n- un\n- deux");
    expect(rest).toBe("- trois");
  });

  it("fins de ligne Windows normalisées", () => {
    const { head, rest } = splitSummary("Premier.\r\n\r\nSecond.");
    expect(head).toBe("Premier.");
    expect(rest).toBe("Second.");
  });
});
