import { describe, it, expect } from "vitest";
import { arrondiQuart, cibleDuJour, debutEntree, ecouleAujourdhui, entreesRestantes, ramenerA, SAISIE_PAR_DEFAUT, tempsParUs } from "./tempsSaisie";
import type { ActivityEvent, TicketRef } from "./activityApi";

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

function calcul(events: ActivityEvent[], reunion: TicketRef | null = REUNION, maintenant = PLUS_TARD) {
  return tempsParUs(events, noms, SAISIE_PAR_DEFAUT, reunion, maintenant);
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
  it("US au mesuré, le reste de la journée sur la réunion", () => {
    const t = calcul([
      ev(mardi(9, 0), "/p/app", A),
      ev(mardi(9, 1), "/p/app", A),
      ev(mardi(9, 2), "/p/app", B),
      ev(mardi(9, 15), "/p/app", A),
      ev(mardi(10, 0), "/p/perso", null),
    ]);
    // A : 10 + 15 min mesurées → 30 ; B : 5 min → 15 ; réunion : 450 − 45.
    expect(t.us.map((l) => [l.cle, l.saisie])).toEqual([
      ["ABC-1", 30],
      ["ABC-2", 15],
    ]);
    expect(t.reunion).toMatchObject({ ticket: REUNION, horsUs: [{ projet: "perso", minutes: 15 }], saisie: 405 });
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
    expect(t.us[0].saisie).toBe(15);
    expect(t.reunion.saisie).toBe(120);
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

  it("week-end : pas de cible, seul le mesuré compte", () => {
    const t = calcul([ev(SAMEDI_9H, "/p/app", A), ev(SAMEDI_9H + 900, "/p/perso", null)]);
    expect(t.us[0].saisie).toBe(15);
    expect(t.reunion.saisie).toBe(15);
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

  it("le proposé moins le déjà saisi, rien pour une ligne couverte", () => {
    expect(entreesRestantes(t, {})).toEqual([
      { taskId: "ABC-1", debut: "2026-09-15 09:00", minutes: 15 },
      { taskId: "ABC-9", debut: "2026-09-15 09:00", minutes: 435 },
    ]);
    expect(entreesRestantes(t, { "ABC-1": 15, "ABC-9": 400 })).toEqual([
      { taskId: "ABC-9", debut: "2026-09-15 09:00", minutes: 35 },
    ]);
  });

  it("réunion inconnue : pas d'entrée pour elle", () => {
    const sans = calcul([ev(mardi(9), "/p/app", A)], null);
    expect(entreesRestantes(sans, {}).map((e) => e.taskId)).toEqual(["ABC-1"]);
  });
});
