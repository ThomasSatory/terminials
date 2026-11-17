import { describe, it, expect } from "vitest";
import { arrondiQuart, cibleDuJour, debutEntree, ecouleAujourdhui, entreesRestantes, etatLigne, ramenerA, SAISIE_PAR_DEFAUT, tempsParUs } from "./tempsSaisie";
import type { ActivityEvent, Reunion, TicketRef } from "./activityApi";

/** Mardi 15 septembre 2026, heure locale. */
function mardi(h: number, m = 0): number {
  return Math.floor(new Date(2026, 8, 15, h, m).getTime() / 1000);
}
const VENDREDI_9H = Math.floor(new Date(2026, 8, 18, 9, 0).getTime() / 1000);
const SAMEDI_9H = Math.floor(new Date(2026, 8, 19, 9, 0).getTime() / 1000);

function ev(ts: number, dir: string | null, us: TicketRef | null, extra: Partial<ActivityEvent> = {}): ActivityEvent {
  return {
    id: ts,
    ts,
    kind: "claude_prompt",
    workspaceDir: dir,
    branch: null,
    title: "p",
    body: null,
    ticketIds: [],
    tickets: [],
    usTicket: us,
    ...extra,
  };
}

const A: TicketRef = { id: "ABC-1", name: "Faire A", status: "en cours", url: "u/a" };
const B: TicketRef = { id: "ABC-2", name: "Faire B", status: "test", url: "u/b" };
const REUNION: TicketRef = { id: "ABC-9", name: "Réunions", status: "en cours", url: "u/r" };
const noms = new Map([
  ["/p/app", "app"],
  ["/p/perso", "perso"],
]);

/** Bien après la plage des tests : aucun jour n'est « aujourd'hui ». */
const PLUS_TARD = Math.floor(new Date(2026, 9, 1).getTime() / 1000);

function calcul(
  events: ActivityEvent[],
  reunion: TicketRef | null = REUNION,
  maintenant = PLUS_TARD,
  reunions: Reunion[] = [],
  ouvertes: TicketRef[] = [],
) {
  return tempsParUs(events, noms, SAISIE_PAR_DEFAUT, reunion, maintenant, reunions, ouvertes);
}

function rdv(id: string, debut: number, fin: number): Reunion {
  return { id, titre: `Réunion ${id}`, debut, fin };
}

describe("arrondiQuart", () => {
  it("au quart d'heure le plus proche, jamais sous 15 min", () => {
    expect(arrondiQuart(0)).toBe(0);
    expect(arrondiQuart(4)).toBe(15);
    expect(arrondiQuart(22)).toBe(15);
    expect(arrondiQuart(23)).toBe(30);
    expect(arrondiQuart(100)).toBe(105);
  });
});

describe("cibleDuJour", () => {
  it("7 h 30 du lundi au jeudi, 7 h le vendredi, rien le week-end", () => {
    expect([1, 4, 5, 6, 0].map((j) => cibleDuJour(j, SAISIE_PAR_DEFAUT))).toEqual([450, 450, 420, 0, 0]);
  });
});

describe("ramenerA", () => {
  it("au prorata, en quarts d'heure, somme exacte", () => {
    const r = ramenerA([300, 300, 60], 450);
    expect(r.reduce((s, m) => s + m, 0)).toBe(450);
    expect(r.every((m) => m % 15 === 0)).toBe(true);
    expect(Math.abs(r[0] - r[1])).toBeLessThanOrEqual(15);
    expect(r[2]).toBeLessThan(r[1]);
  });
});

