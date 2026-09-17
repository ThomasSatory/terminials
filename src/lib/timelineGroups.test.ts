import { describe, it, expect } from "vitest";
import { groupTimeline, eventIcon } from "./timelineGroups";
import type { ActivityEvent } from "./activityApi";

function ev(partial: Partial<ActivityEvent> & { id: number; ts: number }): ActivityEvent {
  return {
    kind: "commit",
    workspaceDir: "/home/x/dev/a",
    branch: null,
    title: "titre",
    body: null,
    ticketIds: [],
    tickets: [],
    ...partial,
  };
}

describe("groupTimeline", () => {
  it("groupe par workspace, ordre des groupes = premier événement rencontré", () => {
    const events = [
      ev({ id: 1, ts: 1000, workspaceDir: "/home/x/dev/a", title: "commit a1" }),
      ev({ id: 2, ts: 1010, workspaceDir: "/home/x/dev/b", title: "commit b1" }),
      ev({ id: 3, ts: 1020, workspaceDir: "/home/x/dev/a", title: "commit a2" }),
    ];
    const groups = groupTimeline(events, null, "");
    expect(groups.map((g) => g.dir)).toEqual(["/home/x/dev/a", "/home/x/dev/b"]);
    expect(groups[0].name).toBe("a");
    expect(groups[0].events.map((e) => e.id)).toEqual([1, 3]);
    expect(groups[1].events.map((e) => e.id)).toEqual([2]);
  });

  it("filtre par dir : ne garde que le groupe sélectionné", () => {
    const events = [
      ev({ id: 1, ts: 1000, workspaceDir: "/home/x/dev/a" }),
      ev({ id: 2, ts: 1010, workspaceDir: "/home/x/dev/b" }),
    ];
    const groups = groupTimeline(events, "/home/x/dev/b", "");
    expect(groups.map((g) => g.dir)).toEqual(["/home/x/dev/b"]);
  });

  it("filtre texte insensible à la casse sur le ticket id", () => {
    const events = [
      ev({ id: 1, ts: 1000, title: "sans rapport", ticketIds: ["AB-1"] }),
      ev({ id: 2, ts: 1010, title: "avec ticket", ticketIds: ["ABC-42"] }),
    ];
    const groups = groupTimeline(events, null, "abc-42");
    const ids = groups.flatMap((g) => g.events.map((e) => e.id));
    expect(ids).toEqual([2]);
  });

  it("filtre texte sur title et branch", () => {
    const events = [
      ev({ id: 1, ts: 1000, title: "correctif urgent", branch: null }),
      ev({ id: 2, ts: 1010, title: "autre chose", branch: "feature/URGENT-fix" }),
      ev({ id: 3, ts: 1020, title: "sans lien", branch: "main" }),
    ];
    const groups = groupTimeline(events, null, "urgent");
    const ids = groups.flatMap((g) => g.events.map((e) => e.id));
    expect(ids).toEqual([1, 2]);
  });

  it("le groupe ClickUp (dir null) est toujours en dernier, même s'il apparaît en premier", () => {
    const events = [
      ev({ id: 1, ts: 1000, kind: "clickup_change", workspaceDir: null, title: "ticket bougé" }),
      ev({ id: 2, ts: 1010, workspaceDir: "/home/x/dev/a", title: "commit a1" }),
    ];
    const groups = groupTimeline(events, null, "");
    expect(groups.map((g) => g.dir)).toEqual(["/home/x/dev/a", null]);
    expect(groups[1].name).toBe("ClickUp");
    expect(groups[1].events.map((e) => e.id)).toEqual([1]);
  });
});

describe("eventIcon", () => {
  it("associe une icône par kind", () => {
    expect(eventIcon("commit")).toBe("●");
    expect(eventIcon("claude_prompt")).toBe("✦");
    expect(eventIcon("claude_session")).toBe("◷");
    expect(eventIcon("shell_cmd")).toBe("›");
    expect(eventIcon("clickup_change")).toBe("◆");
  });
});
