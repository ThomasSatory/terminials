import { describe, it, expect } from "vitest";
import { buildFrise, cellTooltip, dotTooltip, dayBounds, HEURE_DEBUT, HEURE_FIN } from "./frise";
import type { ActivityEvent, WorkspaceCount } from "./activityApi";
import { assignWorkspaceColors } from "./workspacePalette";

const JOUR = "2026-09-16";
function at(h: number, m = 0): number {
  return Math.floor(new Date(2026, 8, 16, h, m).getTime() / 1000);
}
function ev(ts: number, kind: ActivityEvent["kind"], dir: string | null, title = "x"): ActivityEvent {
  return { id: ts, ts, kind, workspaceDir: dir, branch: "master", title, ticketIds: [], tickets: [] };
}
const A = "/home/x/dev/a";
const B = "/home/x/dev/b";
const ws: WorkspaceCount[] = [
  { dir: A, name: "a", events: 10, commits: 2 },
  { dir: B, name: "b", events: 3, commits: 0 },
];
const colors = assignWorkspaceColors(ws);

describe("dayBounds", () => {
  it("7h → 20h par défaut", () => {
    expect(dayBounds(JOUR, [])).toEqual({ start: at(HEURE_DEBUT), end: at(HEURE_FIN) });
  });
  it("s'étend à l'heure pleine avant le premier et après le dernier événement", () => {
    const b = dayBounds(JOUR, [ev(at(6, 40), "shell_cmd", A), ev(at(21, 5), "commit", A)]);
    expect(b).toEqual({ start: at(6), end: at(22) });
  });
  it("ignore les événements hors du jour", () => {
    const hier = at(6) - 86400;
    expect(dayBounds(JOUR, [ev(hier, "commit", A)])).toEqual({ start: at(7), end: at(20) });
  });
});

describe("buildFrise — jour", () => {
  const events = [
    ev(at(9, 5), "shell_cmd", A),
    ev(at(9, 10), "shell_cmd", A),
    ev(at(9, 12), "claude_prompt", A),
    ev(at(9, 20), "commit", A, "fix: bug"),
    ev(at(14, 0), "shell_cmd", B),
    ev(at(15, 0), "clickup_change", null, "T → done"),
  ];
  const f = buildFrise("day", JOUR, events, ws, colors);

  it("cases de 15 minutes sur 13 heures", () => {
    expect(f.cellSeconds).toBe(900);
    expect(f.rows[0].cells.length).toBe(13 * 4);
    expect(f.ticks.length).toBe(13);
    expect(f.ticks[0].label).toBe("7h");
    expect(f.ticks[2].label).toBe("9h");
  });

  it("une ligne par projet actif, dans l'ordre d'activité, ClickUp en dernier", () => {
    expect(f.rows.map((r) => r.name)).toEqual(["a", "b", "ClickUp"]);
    expect(f.rows[0].color).toBe("#c9a36a");
    expect(f.rows[2].color).toBe("#8f887b");
  });

  it("compte par case et normalise la densité sur toute la frise", () => {
    const neufH = f.rows[0].cells[(9 - 7) * 4];
    expect(neufH.commands).toBe(2);
    expect(neufH.prompts).toBe(1);
    expect(neufH.total).toBe(3);
    expect(neufH.density).toBe(1);
    const quatorze = f.rows[1].cells[(14 - 7) * 4];
    expect(quatorze.total).toBe(1);
    expect(quatorze.density).toBeCloseTo(1 / 3);
  });

  it("pose les commits en points, avec leur position relative", () => {
    expect(f.rows[0].dots.length).toBe(1);
    expect(f.rows[0].commits).toBe(1);
    expect(f.rows[0].dots[0].left).toBeCloseTo((2 * 3600 + 20 * 60) / (13 * 3600));
    expect(f.rows[1].dots).toEqual([]);
  });

  it("infobulles", () => {
    expect(cellTooltip(f.rows[0].cells[(9 - 7) * 4], "day")).toBe("9h · 2 commandes, 1 échange");
    expect(cellTooltip(f.rows[0].cells[0], "day")).toBe("");
    expect(dotTooltip(f.rows[0].dots[0], "day")).toBe("9h20 · fix: bug\nmaster");
  });

  it("aucun événement : aucune ligne, mais des repères", () => {
    const vide = buildFrise("day", JOUR, [], [], new Map());
    expect(vide.rows).toEqual([]);
    expect(vide.ticks.length).toBe(13);
  });
});

describe("buildFrise — semaine", () => {
  it("cases d'une heure, un repère par jour ouvré, week-end seulement s'il est actif", () => {
    // 2026-09-16 est un mercredi ; la semaine va du lundi 14 au vendredi 18.
    const mardi = Math.floor(new Date(2026, 8, 15, 10).getTime() / 1000);
    const f = buildFrise("week", JOUR, [ev(mardi, "commit", A)], ws, colors);
    expect(f.cellSeconds).toBe(3600);
    expect(f.ticks.map((t) => t.label)).toEqual(["lun. 14", "mar. 15", "mer. 16", "jeu. 17", "ven. 18"]);
    expect(f.rows[0].cells.length).toBe(5 * 24);

    const samedi = Math.floor(new Date(2026, 8, 19, 10).getTime() / 1000);
    const g = buildFrise("week", JOUR, [ev(samedi, "commit", A)], ws, colors);
    expect(g.ticks.length).toBe(7);
    expect(g.rows[0].cells.length).toBe(7 * 24);
  });
});