describe("tempsParUs", () => {
  it("le reste de la journée est lissé sur les US travaillées, au prorata", () => {
    const t = calcul([
      ev(mardi(9, 0), "/p/app", A),
      ev(mardi(9, 1), "/p/app", A),
      ev(mardi(9, 2), "/p/app", B),
      ev(mardi(9, 15), "/p/app", A),
      ev(mardi(10, 0), "/p/perso", null),
    ]);
    // A : 10 + 15 min mesurées → 30 ; B : 5 min → 15 ; 450 lissées 2 pour 1.
    expect(t.us.map((l) => [l.cle, l.saisie])).toEqual([
      ["ABC-1", 300],
      ["ABC-2", 150],
    ]);
    expect(t.reunion).toMatchObject({ ticket: REUNION, saisie: 0 });
    expect(t.horsUs).toEqual([{ projet: "perso", minutes: 15 }]);
    expect(t.total).toBe(450);
  });

  it("comble jusqu'à deux quarts d'heure vides entre deux activités sur la même US", () => {
    const t = calcul([
      ev(mardi(9, 0), "/p/app", A),
      ev(mardi(9, 50), "/p/app", A), // 9h15 et 9h30 vides → comblés : 9h → 10h
      ev(mardi(11, 0), "/p/app", A), // trois quarts vides (10h → 10h45) → pas comblé
    ]);
    expect(Math.round(t.us[0].minutes)).toBe(60 + 15);
  });

  it("aujourd'hui : la cible suit l'heure, par quart d'heure entamé", () => {
    // Début 9 h, il est 11 h 20 : 9 h → 11 h 15 = 2 h 15.
    const t = calcul([ev(mardi(9, 5), "/p/app", A)], REUNION, mardi(11, 20));
    expect(t.total).toBe(135);
    expect(t.us[0].saisie).toBe(135);
    expect(t.reunion.saisie).toBe(0);
  });

  it("aujourd'hui : la pause de midi est retirée, la cible reste plafonnée", () => {
    const events = [ev(mardi(9), "/p/app", A), ev(mardi(11, 50), "/p/app", A), ev(mardi(13, 30), "/p/app", A)];
    // 9 h → 15 h = 24 quarts, pause 12 h → 13 h 30 = 6 quarts → 18 quarts = 4 h 30.
    expect(calcul(events, REUNION, mardi(15, 5)).total).toBe(270);
    expect(calcul(events, REUNION, mardi(20)).total).toBe(450);
  });

  it("le vendredi vise 7 h", () => {
    expect(calcul([ev(VENDREDI_9H, "/p/app", A)]).total).toBe(420);
  });

  it("des US au-delà de la cible sont ramenées à la cible, sans réunion", () => {
    const events: ActivityEvent[] = [];
    for (let q = 0; q < 40; q++) {
      events.push(ev(mardi(8) + q * 900, "/p/app", A), ev(mardi(8) + q * 900 + 1, "/p/app", B));
    }
    const t = calcul(events);
    expect(t.us.map((l) => l.saisie)).toEqual([225, 225]);
    expect(t.reunion.saisie).toBe(0);
    expect(t.total).toBe(450);
  });

  it("week-end : pas de cible, seul le mesuré compte, l'activité sans US sur les US", () => {
    const t = calcul([ev(SAMEDI_9H, "/p/app", A), ev(SAMEDI_9H + 900, "/p/perso", null)]);
    expect(t.us[0].saisie).toBe(30);
    expect(t.reunion.saisie).toBe(0);
    expect(calcul([ev(SAMEDI_9H, "/p/perso", null)]).total).toBe(0);
  });

  it("une semaine : une cible par jour travaillé, les jours sans activité n'ont rien", () => {
    const t = calcul([ev(mardi(9), "/p/app", A), ev(VENDREDI_9H, "/p/app", A)]);
    expect(t.jours).toBe(2);
    expect(t.total).toBe(450 + 420);
  });

  it("travailler sur l'US de réunion elle-même compte pour la réunion", () => {
    const t = calcul([ev(mardi(9), "/p/app", REUNION)]);
    expect(t.us).toEqual([]);
    expect(t.reunion.saisie).toBe(450);
  });

  it("sessions et changements ClickUp ignorés ; à défaut d'US de branche, le premier ticket cité", () => {
    const t = calcul([
      ev(mardi(9), "/p/app", A, { kind: "claude_session" }),
      ev(mardi(9), null, null, { kind: "clickup_change" }),
      ev(mardi(10), "/p/app", null, { tickets: [B] }),
    ]);
    expect(t.us.map((l) => l.cle)).toEqual(["ABC-2"]);
  });

  it("réunion inconnue : le temps reste affiché, sans US", () => {
    const t = calcul([ev(mardi(9), "/p/perso", null)], null);
    expect(t.reunion.ticket).toBeNull();
    expect(t.reunion.saisie).toBe(450);
  });

  it("les réunions relevées vont sur la réunion, à leur heure ; le reste sur les US", () => {
    // Réunion 14 h 10 → 16 h 04 : 14 h 15, 1 h 54 arrondie à 2 h.
    const t = calcul([ev(mardi(9), "/p/app", A), ev(mardi(9, 20), "/p/app", A)], REUNION, PLUS_TARD, [rdv("d1", mardi(14, 10), mardi(16, 4))]);
    expect(t.reunion.saisie).toBe(120);
    expect(t.reunion.reunions).toEqual([{ titre: "Réunion d1", debut: mardi(14, 15), fin: mardi(16, 15) }]);
    expect(t.us[0].saisie).toBe(330);
    // A de 9 h, pause 12 h → 13 h 30 (trou de 9 h 30 à 14 h 15 ramené à 1 h 30), réunion sautée.
    expect(t.entrees).toEqual([
      { taskId: "ABC-1", debut: "2026-09-15 09:00", minutes: 180 },
      { taskId: "ABC-1", debut: "2026-09-15 13:30", minutes: 45 },
      { taskId: "ABC-9", debut: "2026-09-15 14:15", minutes: 120 },
      { taskId: "ABC-1", debut: "2026-09-15 16:15", minutes: 105 },
    ]);
  });

  it("l'activité pendant une réunion ne compte pour aucune US", () => {
    const t = calcul(
      [ev(mardi(9), "/p/app", A), ev(mardi(10, 5), "/p/app", B)],
      REUNION,
      PLUS_TARD,
      [rdv("d1", mardi(10), mardi(11))],
    );
    expect(t.us.map((l) => l.cle)).toEqual(["ABC-1"]);
    expect(t.us[0].saisie).toBe(390);
  });

  it("une réunion à venir ou en cours n'est pas comptée", () => {
    const t = calcul([ev(mardi(9), "/p/app", A)], REUNION, mardi(10, 30), [rdv("d1", mardi(10), mardi(11))]);
    expect(t.reunion.saisie).toBe(0);
  });

  it("aujourd'hui : une réunion avant la première activité ouvre la journée", () => {
    const t = calcul([ev(mardi(10, 5), "/p/app", A)], REUNION, mardi(11, 5), [rdv("d1", mardi(9), mardi(9, 30))]);
    // 9 h → 11 h = 2 h : 30 min de réunion, 1 h 30 sur A.
    expect(t.total).toBe(120);
    expect(t.reunion.saisie).toBe(30);
    expect(t.us[0].saisie).toBe(90);
  });

  it("une journée de réunions sans activité compte", () => {
    const t = calcul([], REUNION, PLUS_TARD, [rdv("d1", mardi(9), mardi(10))], [A]);
    expect(t.jours).toBe(1);
    expect(t.reunion.saisie).toBe(60);
    expect(t.us).toMatchObject([{ cle: "ABC-1", saisie: 390, projets: [] }]);
  });

  it("sans US travaillée, le reste va au « Reste à faire » (réunion exclue), à parts égales", () => {
    const t = calcul([ev(mardi(9), "/p/perso", null)], REUNION, PLUS_TARD, [], [A, REUNION, B]);
    expect(t.us.map((l) => [l.cle, l.saisie])).toEqual([
      ["ABC-1", 225],
      ["ABC-2", 225],
    ]);
    expect(t.reunion.saisie).toBe(0);
  });

  it("aucune activité : rien à saisir", () => {
    expect(calcul([])).toMatchObject({ us: [], total: 0, jours: 0 });
  });
});

