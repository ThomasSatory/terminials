import { describe, it, expect } from "vitest";
import {
  MAX_RESUME,
  cartesParEspace,
  demandeAuClavier,
  filtrerFil,
  groupeDuPoste,
  libellesCompteurs,
  nettoyerResume,
  repliResume,
  resumeAffiche,
  typeAttente,
} from "./posteSuperviseur";
import type { DemandeValidation, EntreeFil } from "../store/superviseur";

const demande = (id: string, o: Partial<DemandeValidation> = {}): DemandeValidation => ({
  id,
  appelId: null,
  outil: "terminal.ecrire",
  cible: { wsId: "api-paiements", tabId: "t1" },
  de: null,
  echangeId: null,
  titre: "Écrire",
  texte: "npm test",
  entree: true,
  pourquoi: "",
  paire: null,
  bloquee: false,
  depuis: 0,
  statut: "ouverte",
  toujours: false,
  ...o,
});

const entree = (id: string, o: Partial<EntreeFil> = {}): EntreeFil => ({
  id,
  a: 0,
  genre: "superviseur",
  parties: [{ type: "texte", texte: id }],
  ...o,
});

describe("groupeDuPoste", () => {
  it("attente ou carte ouverte : vous attendent", () => {
    expect(groupeDuPoste("attente", false, 0)).toBe("attendent");
    expect(groupeDuPoste("repos", false, 1)).toBe("attendent");
    expect(groupeDuPoste("travail", true, 2)).toBe("attendent");
  });
  it("travail ou relais : au travail", () => {
    expect(groupeDuPoste("travail", false, 0)).toBe("travail");
    expect(groupeDuPoste("repos", true, 0)).toBe("travail");
  });
  it("terminé et repos : au repos", () => {
    expect(groupeDuPoste("termine", false, 0)).toBe("repos");
    expect(groupeDuPoste("repos", false, 0)).toBe("repos");
  });
});

describe("nettoyerResume", () => {
  it("retire l'ANSI et les contrôles, compacte les blancs", () => {
    expect(nettoyerResume("\u001b[31mErreur\u001b[0m\n  dans\t le   test\u0007\u0000")).toBe("Erreur dans le test");
  });
  it("chaîne vide si rien ne reste", () => {
    expect(nettoyerResume(" \n\t\u0001 ")).toBe("");
  });
  it("laisse intact un texte court", () => {
    expect(nettoyerResume("Migration terminée")).toBe("Migration terminée");
  });
  it("coupe à 160 caractères avec « … »", () => {
    const r = nettoyerResume("a".repeat(200));
    expect(Array.from(r)).toHaveLength(MAX_RESUME);
    expect(r.endsWith("…")).toBe(true);
  });
  it("exactement 160 : inchangé", () => {
    expect(nettoyerResume("a".repeat(160))).toBe("a".repeat(160));
  });
  it("compte les émojis et accents en points de code", () => {
    const emojis = "😀".repeat(200);
    const r = nettoyerResume(emojis);
    expect(Array.from(r)).toHaveLength(MAX_RESUME);
    expect(r).toBe(`${"😀".repeat(159)}…`);
    expect(nettoyerResume("é".repeat(160))).toBe("é".repeat(160));
    expect(nettoyerResume("😀".repeat(160))).toBe("😀".repeat(160));
  });
});

describe("cartesParEspace", () => {
  it("aucune demande : table vide", () => {
    expect(cartesParEspace([]).size).toBe(0);
  });
  it("plusieurs cartes pour un espace, de la plus ancienne à la plus récente", () => {
    const m = cartesParEspace([demande("a"), demande("b", { outil: "session.demander" })]);
    expect(m.get("api-paiements")?.map((d) => d.id)).toEqual(["a", "b"]);
  });
  it("rattache à l'espace écrit, jamais à l'expéditeur", () => {
    const m = cartesParEspace([demande("a", { de: "site-vitrine", cible: { wsId: "facturation", tabId: "t" } })]);
    expect([...m.keys()]).toEqual(["facturation"]);
  });
  it("ignore les demandes non ouvertes", () => {
    const m = cartesParEspace([demande("a", { statut: "autorisee" }), demande("b", { statut: "refusee" }), demande("c", { statut: "annulee" })]);
    expect(m.size).toBe(0);
  });
});

describe("demandeAuClavier", () => {
  const ds = [
    demande("a", { cible: { wsId: "x", tabId: "t" } }),
    demande("b", { cible: { wsId: "y", tabId: "t" } }),
    demande("c", { cible: { wsId: "y", tabId: "t" } }),
  ];
  it("sans demande : null", () => {
    expect(demandeAuClavier([], null)).toBeNull();
    expect(demandeAuClavier([demande("a", { statut: "refusee" })], "x")).toBeNull();
  });
  it("sans filtre : la plus ancienne ouverte", () => {
    expect(demandeAuClavier(ds, null)?.id).toBe("a");
  });
  it("avec filtre : la plus ancienne de l'espace", () => {
    expect(demandeAuClavier(ds, "y")?.id).toBe("b");
  });
  it("filtre sans carte : la plus ancienne ouverte tout court", () => {
    expect(demandeAuClavier(ds, "z")?.id).toBe("a");
  });
  it("saute les demandes non ouvertes", () => {
    expect(demandeAuClavier([demande("a", { statut: "autorisee" }), ...ds.slice(1)], null)?.id).toBe("b");
  });
});

