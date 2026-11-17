import { describe, expect, it } from "vitest";
import {
  cheminAbrege,
  construireSections,
  correspond,
  descCollecte,
  filtrerRaccourcis,
  heureEnTexte,
  introRecherche,
  membrePaire,
  minutesEnHeures,
  normaliserRecherche,
  optionsShell,
  rechercher,
  sousTitrePaire,
  texteEnHeure,
  type ContexteModele,
} from "./parametresModele";
import { rangeesRaccourcis } from "./parametresRaccourcis";
import { INDEX_REGLAGES, SECTIONS_PARAMETRES, reglagesCherchables } from "./reglagesIndex";

const raccourcis = rangeesRaccourcis();
const base: ContexteModele = {
  supActif: false,
  supNom: "Superviseur",
  activite: { source: "claude_mcp", integrationShell: true },
  raccourcis,
};
const ids = (ctx: ContexteModele) => construireSections(ctx).flatMap((s) => s.blocs.flatMap((b) => b.rangees.map((r) => r.id)));

describe("construireSections", () => {
  it("sept sections dans l'ordre de la navigation", () => {
    expect(construireSections(base).map((s) => s.id)).toEqual(SECTIONS_PARAMETRES.map((s) => s.id));
  });

  it("superviseur désactivé : seul l'interrupteur, et la note de la maquette", () => {
    const sup = construireSections(base).find((s) => s.id === "superviseur")!;
    expect(sup.blocs.flatMap((b) => b.rangees.map((r) => r.id))).toEqual(["supActif"]);
    expect(sup.blocs.some((b) => b.note?.startsWith("Désactivé"))).toBe(true);
  });

  it("superviseur activé : nom, pause, autonomie à son nom, paires", () => {
    const sup = construireSections({ ...base, supActif: true, supNom: "Vigie" }).find((s) => s.id === "superviseur")!;
    const rangees = sup.blocs.flatMap((b) => b.rangees);
    expect(rangees.map((r) => r.id)).toEqual(["supActif", "supNom", "supPause", "supNiveau", "supPaires"]);
    expect(rangees.find((r) => r.id === "supNiveau")?.libelle).toBe("Ce que Vigie peut faire");
    expect(sup.blocs.find((b) => b.titre === "Échanges entre espaces")?.note).toContain("par Vigie");
  });

  it("activité : rangées selon la source des tâches et l'intégration shell", () => {
    expect(ids(base)).toContain("listes");
    expect(ids(base)).not.toContain("cle");
    const api = ids({ ...base, activite: { source: "api", integrationShell: false } });
    expect(api).toContain("cle");
    expect(api).not.toContain("listes");
    expect(api).not.toContain("commandesIgnorees");
  });

  it("activité pas encore lue : aucune rangée, une note", () => {
    const act = construireSections({ ...base, activite: null, noteActivite: "illisible" }).find((s) => s.id === "activite")!;
    expect(act.blocs.flatMap((b) => b.rangees)).toEqual([]);
    expect(act.blocs[0].note).toBe("illisible");
  });

  it("chaque rangée de réglage a son entrée dans l'index de la palette (même section)", () => {
    const sections = construireSections({ ...base, supActif: true });
    for (const s of sections) {
      for (const r of s.blocs.flatMap((b) => b.rangees)) {
        if (r.combos) continue;
        const entree = INDEX_REGLAGES.find((e) => e.id === r.id);
        expect(entree, r.id).toBeDefined();
        expect(entree?.section, r.id).toBe(s.id);
        expect(r.motsCles).toBe(entree?.motsCles);
      }
    }
  });

  it("chaque entrée de l'index existe dans la page (toutes options ouvertes)", () => {
    const toutes = new Set([
      ...ids({ ...base, supActif: true }),
      ...ids({ ...base, supActif: true, activite: { source: "api", integrationShell: true } }),
    ]);
    for (const e of INDEX_REGLAGES) {
      if (e.id === "raccourcis") continue; // la section entière
      expect(toutes.has(e.id), e.id).toBe(true);
    }
  });

  it("superviseur désactivé : la palette ne propose que les réglages que la page montre", () => {
    const visibles = new Set(ids(base));
    const proposes = reglagesCherchables(false)
      .filter((e) => e.section === "superviseur")
      .map((e) => e.id);
    expect(proposes).toContain("supActif");
    for (const id of ["supNom", "supPause", "supNiveau", "supPaires"]) expect(proposes).not.toContain(id);
    for (const id of proposes) expect(visibles.has(id), id).toBe(true);
    expect(reglagesCherchables(true)).toBe(INDEX_REGLAGES);
  });
});

