import { describe, it, expect } from "vitest";
import { buildFrise, colonneA, colonnesEmpilees, dotTooltip, dayBounds, dureeActive, extraitPrompt, survolColonne, HEURE_DEBUT, HEURE_FIN } from "./frise";
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

  it("une ligne par projet actif, dans l'ordre d'activité, sans ligne pour ClickUp", () => {
    expect(f.rows.map((r) => r.name)).toEqual(["a", "b"]);
    expect(f.rows[0].color).toBe("#2ecc71");
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
    const col = colonnesEmpilees(f)[0];
    expect(survolColonne(col, f, "day")).toEqual({
      t0: at(9),
      titre: "9h – 9h15",
      projets: [
        { name: "a", color: f.rows[0].color, detail: "2 commandes, 1 échange", us: [], commits: [], extraits: [] },
      ],
    });
    expect(survolColonne(colonnesEmpilees(f)[1], f, "day").projets[0].commits).toEqual(["fix: bug"]);
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

describe("colonnesEmpilees", () => {
  const f = buildFrise(
    "day",
    JOUR,
    [
      ev(at(9, 0), "shell_cmd", A),
      ev(at(9, 5), "shell_cmd", A),
      ev(at(9, 10), "claude_prompt", B),
      ev(at(14, 0), "shell_cmd", B),
    ],
    ws,
    colors,
  );
  const cols = colonnesEmpilees(f);

  it("une colonne par case active, les projets empilés dans l'ordre des lignes", () => {
    expect(cols.length).toBe(2);
    expect(cols[0].t0).toBe(at(9));
    expect(cols[0].segments.map((s) => s.name)).toEqual(["a", "b"]);
    expect(cols[1].segments.map((s) => s.name)).toEqual(["b"]);
  });

  it("hauteurs relatives à la pile la plus haute de la frise", () => {
    expect(cols[0].segments[0].part).toBeCloseTo(2 / 3);
    expect(cols[0].segments[1].part).toBeCloseTo(1 / 3);
    expect(cols[1].segments[0].part).toBeCloseTo(1 / 3);
    expect(cols[0].left).toBeCloseTo((2 * 3600) / (13 * 3600));
  });

  it("infobulle : l'heure puis le détail par projet", () => {
    const s = survolColonne(cols[0], f, "day");
    expect(s.titre).toBe("9h – 9h15");
    expect(s.projets.map((p) => `${p.name} — ${p.detail}`)).toEqual(["a — 2 commandes", "b — 1 échange"]);
  });

  it("colonne sous le pointeur, rien entre deux colonnes", () => {
    expect(colonneA(cols, cols[0].left + cols[0].width / 2)).toBe(cols[0]);
    expect(colonneA(cols, 0)).toBeNull();
  });

  it("frise vide : aucune colonne", () => {
    expect(colonnesEmpilees(buildFrise("day", JOUR, [], [], new Map()))).toEqual([]);
  });
});

describe("dureeActive", () => {
  it("temps des cases actives d'un projet, arrondi au quart d'heure", () => {
    const f = buildFrise("day", JOUR, [ev(at(9), "shell_cmd", A), ev(at(9, 20), "shell_cmd", A)], ws, colors);
    expect(dureeActive(f.rows[0], f.cellSeconds)).toBe("30 min");
  });

  it("formate les heures", () => {
    const evs = Array.from({ length: 5 }, (_, i) => ev(at(9, i * 15), "shell_cmd", A));
    const f = buildFrise("day", JOUR, evs, ws, colors);
    expect(dureeActive(f.rows[0], f.cellSeconds)).toBe("1 h 15");
    const g = buildFrise("day", JOUR, evs.slice(0, 4), ws, colors);
    expect(dureeActive(g.rows[0], g.cellSeconds)).toBe("1 h");
  });
});

describe("US et extraits dans les cases", () => {
  const us = { id: "ABC-7", name: "Faire X", status: "test", url: "u" };
  const f = buildFrise(
    "day",
    JOUR,
    [
      { ...ev(at(10, 1), "claude_prompt", A, "Il faut que le dashboard affiche le temps par US"), usTicket: us },
      { ...ev(at(10, 2), "claude_prompt", A, "<bash-stdout>ok</bash-stdout>"), usTicket: us },
      { ...ev(at(10, 3), "claude_prompt", A, "fait"), usTicket: us },
    ],
    ws,
    colors,
  );
  it("une US par case sans doublon, prompts bruités écartés", () => {
    const cell = f.rows[0].cells[(10 - 7) * 4];
    expect(cell.us).toEqual([us]);
    expect(cell.extraits).toEqual(["Il faut que le dashboard affiche le temps par US"]);
  });
  it("extraitPrompt tronque les longs messages", () => {
    expect(extraitPrompt("a".repeat(200))?.length).toBe(90);
    expect(extraitPrompt("Another Claude session sent a message")).toBeNull();
  });
});
