import { describe, it, expect } from "vitest";
import { normaliser, scoreFloue, classerFlou } from "./fuzzy";

describe("normaliser", () => {
  it("passe en minuscules sans accents en gardant la longueur", () => {
    expect(normaliser("Éditer À Côté")).toBe("editer a cote");
    expect(normaliser("Éditer").length).toBe("Éditer".length);
  });
});

describe("scoreFloue", () => {
  it("requête vide : tout passe, score nul", () => {
    expect(scoreFloue("", "n'importe quoi")).toEqual({ score: 0, indices: [] });
    expect(scoreFloue("   ", "x")).toEqual({ score: 0, indices: [] });
  });

  it("exige les lettres dans l'ordre", () => {
    expect(scoreFloue("nvespace", "Nouvel espace")).not.toBeNull();
    expect(scoreFloue("espacenv", "Nouvel espace")).toBeNull();
    expect(scoreFloue("zz", "Nouvel espace")).toBeNull();
  });

  it("ignore casse et accents", () => {
    expect(scoreFloue("FICHIERS MODIF", "Voir les fichiers modifiés")).not.toBeNull();
    expect(scoreFloue("modifies", "fichiers modifiés")).not.toBeNull();
    expect(scoreFloue("recap", "Récap")).not.toBeNull();
  });

  it("renvoie les positions du texte d'origine", () => {
    // Le « e » se pose sur le début du mot « espace » (7), pas au milieu de « Nouvel ».
    const r = scoreFloue("ne", "Nouvel espace");
    expect(r?.indices).toEqual([0, 7]);
  });

  it("chaque mot de la requête doit trouver sa place (ET)", () => {
    expect(scoreFloue("nouv esp", "Nouvel espace")).not.toBeNull();
    expect(scoreFloue("nouv zzz", "Nouvel espace")).toBeNull();
  });

  it("préfère le préfixe, le début de mot et les lettres jointes", () => {
    const prefixe = scoreFloue("api", "api-paiements")!.score;
    const milieu = scoreFloue("api", "rapide")!.score;
    expect(prefixe).toBeGreaterThan(milieu);
    const jointes = scoreFloue("pai", "paiements")!.score;
    const eparses = scoreFloue("pai", "plan a idee")!.score;
    expect(jointes).toBeGreaterThan(eparses);
  });

  it("choisit le meilleur placement, pas le premier", () => {
    // Le « s » de « sa » doit se poser sur le début du mot « sa », pas sur « s » de « espace ».
    const r = scoreFloue("sa", "espace sa")!;
    expect(r.indices).toEqual([7, 8]);
  });

  it("requête plus longue que le texte : rien", () => {
    expect(scoreFloue("abcdef", "abc")).toBeNull();
  });
});

describe("classerFlou", () => {
  const items = ["rapide", "api-paiements", "site-vitrine"];
  const texte = (s: string) => [{ texte: s }];

  it("garde l'ordre d'origine sans requête", () => {
    expect(classerFlou(items, "", texte).map((r) => r.item)).toEqual(items);
  });

  it("filtre et classe par score", () => {
    const r = classerFlou(items, "api", texte).map((x) => x.item);
    expect(r).toEqual(["api-paiements", "rapide"]);
  });

  it("à score égal, l'ordre d'origine tranche", () => {
    const r = classerFlou(["bb", "bb"], "b", texte);
    expect(r.map((x) => x.item)).toEqual(["bb", "bb"]);
  });

  it("un champ secondaire trouve avec un poids réduit, sans indices à surligner", () => {
    const els = [
      { nom: "alpha", branche: "feature/palette" },
      { nom: "palette", branche: "main" },
    ];
    const r = classerFlou(els, "palette", (e) => [
      { texte: e.nom },
      { texte: e.branche, poids: 0.5 },
    ]);
    expect(r.map((x) => x.item.nom)).toEqual(["palette", "alpha"]);
    expect(r[1].indices).toEqual([]);
    expect(r[0].indices.length).toBe(7);
  });
});
