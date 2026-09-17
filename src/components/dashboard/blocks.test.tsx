import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StatTiles } from "./StatTiles";
import { HourChart } from "./HourChart";
import { WorkspaceBars } from "./WorkspaceBars";
import { Timeline } from "./Timeline";
import type { ActivityEvent, HourCounts, WorkspaceCount } from "../../lib/activityApi";

function zeroHours(): HourCounts[] {
  return Array.from({ length: 24 }, (_, hour) => ({
    hour,
    commit: 0,
    claude_prompt: 0,
    shell_cmd: 0,
    clickup_change: 0,
  }));
}

describe("StatTiles", () => {
  it("affiche les valeurs et libellés, dont la durée formatée", () => {
    const html = renderToStaticMarkup(
      createElement(StatTiles, {
        totals: { commits: 5, prompts: 3, commands: 8, tickets: 2, activeMinutes: 65 },
      }),
    );
    expect(html).toContain("5");
    expect(html).toContain("commits");
    expect(html).toContain("1 h 05");
  });
});

describe("HourChart", () => {
  it("mode heure : une barre par heure visible (plage par défaut = 14)", () => {
    const html = renderToStaticMarkup(
      createElement(HourChart, { data: { kind: "hour", byHour: zeroHours() } }),
    );
    const matches = html.match(/class="bar"/g) ?? [];
    expect(matches.length).toBe(14);
  });

  it("rend un rect vert (#2ecc71) pour un commit à 9h", () => {
    const hours = zeroHours();
    hours[9].commit = 1;
    const html = renderToStaticMarkup(
      createElement(HourChart, { data: { kind: "hour", byHour: hours } }),
    );
    expect(html).toContain('fill="#2ecc71"');
  });
});

describe("WorkspaceBars", () => {
  const rows: WorkspaceCount[] = [
    { dir: "/home/x/dev/a", name: "a", events: 10, commits: 4 },
    { dir: "/home/x/dev/b", name: "b", events: 3, commits: 1 },
  ];

  it("rend une barre par ligne", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceBars, { rows, selected: null, onSelect: () => {} }),
    );
    expect((html.match(/dash-wsbar/g) ?? []).length).toBeGreaterThanOrEqual(2);
    expect(html).toContain(">a<");
    expect(html).toContain(">b<");
  });

  it("marque la ligne sélectionnée avec aria-pressed", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceBars, { rows, selected: "/home/x/dev/a", onSelect: () => {} }),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });
});

describe("Timeline", () => {
  it("rend un lien ClickUp cliquable", () => {
    const events: ActivityEvent[] = [
      {
        id: 1,
        ts: 1758100000,
        kind: "commit",
        workspaceDir: "/home/x/dev/a",
        branch: "main",
        title: "corrige le bug",
        body: null,
        ticketIds: ["86c1abc"],
        // status volontairement absent : le titre (tooltip statut) ne doit alors
        // pas apparaître sur le <a>, pour vérifier que seul href est ajouté.
        tickets: [{ id: "86c1abc", name: "Bug X", status: null, url: "https://app.clickup.com/t/86c1abc" }],
      },
    ];
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        events,
        filterDir: null,
        filterText: "",
        onOpenTicket: vi.fn(),
      }),
    );
    expect(html).toContain('<a href="https://app.clickup.com/t/86c1abc">');
  });
});
