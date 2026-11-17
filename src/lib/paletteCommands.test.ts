import { describe, it, expect } from "vitest";
import {
  actionsDisponibles,
  aplatir,
  construireSections,
  deplacerSelection,
  indiceEspace,
  indiceSelection,
  segmenterSurlignage,
  titreOnglet,
  type ContextePalette,
  type EspacePalette,
} from "./paletteCommands";

function espace(id: string, o: Partial<EspacePalette> = {}): EspacePalette {
  return {
    id,
    name: id,
    cwd: `/home/dev/${id}`,
    tabs: [{ id: `${id}-t1`, etat: "repos" }],
    activeTabId: `${id}-t1`,
    etat: "repos",
    ...o,
  };
}

function ctx(o: Partial<ContextePalette> = {}): ContextePalette {
  const espaces = o.espaces ?? [espace("api"), espace("site"), espace("docs")];
  return {
    espaces,
    ordreNavigable: espaces.map((e) => e.id),
    actifId: espaces[0]?.id ?? null,
    actifDansGroupe: false,
    dockVisible: true,
    requete: "",
    ...o,
  };
}

const ids = (c: ContextePalette) => construireSections(c).map((s) => s.id);

describe("titreOnglet / indiceEspace", () => {
  it("titre du terminal, sinon rang", () => {
    expect(titreOnglet({ title: " vim " }, 0)).toBe("vim");
    expect(titreOnglet({}, 1)).toBe("Terminal 2");
    expect(titreOnglet({ title: "  " }, 0)).toBe("Terminal 1");
  });

  it("l'état prime sur la branche", () => {
    expect(indiceEspace(espace("a", { branch: "main" }))).toEqual({ texte: "main", ton: "discret" });
    expect(indiceEspace(espace("a", { etat: "travail", statut: "Compile" }))).toEqual({ texte: "Compile", ton: "travail" });
    expect(indiceEspace(espace("a", { etat: "travail" })).texte).toBe("Un agent travaille");
    expect(indiceEspace(espace("a", { etat: "attente", notification: "Autoriser ?" }))).toEqual({ texte: "Autoriser ?", ton: "attente" });
    expect(indiceEspace(espace("a", { etat: "attente" })).texte).toBe("Vous attend");
  });

  it("agent qui vient de finir : « Terminé : sujet », en vert", () => {
    expect(indiceEspace(espace("a", { etat: "termine", sujetTermine: "Refonte du dock" }))).toEqual({
      texte: "Terminé : Refonte du dock",
      ton: "termine",
    });
    expect(indiceEspace(espace("a", { etat: "termine" })).texte).toBe("Terminé");
  });

  it("sans branche, « hors dépôt »", () => {
    expect(indiceEspace(espace("a")).texte).toBe("hors dépôt");
  });

  it("préfixé du nom du groupe (maquette Groupes)", () => {
    expect(indiceEspace(espace("a", { branch: "feat/hero-anim", groupe: "produit" })).texte).toBe("produit · feat/hero-anim");
    expect(
      indiceEspace(espace("a", { etat: "attente", notification: "Autoriser npm run migrate ?", groupe: "services" })),
    ).toEqual({ texte: "services · Autoriser npm run migrate ?", ton: "attente" });
  });
});

