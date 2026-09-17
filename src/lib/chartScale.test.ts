import { describe, it, expect } from "vitest";
import { visibleHours, niceMax, stackSegments, KIND_COLORS } from "./chartScale";
import type { HourCounts, KindCounts } from "./activityApi";

function zeroHours(): HourCounts[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    commit: 0,
    claude_prompt: 0,
    shell_cmd: 0,
    clickup_change: 0,
  }));
}

describe("visibleHours", () => {
  it("24 heures vides → plage par défaut 7h-20h", () => {
    expect(visibleHours(zeroHours())).toEqual([
      7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
  });

  it("événement à 22h étend la borne haute", () => {
    const hours = zeroHours();
    hours[22].commit = 1;
    expect(visibleHours(hours)).toEqual([
      7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22,
    ]);
  });

  it("événement à 5h étend la borne basse", () => {
    const hours = zeroHours();
    hours[5].shell_cmd = 1;
    expect(visibleHours(hours)).toEqual([
      5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
  });
});

describe("niceMax", () => {
  it("arrondit au multiple de 1/2/5 × 10^n supérieur", () => {
    expect(niceMax([0, 3])).toBe(5);
    expect(niceMax([12])).toBe(20);
  });

  it("tableau vide → minimum 1", () => {
    expect(niceMax([])).toBe(1);
  });
});

describe("stackSegments", () => {
  it("ordre commit, claude, shell, clickup et somme des hauteurs proportionnelle au total", () => {
    const counts: KindCounts = { commit: 1, claude_prompt: 2, shell_cmd: 0, clickup_change: 1 };
    const total = 8;
    const height = 100;
    const segments = stackSegments(counts, total, height);

    // shell_cmd est à 0 : pas de segment pour ce kind.
    expect(segments.map((s) => s.kind)).toEqual(["commit", "claude_prompt", "clickup_change"]);

    const columnTotal = counts.commit + counts.claude_prompt + counts.shell_cmd + counts.clickup_change;
    const sumH = segments.reduce((acc, s) => acc + s.h, 0);
    expect(sumH).toBeCloseTo((columnTotal / total) * height);

    // Empilement du bas vers le haut : y décroît à chaque segment ajouté.
    expect(segments[0].y + segments[0].h).toBeCloseTo(height);
    expect(segments[1].y + segments[1].h).toBeCloseTo(segments[0].y);
    expect(segments[2].y + segments[2].h).toBeCloseTo(segments[1].y);
  });

  it("total nul → aucun segment (évite la division par zéro)", () => {
    const counts: KindCounts = { commit: 0, claude_prompt: 0, shell_cmd: 0, clickup_change: 0 };
    expect(stackSegments(counts, 0, 100)).toEqual([]);
  });

  it("couleurs déclarées pour les 4 kinds", () => {
    expect(KIND_COLORS.commit).toBe("#2ecc71");
    expect(KIND_COLORS.claude_prompt).toBe("#3b82f6");
    expect(KIND_COLORS.shell_cmd).toBe("#8a8a8a");
    expect(KIND_COLORS.clickup_change).toBe("#9b59b6");
  });
});
