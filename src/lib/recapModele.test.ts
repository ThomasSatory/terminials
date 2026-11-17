import { describe, it, expect } from "vitest";
import type { ActivityEvent } from "./activityApi";
import { buildFrise } from "./frise";
import {
  ariaColonne,
  pct,
  activite,
  chronologie,
  colonnesRythme,
  derniereBranche,
  drapeauSection,
  ECART_COMMITS,
  grouperCommits,
  RETRAIT_MAINTENANT,
  duree,
  etiquettePuce,
  heure,
  joursSelecteur,
  jourVoisin,
  libelleBilan,
  libelleRedaction,
  lignesSaisies,
  numeroSemaine,
  phraseHoraire,
  pucesDe,
  reperes,
  sousTitreCreneau,
  texteDaily,
} from "./recapModele";

const A = "/home/x/dev/a";
const B = "/home/x/dev/b";
const at = (d: number, h: number, m = 0) => Math.floor(new Date(2026, 10, d, h, m).getTime() / 1000);
const ev = (ts: number, kind: ActivityEvent["kind"], dir: string | null = A, title = "x", branch: string | null = "main"): ActivityEvent => ({
  id: ts,
  ts,
  kind,
  workspaceDir: dir,
  branch,
  title,
  ticketIds: [],
  tickets: [],
});

describe("formats", () => {
  it("duree : la notation des maquettes", () => {
    expect(duree(45)).toBe("45 min");
    expect(duree(60)).toBe("1 h");
    expect(duree(125)).toBe("2 h 05");
    expect(duree(0)).toBe("0 min");
  });
  it("heure", () => {
    expect(heure(at(16, 9, 5))).toBe("9h05");
  });
  it("numéro de semaine ISO", () => {
    expect(numeroSemaine("2026-11-16")).toBe(47);
    expect(numeroSemaine("2026-01-01")).toBe(1);
  });
  it("libellés", () => {
    expect(lignesSaisies(0, 5)).toBe("0 ligne saisie sur 5");
    expect(lignesSaisies(2, 5)).toBe("2 lignes saisies sur 5");
    expect(sousTitreCreneau(2)).toBe("2 espaces en parallèle");
    expect(sousTitreCreneau(1)).toBe("un espace actif");
    expect(sousTitreCreneau(0)).toBe("aucune activité");
    expect(phraseHoraire({ hour: 7, minute: 0, weekdaysOnly: true })).toBe("Il se rédige seul à 7 h du lundi au vendredi.");
    expect(phraseHoraire({ hour: 6, minute: 5, weekdaysOnly: false })).toBe("Il se rédige seul à 6 h 05 chaque jour.");
  });
  it("rédaction du bilan : l'heure, et le jour s'il diffère", () => {
    expect(libelleRedaction(at(16, 18, 4), "2026-11-16")).toBe("Bilan rédigé à 18h04");
    expect(libelleRedaction(at(17, 7, 2), "2026-11-16")).toBe("Bilan rédigé le mar. 17 à 7h02");
  });
  it("bilan réécrit ici : « à l’instant » tant que c'est vrai, puis l'heure", () => {
    const s = { generatedAt: at(16, 18, 4), day: "2026-11-16" };
    expect(libelleBilan(s, true, s.generatedAt + 30)).toBe("Bilan réécrit à l’instant");
    expect(libelleBilan(s, true, s.generatedAt + 600)).toBe("Bilan rédigé à 18h04");
    expect(libelleBilan(s, false, s.generatedAt + 30)).toBe("Bilan rédigé à 18h04");
  });
});

describe("activite", () => {
  it("un quart d'heure compte une fois, par espace aussi ; les sessions ne comptent pas", () => {
    const events = [
      ev(at(16, 9, 1), "shell_cmd"),
      ev(at(16, 9, 2), "claude_prompt"),
      ev(at(16, 9, 3), "shell_cmd", B),
      ev(at(16, 10, 0), "claude_session"),
      ev(at(16, 11, 20), "commit"),
    ];
    const a = activite(events, at(16, 0), at(17, 0));
    expect(a.minutes).toBe(30);
    expect(a.premier).toBe(at(16, 9));
    expect(a.dernier).toBe(at(16, 11, 30));
    expect([...a.parDir]).toEqual([
      [A, 30],
      [B, 15],
    ]);
  });
});

