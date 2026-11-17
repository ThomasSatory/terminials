import { describe, it, expect } from "vitest";
import { compareTasks, foldLabel, formatTaskDue, priorityRank } from "./tachesOuvertes";
import type { OpenTask } from "./activityApi";

const t = (p: Partial<OpenTask>): OpenTask => ({ id: "T-1", name: "x", url: "", status: "à faire", ...p }) as OpenTask;

describe("tâches ouvertes", () => {
  it("rang de priorité : anglais et français, inconnue en dernier", () => {
    expect(priorityRank("Urgent")).toBe(0);
    expect(priorityRank("haute")).toBe(1);
    expect(priorityRank("normale")).toBe(2);
    expect(priorityRank("basse")).toBe(3);
    expect(priorityRank("bizarre")).toBe(4);
    expect(priorityRank(null)).toBe(4);
  });

  it("tri : échéance croissante, sans échéance en dernier, puis priorité", () => {
    const liste = [
      t({ id: "a", dueDate: null, priority: "urgent" }),
      t({ id: "b", dueDate: 200, priority: "low" }),
      t({ id: "c", dueDate: 100, priority: "low" }),
      t({ id: "d", dueDate: 200, priority: "high" }),
    ];
    expect([...liste].sort(compareTasks).map((x) => x.id)).toEqual(["c", "d", "b", "a"]);
  });

  it("échéance courte et libellé de dépliage", () => {
    expect(formatTaskDue(Date.UTC(2026, 10, 20, 12) / 1000)).toBe("ven. 20");
    expect(foldLabel(false, 1)).toBe("+ 1 autre");
    expect(foldLabel(false, 12)).toBe("+ 12 autres");
    expect(foldLabel(true, 12)).toBe("Replier");
  });
});
