import { describe, it, expect } from "vitest";
import {
  FILTRE_TOUS,
  ID_HORS_GROUPE,
  alignerCles,
  ariaTuile,
  cadenceBalayage,
  cheminCourt,
  chrono,
  colonnesGrille,
  construireSections,
  derniereCommande,
  dispositionGrille,
  estToucheNavigation,
  etiquetteTemps,
  filtreValide,
  filtresMosaique,
  ilYA,
  ligneBranche,
  majSuivi,
  messageTermine,
  sujetTermine,
  partiesSection,
  resumeMosaique,
  titreSansGlyphe,
  tonLigne,
  apercuParlant,
  tuileVoisine,
  type EspaceMosaique,
  type GroupeMosaique,
  type RectTuile,
  type SuiviEtat,
} from "./mosaique";

const groupes: GroupeMosaique[] = [
  { id: "g1", nom: "produit", couleur: "#a99cff" },
  { id: "g2", nom: "services", couleur: "#f78fc6" },
  { id: "g3", nom: "vide", couleur: "#fdba74" },
];

const espaces: EspaceMosaique[] = [
  { id: "a", groupId: null, etat: "repos" },
  { id: "b", groupId: "g1", etat: "repos" },
  { id: "c", groupId: "g1", etat: "travail" },
  { id: "d", groupId: "g2", etat: "repos" },
  { id: "e", groupId: "g2", etat: "attente" },
  { id: "f", groupId: "g1", etat: "attente" },
];

describe("construireSections", () => {
  it("un groupe par section dans l'ordre des groupes, hors groupe en dernier, sans section vide", () => {
    const s = construireSections(espaces, groupes, FILTRE_TOUS, false);
    expect(s.map((x) => x.id)).toEqual(["g1", "g2", ID_HORS_GROUPE]);
    expect(s[0].espaces.map((e) => e.id)).toEqual(["b", "c", "f"]);
    expect(s[2]).toMatchObject({ nom: "hors groupe", horsGroupe: true });
  });

  it("filtré : seule la section du groupe", () => {
    const s = construireSections(espaces, groupes, "g2", false);
    expect(s.map((x) => x.id)).toEqual(["g2"]);
  });

  it("en attente d'abord : tuiles triées par urgence, sections par leur tuile la plus pressante", () => {
    const s = construireSections(espaces, groupes, FILTRE_TOUS, true);
    expect(s[0].espaces.map((e) => e.id)).toEqual(["f", "c", "b"]);
    expect(s[1].espaces.map((e) => e.id)).toEqual(["e", "d"]);
    expect(s.map((x) => x.id)).toEqual(["g1", "g2", ID_HORS_GROUPE]);
    const sansAttente = construireSections(
      [
        { id: "x", groupId: "g1", etat: "repos" },
        { id: "y", groupId: null, etat: "travail" },
      ],
      groupes,
      FILTRE_TOUS,
      true,
    );
    expect(sansAttente.map((x) => x.id)).toEqual([ID_HORS_GROUPE, "g1"]);
  });

  it("un espace dont le groupe a disparu retombe hors groupe", () => {
    const s = construireSections([{ id: "z", groupId: "perdu", etat: "repos" }], groupes, FILTRE_TOUS, false);
    expect(s).toHaveLength(1);
    expect(s[0].id).toBe(ID_HORS_GROUPE);
  });
});

describe("filtres", () => {
  it("filtre d'un groupe vidé ou supprimé → Tous", () => {
    expect(filtreValide("g1", espaces)).toBe("g1");
    expect(filtreValide("g3", espaces)).toBe(FILTRE_TOUS);
    expect(filtreValide(FILTRE_TOUS, [])).toBe(FILTRE_TOUS);
  });

  it("Tous puis les groupes non vides, indicateur d'attente prioritaire", () => {
    const f = filtresMosaique(espaces, groupes, "g2");
    expect(f.map((x) => x.libelle)).toEqual(["Tous", "produit", "services"]);
    expect(f[0]).toMatchObject({ nombre: 6, indicateur: null, presse: false, couleur: null });
    expect(f[1]).toMatchObject({ nombre: 3, indicateur: "attente" });
    expect(f[2]).toMatchObject({ presse: true, aria: "Groupe services, 2 espaces, 1 en attente" });
    const travail = filtresMosaique([{ id: "c", groupId: "g1", etat: "travail" }], groupes, FILTRE_TOUS);
    expect(travail[1].indicateur).toBe("travail");
    expect(travail[0].aria).toBe("Tous les espaces, 1 espace, 1 au travail");
  });
});