describe("filtrerFil", () => {
  it("null : le même tableau", () => {
    const fil = [entree("1")];
    expect(filtrerFil(fil, null)).toBe(fil);
  });
  it("fil vide", () => {
    expect(filtrerFil([], "x")).toEqual([]);
  });
  it("garde wsId, de, vers et refs", () => {
    const fil = [
      entree("obs", { genre: "observation", wsId: "x" }),
      entree("de", { genre: "message", de: "x", vers: "y" }),
      entree("vers", { genre: "message", de: "y", vers: "x" }),
      entree("refs", { parties: [{ type: "refs", wsIds: ["z", "x"] }] }),
      entree("autre", { genre: "observation", wsId: "y" }),
    ];
    expect(filtrerFil(fil, "x").map((e) => e.id)).toEqual(["obs", "de", "vers", "refs"]);
  });
  it("rattache le tour du superviseur au message utilisateur précédent", () => {
    const fil = [
      entree("q1", { genre: "utilisateur", wsId: "x" }),
      entree("r1"),
      entree("q2", { genre: "utilisateur", wsId: "y" }),
      entree("r2"),
    ];
    expect(filtrerFil(fil, "x").map((e) => e.id)).toEqual(["q1", "r1"]);
    expect(filtrerFil(fil, "y").map((e) => e.id)).toEqual(["q2", "r2"]);
  });
  it("la réponse à un réveil sur B va dans le fil de B, pas dans celui de A", () => {
    const fil = [
      entree("q", { genre: "utilisateur", wsId: "A" }),
      entree("obs", { genre: "observation", wsId: "B" }),
      entree("r"),
    ];
    expect(filtrerFil(fil, "B").map((e) => e.id)).toEqual(["obs", "r"]);
    expect(filtrerFil(fil, "A").map((e) => e.id)).toEqual(["q"]);
  });
  it("un message utilisateur sans espace coupe le rattachement", () => {
    const fil = [entree("q1", { genre: "utilisateur", wsId: "x" }), entree("q2", { genre: "utilisateur" }), entree("r2")];
    expect(filtrerFil(fil, "x").map((e) => e.id)).toEqual(["q1"]);
  });
  it("une entrée du superviseur qui porte un autre espace n'est pas rattachée", () => {
    const fil = [entree("q", { genre: "utilisateur", wsId: "x" }), entree("r", { vers: "y" })];
    expect(filtrerFil(fil, "x").map((e) => e.id)).toEqual(["q"]);
  });
});

describe("resumeAffiche", () => {
  const r = { texte: "Migre la base", a: 1, groupe: "travail" as const };
  it("résumé valable : affiché", () => {
    expect(resumeAffiche(r, "travail", "repli")).toEqual({ texte: "Migre la base", source: "superviseur" });
  });
  it("résumé périmé (autre groupe) : repli", () => {
    expect(resumeAffiche(r, "repos", "repli")).toEqual({ texte: "repli", source: "repli" });
  });
  it("aucun résumé : repli", () => {
    expect(resumeAffiche(undefined, "travail", "repli")).toEqual({ texte: "repli", source: "repli" });
  });
});

describe("repliResume", () => {
  const base = { etat: "repos" as const, relaisVers: null };
  it("relais : attend la réponse, avec élision", () => {
    expect(repliResume({ ...base, etat: "travail", relaisVers: "api-paiements" })).toBe("Attend la réponse d’api-paiements");
    expect(repliResume({ ...base, relaisVers: "site-vitrine" })).toBe("Attend la réponse de site-vitrine");
  });
  it("attente : blocage, sinon notification, sinon défaut", () => {
    expect(repliResume({ ...base, etat: "attente", bloque: "Autoriser\nnpm  test ?", notification: "n" })).toBe("Autoriser npm test ?");
    expect(repliResume({ ...base, etat: "attente", bloque: null, notification: "Quelle base ?" })).toBe("Quelle base ?");
    expect(repliResume({ ...base, etat: "attente" })).toBe("Vous attend");
  });
  it("travail : titre sans glyphe, sinon « Au travail »", () => {
    expect(repliResume({ ...base, etat: "travail", titreTravail: "✳ Migration" })).toBe("Migration");
    expect(repliResume({ ...base, etat: "travail" })).toBe("Au travail");
  });
  it("terminé et repos", () => {
    expect(repliResume({ ...base, etat: "termine", sujetTermine: "Migration" })).toBe("Terminé : Migration");
    expect(repliResume({ ...base, etat: "termine" })).toBe("Terminé");
    expect(repliResume(base)).toBe("Au repos");
  });
});

describe("libellesCompteurs", () => {
  it("accorde « vous attend / vous attendent »", () => {
    expect(libellesCompteurs({ attendent: 1, travail: 2, repos: 0 })).toEqual({
      attendent: "1 vous attend",
      travail: "2 au travail",
      repos: "0 au repos",
    });
    expect(libellesCompteurs({ attendent: 2, travail: 0, repos: 3 }).attendent).toBe("2 vous attendent");
    expect(libellesCompteurs({ attendent: 0, travail: 0, repos: 0 }).attendent).toBe("0 vous attend");
  });
});

describe("typeAttente", () => {
  it("selon l'outil de la première carte", () => {
    expect(typeAttente([demande("a")], null)).toBe("Écriture à valider");
    expect(typeAttente([demande("a", { outil: "session.demander" }), demande("b")], null)).toBe("Question à transmettre");
    expect(typeAttente([demande("a", { outil: "session.repondre" })], "x")).toBe("Réponse à rendre");
  });
  it("sans carte : autorisation si bloqué, sinon « Vous attend »", () => {
    expect(typeAttente([], "Autoriser ?")).toBe("Autorisation");
    expect(typeAttente([], null)).toBe("Vous attend");
  });
});
