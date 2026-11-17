import { beforeEach, describe, expect, it } from "vitest";
import { BUSY_SILENCE_MS, isInterrupt, noteInput, setBusy, stalePtys } from "./agentBusy";
import {
  useWorkspaceStore,
  groupHasBusy,
  isTabBusy,
  isWorkspaceBusy,
} from "../store/workspace";

const store = () => useWorkspaceStore.getState();

describe("état « au travail » par PTY", () => {
  beforeEach(() => store().reset());

  const setup = () => {
    const id = store().addWorkspace("/a");
    const tab = store().workspaces[0].tabs[0].id;
    store().setTabPty(tab, 5);
    return { id, tab };
  };

  it("allume l'onglet et son workspace, puis s'éteint", () => {
    const { tab } = setup();
    setBusy(5, true);
    expect(isTabBusy(store(), tab)).toBe(true);
    expect(isWorkspaceBusy(store(), store().workspaces[0])).toBe(true);
    setBusy(5, false);
    expect(isWorkspaceBusy(store(), store().workspaces[0])).toBe(false);
  });

  it("un second busy ne réalloue pas l'état (PostToolUse à chaque outil)", () => {
    setup();
    setBusy(5, true);
    const before = store().busyPtys;
    setBusy(5, true);
    expect(store().busyPtys).toBe(before);
  });

  it("un workspace travaille dès qu'UN de ses onglets travaille", () => {
    const { id } = setup();
    const t2 = store().addTab(id);
    store().setTabPty(t2, 8);
    setBusy(8, true);
    const ws = store().workspaces[0];
    expect(isTabBusy(store(), ws.tabs[0].id)).toBe(false);
    expect(isWorkspaceBusy(store(), ws)).toBe(true);
  });

  it("le PTY fermé (onglet fermé, respawn) emporte son état", () => {
    const { tab } = setup();
    setBusy(5, true);
    store().removeTabPty(tab);
    expect(store().busyPtys).toEqual({});
  });

  it("remonte sur le groupe", () => {
    const { id } = setup();
    const g = store().addGroup("G");
    store().assignToGroup(id, g);
    setBusy(5, true);
    expect(groupHasBusy(store(), store().workspaces, g)).toBe(true);
    setBusy(5, false);
    expect(groupHasBusy(store(), store().workspaces, g)).toBe(false);
  });

  it("Échap ou Ctrl+C tapés pendant le travail l'éteignent, pas une flèche", () => {
    setup();
    setBusy(5, true);
    noteInput(5, "\x1b[A");
    expect(5 in store().busyPtys).toBe(true);
    noteInput(5, "\x03");
    expect(5 in store().busyPtys).toBe(false);
  });
});

describe("garde-fous", () => {
  it("isInterrupt : Échap ou Ctrl+C seuls", () => {
    expect(isInterrupt("\x1b")).toBe(true);
    expect(isInterrupt("\x03")).toBe(true);
    expect(isInterrupt("\x1b[A")).toBe(false);
    expect(isInterrupt("a")).toBe(false);
  });

  it("stalePtys : seuls les PTY silencieux au-delà du délai", () => {
    const now = 1_000_000;
    const seen = new Map([
      [1, now - 1000],
      [2, now - BUSY_SILENCE_MS - 1],
    ]);
    expect(stalePtys([1, 2, 3], seen, now)).toEqual([2, 3]);
  });
});