describe("disposition et libellés", () => {
  it("Tous : 260 px, 6 lignes ; groupe : 2 colonnes jusqu'à 4 espaces, 3 au-delà", () => {
    expect(dispositionGrille(FILTRE_TOUS, 9)).toEqual({ largeurMin: 260, nbLignes: 6, taillePolice: 11.5 });
    expect(dispositionGrille("g1", 4)).toEqual({ largeurMin: 520, nbLignes: 12, taillePolice: 12 });
    expect(dispositionGrille("g1", 5)).toEqual({ largeurMin: 400, nbLignes: 11, taillePolice: 12 });
    expect(colonnesGrille(260)).toBe("repeat(auto-fill, minmax(min(260px, 100%), 1fr))");
  });

  it("résumé et pastilles de section, accords compris", () => {
    expect(resumeMosaique(espaces)).toBe("6 espaces · 1 au travail · 2 vous attendent");
    expect(resumeMosaique([{ id: "a", groupId: null, etat: "repos" }])).toBe("1 espace · 0 au travail");
    expect(partiesSection(espaces.slice(1, 3))).toEqual([
      { etat: "travail", texte: "1 au travail" },
      { etat: "repos", texte: "1 au repos" },
    ]);
    expect(partiesSection([espaces[4]])).toEqual([{ etat: "attente", texte: "1 vous attend" }]);
  });

  it("ligne de branche : marque de modification, ports, hors dépôt", () => {
    expect(ligneBranche({ branch: "main" })).toBe("main");
    expect(ligneBranche({ branch: "feat/x", dirty: true, ports: [5173] })).toBe("feat/x •  ·  :5173");
    expect(ligneBranche({ ports: [] })).toBe("hors dépôt");
  });

  it("chemin court : dossier personnel en ~", () => {
    expect(cheminCourt("/home/moi/dev/x")).toBe("~/dev/x");
    expect(cheminCourt("/home/moi")).toBe("~");
    expect(cheminCourt("/srv/data")).toBe("/srv/data");
    // Dossier personnel ailleurs que sous /home : celui du système fait foi.
    expect(cheminCourt("/tmp/essai/dossiers/notes", "/tmp/essai")).toBe("~/dossiers/notes");
    expect(cheminCourt("/tmp/essai", "/tmp/essai/")).toBe("~");
  });

  it("titre d'onglet sans le glyphe animé de l'agent", () => {
    expect(titreSansGlyphe("✳ Refonte du dock")).toBe("Refonte du dock");
    expect(titreSansGlyphe("⠂ Lecture")).toBe("Lecture");
    expect(titreSansGlyphe("~/dev/x")).toBe("~/dev/x");
    expect(titreSansGlyphe(undefined)).toBe("");
  });

  it("aria de tuile : détail seulement hors repos", () => {
    expect(ariaTuile("api", "attente", "Autoriser ?")).toBe("Ouvrir le terminal de api, vous attend : Autoriser ?");
    expect(ariaTuile("api", "repos", "❯ ls")).toBe("Ouvrir le terminal de api, au repos");
  });

  it("état « terminé » : rang, pastille verte, libellés, temps et aria", () => {
    const avecFini: EspaceMosaique[] = [
      { id: "r", groupId: null, etat: "repos" },
      { id: "f", groupId: null, etat: "termine" },
      { id: "t", groupId: null, etat: "travail" },
      { id: "f2", groupId: null, etat: "termine" },
    ];
    // En attente d'abord : travail, puis terminé, puis repos.
    expect(construireSections(avecFini, [], FILTRE_TOUS, true)[0].espaces.map((e) => e.id)).toEqual([
      "t",
      "f",
      "f2",
      "r",
    ]);
    expect(partiesSection(avecFini)).toEqual([
      { etat: "travail", texte: "1 au travail" },
      { etat: "termine", texte: "2 terminés" },
      { etat: "repos", texte: "1 au repos" },
    ]);
    expect(etiquetteTemps("termine", 0, 20_000)).toBe("à l’instant");
    expect(etiquetteTemps("termine", 0, 180_000)).toBe("il y a 3 min");
    expect(messageTermine("Refonte du dock")).toBe("Terminé : Refonte du dock");
    expect(messageTermine("")).toBe("Terminé");
    // Pied d'une tuile terminée : le corps de la notification de fin d'abord.
    const fin = { body: " 3 fichiers modifiés, tests au vert. ", attente: "fin" };
    expect(messageTermine(sujetTermine(fin, "✳ Refonte"))).toBe("Terminé : 3 fichiers modifiés, tests au vert.");
    // Une question ou une autorisation n'est pas un message de fin.
    expect(sujetTermine({ body: "Autoriser ?", attente: "autorisation" }, undefined)).toBe("");
    expect(messageTermine(sujetTermine({ body: "", attente: "fin" }, undefined))).toBe("Terminé");
    expect(ariaTuile("api", "termine", "Terminé : x")).toBe("Ouvrir le terminal de api, terminé");
  });

  it("balayage décalé d'un espace à l'autre", () => {
    expect(cadenceBalayage("infra")).toEqual({ duree: "1.50s", delai: "-0.35s" });
    expect(cadenceBalayage("recherche")).toEqual({ duree: "2.42s", delai: "-0.33s" });
  });
});

