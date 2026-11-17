import { describe, it, expect } from "vitest";
import {
  segmentsDock,
  largeurEtiquette,
  largeurMembres,
  largeurSegment,
  largeurBande,
  replisAutomatiques,
  consulterGroupe,
  pileGroupe,
  placeMembre,
  abscisseIndicateur,
  abscisseCompteur,
  pileAvecCompteur,
  largeurPile,
  melangeOpaque,
  pasDefilementBord,
  geometrieAvatars,
  LARGEUR_AVATAR,
  PAS_AVATAR,
  LARGEUR_PILE,
  LARGEUR_ETIQUETTE_MAX,
  type SegmentDock,
  type EtatPile,
} from "./dockLayout";

type W = { id: string; groupId: string | null };
const ws = (id: string, groupId: string | null = null): W => ({ id, groupId });

/** Jeu de la maquette Groupes : 2 hors groupe, produit (5), services (5), ops (4). */
const groupes = [
  { id: "produit", name: "produit" },
  { id: "services", name: "services" },
  { id: "ops", name: "ops" },
];
const espaces: W[] = [
  ws("notes"),
  ws("dot"),
  ...["term", "site", "mobile", "ds", "docs"].map((id) => ws(id, "produit")),
  ...["api", "auth", "fact", "notif", "search"].map((id) => ws(id, "services")),
  ...["infra", "mon", "ci", "save"].map((id) => ws(id, "ops")),
];
const segs = segmentsDock(espaces, groupes);

describe("segmentsDock", () => {
  it("hors groupe d'abord, puis les groupes dans leur ordre", () => {
    expect(segs.map((s) => s.id)).toEqual([null, "produit", "services", "ops"]);
    expect(segs[0].membres.map((w) => w.id)).toEqual(["notes", "dot"]);
    expect(segs[3].membres.map((w) => w.id)).toEqual(["infra", "mon", "ci", "save"]);
  });

  it("pas de segment hors groupe vide, mais un groupe vide garde son étiquette", () => {
    const s = segmentsDock([ws("a", "g")], [{ id: "g", name: "g" }, { id: "vide", name: "vide" }]);
    expect(s.map((x) => x.id)).toEqual(["g", "vide"]);
    expect(s[1].membres).toEqual([]);
  });
});

describe("largeurs", () => {
  it("étiquette : 34 px + 6,6 px par signe, plafonnée", () => {
    expect(largeurEtiquette("ops")).toBe(34 + 20);
    expect(largeurEtiquette("produit")).toBe(34 + 47);
    expect(largeurEtiquette("x".repeat(80))).toBe(LARGEUR_ETIQUETTE_MAX);
  });

  it("membres : rangée au pas de 52, pile de 88, rien si vide", () => {
    expect(largeurMembres(1, false)).toBe(44);
    expect(largeurMembres(5, false)).toBe(252);
    expect(largeurMembres(5, true)).toBe(88);
    expect(largeurMembres(0, true)).toBe(0);
  });

  it("pile d'un ou deux membres : le compteur colle au dernier avatar visible, sans trou", () => {
    // Trois membres ou plus : la pile complète de la maquette (avatars à 0, 10, 20 ; compteur à 66).
    expect(abscisseCompteur(3)).toBe(66);
    expect(abscisseCompteur(7)).toBe(66);
    expect(largeurPile(3)).toBe(LARGEUR_PILE);
    // Deux membres : avatars à 0 et 10 (bord droit 54), compteur à 56.
    expect(abscisseCompteur(2)).toBe(56);
    expect(largeurMembres(2, true)).toBe(78);
    // Un membre : l'avatar seul, sans compteur. Replié, le groupe garde sa largeur de déplié.
    expect(pileAvecCompteur(1)).toBe(false);
    expect(pileAvecCompteur(2)).toBe(true);
    expect(largeurMembres(1, true)).toBe(44);
    expect(largeurMembres(1, true)).toBe(largeurMembres(1, false));
    expect(largeurPile(1, 48)).toBe(52);
    // Dès deux membres, le compteur (22 px + marge de 2) ferme la boîte de la pile.
    for (const n of [2, 3, 5]) expect(largeurPile(n)).toBe(abscisseCompteur(n) - 2 + 24);
    expect(largeurPile(2, 32)).toBe(70);
  });

  it("segment : le hors-groupe n'a ni étiquette ni marges, et ne se replie jamais", () => {
    expect(largeurSegment(segs[0], true)).toBe(96);
    expect(largeurSegment(segs[1], false)).toBe(6 + 81 + 2 + 252 + 4);
    expect(largeurSegment(segs[1], true)).toBe(6 + 81 + 2 + 88 + 4);
  });

  it("bande : écarts de 8 et séparateur de 9 après le hors-groupe", () => {
    const tout = 96 + 9 + 8 + 345 + 8 + (6 + 87 + 2 + 252 + 4) + 8 + (6 + 54 + 2 + 200 + 4);
    expect(largeurBande(segs, new Set())).toBe(tout);
    // Sans groupe : pas de séparateur (celui du « + » est hors de la bande).
    expect(largeurBande(segmentsDock([ws("a"), ws("b")], []), new Set())).toBe(96);
  });
});