describe("sélecteur de jours", () => {
  it("la semaine ouvrée, le futur marqué, la barre par espace", () => {
    const jours = joursSelecteur("2026-11-16", "2026-11-17", [ev(at(16, 9), "commit")], () => "#a99cff");
    expect(jours.map((j) => j.label)).toEqual(["lun. 16", "mar. 17", "mer. 18", "jeu. 19", "ven. 20"]);
    expect(jours[0].minutes).toBe(15);
    expect(jours[0].barre).toEqual([{ dir: A, couleur: "#a99cff", minutes: 15 }]);
    expect(jours[1].aujourdhui).toBe(true);
    expect(jours[2].future).toBe(true);
  });

  it("un jour de week-end affiché rejoint la liste", () => {
    const jours = joursSelecteur("2026-11-21", "2026-11-21", [], () => "#000000");
    expect(jours.map((j) => j.day)).toContain("2026-11-21");
  });

  it("jour voisin : week-end sauté, jamais au-delà d'aujourd'hui", () => {
    expect(jourVoisin("2026-11-16", -1, "2026-11-18")).toBe("2026-11-13");
    expect(jourVoisin("2026-11-13", 1, "2026-11-18")).toBe("2026-11-16");
    expect(jourVoisin("2026-11-18", 1, "2026-11-18")).toBeNull();
  });
});

describe("colonnes du rythme", () => {
  const events = [
    ev(at(16, 9, 1), "shell_cmd"),
    ev(at(16, 9, 2), "shell_cmd"),
    ev(at(16, 9, 3), "claude_prompt", B, "corrige les retours de revue de l'indicateur"),
    ev(at(16, 9, 40), "commit", A, "fix: x"),
  ];
  const ws = [
    { dir: A, name: "a", events: 3, commits: 1 },
    { dir: B, name: "b", events: 1, commits: 0 },
  ];
  const frise = buildFrise("day", "2026-11-16", events, ws, new Map([[A, "#111111"], [B, "#222222"]]));
  const reunion = { id: "r", titre: "Point", debut: at(16, 9, 30), fin: at(16, 9, 45) };
  const cols = colonnesRythme(frise, [reunion], at(16, 9, 50));

  it("une colonne par quart d'heure, vides comprises, futur marqué", () => {
    expect(cols.length).toBe((frise.end - frise.start) / 900);
    const neuf = cols.find((c) => c.t0 === at(16, 9))!;
    expect(neuf.future).toBe(false);
    expect(cols.find((c) => c.t0 === at(16, 10))!.future).toBe(true);
  });

  it("pile empilée au prorata, hauteur relative à la pile la plus haute", () => {
    const neuf = cols.find((c) => c.t0 === at(16, 9))!;
    expect(neuf.segments.map((s) => s.name)).toEqual(["a", "b"]);
    expect(neuf.segments.map((s) => s.minutes)).toEqual([10, 5]);
    expect(neuf.segments[0].part + neuf.segments[1].part).toBeCloseTo(1);
    expect(neuf.segments[0].detail).toBe("2 commandes");
    expect(neuf.segments[1].prompt).toBe("corrige les retours de revue de l'indicateur");
  });

  it("réunion et commit rattachés à leur créneau", () => {
    const demi = cols.find((c) => c.t0 === at(16, 9, 30))!;
    expect(demi.reunions.map((r) => r.titre)).toEqual(["Point"]);
    expect(demi.commits.map((c) => c.titre)).toEqual(["fix: x"]);
  });

  it("repères : chaque heure pleine, bornes collées aux bords", () => {
    const r = reperes(frise, "day");
    expect(r[0]).toMatchObject({ left: 0, label: "7h", ancre: "debut" });
    expect(r[r.length - 1]).toMatchObject({ left: 1, label: "20h", ancre: "fin" });
  });
});

describe("bilan", () => {
  it("étiquettes lues dans la phrase", () => {
    expect(etiquettePuce("Migration bloquée en recette.")).toBe("bloqué");
    expect(etiquettePuce("La migration attend une autorisation.")).toBe("en attente");
    expect(etiquettePuce("Reste à brancher l'anneau.")).toBe("en cours");
    expect(etiquettePuce("Un agent tourne encore sur les derniers tests de la barre latérale.")).toBe("en cours");
    expect(etiquettePuce("Rejeu validé.")).toBeNull();
  });

  it("puces : items et paragraphes, liens réduits à leur libellé", () => {
    const puces = pucesDe("## a\n- Rejeu validé [ABC-1](https://x/1).\n- **Tests** écrits.\n\nUne note.");
    expect(puces.map((p) => p.texte)).toEqual(["Rejeu validé ABC-1.", "Tests écrits.", "Une note."]);
  });

  it("drapeau : bloqué d'abord, puis en attente", () => {
    expect(drapeauSection(pucesDe("- Attend un retour.\n- Bloqué par les droits."))).toBe("bloqué");
    expect(drapeauSection(pucesDe("- Fait."))).toBeNull();
  });

  it("texte du daily : en-tête, projets et puces, étiquettes entre crochets", () => {
    const lignes = texteDaily("Lundi 16 novembre : Rejeu validé", [
      { name: "api", puces: pucesDe("- Rejeu validé [ABC-1](https://x).\n- Migration bloquée.") },
      { name: "vide", puces: [] },
      { name: "notes", puces: pucesDe("- Notes rangées.") },
    ]);
    expect(lignes).toEqual([
      "Lundi 16 novembre : Rejeu validé",
      "",
      "api",
      "- Rejeu validé ABC-1.",
      "- Migration bloquée. [bloqué]",
      "",
      "notes",
      "- Notes rangées.",
    ]);
  });

  it("dernière branche vue sur un dossier", () => {
    const events = [ev(at(16, 9), "commit", A, "x", "main"), ev(at(16, 10), "commit", A, "x", "feat/y"), ev(at(16, 11), "shell_cmd", A, "x", null)];
    expect(derniereBranche(events, A)).toBe("feat/y");
    expect(derniereBranche(events, B)).toBeNull();
  });
});

