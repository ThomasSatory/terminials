import { describe, it, expect } from "vitest";
import {
  ajouterRecent,
  cheminCourt,
  ecrireRecents,
  espacesDisparus,
  fiche,
  lireRecents,
  parserRecents,
  quandRelatif,
  retirerRecent,
  CLE_RECENTS,
  MAX_RECENTS,
  type EspaceRecent,
  metaRecent,
  estOuvert,
} from "./espacesRecents";

const r = (nom: string, cwd = `/p/${nom}`, ferme = 1000): EspaceRecent => ({ nom, cwd, couleur: "#a99cff", ferme });

describe("espacesDisparus", () => {
  it("rend les espaces absents de la nouvelle liste, dans l'ordre", () => {
    const a = [{ id: "1" }, { id: "2" }, { id: "3" }];
    expect(espacesDisparus(a, [{ id: "2" }])).toEqual([{ id: "1" }, { id: "3" }]);
  });
  it("rien quand la liste ne change pas ou ne fait que grandir", () => {
    const a = [{ id: "1" }];
    expect(espacesDisparus(a, a)).toEqual([]);
    expect(espacesDisparus(a, [{ id: "1" }, { id: "2" }])).toEqual([]);
  });
});

describe("fiche", () => {
  it("retient nom, dossier, couleur d'affichage et instant", () => {
    const f = fiche({ id: "1", cwd: "/p/api", name: "api" }, 42);
    expect(f).toMatchObject({ nom: "api", cwd: "/p/api", ferme: 42 });
    expect(f?.couleur).toMatch(/^#[0-9a-f]{6}$/);
    expect(f).not.toHaveProperty("propre");
  });
  it("garde la couleur propre pour la rétablir à la réouverture", () => {
    expect(fiche({ id: "1", cwd: "/p/api", name: "api", color: "#C0392B" }, 1)?.propre).toBe("#C0392B");
  });
  it("retient le groupe pour l'y ranger à la réouverture, et le relit", () => {
    const f = fiche({ id: "1", cwd: "/p/api", name: "api", groupe: { name: "services", color: "#f78fc6" } }, 1);
    expect(f?.groupe).toEqual({ nom: "services", couleur: "#f78fc6" });
    expect(parserRecents(JSON.parse(JSON.stringify([f])))[0].groupe).toEqual({ nom: "services", couleur: "#f78fc6" });
    expect(fiche({ id: "1", cwd: "/p/api", name: "api", groupe: null }, 1)).not.toHaveProperty("groupe");
  });
  it("ignore un espace sans dossier", () => {
    expect(fiche({ id: "1", cwd: "", name: "x" }, 1)).toBeNull();
  });
});

describe("ajouterRecent", () => {
  it("place la fiche en tête", () => {
    expect(ajouterRecent([r("a")], r("b")).map((x) => x.nom)).toEqual(["b", "a"]);
  });
  it("remplace une fiche du même nom et dossier au lieu de la dupliquer", () => {
    const liste = ajouterRecent([r("a", "/p/a", 1), r("b")], r("a", "/p/a", 9));
    expect(liste.map((x) => x.nom)).toEqual(["a", "b"]);
    expect(liste[0].ferme).toBe(9);
  });
  it("garde deux espaces du même dossier sous des noms différents", () => {
    expect(ajouterRecent([r("a", "/p/x")], r("b", "/p/x"))).toHaveLength(2);
  });
  it("plafonne la liste", () => {
    let l: EspaceRecent[] = [];
    for (let i = 0; i < MAX_RECENTS + 3; i++) l = ajouterRecent(l, r(`e${i}`));
    expect(l).toHaveLength(MAX_RECENTS);
    expect(l[0].nom).toBe(`e${MAX_RECENTS + 2}`);
  });
});

describe("retirerRecent", () => {
  it("retire par nom et dossier", () => {
    expect(retirerRecent([r("a"), r("b")], r("a")).map((x) => x.nom)).toEqual(["b"]);
  });
});

describe("parserRecents / stockage", () => {
  it("écarte les entrées mal formées", () => {
    const liste = parserRecents([r("a"), { nom: "x" }, null, 3, { ...r("b"), ferme: "hier" }, { ...r("c"), cwd: "" }]);
    expect(liste.map((x) => x.nom)).toEqual(["a"]);
  });
  it("tolère un contenu qui n'est pas une liste", () => {
    expect(parserRecents({})).toEqual([]);
    expect(parserRecents(null)).toEqual([]);
  });
  it("aller-retour dans le stockage, sans exception sur un JSON corrompu", () => {
    const mem = new Map<string, string>();
    const st = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
    ecrireRecents(st, [r("a")]);
    expect(lireRecents(st)).toEqual([r("a")]);
    mem.set(CLE_RECENTS, "{pas du json");
    expect(lireRecents(st)).toEqual([]);
  });
  it("un stockage qui lève ou absent n'est jamais fatal", () => {
    const casse = {
      getItem: () => {
        throw new Error("interdit");
      },
      setItem: () => {
        throw new Error("plein");
      },
    };
    expect(lireRecents(casse)).toEqual([]);
    expect(() => ecrireRecents(casse, [r("a")])).not.toThrow();
    expect(lireRecents(undefined)).toEqual([]);
  });
});

describe("quandRelatif", () => {
  const t = Date.UTC(2026, 5, 10, 12);
  it.each([
    [30_000, "à l'instant"],
    [5 * 60_000, "il y a 5 min"],
    [2 * 3_600_000, "il y a 2 h"],
    [30 * 3_600_000, "hier"],
    [3 * 86_400_000, "il y a 3 j"],
  ])("il y a %d ms → %s", (ecart, attendu) => {
    expect(quandRelatif(t - ecart, t)).toBe(attendu);
  });
  it("horloge qui recule", () => {
    expect(quandRelatif(t + 5000, t)).toBe("à l'instant");
  });
  it("au-delà d'un mois, une date courte", () => {
    expect(quandRelatif(t - 60 * 86_400_000, t)).not.toMatch(/il y a/);
  });
});

describe("cheminCourt", () => {
  it("abrège le dossier personnel", () => {
    expect(cheminCourt("/home/ana/dev/x", "/home/ana")).toBe("~/dev/x");
    expect(cheminCourt("/home/ana", "/home/ana/")).toBe("~");
  });
  it("ne touche pas un préfixe qui n'est pas un dossier parent", () => {
    expect(cheminCourt("/home/anabelle/x", "/home/ana")).toBe("/home/anabelle/x");
  });
  it("sans home connu, chemin inchangé", () => {
    expect(cheminCourt("/srv/x")).toBe("/srv/x");
  });
});

describe("branche des espaces récents", () => {
  it("fiche retient la dernière branche connue, rien hors dépôt", () => {
    expect(fiche({ id: "a", cwd: "/d", name: "d", branch: "main" }, 5)?.branche).toBe("main");
    expect(fiche({ id: "a", cwd: "/d", name: "d" }, 5)).not.toHaveProperty("branche");
  });
  it("parserRecents relit la branche et accepte une sauvegarde sans elle", () => {
    const [avec, sans] = parserRecents([
      { nom: "a", cwd: "/a", couleur: "#aabbcc", ferme: 1, branche: "feat/x" },
      { nom: "b", cwd: "/b", couleur: "#aabbcc", ferme: 2, branche: 42 },
    ]);
    expect(avec.branche).toBe("feat/x");
    expect(sans).not.toHaveProperty("branche");
  });
  it("metaRecent : « chemin  ·  branche », « hors dépôt » sans branche (maquette Accueil)", () => {
    expect(metaRecent({ cwd: "/home/ana/dev/x", branche: "main" }, "/home/ana")).toBe("~/dev/x  ·  main");
    expect(metaRecent({ cwd: "/srv/x" })).toBe("/srv/x  ·  hors dépôt");
  });
});

describe("onglets et sessions Claude des espaces récents", () => {
  const SID = "6db82e10-f79a-44eb-a88f-8737db058caf";
  it("fiche retient le nombre d'onglets et les sessions, dans l'ordre des onglets", () => {
    const f = fiche({ id: "a", cwd: "/d", name: "d", tabs: [{}, { claude: { id: SID, cwd: "/d/api" } }] }, 5);
    expect(f?.onglets).toBe(2);
    expect(f?.sessions).toEqual([null, { id: SID, cwd: "/d/api" }]);
  });
  it("sans session ni second onglet, la fiche garde sa forme antérieure", () => {
    const f = fiche({ id: "a", cwd: "/d", name: "d", tabs: [{}] }, 5);
    expect(f).not.toHaveProperty("onglets");
    expect(f).not.toHaveProperty("sessions");
  });
  it("parserRecents revalide chaque session et borne les onglets", () => {
    const base = { nom: "a", cwd: "/a", couleur: "#aabbcc", ferme: 1 };
    const [ok, injecte, enorme] = parserRecents([
      { ...base, onglets: 1, sessions: [{ id: SID, cwd: "/a" }, null] },
      { ...base, nom: "b", sessions: [{ id: "x; rm -rf ~", cwd: "/a" }] },
      { ...base, nom: "c", onglets: 1e9 },
    ]);
    expect(ok.sessions).toEqual([{ id: SID, cwd: "/a" }, null]);
    expect(ok.onglets).toBe(2);
    expect(injecte).not.toHaveProperty("sessions");
    expect(enorme.onglets).toBe(32);
  });
});

describe("estOuvert", () => {
  it("reconnaît un espace ouvert par son nom et son dossier", () => {
    expect(estOuvert(r("api"), [{ name: "api", cwd: "/p/api" }])).toBe(true);
    expect(estOuvert(r("api"), [{ name: "api", cwd: "/autre" }])).toBe(false);
  });
});
