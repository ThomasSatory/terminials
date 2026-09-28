import { describe, it, expect } from "vitest";
import type { ActivityEvent, EventKind } from "./activityApi";
import { assignWorkspaceColors, SANS_WORKSPACE_COLOR } from "./workspacePalette";
import { groupByHour } from "./timelineHours";

const DIR_A = "/dev/terminials";
const DIR_B = "/dev/webapp";

const colors = assignWorkspaceColors([
  { dir: DIR_A, name: "terminials", events: 29, commits: 4 },
  { dir: DIR_B, name: "webapp", events: 2, commits: 0 },
]);

let seq = 0;

/** Événement de test à l'heure locale `h`:`m` du 17 septembre 2025. */
function ev(
  h: number,
  m: number,
  kind: EventKind,
  title: string,
  dir: string | null = DIR_A,
  extra: Partial<ActivityEvent> = {},
): ActivityEvent {
  return {
    id: ++seq,
    ts: Math.floor(new Date(2025, 8, 17, h, m).getTime() / 1000),
    kind,
    workspaceDir: dir,
    branch: null,
    title,
    body: null,
    ticketIds: [],
    tickets: [],
    ...extra,
  };
}

describe("groupByHour", () => {
  it("ne garde que les heures ayant des événements, dans l'ordre croissant", () => {
    const hours = groupByHour(
      [ev(18, 5, "commit", "tard"), ev(9, 5, "commit", "tôt")],
      null,
      "",
      colors,
    );
    expect(hours.map((h) => h.hour)).toEqual([9, 18]);
  });

  it("un commit = une ligne forte, dans la teinte de son workspace", () => {
    const [hour] = groupByHour([ev(9, 5, "commit", "store SQLite")], null, "", colors);
    expect(hour.lines).toEqual([
      {
        kind: "commit",
        color: "#2ecc71",
        text: "store SQLite",
        muted: false,
        tickets: [],
      },
    ]);
  });

  it("agrège les prompts Claude par heure et par workspace", () => {
    const [hour] = groupByHour(
      [
        ev(9, 10, "claude_prompt", "a"),
        ev(9, 12, "claude_prompt", "b"),
        ev(9, 20, "claude_prompt", "c", DIR_B),
      ],
      null,
      "",
      colors,
    );
    expect(hour.lines.map((l) => l.text)).toEqual([
      "2 échanges avec Claude",
      "1 échange avec Claude",
    ]);
    expect(hour.lines.every((l) => l.muted)).toBe(true);
    // Seules les lignes d'un workspace autre que le plus actif portent son nom.
    expect(hour.lines[0].workspaceName).toBeUndefined();
    expect(hour.lines[1].workspaceName).toBe("webapp");
    expect(hour.lines[1].color).toBe("#e67e22");
  });

  it("agrège les commandes shell avec les deux premières distinctes", () => {
    const [hour] = groupByHour(
      [
        ev(10, 1, "shell_cmd", "cargo test -p terminials-core"),
        ev(10, 2, "shell_cmd", "npm run test"),
        ev(10, 3, "shell_cmd", "cargo build"),
        ev(10, 4, "shell_cmd", "ls -la"),
      ],
      null,
      "",
      colors,
    );
    expect(hour.lines[0].text).toBe("4 commandes, dont cargo test et npm run");
    expect(hour.lines[0].muted).toBe(true);
  });

  it("une seule commande : singulier", () => {
    const [hour] = groupByHour([ev(10, 1, "shell_cmd", "make api-back")], null, "", colors);
    expect(hour.lines[0].text).toBe("1 commande, dont make api-back");
  });

  it("une session Claude garde son titre, en atténué", () => {
    const [hour] = groupByHour(
      [ev(18, 5, "claude_session", "revue de branche avec Claude")],
      null,
      "",
      colors,
    );
    expect(hour.lines[0]).toMatchObject({
      kind: "claude_session",
      text: "revue de branche avec Claude",
      muted: true,
    });
  });

  it("un changement ClickUp = une ligne forte atténuée en teinte, avec ses tickets", () => {
    const ticket = {
      id: "86c1abc",
      name: null,
      status: "en cours",
      url: "https://app.clickup.com/t/86c1abc",
    };
    const [hour] = groupByHour(
      [
        ev(14, 0, "clickup_change", "86c1abc passé « en cours »", null, {
          ticketIds: ["86c1abc"],
          tickets: [ticket],
        }),
      ],
      null,
      "",
      colors,
    );
    expect(hour.lines[0]).toEqual({
      kind: "clickup_change",
      color: SANS_WORKSPACE_COLOR,
      text: "86c1abc passé « en cours »",
      muted: false,
      tickets: [ticket],
    });
  });

  it("conserve l'ordre d'apparition des lignes dans l'heure", () => {
    const [hour] = groupByHour(
      [
        ev(16, 1, "commit", "état absent"),
        ev(16, 5, "shell_cmd", "npm run tauri dev"),
        ev(16, 9, "shell_cmd", "npm run build"),
      ],
      null,
      "",
      colors,
    );
    expect(hour.lines.map((l) => l.kind)).toEqual(["commit", "shell_cmd"]);
  });

  it("filtre par workspace", () => {
    const hours = groupByHour(
      [ev(9, 5, "commit", "ici"), ev(10, 5, "commit", "ailleurs", DIR_B)],
      DIR_B,
      "",
      colors,
    );
    expect(hours.map((h) => h.hour)).toEqual([10]);
  });

  it("filtre par texte, insensible à la casse, sur le titre, la branche et les tickets", () => {
    const events = [
      ev(9, 5, "commit", "Store SQLite"),
      ev(10, 5, "commit", "autre chose", DIR_A, { branch: "feat-dashboard" }),
      ev(11, 5, "commit", "encore", DIR_A, { ticketIds: ["86c1abc"] }),
    ];
    expect(groupByHour(events, null, "sqlite", colors).map((h) => h.hour)).toEqual([9]);
    expect(groupByHour(events, null, "DASHBOARD", colors).map((h) => h.hour)).toEqual([10]);
    expect(groupByHour(events, null, "86c1", colors).map((h) => h.hour)).toEqual([11]);
  });

  it("aucun événement : aucune heure", () => {
    expect(groupByHour([], null, "", colors)).toEqual([]);
  });
});
