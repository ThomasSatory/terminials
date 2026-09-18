import { describe, it, expect } from "vitest";
import type { ActivityStats, WorkspaceCount } from "./activityApi";
import { statsSentence } from "./statsSentence";

type Totals = ActivityStats["totals"];

function totals(p: Partial<Totals>): Totals {
  return { commits: 0, prompts: 0, commands: 0, tickets: 0, activeMinutes: 0, ...p };
}

function ws(name: string, events: number): WorkspaceCount {
  return { dir: `/dev/${name}`, name, events, commits: 0 };
}

describe("statsSentence", () => {
  it("phrase complète avec la queue « presque tout sur » (≥ 70 % des événements)", () => {
    const phrase = statsSentence(
      totals({ commits: 4, prompts: 38, commands: 112, tickets: 6, activeMinutes: 400 }),
      [ws("terminials", 29), ws("backend-devstack", 1), ws("webapp", 1)],
    );
    expect(phrase).toBe(
      "4 commits, 38 échanges avec Claude, 112 commandes et 6 h 40 d'activité, presque tout sur terminials.",
    );
  });

  it("singuliers : commit, échange, commande", () => {
    const phrase = statsSentence(
      totals({ commits: 1, prompts: 1, commands: 1 }),
      [ws("terminials", 3)],
    );
    expect(phrase).toBe("1 commit, 1 échange avec Claude et 1 commande, sur terminials.");
  });

  it("les compteurs à zéro sont omis, la durée aussi", () => {
    const phrase = statsSentence(totals({ prompts: 5 }), [ws("a", 3), ws("b", 2)]);
    expect(phrase).toBe("5 échanges avec Claude, sur 2 projets.");
  });

  it("répartition équilibrée sur plusieurs projets : « sur N projets »", () => {
    const phrase = statsSentence(
      totals({ commits: 2, activeMinutes: 30 }),
      [ws("a", 5), ws("b", 5)],
    );
    expect(phrase).toBe("2 commits et 30 min d'activité, sur 2 projets.");
  });

  it("aucun workspace : pas de queue", () => {
    expect(statsSentence(totals({ commits: 2 }), [])).toBe("2 commits.");
  });

  it("tous les compteurs à zéro", () => {
    expect(statsSentence(totals({}), [ws("a", 0)])).toBe("Aucune activité enregistrée.");
  });

  it("les tickets touchés n'entrent pas dans la phrase", () => {
    const phrase = statsSentence(totals({ commits: 1, tickets: 9 }), []);
    expect(phrase).toBe("1 commit.");
  });
});
