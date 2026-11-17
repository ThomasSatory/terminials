import { describe, it, expect } from "vitest";
import { mouvementReduit } from "./mouvement";

const fenetre = (reduit: boolean) =>
  ({ matchMedia: (q: string) => ({ matches: reduit && q === "(prefers-reduced-motion: reduce)" }) }) as unknown as Pick<
    Window,
    "matchMedia"
  >;

describe("mouvementReduit", () => {
  it("suit la préférence du système", () => {
    expect(mouvementReduit(fenetre(true))).toBe(true);
    expect(mouvementReduit(fenetre(false))).toBe(false);
  });

  it("faux sans fenêtre ni matchMedia", () => {
    expect(mouvementReduit(undefined)).toBe(false);
    expect(mouvementReduit({} as Pick<Window, "matchMedia">)).toBe(false);
  });

  it("suit aussi le réglage « Réduire les animations » posé sur :root", () => {
    const f = {
      matchMedia: () => ({ matches: false }),
      document: { documentElement: { dataset: { mouvement: "reduit" } } },
    } as unknown as Pick<Window, "matchMedia">;
    expect(mouvementReduit(f)).toBe(true);
  });
});