describe("construireSections sans requête", () => {
  it("espaces puis actions ; pas d'onglets avec un seul onglet", () => {
    expect(ids(ctx())).toEqual(["espaces", "actions"]);
  });

  it("« Vous attendent » en tête avec les seuls espaces en attente, qui restent aussi dans « Espaces »", () => {
    const c = ctx({ espaces: [espace("api"), espace("site", { etat: "attente" }), espace("docs", { etat: "travail" })] });
    const s = construireSections(c);
    expect(s.map((x) => x.id)).toEqual(["attendent", "espaces", "actions"]);
    expect(s[0].entrees.map((e) => e.cible)).toEqual([{ type: "espace", wsId: "site" }]);
    expect(s[1].entrees).toHaveLength(3);
    const tous = aplatir(s).map((e) => e.id);
    expect(new Set(tous).size).toBe(tous.length);
  });

  it("les espaces portent Ctrl 1…9 selon l'ordre navigable, rien au-delà ni hors ordre", () => {
    const espaces = Array.from({ length: 11 }, (_, i) => espace(`e${i}`));
    const c = ctx({ espaces, ordreNavigable: espaces.filter((e) => e.id !== "e1").map((e) => e.id) });
    const l = construireSections(c)[0].entrees;
    expect(l[0].raccourci).toBe("Ctrl 1");
    expect(l[1].raccourci).toBeUndefined();
    expect(l[2].raccourci).toBe("Ctrl 2");
    expect(l[10].raccourci).toBeUndefined();
  });

  it("liste les onglets de l'espace actif s'il en a plusieurs", () => {
    const api = espace("api", {
      tabs: [
        { id: "t1", title: "zsh", etat: "repos" },
        { id: "t2", etat: "travail" },
      ],
      activeTabId: "t1",
    });
    const s = construireSections(ctx({ espaces: [api, espace("site")], actifId: "api" }));
    const onglets = s.find((x) => x.id === "onglets")!;
    expect(onglets.entrees.map((e) => e.libelle)).toEqual(["zsh", "Terminal 2"]);
    expect(onglets.entrees[0].visuel).toMatchObject({ genre: "onglet", actif: true });
    expect(onglets.entrees[1].cible).toEqual({ type: "onglet", wsId: "api", tabId: "t2" });
  });

  it("aucun espace : seules les actions de création restent", () => {
    const s = construireSections(ctx({ espaces: [], actifId: null }));
    expect(s.map((x) => x.id)).toEqual(["actions"]);
    expect(s[0].entrees.map((e) => e.id)).toEqual([
      "action:new-workspace",
      "action:new-home-workspace",
      "action:open-folder",
      "action:new-group",
      "action:toggle-dashboard",
      "action:toggle-parametres",
      "action:toggle-dock",
    ]);
  });
});

describe("construireSections avec requête", () => {
  it("masque « Vous attendent » et filtre les espaces", () => {
    const c = ctx({ espaces: [espace("api", { etat: "attente" }), espace("site")], requete: "api" });
    const s = construireSections(c);
    expect(s.map((x) => x.id)).not.toContain("attendent");
    expect(s[0].entrees.map((e) => e.libelle)).toEqual(["api"]);
    expect(s[0].entrees[0].indices).toEqual([0, 1, 2]);
  });

  it("cherche sur le nom et le groupe, jamais sur la branche ni le dossier (maquette Dock/09)", () => {
    const c = ctx({
      espaces: [
        espace("auth", { branch: "main" }),
        espace("infra", { branch: "main" }),
        espace("site", { groupe: "inspiration" }),
        espace("notifications"),
      ],
      requete: "in",
    });
    // « notifications » ne contient pas « in » d'un bloc : écarté, comme dans la maquette.
    expect(construireSections(c)[0].entrees.map((e) => e.libelle).sort()).toEqual(["infra", "site"]);
    // Aucun nom ne contient la requête : la recherche floue reprend la main.
    const flou = ctx({ espaces: [espace("api-paiements"), espace("site")], requete: "apm" });
    expect(construireSections(flou)[0].entrees.map((e) => e.libelle)).toEqual(["api-paiements"]);
  });

  it("propose les espaces récents à reprendre, après les espaces", () => {
    const c = ctx({
      reprendre: [{ nom: "api-paiements", cwd: "/p/api", couleur: "#f78fc6", indice: "~/api", quand: "hier" }],
    });
    const s = construireSections(c);
    const ids = s.map((x) => x.id);
    expect(ids.indexOf("reprendre")).toBe(ids.indexOf("espaces") + 1);
    expect(s.find((x) => x.id === "reprendre")!.entrees[0]).toMatchObject({
      libelle: "api-paiements",
      indice: "~/api",
      raccourci: "hier",
      cible: { type: "reprendre", cwd: "/p/api", nom: "api-paiements" },
    });
  });

  it("retrouve un onglet de n'importe quel espace, par titre", () => {
    const docs = espace("docs", { tabs: [{ id: "x", title: "serveur", etat: "travail" }], activeTabId: "x" });
    const s = construireSections(ctx({ espaces: [espace("api"), docs], requete: "serveur" }));
    const o = s.find((x) => x.id === "onglets")!;
    expect(o.entrees[0]).toMatchObject({ libelle: "serveur", indice: "docs", cible: { type: "onglet", wsId: "docs", tabId: "x" } });
  });

  it("retrouve une action par mot-clé, sans accent", () => {
    const a = construireSections(ctx({ requete: "recap" })).find((x) => x.id === "actions")!;
    expect(a.entrees[0].cible).toEqual({ type: "raccourci", action: { type: "toggle-dashboard" } });
    expect(a.entrees[0].raccourci).toBe("Ctrl+Maj+H");
  });

  it("aucun résultat : aucune section", () => {
    expect(construireSections(ctx({ requete: "zzzzqq" }))).toEqual([]);
  });

  it("classe les actions par pertinence", () => {
    const a = construireSections(ctx({ requete: "nouvel" })).find((x) => x.id === "actions")!;
    expect(a.entrees[0].libelle).toBe("Nouvel espace");
  });
});

