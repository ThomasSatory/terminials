import { beforeEach, describe, expect, it } from "vitest";
import { applyClaudeSession, tabIdForPty } from "./socketEvents";
import { useWorkspaceStore } from "../store/workspace";

describe("tabIdForPty", () => {
  const tabPtys = { "t:1": 4, "t:2": 7 };

  it("retrouve l'onglet porteur du PTY", () => {
    expect(tabIdForPty(tabPtys, 7)).toBe("t:2");
  });

  it("undefined si le PTY n'est plus dans aucun onglet", () => {
    expect(tabIdForPty(tabPtys, 9)).toBeUndefined();
  });

  it("undefined sans ptyId numérique (CLI hors onglet)", () => {
    expect(tabIdForPty(tabPtys, undefined)).toBeUndefined();
    expect(tabIdForPty(tabPtys, "7")).toBeUndefined();
  });
});

describe("applyClaudeSession", () => {
  const SID = "6db82e10-f79a-44eb-a88f-8737db058caf";
  const store = () => useWorkspaceStore.getState();

  beforeEach(() => store().reset());

  const setup = () => {
    const id = store().addWorkspace("/a");
    const tab = store().workspaces[0].tabs[0].id;
    store().setTabPty(tab, 5);
    return { id, tab };
  };

  it("retient la session sur l'onglet porteur du PTY émetteur", () => {
    const { id } = setup();
    applyClaudeSession(id, { sessionId: SID, cwd: "/a/api", ended: false, ptyId: 5 });
    expect(store().workspaces[0].tabs[0].claude).toEqual({ id: SID, cwd: "/a/api" });
    applyClaudeSession(id, { sessionId: SID, ended: true, ptyId: 5 });
    expect(store().workspaces[0].tabs[0].claude).toBeUndefined();
  });

  it("ignore un émetteur hors onglet et un id invalide", () => {
    const { id } = setup();
    applyClaudeSession(id, { sessionId: SID, cwd: "/a", ended: false });
    applyClaudeSession(id, { sessionId: "$(id)", cwd: "/a", ended: false, ptyId: 5 });
    expect(store().workspaces[0].tabs[0].claude).toBeUndefined();
  });
});
