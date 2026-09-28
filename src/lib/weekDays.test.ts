import { describe, it, expect } from "vitest";
import type { ActivityEvent, EventKind } from "./activityApi";
import { assignWorkspaceColors, SANS_WORKSPACE_COLOR } from "./workspacePalette";
import { weekRange } from "./dashboardDay";
import { buildWeekDays } from "./weekDays";

const DIR_A = "/dev/terminials";
const DIR_B = "/dev/webapp";

const colors = assignWorkspaceColors([
  { dir: DIR_A, name: "terminials", events: 29, commits: 4 },
  { dir: DIR_B, name: "webapp", events: 2, commits: 0 },
]);

/** Semaine 38 de 2025 : lundi 15 → vendredi 19 septembre. */
const SEMAINE = weekRange("2025-09-17").days;

let seq = 0;

function ev(
  day: string,
  h: number,
  kind: EventKind,
  title: string,
  dir: string | null = DIR_A,
): ActivityEvent {
  const [y, m, d] = day.split("-").map(Number);
  return {
    id: ++seq,
    ts: Math.floor(new Date(y, m - 1, d, h, 0).getTime() / 1000),
    kind,
    workspaceDir: dir,
    branch: null,
    title,
    body: null,
    ticketIds: [],
    tickets: [],
  };
}

describe("buildWeekDays", () => {
  it("une ligne par jour ouvré, libellée « lun. 15 »", () => {
    const rows = buildWeekDays(SEMAINE, [], colors, "2025-09-19");
    expect(rows.map((r) => r.day)).toEqual(SEMAINE);
    expect(rows[0].label).toBe("lun. 15");
    expect(rows[4].label).toBe("ven. 19");
  });

  it("fait marquant : le premier commit du jour", () => {
    const rows = buildWeekDays(
      SEMAINE,
      [
        ev("2025-09-15", 9, "claude_session", "session du matin"),
        ev("2025-09-15", 10, "commit", "réordonnancement des workspaces"),
        ev("2025-09-15", 11, "commit", "plus tard"),
      ],
      colors,
      "2025-09-19",
    );
    expect(rows[0].fait).toBe("réordonnancement des workspaces");
  });

  it("sans commit : le titre de la première session Claude", () => {
    const rows = buildWeekDays(
      SEMAINE,
      [ev("2025-09-16", 9, "claude_session", "revue de la sidebar")],
      colors,
      "2025-09-19",
    );
    expect(rows[1].fait).toBe("revue de la sidebar");
  });

  it("sans commit ni session : le nombre de commandes", () => {
    const rows = buildWeekDays(
      SEMAINE,
      [
        ev("2025-09-16", 9, "shell_cmd", "ls"),
        ev("2025-09-16", 10, "shell_cmd", "cargo test"),
        ev("2025-09-17", 10, "shell_cmd", "make"),
      ],
      colors,
      "2025-09-19",
    );
    expect(rows[1].fait).toBe("2 commandes");
    expect(rows[2].fait).toBe("1 commande");
  });

  it("jour futur : marqué « à venir », sans fait marquant", () => {
    const rows = buildWeekDays(SEMAINE, [], colors, "2025-09-17");
    expect(rows.map((r) => r.future)).toEqual([false, false, false, true, true]);
    expect(rows[3].fait).toBe("");
  });

  it("compteurs : commits et échanges, zéros omis, singuliers", () => {
    const rows = buildWeekDays(
      SEMAINE,
      [
        ev("2025-09-15", 9, "commit", "un"),
        ev("2025-09-15", 10, "commit", "deux"),
        ev("2025-09-15", 11, "claude_prompt", "p"),
        ev("2025-09-16", 9, "commit", "seul"),
        ev("2025-09-17", 9, "claude_prompt", "p"),
      ],
      colors,
      "2025-09-19",
    );
    expect(rows[0].compteurs).toBe("2 commits, 1 échange");
    expect(rows[1].compteurs).toBe("1 commit");
    expect(rows[2].compteurs).toBe("1 échange");
    expect(rows[3].compteurs).toBe("");
  });

  it("répartition : un segment par workspace, du plus actif au moins actif", () => {
    const rows = buildWeekDays(
      SEMAINE,
      [
        ev("2025-09-15", 9, "commit", "a"),
        ev("2025-09-15", 10, "claude_prompt", "a"),
        ev("2025-09-15", 11, "claude_prompt", "a"),
        ev("2025-09-15", 12, "commit", "b", DIR_B),
        ev("2025-09-15", 13, "clickup_change", "ticket", null),
      ],
      colors,
      "2025-09-19",
    );
    expect(rows[0].segments).toEqual([
      { dir: DIR_A, color: "#2ecc71", events: 3 },
      { dir: DIR_B, color: "#e67e22", events: 1 },
      { dir: null, color: SANS_WORKSPACE_COLOR, events: 1 },
    ]);
    expect(rows[4].segments).toEqual([]);
  });

  it("un samedi n'apparaît que s'il a des événements", () => {
    const sansSamedi = buildWeekDays(SEMAINE, [], colors, "2025-09-22");
    expect(sansSamedi).toHaveLength(5);

    const avecSamedi = buildWeekDays(
      SEMAINE,
      [ev("2025-09-20", 11, "commit", "week-end")],
      colors,
      "2025-09-22",
    );
    expect(avecSamedi.map((r) => r.day)).toEqual([...SEMAINE, "2025-09-20"]);
    expect(avecSamedi[5].label).toBe("sam. 20");
  });
});
