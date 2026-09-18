import { describe, it, expect } from "vitest";
import { nextDelayMs, DIRTY_BUDGET, PORTS_BUDGET, type PollBudget } from "./pollSchedule";

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
