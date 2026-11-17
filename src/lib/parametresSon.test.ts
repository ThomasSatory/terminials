import { describe, expect, it } from "vitest";
import { INTERVALLE_SON_MS, espacesPassesEnAttente, idsEnAttente, sonPermis } from "./parametresSon";

const ws = (id: string, p: { unread?: boolean; unreadTabs?: string[] } = {}) => ({
  id,
  tabs: [{ id: `${id}:t` }],
  unread: p.unread ?? false,
  unreadTabs: p.unreadTabs ?? [],
});

describe("son d'attente", () => {
  it("idsEnAttente : même règle que la pastille (notification d'espace ou d'onglet)", () => {
    const s = {
      workspaces: [ws("a", { unread: true }), ws("b", { unreadTabs: ["b:t"] }), ws("c")],
      tabPtys: { "c:t": 3 },
      busyPtys: { 3: true as const },
    };
    expect([...idsEnAttente(s)].sort()).toEqual(["a", "b"]);
  });

  it("seuls les PASSAGES en attente comptent", () => {
    expect(espacesPassesEnAttente(new Set(["a"]), new Set(["a", "b"]))).toEqual(["b"]);
    expect(espacesPassesEnAttente(new Set(["a", "b"]), new Set(["a"]))).toEqual([]);
  });

  it("deux passages rapprochés ne sonnent qu'une fois", () => {
    expect(sonPermis(0, INTERVALLE_SON_MS)).toBe(true);
    expect(sonPermis(1000, 1000 + INTERVALLE_SON_MS - 1)).toBe(false);
  });
});