describe("lignes de terminal", () => {
  it("ton : invites et puces en clair, sorties d'outil discrètes", () => {
    expect(tonLigne("❯ claude")).toBe("fort");
    expect(tonLigne("● Je refonds le dock")).toBe("fort");
    expect(tonLigne("  ⎿  Read src/App.tsx")).toBe("discret");
    expect(tonLigne("  └ 142 tests passés")).toBe("discret");
    expect(tonLigne("rien à valider")).toBe("texte");
  });

  it("dernière commande : invite zsh, bash ou starship", () => {
    expect(derniereCommande(["❯ git status", "Sur la branche main"])).toBe("❯ git status");
    expect(derniereCommande(["moi@poste:~/dev/x$ npm test", "ok"])).toBe("❯ npm test");
    expect(derniereCommande(["sortie", "autre sortie"])).toBeNull();
  });

  it("clés : une ligne qui remonte garde sa clé, la nouvelle en reçoit une neuve", () => {
    const r = alignerCles(["a", "b", "c"], [1, 2, 3], ["b", "c", "d"], 10);
    expect(r).toEqual({ cles: [2, 3, 10], prochaineCle: 11 });
    // Tampon pas encore plein : ajout en fin.
    expect(alignerCles(["a"], [1], ["a", "b"], 5).cles).toEqual([1, 5]);
    // Identique : mêmes clés.
    expect(alignerCles(["a", "b"], [1, 2], ["a", "b"], 5)).toEqual({ cles: [1, 2], prochaineCle: 5 });
  });

  it("clés : ligne d'activité réécrite en place pendant qu'une sortie arrive", () => {
    // Réécrite seule : rien ne bouge.
    expect(alignerCles(["a", "b", "✻ 1s"], [1, 2, 3], ["a", "b", "✻ 2s"], 9).cles).toEqual([1, 2, 3]);
    // Réécrite et décalée : seule la nouvelle dernière ligne entre.
    expect(alignerCles(["a", "b", "✻ 1s"], [1, 2, 3], ["b", "c", "✻ 2s"], 9).cles).toEqual([2, 3, 9]);
  });

  it("clés : écran redessiné, les clés restent aux positions", () => {
    expect(alignerCles(["a", "b"], [1, 2], ["x", "y", "z"], 7)).toEqual({ cles: [1, 2, 7], prochaineCle: 8 });
    expect(alignerCles([], [], ["x"], 3)).toEqual({ cles: [3], prochaineCle: 4 });
  });
});