describe("ecouleAujourdhui", () => {
  it("rien avant la première activité, pas de pause sous 30 min", () => {
    const q = (h: number, m = 0) => Math.floor(mardi(h, m) / 900);
    expect(ecouleAujourdhui(new Map(), mardi(10))).toBe(0);
    const quarts = new Map([q(12), q(12, 30)].map((x) => [x, null]));
    // 12 h → 13 h = 4 quarts, trou de 12 h 15 (1 quart) : pas une pause.
    expect(ecouleAujourdhui(quarts, mardi(13, 0))).toBe(60);
  });
});

describe("entrées à saisir dans ClickUp", () => {
  const t = calcul([ev(mardi(9, 5), "/p/app", A), ev(mardi(10, 20), "/p/perso", null)]);

  it("début au quart d'heure de la première activité, heure locale", () => {
    expect(debutEntree(mardi(9, 5))).toBe("2026-09-15 09:00");
  });

  it("le proposé moins le déjà saisi, repris là où la saisie s'est arrêtée", () => {
    expect(entreesRestantes(t, {})).toEqual([{ taskId: "ABC-1", debut: "2026-09-15 09:00", minutes: 450 }]);
    expect(entreesRestantes(t, { "ABC-1": 400 })).toEqual([{ taskId: "ABC-1", debut: "2026-09-15 15:40", minutes: 50 }]);
    expect(entreesRestantes(t, { "ABC-1": 450 })).toEqual([]);
  });

  it("par tâche, plusieurs entrées : une par réunion", () => {
    const r = calcul([ev(mardi(9), "/p/app", A)], REUNION, PLUS_TARD, [rdv("d1", mardi(10), mardi(10, 30)), rdv("d2", mardi(15), mardi(15, 15))]);
    expect(entreesRestantes(r, { "ABC-9": 30 }, "ABC-9")).toEqual([{ taskId: "ABC-9", debut: "2026-09-15 15:00", minutes: 15 }]);
  });

  it("réunion inconnue : pas d'entrée pour elle", () => {
    const sans = calcul([ev(mardi(9), "/p/app", A)], null);
    expect(entreesRestantes(sans, {}).map((e) => e.taskId)).toEqual(["ABC-1"]);
  });
});

describe("etatLigne", () => {
  it("à saisir, partiel, saisi, en cours (prioritaire)", () => {
    expect(etatLigne(45, 0, false)).toBe("a-saisir");
    expect(etatLigne(45, 15, false)).toBe("partiel");
    expect(etatLigne(45, 45, false)).toBe("saisi");
    expect(etatLigne(45, 60, false)).toBe("saisi");
    expect(etatLigne(45, 0, true)).toBe("en-cours");
  });
});
