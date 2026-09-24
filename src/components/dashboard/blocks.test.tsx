import { describe, it, expect, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { Timeline } from "./Timeline";
import { Frise } from "./Frise";
import { buildFrise } from "../../lib/frise";
import { WeekDays } from "./WeekDays";
import type { ActivityEvent } from "../../lib/activityApi";
import { assignWorkspaceColors } from "../../lib/workspacePalette";
import type { WeekDayRow } from "../../lib/weekDays";

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

describe("Frise", () => {
  const A = "/home/x/dev/a";
  const at = (h: number, m = 0) => Math.floor(new Date(2026, 8, 16, h, m).getTime() / 1000);
  const ev = (ts: number, kind: ActivityEvent["kind"], title = "x"): ActivityEvent => ({
    id: ts,
    ts,
    kind,
    workspaceDir: A,
    branch: null,
    title,
    ticketIds: [],
    tickets: kind === "commit" ? [{ id: "CU-1", url: "https://app.clickup.com/t/CU-1" }] : [],
  });
  const ws = [{ dir: A, name: "a", events: 3, commits: 1 }];
  const colors = assignWorkspaceColors(ws);

  it("une ligne par projet, une case par quart d'heure actif, un point cliquable par commit", () => {
    const frise = buildFrise(
      "day",
      "2026-09-16",
      [ev(at(9, 5), "shell_cmd"), ev(at(9, 10), "shell_cmd"), ev(at(11, 30), "commit", "fix: x")],
      ws,
      colors,
    );
    const html = renderToStaticMarkup(
      createElement(Frise, { frise, mode: "day", onOpenTicket: () => {} }),
    );
    expect((html.match(/dash-frise-row/g) ?? []).length).toBe(2); // projet + axe
    expect((html.match(/dash-frise-cell/g) ?? []).length).toBe(2);
    expect(html).toContain('href="https://app.clickup.com/t/CU-1"');
    expect(html).toContain("11h30 · fix: x");
    expect(html).toContain("1 commit");
    expect(html).toContain(">7h<");
  });

  it("porte sous chaque ligne la phrase du bilan du projet, liens cliquables", () => {
    const frise = buildFrise("day", "2026-09-16", [ev(at(9, 5), "shell_cmd")], ws, colors);
    const phrases = new Map([["a", "Longue session pour [CU-2](https://app.clickup.com/t/CU-2)."]]);
    const html = renderToStaticMarkup(
      createElement(Frise, { frise, mode: "day", phrases, onOpenLink: () => {} }),
    );
    expect(html).toContain("dash-frise-phrase");
    expect(html).toContain("Longue session pour ");
    expect(html).toContain('href="https://app.clickup.com/t/CU-2"');
  });

  it("sans phrase pour le projet : pas de ligne de phrase", () => {
    const frise = buildFrise("day", "2026-09-16", [ev(at(9, 5), "shell_cmd")], ws, colors);
    const html = renderToStaticMarkup(createElement(Frise, { frise, mode: "day", phrases: new Map() }));
    expect(html).not.toContain("dash-frise-phrase");
  });

  it("sans événement : phrase d'absence", () => {
    const html = renderToStaticMarkup(
      createElement(Frise, { frise: buildFrise("day", "2026-09-16", [], [], new Map()), mode: "day" }),
    );
    expect(html).toContain("Aucune activité ce jour");
  });
});
