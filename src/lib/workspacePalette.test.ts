import { describe, it, expect } from "vitest";
import type { WorkspaceCount } from "./activityApi";
import {
  WORKSPACE_COLORS,
  SANS_WORKSPACE_COLOR,
  assignWorkspaceColors,
  workspaceColor,
} from "./workspacePalette";
import { PALETTE } from "./palette";

function ws(dir: string, events: number): WorkspaceCount {
  return { dir, name: dir.split("/").pop() ?? dir, events, commits: 0 };
}

describe("assignWorkspaceColors", () => {
  it("donne le vert au workspace le plus actif, puis l'orange et le violet", () => {
    const colors = assignWorkspaceColors([ws("/dev/b", 3), ws("/dev/a", 29), ws("/dev/c", 7)]);
    expect(colors.get("/dev/a")).toBe("#2ecc71");
    expect(colors.get("/dev/c")).toBe("#e67e22");
    expect(colors.get("/dev/b")).toBe("#9b59b6");
  });

  it("l'ordre d'insertion suit l'activité décroissante (le premier est le plus actif)", () => {
    const colors = assignWorkspaceColors([ws("/dev/b", 3), ws("/dev/a", 29)]);
    expect([...colors.keys()]).toEqual(["/dev/a", "/dev/b"]);
  });

  it("cycle au-delà de 7 workspaces", () => {
    const rows = Array.from({ length: 9 }, (_, i) => ws(`/dev/w${i}`, 100 - i));
    const colors = assignWorkspaceColors(rows);
    expect(colors.get("/dev/w7")).toBe(WORKSPACE_COLORS[0]);
    expect(colors.get("/dev/w8")).toBe(WORKSPACE_COLORS[1]);
  });

  it("égalité d'événements : ordre stable par dossier", () => {
    const colors = assignWorkspaceColors([ws("/dev/z", 5), ws("/dev/a", 5)]);
    expect([...colors.keys()]).toEqual(["/dev/a", "/dev/z"]);
  });
});

describe("WORKSPACE_COLORS", () => {
  it("reprend uniquement des couleurs de la palette de l'application, sans le gris", () => {
    for (const c of WORKSPACE_COLORS) expect(PALETTE).toContain(c);
    expect(WORKSPACE_COLORS).not.toContain(SANS_WORKSPACE_COLOR);
    expect(new Set(WORKSPACE_COLORS).size).toBe(WORKSPACE_COLORS.length);
  });
});

describe("workspaceColor", () => {
  it("un événement sans workspace (ClickUp) prend le gris de la palette", () => {
    const colors = assignWorkspaceColors([ws("/dev/a", 2)]);
    expect(workspaceColor(null, colors)).toBe(SANS_WORKSPACE_COLOR);
    expect(workspaceColor("/dev/inconnu", colors)).toBe(SANS_WORKSPACE_COLOR);
    expect(workspaceColor("/dev/a", colors)).toBe("#2ecc71");
  });
});
