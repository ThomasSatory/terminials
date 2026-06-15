import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "./workspace";

describe("workspace store", () => {
  beforeEach(() => useWorkspaceStore.getState().reset());

  it("crée un workspace avec un pane racine", () => {
    const id = useWorkspaceStore.getState().addWorkspace("/tmp");
    const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === id)!;
    expect(ws.cwd).toBe("/tmp");
    expect(ws.root.kind).toBe("leaf");
  });

  it("split un pane leaf en branche avec 2 leaves", () => {
    const id = useWorkspaceStore.getState().addWorkspace("/tmp");
    const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === id)!;
    const leafId = (ws.root as any).paneId;
    useWorkspaceStore.getState().splitPane(id, leafId, "horizontal");
    const ws2 = useWorkspaceStore.getState().workspaces.find((w) => w.id === id)!;
    expect(ws2.root.kind).toBe("branch");
    expect((ws2.root as any).children).toHaveLength(2);
  });

  it("marque une notification lue", () => {
    const id = useWorkspaceStore.getState().addWorkspace("/tmp");
    useWorkspaceStore.getState().setNotification(id, { title: "x", body: "y" });
    expect(useWorkspaceStore.getState().workspaces.find((w) => w.id === id)!.unread).toBe(true);
    useWorkspaceStore.getState().markRead(id);
    expect(useWorkspaceStore.getState().workspaces.find((w) => w.id === id)!.unread).toBe(false);
  });
});