describe("recherche", () => {
  const sections = construireSections({ ...base, supActif: true });

  it("ignore casse, accents et « + », dans libellé, description et mots-clés", () => {
    expect(normaliserRecherche("Défilement")).toBe("defilement");
    expect(normaliserRecherche("Maj+D")).toBe("maj d");
    const r = { id: "x", libelle: "Défilement", desc: "Lignes conservées", motsCles: "scrollback" };
    expect(correspond(r, "DEFIL")).toBe(true);
    expect(correspond(r, "conservees")).toBe(true);
    expect(correspond(r, "scroll")).toBe(true);
    expect(correspond(r, "police")).toBe(false);
  });

  it("couvre toutes les sections et compte par section", () => {
    const res = rechercher(sections, "police");
    expect(res.map((r) => r.section.id)).toEqual(["apparence", "terminal"]);
    expect(res.find((r) => r.section.id === "terminal")?.rangees.map((x) => x.id)).toContain("police");
    // Les raccourcis aussi : « onglet » trouve des rangées de la section Raccourcis.
    expect(rechercher(sections, "onglet").some((r) => r.section.id === "raccourcis")).toBe(true);
    expect(rechercher(sections, "hooks")[0].rangees[0].id).toBe("hooks");
    expect(rechercher(sections, "zzzz")).toEqual([]);
  });

  it("intro : nombre de réglages accordé, ou rien", () => {
    expect(introRecherche(1, " son ")).toBe("1 réglage pour « son », dans toutes les sections.");
    expect(introRecherche(3, "x")).toBe("3 réglages pour « x », dans toutes les sections.");
    expect(introRecherche(0, "x")).toBe("Rien ne correspond, dans aucune section.");
  });

  it("filtre des raccourcis : par libellé ou par touches, blocs vides retirés", () => {
    const blocs = sections.find((s) => s.id === "raccourcis")!.blocs;
    const parTouche = filtrerRaccourcis(blocs, "maj+d");
    expect(parTouche.flatMap((b) => b.rangees.map((r) => r.libelle))).toContain("Fichiers modifiés");
    expect(filtrerRaccourcis(blocs, "dock").map((b) => b.titre)).toEqual(["Vues"]);
    expect(filtrerRaccourcis(blocs, "zzzz")).toEqual([]);
    expect(filtrerRaccourcis(blocs, "  ")).toHaveLength(blocs.length);
  });
});

describe("libellés", () => {
  it("cheminAbrege : le dossier personnel devient « ~ »", () => {
    expect(cheminAbrege("/home/moi/.config/terminials/settings.json", "/home/moi")).toBe("~/.config/terminials/settings.json");
    expect(cheminAbrege("/home/moi", "/home/moi/")).toBe("~");
    expect(cheminAbrege("/home/moins/x", "/home/moi")).toBe("/home/moins/x");
    expect(cheminAbrege("/etc/x", null)).toBe("/etc/x");
  });

  it("sousTitrePaire : date courte et échanges accordés", () => {
    const depuis = new Date(2026, 10, 12, 10).getTime();
    expect(sousTitrePaire({ depuis, echanges: 6 })).toBe("autorisée le 12 nov. · 6 échanges");
    expect(sousTitrePaire({ depuis: 0, echanges: 1 })).toBe("autorisée · 1 échange");
  });

  it("membrePaire : espace ouvert sur le dossier, nom du dossier, ou le superviseur", () => {
    const espaces = [{ id: "ws:1", cwd: "/x/site", name: "site" }];
    expect(membrePaire("/x/site", espaces, "Vigie")).toEqual({ nom: "site", wsId: "ws:1", superviseur: false });
    expect(membrePaire("/x/api-v2", espaces, "Vigie")).toEqual({ nom: "api-v2", wsId: null, superviseur: false });
    expect(membrePaire("superviseur", espaces, "Vigie")).toEqual({ nom: "Vigie", wsId: null, superviseur: true });
  });

  it("optionsShell : la session d'abord, un shell par nom, le choix courant toujours visible", () => {
    expect(optionsShell("/usr/bin/zsh", ["/bin/bash", "/usr/bin/zsh", "/usr/bin/fish"], "")).toEqual([
      { valeur: "", libelle: "$SHELL · zsh" },
      { valeur: "/bin/bash", libelle: "bash" },
      { valeur: "/usr/bin/fish", libelle: "fish" },
    ]);
    expect(optionsShell(null, [], "/opt/nu").map((o) => o.libelle)).toEqual(["$SHELL", "nu"]);
    // Autre chemin d'un shell proposé : il remplace l'option du même nom.
    expect(optionsShell("/bin/zsh", ["/bin/bash"], "/usr/bin/bash")).toEqual([
      { valeur: "", libelle: "$SHELL · zsh" },
      { valeur: "/usr/bin/bash", libelle: "bash" },
    ]);
  });

  it("descCollecte : âge de la plus récente des collectes", () => {
    expect(descCollecte({ git: 1000, claude: 1200 }, 1200 + 12 * 60, false)).toBe(
      "Dernière collecte il y a 12 min. Automatique toutes les 5 minutes.",
    );
    expect(descCollecte({ git: 1000 }, 1010, false)).toContain("à l’instant");
    expect(descCollecte({ git: 0 }, 2 * 3600, false)).toContain("il y a 2 heures");
    expect(descCollecte({}, 0, false)).toContain("Aucune collecte");
    expect(descCollecte(null, 0, true)).toContain("en cours");
  });

  it("heures du bilan et objectif", () => {
    expect(heureEnTexte(7, 0)).toBe("07:00");
    expect(texteEnHeure("18:45")).toEqual({ hour: 18, minute: 45 });
    expect(texteEnHeure("24:00")).toBeNull();
    expect(texteEnHeure("")).toBeNull();
    expect(minutesEnHeures(450)).toBe("7.5");
    expect(minutesEnHeures(420)).toBe("7");
  });
});
