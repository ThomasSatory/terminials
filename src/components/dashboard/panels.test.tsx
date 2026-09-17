import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenTasks } from "./OpenTasks";
import { summaryFooter } from "./SummaryPanel";
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

describe("summaryFooter", () => {
  it("formate « généré à HH:MM par <model> »", () => {
    const summary: Summary = {
      text: "…",
      model: "openai:google/gemma-4-31B-it",
      generatedAt: Math.floor(new Date(2026, 8, 17, 7, 2, 0).getTime() / 1000),
      cached: true,
    };
    expect(summaryFooter(summary)).toBe("généré à 07:02 par openai:google/gemma-4-31B-it");
  });
});