describe("chronologie", () => {
  const events = [
    ev(at(16, 9, 5), "commit", A, "fix: x"),
    ev(at(16, 9, 6), "shell_cmd", A, "npm test"),
    ev(at(16, 9, 7), "shell_cmd", A, "npm test"),
    ev(at(16, 9, 8), "claude_prompt", A, "ok"),
    ev(at(16, 10, 1), "claude_prompt", B, "ajoute la file de rejeu des webhooks"),
    ev(at(16, 10, 2), "claude_session", B, "session"),
  ];
  const reunions = [{ id: "r", titre: "Point", debut: at(16, 9, 30), fin: at(16, 9, 45) }];
  const nom = (d: string) => (d === A ? "a" : "b");

  it("groupée par heure, répétitions fusionnées, bruit et sessions écartés, réunions incluses", () => {
    const h = chronologie(events, reunions, nom, "");
    expect(h.map((g) => g.heure)).toEqual(["9h", "10h"]);
    expect(h[0].items.map((i) => [i.genre, i.texte, i.fois])).toEqual([
      ["commit", "fix: x", 1],
      ["shell", "npm test", 2],
      ["reunion", "Réunion : Point (15 min)", 1],
    ]);
    expect(h[1].items[0]).toMatchObject({ genre: "prompt", texte: "« ajoute la file de rejeu des webhooks »", nom: "b" });
  });

  it("filtre sur le texte et le nom de l'espace", () => {
    expect(chronologie(events, reunions, nom, "rejeu").flatMap((g) => g.items).length).toBe(1);
    expect(chronologie(events, reunions, nom, "B").flatMap((g) => g.items).length).toBe(1);
  });
});

describe("frise : rendu", () => {
  it("pourcentage CSS à trois décimales", () => {
    expect(pct(0.125)).toBe("12.500%");
    expect(pct(1)).toBe("100.000%");
  });

  it("aria d'une colonne : à venir, vide, ou les espaces actifs", () => {
    const t0 = new Date(2026, 10, 16, 9, 0).getTime() / 1000;
    const base = { t0, t1: t0 + 900, future: false, segments: [] as { name: string }[] };
    expect(ariaColonne({ ...base, future: true } as never)).toBe("9h00 à 9h15 : à venir");
    expect(ariaColonne(base as never)).toBe("9h00 à 9h15 : aucune activité");
    expect(ariaColonne({ ...base, segments: [{ name: "app" }, { name: "api" }] } as never)).toBe("9h00 à 9h15 : app, api");
  });
});

describe("cercles de commit", () => {
  const c = (ts: number, titre = "t") => ({ ts, dir: A, name: "a", couleur: "#a99cff", titre });
  // Frise de 0 à 1000 s sur 1000 px : 1 s = 1 px.
  const pos = (ts: number) => Math.min(1, Math.max(0, ts / 1000));

  it("largeur inconnue : un cercle par commit, à sa position", () => {
    const g = grouperCommits([c(20), c(10)], pos, 0, null);
    expect(g.map((x) => x.x)).toEqual([0.01, 0.02]);
  });

  it("commits trop proches regroupés : jamais deux cercles à moins de l'écart minimal", () => {
    const g = grouperCommits([c(100), c(105), c(109), c(300), c(310), c(320)], pos, 1000, null);
    expect(g.map((x) => x.commits.length)).toEqual([3, 2, 1]);
    expect(g.map((x) => x.x * 1000)).toEqual([100, 300, 320]);
    for (let i = 1; i < g.length; i++) expect((g[i].x - g[i - 1].x) * 1000).toBeGreaterThanOrEqual(ECART_COMMITS);
  });

  it("aucun cercle ne touche le trait « maintenant »", () => {
    const g = grouperCommits([c(400), c(495), c(500)], pos, 1000, 500);
    for (const x of g) expect(500 - x.x * 1000).toBeGreaterThanOrEqual(RETRAIT_MAINTENANT);
    // 495 et 500, ramenés avant le trait, rejoignent un seul cercle.
    expect(g.map((x) => x.commits.length)).toEqual([1, 2]);
  });
});
