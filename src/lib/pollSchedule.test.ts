import { describe, it, expect } from "vitest";
import { echeanceAnticipee, nextDelayMs, DIRTY_BUDGET, PORTS_BUDGET, type PollBudget } from "./pollSchedule";

const BUDGET: PollBudget = { dutyCycle: 0.05, minDelayMs: 2000, maxDelayMs: 120_000 };

describe("nextDelayMs", () => {
  it("garde le délai plancher quand la sonde est instantanée", () => {
    // Repo minuscule : `git status` en 5 ms. 5/0.05 = 100 ms → plancher.
    expect(nextDelayMs(5, BUDGET)).toBe(2000);
  });

  it("écarte le délai proportionnellement au coût mesuré", () => {
    // 500 ms de sonde à 5 % de budget → une sonde toutes les 10 s.
    expect(nextDelayMs(500, BUDGET)).toBe(10_000);
  });

  it("plafonne le délai sur un repo monstrueux", () => {
    // Cas mesuré sur ~/dev/monorepo : 6,14 s par `git status --porcelain`.
    // 6140/0.05 = 122 800 ms, au-delà du plafond → plafond.
    expect(nextDelayMs(6140, BUDGET)).toBe(120_000);
  });

  it("ne descend jamais sous le plancher et ne dépasse jamais le plafond", () => {
    for (const d of [-1, 0, 1, 42, 1e9, Number.POSITIVE_INFINITY, Number.NaN]) {
      const delay = nextDelayMs(d, BUDGET);
      expect(delay).toBeGreaterThanOrEqual(BUDGET.minDelayMs);
      expect(delay).toBeLessThanOrEqual(BUDGET.maxDelayMs);
    }
  });

  it("traite une durée absurde (NaN, négative) comme le plancher", () => {
    expect(nextDelayMs(Number.NaN, BUDGET)).toBe(2000);
    expect(nextDelayMs(-500, BUDGET)).toBe(2000);
  });

  it("borne le coût CPU du poller au duty cycle demandé", () => {
    // Invariant central : durée/délai <= dutyCycle, sauf quand le plafond
    // s'applique (repo si lent qu'on accepte de dépasser pour garder un
    // rafraîchissement minimal).
    for (const d of [10, 100, 1000, 5000]) {
      const delay = nextDelayMs(d, BUDGET);
      if (delay < BUDGET.maxDelayMs) expect(d / delay).toBeLessThanOrEqual(BUDGET.dutyCycle);
    }
  });
});

describe("budgets par défaut", () => {
  it("laisse le dirty git respirer : 5 % de duty cycle, plafond 2 min", () => {
    // Le `git status --porcelain` d'backend coûte 6,14 s wall et ~19 s-CPU dans
    // le hook fanotify de l'antivirus : il ne doit JAMAIS tourner en boucle.
    expect(DIRTY_BUDGET.dutyCycle).toBeLessThanOrEqual(0.05);
    expect(DIRTY_BUDGET.minDelayMs).toBeGreaterThanOrEqual(2000);
    expect(nextDelayMs(6140, DIRTY_BUDGET)).toBeGreaterThanOrEqual(60_000);
  });

  it("garde les ports réactifs : la sonde /proc est bien moins chère", () => {
    expect(nextDelayMs(20, PORTS_BUDGET)).toBeLessThanOrEqual(5000);
  });
});

describe("echeanceAnticipee", () => {
  const B: PollBudget = { dutyCycle: 0.05, minDelayMs: 2000, maxDelayMs: 120_000 };

  it("dépôt léger : recompté dès le plancher passé après la dernière sonde", () => {
    // Dernière sonde de 10 ms finie à t=1000 : plancher 2 s → t=3000 au plus tôt.
    expect(echeanceAnticipee(60_000, 1500, B, { fin: 1000, duree: 10 })).toBe(3000);
    // Plancher déjà passé : tout de suite.
    expect(echeanceAnticipee(60_000, 5000, B, { fin: 1000, duree: 10 })).toBe(5000);
  });

  it("dépôt géant : l'espacement reste proportionnel au coût (budget ×4)", () => {
    // 6 s de sonde : 6000 / (0.05 × 4) = 30 s après sa fin, pas avant.
    expect(echeanceAnticipee(120_000, 7000, B, { fin: 6000, duree: 6000 })).toBe(36_000);
  });

  it("jamais plus tard que l'échéance prévue, tout de suite sans sonde connue", () => {
    expect(echeanceAnticipee(2500, 1500, B, { fin: 1000, duree: 6000 })).toBe(2500);
    expect(echeanceAnticipee(90_000, 1500, B)).toBe(1500);
  });
});