describe("replisAutomatiques", () => {
  const manuels = new Set(["services"]);
  const base = { segments: segs, replisManuels: manuels, recents: ["produit", "ops", "services"], groupeActif: "produit" };

  it("assez de place : seuls les replis manuels", () => {
    const r = replisAutomatiques({ ...base, disponible: 5000 });
    expect([...r.replis]).toEqual(["services"]);
    expect(r.auto.size).toBe(0);
    expect(r.defile).toBe(false);
  });

  it("place mesurée inconnue (Infinity) : rien de replié automatiquement", () => {
    expect(replisAutomatiques({ ...base, disponible: Infinity }).auto.size).toBe(0);
  });

  it("replie d'abord le moins récemment consulté, jamais l'actif ni le dernier déplié", () => {
    // Juste un pixel de trop : un seul groupe à replier.
    const r = replisAutomatiques({
      ...base,
      recents: ["services", "produit", "ops"],
      replisManuels: new Set(),
      disponible: largeurBande(segs, new Set()) - 1,
    });
    // « services » est le dernier consulté, « produit » porte l'actif : c'est « ops » qui cède.
    expect([...r.auto]).toEqual(["ops"]);
    expect(r.defile).toBe(false);
  });

  it("jamais consulté passe avant les consultés, puis dans l'ordre du dock", () => {
    const r = replisAutomatiques({
      segments: segs,
      replisManuels: new Set(),
      recents: ["ops"],
      groupeActif: null,
      disponible: largeurBande(segs, new Set()) - 1,
    });
    expect([...r.auto]).toEqual(["produit"]);
  });

  it("toujours trop large : la bande défile", () => {
    const r = replisAutomatiques({ ...base, disponible: 300 });
    expect(r.defile).toBe(true);
    // Le groupe actif reste déplié, même quand rien ne tient.
    expect(r.replis.has("produit")).toBe(false);
  });

  it("un groupe vide n'est jamais candidat", () => {
    const s: SegmentDock<W>[] = segmentsDock([ws("a"), ws("b"), ws("c")], [{ id: "vide", name: "vide" }]);
    const r = replisAutomatiques({ segments: s, replisManuels: new Set(), recents: [], groupeActif: null, disponible: 10 });
    expect(r.auto.size).toBe(0);
    expect(r.defile).toBe(true);
  });

  it("un groupe d'un seul membre n'est jamais candidat : sa pile élargirait la bande", () => {
    const s: SegmentDock<W>[] = segmentsDock(
      [ws("a", "seul"), ...["b", "c", "d"].map((id) => ws(id, "grand"))],
      [
        { id: "seul", name: "seul" },
        { id: "grand", name: "grand" },
      ],
    );
    expect(largeurMembres(1, true)).toBeGreaterThanOrEqual(largeurMembres(1, false));
    const r = replisAutomatiques({
      segments: s,
      replisManuels: new Set(),
      recents: ["grand"],
      groupeActif: null,
      disponible: largeurBande(s, new Set()) - 1,
    });
    // « grand » est le dernier consulté (gardé) ; replier « seul » n'aiderait pas : la bande défile.
    expect([...r.auto]).toEqual([]);
    expect(r.defile).toBe(true);
    const r2 = replisAutomatiques({
      segments: s,
      replisManuels: new Set(),
      recents: [],
      groupeActif: null,
      disponible: largeurBande(s, new Set()) - 1,
    });
    expect([...r2.auto]).toEqual(["grand"]);
    expect(r2.defile).toBe(false);
  });
});