describe("actionsDisponibles", () => {
  const libelles = (c: ContextePalette) => actionsDisponibles(c).map((a) => a.id);

  it("fichiers modifiés seulement avec un dossier", () => {
    expect(libelles(ctx())).toContain("toggle-diff");
    const sansDossier = ctx({ espaces: [espace("a", { cwd: "" })] });
    expect(libelles(sansDossier)).not.toContain("toggle-diff");
  });

  it("replier le groupe seulement dans un groupe", () => {
    expect(libelles(ctx())).not.toContain("toggle-group");
    expect(libelles(ctx({ actifDansGroupe: true }))).toContain("toggle-group");
  });

  it("navigation entre onglets et espaces seulement s'il y a de quoi naviguer", () => {
    const seul = ctx({ espaces: [espace("a")] });
    expect(libelles(seul)).not.toContain("next-workspace");
    expect(libelles(seul)).not.toContain("next-tab");
    expect(libelles(ctx())).toContain("next-workspace");
  });

  it("la mosaïque ouvre les actions, à l'accent, avec l'état des agents", () => {
    const c = ctx({ espaces: [espace("a", { etat: "travail" }), espace("b", { etat: "attente" }), espace("c", { etat: "travail" })] });
    const a = construireSections(c).find((x) => x.id === "actions")!;
    expect(a.entrees[0]).toMatchObject({
      id: "action:toggle-mosaique",
      indice: "2 au travail · 1 en attente",
      visuel: { genre: "accent" },
    });
  });

  it("le libellé du dock suit son état", () => {
    const l = (v: boolean) => actionsDisponibles(ctx({ dockVisible: v })).find((a) => a.id === "toggle-dock")!.libelle;
    expect(l(true)).toBe("Masquer le dock");
    expect(l(false)).toBe("Afficher le dock");
  });

  it("dupliquer vise l'espace actif et passe par le store, pas par un raccourci", () => {
    const d = actionsDisponibles(ctx({ actifId: "site" })).find((a) => a.id === "duplicate-workspace")!;
    expect(d.cible).toEqual({ type: "dupliquer", wsId: "site" });
    expect(d.raccourci).toBeUndefined();
  });

  it("les libellés d'action sont uniques", () => {
    const l = libelles(ctx({ actifDansGroupe: true, espaces: [espace("a", { tabs: [{ id: "1", etat: "repos" }, { id: "2", etat: "repos" }] }), espace("b")] }));
    expect(new Set(l).size).toBe(l.length);
  });
});