describe("temps", () => {
  it("chrono et il y a", () => {
    expect(chrono(4_000)).toBe("0:04");
    expect(chrono(252_000)).toBe("4:12");
    expect(chrono(3_725_000)).toBe("1:02:05");
    expect(ilYA(400)).toBe("il y a 1 s");
    expect(ilYA(180_000)).toBe("il y a 3 min");
    expect(ilYA(3 * 3_600_000)).toBe("il y a 3 h");
    expect(ilYA(30 * 3_600_000)).toBe("hier");
    expect(ilYA(4 * 86_400_000)).toBe("il y a 4 j");
  });

  it("étiquette selon l'état, vide seulement sans suivi", () => {
    expect(etiquetteTemps("attente", 0, 42_000)).toBe("depuis 0:42");
    expect(etiquetteTemps("travail", 0, 72_000)).toBe("1:12");
    expect(etiquetteTemps("repos", 0, 120_000)).toBe("il y a 2 min");
    expect(etiquetteTemps("repos", null, 120_000)).toBe("");
  });

  it("suivi : même Map sans changement, transition datée, nouvel espace daté à son apparition", () => {
    const vide = new Map<string, SuiviEtat>();
    const debut = majSuivi(vide, [["a", "repos"]], 100);
    expect(debut.get("a")).toEqual({ etat: "repos", depuis: 100 });
    expect(majSuivi(debut, [["a", "repos"]], 200)).toBe(debut);
    const travail = majSuivi(debut, [["a", "travail"]], 300);
    expect(travail.get("a")).toEqual({ etat: "travail", depuis: 300 });
    // Nouvel espace en cours de route : daté de son apparition ; espace disparu : oublié.
    const ajout = majSuivi(travail, [["b", "repos"]], 400);
    expect(ajout.get("b")).toEqual({ etat: "repos", depuis: 400 });
    expect(ajout.has("a")).toBe(false);
  });
});

describe("navigation clavier", () => {
  // Grille 3 colonnes × 2 rangées, puis une section de 2 tuiles plus bas.
  const r = (left: number, top: number): RectTuile => ({ left, top, width: 100, height: 80 });
  const rects = [r(0, 0), r(110, 0), r(220, 0), r(0, 90), r(110, 90), r(0, 230), r(110, 230)];

  it("gauche/droite suivent l'ordre de lecture, Début/Fin aux extrémités", () => {
    expect(tuileVoisine(rects, 2, "ArrowRight")).toBe(3);
    expect(tuileVoisine(rects, 0, "ArrowLeft")).toBe(0);
    expect(tuileVoisine(rects, 4, "Home")).toBe(0);
    expect(tuileVoisine(rects, 0, "End")).toBe(6);
  });

  it("haut/bas : rangée voisine, tuile la mieux alignée", () => {
    expect(tuileVoisine(rects, 1, "ArrowDown")).toBe(4);
    expect(tuileVoisine(rects, 2, "ArrowDown")).toBe(4);
    expect(tuileVoisine(rects, 4, "ArrowDown")).toBe(6);
    expect(tuileVoisine(rects, 6, "ArrowUp")).toBe(4);
    expect(tuileVoisine(rects, 0, "ArrowUp")).toBe(0);
  });

  it("touches reconnues, grille vide", () => {
    expect(estToucheNavigation("ArrowUp")).toBe(true);
    expect(estToucheNavigation("Enter")).toBe(false);
    expect(tuileVoisine([], 0, "ArrowDown")).toBe(-1);
  });
});

describe("apercuParlant", () => {
  it("rien à montrer : invites vides et lignes blanches", () => {
    expect(apercuParlant([])).toBe(false);
    expect(apercuParlant(["❯", "", "  $ "])).toBe(false);
  });
  it("une vraie ligne suffit", () => {
    expect(apercuParlant(["❯", "Autoriser npm run migrate ?"])).toBe(true);
    expect(apercuParlant(["❯ git status"])).toBe(true);
  });
});