describe("consulterGroupe", () => {
  it("remonte le groupe en tête sans doublon", () => {
    expect(consulterGroupe(["a", "b", "c"], "c")).toEqual(["c", "a", "b"]);
    expect(consulterGroupe([], "a")).toEqual(["a"]);
  });

  it("déjà en tête : même tableau (pas de rendu pour rien)", () => {
    const r = ["a", "b"];
    expect(consulterGroupe(r, "a")).toBe(r);
  });
});

describe("pileGroupe", () => {
  const etats = (e: Record<string, EtatPile>) => new Map(Object.entries(e));
  const ids = ["a", "b", "c", "d"];

  it("l'agent qui attend passe en tête et la pile est en attente", () => {
    const p = pileGroupe(ids, etats({ b: "travail", c: "attente" }), "a");
    expect(p.representant).toBe("c");
    expect(p.ordre).toEqual(["c", "a", "b", "d"]);
    expect(p.etat).toBe("attente");
  });

  it("sinon l'agent qui travaille, sinon l'actif, sinon le premier", () => {
    expect(pileGroupe(ids, etats({ d: "travail" }), "b").representant).toBe("d");
    expect(pileGroupe(ids, etats({ d: "travail" }), "b").etat).toBe("travail");
    expect(pileGroupe(ids, etats({}), "b").representant).toBe("b");
    expect(pileGroupe(ids, etats({}), null).representant).toBe("a");
    expect(pileGroupe(ids, etats({}), null).etat).toBe("repos");
  });

  it("groupe vide : pile vide", () => {
    expect(pileGroupe([], etats({}), null)).toEqual({ ordre: [], representant: null, etat: "repos" });
  });
});

describe("placeMembre", () => {
  it("rangée : un avatar tous les 52 px", () => {
    expect(placeMembre(3, 0, false)).toEqual({ x: 156, z: 1, visible: true });
  });

  it("pile : décalés de 10, le représentant dessus, trois visibles", () => {
    expect(placeMembre(4, 0, true)).toEqual({ x: 0, z: 10, visible: true });
    expect(placeMembre(0, 2, true)).toEqual({ x: 20, z: 8, visible: true });
    expect(placeMembre(1, 3, true)).toEqual({ x: 20, z: 7, visible: false });
  });
});

describe("abscisseIndicateur", () => {
  it("sous l'avatar actif, en tenant compte de l'étiquette et des segments précédents", () => {
    expect(abscisseIndicateur(segs, new Set(), "dot")).toBe(52);
    // produit commence après hors-groupe (96) + 8 + 9, puis marge 6 + étiquette 81 + 2.
    expect(abscisseIndicateur(segs, new Set(), "site")).toBe(113 + 89 + 52);
  });

  it("sous la pile d'un groupe replié : au deuxième avatar", () => {
    expect(abscisseIndicateur(segs, new Set(["produit"]), "docs")).toBe(113 + 89 + 10);
  });

  it("sous la pile d'un groupe replié d'un ou deux membres : au centre de ses avatars", () => {
    const petits = segmentsDock(
      [ws("seul", "un"), ws("a", "deux"), ws("b", "deux")],
      [
        { id: "un", name: "un" },
        { id: "deux", name: "deux" },
      ],
    );
    const replis = new Set(["un", "deux"]);
    // « un » : marge 6 + étiquette (34 + 14) + 2 ; son unique avatar est à 0.
    expect(abscisseIndicateur(petits, replis, "seul")).toBe(56);
    // « deux » commence après « un » (56 + pile 44, sans compteur + marge 4) + écart 8, puis marge 6 +
    // étiquette (34 + 27) + 2 ; avatars à 0 et 10, centre à 5.
    expect(abscisseIndicateur(petits, replis, "b")).toBe(112 + 69 + 5);
  });

  it("null sans espace actif ou s'il n'est pas dans la bande", () => {
    expect(abscisseIndicateur(segs, new Set(), null)).toBeNull();
    expect(abscisseIndicateur(segs, new Set(), "inconnu")).toBeNull();
  });
});