describe("deplacerSelection", () => {
  it("reboucle dans les deux sens", () => {
    expect(deplacerSelection(0, -1, 5)).toBe(4);
    expect(deplacerSelection(4, 1, 5)).toBe(0);
    expect(deplacerSelection(2, 1, 5)).toBe(3);
  });
  it("liste vide : 0", () => {
    expect(deplacerSelection(3, 1, 0)).toBe(0);
  });
});

describe("indiceSelection", () => {
  const lignes = [{ id: "a" }, { id: "b" }, { id: "c" }];
  it("suit la ligne choisie même si elle change de rang", () => {
    expect(indiceSelection(lignes, "b")).toBe(1);
    // Une section apparaît en tête : la même ligne descend, la sélection la suit.
    expect(indiceSelection([{ id: "x" }, ...lignes], "b")).toBe(2);
  });
  it("sans choix ou ligne disparue : première ligne", () => {
    expect(indiceSelection(lignes, null)).toBe(0);
    expect(indiceSelection(lignes, "zz")).toBe(0);
    expect(indiceSelection([], "a")).toBe(0);
  });
});

describe("segmenterSurlignage", () => {
  it("sans lettre trouvée : un seul morceau", () => {
    expect(segmenterSurlignage("Nouvel espace", [])).toEqual([{ texte: "Nouvel espace", trouve: false }]);
  });
  it("regroupe les lettres consécutives", () => {
    expect(segmenterSurlignage("api-paiements", [0, 1, 2, 4])).toEqual([
      { texte: "api", trouve: true },
      { texte: "-", trouve: false },
      { texte: "p", trouve: true },
      { texte: "aiements", trouve: false },
    ]);
  });
  it("recompose le texte d'origine", () => {
    const m = segmenterSurlignage("Voir les fichiers", [0, 5, 6]);
    expect(m.map((x) => x.texte).join("")).toBe("Voir les fichiers");
  });
});

describe("superviseur et réglages dans la palette", () => {
  const base = (): ContextePalette => ({
    espaces: [],
    ordreNavigable: [],
    actifId: null,
    actifDansGroupe: false,
    dockVisible: true,
    requete: "",
  });

  it("le superviseur n'apparaît que s'il est actif, juste après « Vous attendent »", () => {
    expect(construireSections(base()).some((s) => s.id === "superviseur")).toBe(false);
    const s = construireSections({ ...base(), superviseur: { nom: "Vigie", etat: "observe 3 espaces" } });
    expect(s[0].id).toBe("superviseur");
    expect(s[0].entrees.map((e) => e.libelle)).toEqual(["Vigie", "Où en sont mes agents ?", "Ranger les espaces par groupe"]);
    expect(s[0].entrees[0]).toMatchObject({ raccourci: "Ctrl+Maj+Espace", cible: { type: "superviseur" } });
    expect(s[0].entrees[1].cible).toEqual({ type: "superviseur", demande: "Où en sont mes agents ?" });
  });

  it("les réglages ne sortent que pendant une recherche, cinq au plus", () => {
    const reglages = [
      { id: "accent", libelle: "Couleur d’accent", section: "apparence" as const, motsCles: "theme couleur" },
      { id: "police", libelle: "Police", section: "terminal" as const, motsCles: "fonte" },
    ];
    expect(construireSections({ ...base(), reglages }).some((s) => s.id === "reglages")).toBe(false);
    const s = construireSections({ ...base(), reglages, requete: "police" });
    const r = s.find((x) => x.id === "reglages")!;
    expect(r.titre).toBe("Réglages");
    expect(r.entrees[0]).toMatchObject({
      libelle: "Police",
      indice: "Paramètres › Terminal",
      cible: { type: "reglage", section: "terminal", ligne: "police" },
    });
  });
});

