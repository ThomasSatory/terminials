import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkspaceChips } from "./WorkspaceChips";
import { Timeline } from "./Timeline";
import { WeekDays } from "./WeekDays";
import type { ActivityEvent, WorkspaceCount } from "../../lib/activityApi";
import { assignWorkspaceColors } from "../../lib/workspacePalette";
import type { WeekDayRow } from "../../lib/weekDays";

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
  const colors = assignWorkspaceColors([
    { dir: "/home/x/dev/a", name: "a", events: 10, commits: 4 },
  ]);

  function commit(ts: number, title: string, extra: Partial<ActivityEvent> = {}): ActivityEvent {
    return {
      id: ts,
      ts,
      kind: "commit",
      workspaceDir: "/home/x/dev/a",
      branch: "main",
      title,
      body: null,
      ticketIds: [],
      tickets: [],
      ...extra,
    };
  }

  const NEUF_HEURES = Math.floor(new Date(2025, 8, 17, 9, 30).getTime() / 1000);

  it("rend un lien ClickUp cliquable", () => {
    const events: ActivityEvent[] = [
      commit(NEUF_HEURES, "corrige le bug", {
        ticketIds: ["86c1abc"],
        // status volontairement absent : le titre (tooltip statut) ne doit alors
        // pas apparaître sur le <a>, pour vérifier que seul href est ajouté.
        tickets: [
          { id: "86c1abc", name: "Bug X", status: null, url: "https://app.clickup.com/t/86c1abc" },
        ],
      }),
    ];
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        events,
        filterDir: null,
        filterText: "",
        colors,
        onOpenTicket: vi.fn(),
      }),
    );
    expect(html).toContain('<a href="https://app.clickup.com/t/86c1abc">');
  });

  it("une heure par groupe, avec le glyphe teinté du workspace", () => {
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        events: [commit(NEUF_HEURES, "store SQLite")],
        filterDir: null,
        filterText: "",
        colors,
        onOpenTicket: vi.fn(),
      }),
    );
    expect(html).toContain(">9h<");
    expect(html).toContain("dash-glyph-commit");
    expect(html).toContain("color:#c9a36a");
    expect(html).toContain("store SQLite");
  });

  it("aucun événement retenu : message vide en serif italique", () => {
    const html = renderToStaticMarkup(
      createElement(Timeline, {
        events: [commit(NEUF_HEURES, "store SQLite")],
        filterDir: null,
        filterText: "introuvable",
        colors,
        onOpenTicket: vi.fn(),
      }),
    );
    expect(html).toContain("dash-tl-empty");
    expect(html).toContain("Aucune activité ce jour");
  });
});

describe("WeekDays", () => {
  const rows: WeekDayRow[] = [
    {
      day: "2025-09-15",
      label: "lun. 15",
      fait: "réordonnancement des workspaces",
      future: false,
      compteurs: "5 commits, 31 échanges",
      segments: [
        { dir: "/dev/a", color: "#c9a36a", events: 9 },
        { dir: "/dev/b", color: "#9bb08a", events: 1 },
      ],
    },
    {
      day: "2025-09-19",
      label: "ven. 19",
      fait: "",
      future: true,
      compteurs: "",
      segments: [],
    },
  ];

  it("rend le fait marquant, les compteurs et un segment par workspace", () => {
    const html = renderToStaticMarkup(
      createElement(WeekDays, { rows, selectedDay: "2025-09-15", onSelect: () => {} }),
    );
    expect(html).toContain("lun. 15");
    expect(html).toContain("réordonnancement des workspaces");
    expect(html).toContain("5 commits, 31 échanges");
    expect((html.match(/dash-dayrow-seg/g) ?? []).length).toBe(2);
    expect(html).toContain("flex:9");
  });

  it("marque le jour sélectionné et annonce les jours futurs", () => {
    const html = renderToStaticMarkup(
      createElement(WeekDays, { rows, selectedDay: "2025-09-15", onSelect: () => {} }),
    );
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("à venir");
  });
});