describe("melangeOpaque", () => {
  it("couleur à la part donnée sur le fond du segment", () => {
    expect(melangeOpaque("#1d1e22", 0.5)).toBe("rgb(29,30,34)");
    expect(melangeOpaque("#ffffff", 1)).toBe("rgb(255,255,255)");
    expect(melangeOpaque("#a99cff", 0.22)).toBe("rgb(60,58,83)");
  });
});

describe("pasDefilementBord", () => {
  // Bande de 100 à 500 px, zones de 40 px.
  it("ne défile pas loin des bords", () => {
    expect(pasDefilementBord(300, 100, 500)).toBe(0);
    expect(pasDefilementBord(140, 100, 500)).toBe(0);
    expect(pasDefilementBord(460, 100, 500)).toBe(0);
  });

  it("défile vers le bord approché, plus vite à mesure qu'on s'en rapproche", () => {
    const loin = pasDefilementBord(130, 100, 500);
    const pres = pasDefilementBord(105, 100, 500);
    expect(loin).toBeLessThan(0);
    expect(pres).toBeLessThan(loin);
    expect(pasDefilementBord(480, 100, 500)).toBeGreaterThan(0);
  });

  it("plafonne au-delà du bord", () => {
    expect(pasDefilementBord(20, 100, 500)).toBe(pasDefilementBord(100, 100, 500));
    expect(pasDefilementBord(900, 100, 500)).toBe(14);
  });

  it("reste immobile sur une bande trop étroite", () => {
    expect(pasDefilementBord(105, 100, 170)).toBe(0);
  });
});

describe("densité du dock (taille des avatars)", () => {
  it("normale : retrouve les mesures fixes de la maquette Dock", () => {
    const g = geometrieAvatars(40);
    expect(g).toMatchObject({ avatar: 40, bouton: LARGEUR_AVATAR, pas: PAS_AVATAR, pile: LARGEUR_PILE, filet: 28, infobulle: 62 });
    expect(g.compteur).toBe(66);
    expect(geometrieAvatars()).toEqual(g);
  });

  it("compacte et ample : bouton = avatar + 4, pas = bouton + 8 (maquette Parametres)", () => {
    expect(geometrieAvatars(32)).toMatchObject({ bouton: 36, pas: 44, pile: 80, filet: 22, infobulle: 54 });
    expect(geometrieAvatars(48)).toMatchObject({ bouton: 52, pas: 60, pile: 96, filet: 34, infobulle: 70 });
  });

  it("largeurs, places et indicateur suivent la taille", () => {
    expect(largeurMembres(5, false, 32)).toBe(5 * 44 - 8);
    expect(largeurMembres(5, true, 48)).toBe(96);
    expect(largeurSegment(segs[1], false, 48)).toBe(6 + 81 + 2 + (5 * 60 - 8) + 4);
    expect(placeMembre(2, 2, false, 32).x).toBe(88);
    expect(placeMembre(2, 2, true, 32).x).toBe(20);
    const compacte = largeurBande(segs, new Set(), 32);
    expect(compacte).toBeLessThan(largeurBande(segs, new Set()));
    expect(largeurBande(segs, new Set(), 48)).toBeGreaterThan(largeurBande(segs, new Set()));
    // Deuxième avatar du hors-groupe : un pas.
    expect(abscisseIndicateur(segs, new Set(), "dot", 48)).toBe(60);
  });

  it("le repli automatique tient compte de la taille : plus d'avatars tiennent en compacte", () => {
    const base = { segments: segs, replisManuels: new Set<string>(), recents: [], groupeActif: null };
    const disponible = largeurBande(segs, new Set(), 32);
    expect(replisAutomatiques({ ...base, disponible, taille: 32 }).replis.size).toBe(0);
    expect(replisAutomatiques({ ...base, disponible }).replis.size).toBeGreaterThan(0);
  });
});
