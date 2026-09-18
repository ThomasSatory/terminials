import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceChips } from "./WorkspaceChips";
import { Timeline } from "./Timeline";
import type { ActivityEvent, WorkspaceCount } from "../../lib/activityApi";

describe("WorkspaceChips", () => {
  const rows: WorkspaceCount[] = [
    { dir: "/home/x/dev/a", name: "a", events: 10, commits: 4 },
    { dir: "/home/x/dev/b", name: "b", events: 3, commits: 1 },
  ];

  it("un chip par workspace, avec sa teinte et son compteur", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceChips, { rows, selected: null, onSelect: () => {} }),
    );
    expect((html.match(/dash-chip"/g) ?? []).length).toBe(2);
    expect(html).toContain(">a<");
    expect(html).toContain(">b<");
    // Le plus actif prend le laiton, le suivant la teinte 2 de la palette.
    expect(html).toContain("background:#c9a36a");
    expect(html).toContain("background:#9bb08a");
    expect(html).toContain("cliquer pour filtrer");
  });

  it("marque le chip sélectionné avec aria-pressed", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceChips, { rows, selected: "/home/x/dev/a", onSelect: () => {} }),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
  });

  it("sans workspace, aucune rangée n'est rendue", () => {
    const html = renderToStaticMarkup(
      createElement(WorkspaceChips, { rows: [], selected: null, onSelect: () => {} }),
    );
    expect(html).toBe("");
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
