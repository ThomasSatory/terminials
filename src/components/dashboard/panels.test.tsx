import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenTasks } from "./OpenTasks";
import { champsLlmDetailles } from "./SettingsPanel";
import { summaryFooter, scheduleSentence } from "./SummaryPanel";
import { clickupActif, type OpenTask, type Summary } from "../../lib/activityApi";

describe("clickupActif", () => {
  it("le MCP est actif sans jeton, la clé API exige un jeton, « off » n'est jamais actif", () => {
    expect(clickupActif({ source: "claude_mcp", token: "" })).toBe(true);
    expect(clickupActif({ source: "api", token: "" })).toBe(false);
    expect(clickupActif({ source: "api", token: "pk_1" })).toBe(true);
    expect(clickupActif({ source: "off", token: "pk_1" })).toBe(false);
  });
});

describe("champsLlmDetailles", () => {
  it("cachés pour claude -p, montrés pour les API configurables", () => {
    expect(champsLlmDetailles("claude_cli")).toBe(false);
    expect(champsLlmDetailles("openai")).toBe(true);
    expect(champsLlmDetailles("ollama")).toBe(true);
  });
});

describe("OpenTasks", () => {
  it("ClickUp inactif affiche l'invite à l'activer dans les réglages", () => {
    const html = renderToStaticMarkup(<OpenTasks tasks={[]} active={false} onOpen={() => {}} />);
    expect(html).toContain("Activer ClickUp dans les réglages");
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
      <OpenTasks tasks={tasks} active={true} onOpen={() => {}} />,
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
