import { describe, it, expect } from "vitest";
import { indexer, phraseManque, phraseReveil, reveilsEntre, type InstantaneEspace } from "./reveilSuperviseur";

const w = (id: string, p: Partial<InstantaneEspace> = {}): InstantaneEspace => ({
  id,
  nom: id,
  etat: "repos",
  bloque: null,
  notification: null,
  sujet: null,
  ...p,
});

describe("reveilsEntre", () => {
  it("rien sans changement, rien pour un espace nouveau", () => {
    const avant = indexer([w("api", { etat: "attente" })]);
    expect(reveilsEntre(avant, [w("api", { etat: "attente" }), w("neuf", { etat: "attente" })])).toEqual([]);
  });

  it("un agent se met à vous attendre", () => {
    const r = reveilsEntre(indexer([w("api", { etat: "travail" })]), [
      w("api", { etat: "attente", notification: "Quelle base utiliser ?" }),
    ]);
    expect(r).toEqual([{ genre: "attente", wsId: "api", nom: "api", suite: "vous attend : Quelle base utiliser ?" }]);
    expect(phraseReveil(r[0])).toBe("api vous attend : Quelle base utiliser ?");
  });

  it("une attente qui devient demande d'autorisation réveille une seconde fois", () => {
    const avant = indexer([w("api", { etat: "attente", notification: "x" })]);
    const r = reveilsEntre(avant, [w("api", { etat: "attente", bloque: "Claude demande l'autorisation d'utiliser Bash" })]);
    expect(r[0].suite).toBe("attend une autorisation : utiliser Bash");
    expect(phraseManque(r[0])).toBe("api attend une autorisation : utiliser Bash");
  });

  it("un agent termine, avec son sujet", () => {
    const r = reveilsEntre(indexer([w("site", { etat: "travail" })]), [w("site", { etat: "termine", sujet: "Encart de paiement." })]);
    expect(r).toEqual([{ genre: "termine", wsId: "site", nom: "site", suite: "a terminé : Encart de paiement" }]);
    expect(phraseReveil(r[0])).toBe("site a terminé : Encart de paiement.");
  });

  it("terminé puis consulté (repos) : rien", () => {
    expect(reveilsEntre(indexer([w("site", { etat: "termine" })]), [w("site")])).toEqual([]);
  });
});
