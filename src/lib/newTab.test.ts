import { describe, it, expect, vi } from "vitest";

vi.mock("./pty", () => ({ ptyCwd: vi.fn(), closePty: vi.fn() }));

import { newTabCwd } from "./newTab";
import type { Workspace } from "../store/workspace";

const ws = (over: Partial<Workspace> = {}): Workspace => ({
  id: "ws:0",
  cwd: "/repo",
  name: "repo",
  tabs: [{ id: "tab:0" }],
  activeTabId: "tab:0",
  groupId: null,
  ports: [],
  unread: false,
  unreadTabs: [],
  diffOpen: false,
  ...over,
});

describe("newTabCwd", () => {
  it("prend le dossier courant du shell de l'onglet actif", async () => {
    const read = vi.fn(async () => "/repo/front");
    expect(await newTabCwd(ws(), { "tab:0": 7 }, read)).toBe("/repo/front");
    expect(read).toHaveBeenCalledWith(7);
  });

  it("sans PTY pour l'onglet actif : son dossier de départ, sinon celui du workspace", async () => {
    const read = vi.fn();
    expect(await newTabCwd(ws(), {}, read)).toBeUndefined();
    expect(await newTabCwd(ws({ tabs: [{ id: "tab:0", cwd: "/repo/api" }] }), {}, read)).toBe("/repo/api");
    expect(read).not.toHaveBeenCalled();
  });

  it("lecture vide ou rejetée : même repli", async () => {
    expect(await newTabCwd(ws(), { "tab:0": 7 }, async () => null)).toBeUndefined();
    expect(
      await newTabCwd(ws({ tabs: [{ id: "tab:0", cwd: "/repo/api" }] }), { "tab:0": 7 }, () =>
        Promise.reject(new Error("pty introuvable")),
      ),
    ).toBe("/repo/api");
  });

  it("sans onglet actif : dossier du workspace", async () => {
    expect(await newTabCwd(ws({ activeTabId: null }), { "tab:0": 7 }, async () => "/x")).toBeUndefined();
  });

  it("un dossier égal à celui du workspace n'est pas retenu", async () => {
    expect(await newTabCwd(ws(), { "tab:0": 7 }, async () => "/repo")).toBeUndefined();
  });
});
