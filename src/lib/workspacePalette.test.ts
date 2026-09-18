import { describe, it, expect } from "vitest";
import type { WorkspaceCount } from "./activityApi";
import {
  WORKSPACE_COLORS,
  SANS_WORKSPACE_COLOR,
  assignWorkspaceColors,
  workspaceColor,
} from "./workspacePalette";

function ws(dir: string, events: number): WorkspaceCount {
  return { dir, name: dir.split("/").pop() ?? dir, events, commits: 0 };
}

describe("assignWorkspaceColors", () => {
  it("donne le laiton au workspace le plus actif, puis la palette dans l'ordre", () => {
    const colors = assignWorkspaceColors([ws("/dev/b", 3), ws("/dev/a", 29), ws("/dev/c", 7)]);
    expect(colors.get("/dev/a")).toBe("#c9a36a");
    expect(colors.get("/dev/c")).toBe("#9bb08a");
    expect(colors.get("/dev/b")).toBe("#8da2bf");
  });

  it("l'ordre d'insertion suit l'activité décroissante (le premier est le plus actif)", () => {
    const colors = assignWorkspaceColors([ws("/dev/b", 3), ws("/dev/a", 29)]);
    expect([...colors.keys()]).toEqual(["/dev/a", "/dev/b"]);
  });

  it("cycle au-delà de 6 workspaces", () => {
    const rows = Array.from({ length: 8 }, (_, i) => ws(`/dev/w${i}`, 100 - i));
    const colors = assignWorkspaceColors(rows);
    expect(colors.get("/dev/w6")).toBe(WORKSPACE_COLORS[0]);
    expect(colors.get("/dev/w7")).toBe(WORKSPACE_COLORS[1]);
  });

  it("égalité d'événements : ordre stable par dossier", () => {
    const colors = assignWorkspaceColors([ws("/dev/z", 5), ws("/dev/a", 5)]);
    expect([...colors.keys()]).toEqual(["/dev/a", "/dev/z"]);
  });
});

describe("workspaceColor", () => {
  it("un événement sans workspace (ClickUp) prend la teinte atténuée", () => {
    const colors = assignWorkspaceColors([ws("/dev/a", 2)]);
    expect(workspaceColor(null, colors)).toBe(SANS_WORKSPACE_COLOR);
    expect(workspaceColor("/dev/inconnu", colors)).toBe(SANS_WORKSPACE_COLOR);
    expect(workspaceColor("/dev/a", colors)).toBe("#c9a36a");
  });
});
