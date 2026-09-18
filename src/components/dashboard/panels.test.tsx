import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenTasks } from "./OpenTasks";
import { summaryFooter, scheduleSentence } from "./SummaryPanel";
import type { OpenTask, Summary } from "../../lib/activityApi";

describe("OpenTasks", () => {
  it("sans token affiche l'invite à ajouter un token ClickUp", () => {
    const html = renderToStaticMarkup(<OpenTasks tasks={[]} hasToken={false} onOpen={() => {}} />);
    expect(html).toContain("Ajouter un token ClickUp");
  });

  it("avec 2 tâches : triées par échéance (sans échéance en dernier) et affiche le statut", () => {
    const tasks: OpenTask[] = [
      { id: "1", name: "Tâche sans échéance", status: "à faire", url: "https://x/1" },
      {
        id: "2",
        name: "Tâche avec échéance",
        status: "en cours",
        url: "https://x/2",
        dueDate: 1_700_000_000,
      },
    ];
    const html = renderToStaticMarkup(
      <OpenTasks tasks={tasks} hasToken={true} onOpen={() => {}} />,
    );

    const liCount = (html.match(/<li/g) ?? []).length;
    expect(liCount).toBe(2);

    const idxWithDue = html.indexOf("Tâche avec échéance");
    const idxWithoutDue = html.indexOf("Tâche sans échéance");
    expect(idxWithDue).toBeGreaterThanOrEqual(0);
    expect(idxWithoutDue).toBeGreaterThan(idxWithDue);

    expect(html).toContain("en cours");
    expect(html).toContain("à faire");
  });
});

describe("scheduleSentence", () => {
  it("heure ronde, jours ouvrés", () => {
    expect(scheduleSentence({ hour: 7, minute: 0, weekdaysOnly: true })).toBe(
      "La synthèse se génère seule à 7 h du lundi au vendredi.",
    );
  });
  it("heure avec minutes, tous les jours", () => {
    expect(scheduleSentence({ hour: 6, minute: 30, weekdaysOnly: false })).toBe(
      "La synthèse se génère seule à 6 h 30 chaque jour.",
    );
  });
});

describe("summaryFooter", () => {
  it("formate « Synthèse générée à HH:MM par <model> »", () => {
    const summary: Summary = {
      day: "2026-09-17",
      text: "…",
      model: "openai:google/gemma-4-31B-it",
      generatedAt: Math.floor(new Date(2026, 8, 17, 7, 2, 0).getTime() / 1000),
      cached: true,
    };
    expect(summaryFooter(summary)).toBe(
      "Synthèse générée à 07:02 par openai:google/gemma-4-31B-it",
    );
  });
});
