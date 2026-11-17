import { describe, it, expect } from "vitest";
import {
  comptesEtats,
  deNom,
  depuisLibelle,
  descriptionNiveau,
  heureFil,
  ligneEtatSuperviseur,
  signatureBulle,
  suggestionsEspace,
  suggestionsSuperviseur,
  texteBulle,
  texteMasque,
  texteNiveau,
  texteReprise,
  tonLigneEtat,
} from "./superviseurLibelles";

describe("ligneEtatSuperviseur", () => {
  it("formes de la maquette", () => {
    const base = { mode: "observe" as const, nbEspaces: 8, nbAttente: 0, nbEchanges: 0, outil: null };
    expect(ligneEtatSuperviseur(base)).toBe("observe 8 espaces");
    expect(ligneEtatSuperviseur({ ...base, mode: "parle", nbAttente: 1, nbEchanges: 2 })).toBe(
      "observe 8 espaces · 1 vous attend · 2 échanges en cours",
    );
    expect(ligneEtatSuperviseur({ ...base, nbEspaces: 1, nbAttente: 2 })).toBe("observe 1 espace · 2 vous attendent");
    expect(ligneEtatSuperviseur({ ...base, mode: "agit", outil: "session.repondre" })).toBe("agit · session.répondre");
    expect(ligneEtatSuperviseur({ ...base, mode: "pause" })).toBe("en pause · n’observe plus");
  });

  it("ton : cyan quand il agit, accent quand quelque chose vous réclame", () => {
    expect(tonLigneEtat("agit", true)).toBe("travail");
    expect(tonLigneEtat("parle", true)).toBe("attente");
    expect(tonLigneEtat("observe", false)).toBe("discret");
    expect(tonLigneEtat("pause", true)).toBe("discret");
  });
});

describe("textes du fil", () => {
  it("niveaux, reprise", () => {
    expect(texteNiveau("reorganiser")).toBe("Autonomie : Réorganiser. Je range vos espaces, je n’écris dans aucune session.");
    expect(descriptionNiveau("agir", "Vigie")).toMatch(/^Vigie réorganise librement/);
    expect(texteReprise([])).toBe("Reprise. Rien de nouveau pendant la pause.");
    expect(texteReprise(["api a terminé", "site vous attend"])).toBe("Reprise. Pendant la pause : api a terminé ; site vous attend.");
  });

  it("heure et ancienneté", () => {
    const d = new Date(2026, 0, 1, 9, 5).getTime();
    expect(heureFil(d)).toBe("09:05");
    expect(depuisLibelle(d, d + 500)).toBe("depuis 1 s");
    expect(depuisLibelle(d, d + 4 * 60_000)).toBe("depuis 4 min");
    expect(depuisLibelle(d, d + 2 * 3_600_000)).toBe("depuis 2 h");
  });

  it("comptes du tableau des agents", () => {
    expect(comptesEtats(["attente", "travail", "travail", "repos", "termine"]).map((c) => c.texte)).toEqual([
      "1 vous attend",
      "2 au travail",
      "1 terminé",
      "1 au repos",
    ]);
  });

  it("bandeau masqué, bulle", () => {
    expect(texteMasque(1, false)).toBe("Une écriture dans une session est prête ; elle demande le niveau Agir.");
    expect(texteMasque(2, true)).toBe("2 écritures attendent votre reprise.");
    expect(texteBulle(2, 1)).toEqual({ titre: "2 agents vous attendent", note: "dont 1 écriture à valider", accent: true });
    expect(texteBulle(0, 2).titre).toBe("2 écritures à valider");
    // Cartes seules : le titre les compte déjà, la note ne le répète pas.
    expect(texteBulle(0, 2).note).toBe("à autoriser dans le poste de suivi");
    expect(texteBulle(1, 0).note).toBe("clic sur un espace pour y aller");
    expect(signatureBulle(["a", "b"], ["d:1"])).toBe("a,b|d:1");
  });
});

describe("suggestionsSuperviseur", () => {
  it("relayer d'abord, trois au plus", () => {
    expect(
      suggestionsSuperviseur({ echange: { de: "site", vers: "api" }, nbEspaces: 5, nbGroupes: 0, attente: "api", actif: "site" }),
    ).toEqual(["Fais répondre api à site", "Où en sont mes agents ?", "Range les espaces par groupe"]);
    expect(suggestionsSuperviseur({ echange: null, nbEspaces: 2, nbGroupes: 1, attente: null, actif: "notes" })).toEqual([
      "Où en sont mes agents ?",
      "Que fait notes ?",
    ]);
  });
});

describe("deNom", () => {
  it("élide devant une voyelle, accentuée ou non, et devant un h", () => {
    expect(deNom("api-paiements")).toBe("d’api-paiements");
    expect(deNom("Écran")).toBe("d’Écran");
    expect(deNom("hub")).toBe("d’hub");
  });
  it("garde « de » devant une consonne, un chiffre ou un nom vide", () => {
    expect(deNom("site-vitrine")).toBe("de site-vitrine");
    expect(deNom("3d-viewer")).toBe("de 3d-viewer");
    expect(deNom("")).toBe("de ");
  });
});

describe("suggestionsEspace", () => {
  it("écrit le nom de l'espace dans chaque phrase, avec l'élision", () => {
    expect(suggestionsEspace("api-paiements")).toEqual([
      "Où en est api-paiements ?",
      "Résume les changements d’api-paiements",
      "Préviens-moi quand api-paiements a fini",
    ]);
    expect(suggestionsEspace("site-vitrine")[1]).toBe("Résume les changements de site-vitrine");
  });
});
