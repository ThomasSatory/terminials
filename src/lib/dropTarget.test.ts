import { describe, it, expect } from "vitest";
import { resolvePaneId, toCssPoint, resolveTargetPty, type PaneAncestor } from "./dropTarget";

/** Fabrique une chaîne d'ancêtres (du plus profond au plus haut), comme le DOM. */
function chain(...paneIds: (string | undefined)[]): PaneAncestor {
  let parent: PaneAncestor | null = null;
  for (const paneId of paneIds.slice().reverse()) {
    parent = { dataset: { paneId }, parentElement: parent };
  }
  return parent!;
}

describe("resolvePaneId", () => {
  it("élément portant data-pane-id → cet id", () => {
    expect(resolvePaneId(chain("p1"))).toBe("p1");
  });

  it("remonte les ancêtres depuis un descendant xterm sans data-pane-id", () => {
    expect(resolvePaneId(chain(undefined, undefined, "p2"))).toBe("p2");
  });

  it("s'arrête au premier ancêtre marqué (pane imbriqué → le plus proche)", () => {
    expect(resolvePaneId(chain(undefined, "p3", "p4"))).toBe("p3");
  });

  it("aucun ancêtre marqué → null (l'appelant retombe sur le pane actif)", () => {
    expect(resolvePaneId(chain(undefined, undefined))).toBeNull();
  });

  it("élément absent (drop hors fenêtre) → null", () => {
    expect(resolvePaneId(null)).toBeNull();
  });
});

describe("toCssPoint", () => {
  it("dpr 1 → coordonnées inchangées", () => {
    expect(toCssPoint({ x: 300, y: 200 }, 1)).toEqual({ x: 300, y: 200 });
  });

  it("écran HiDPI : les pixels physiques de Tauri sont divisés par le dpr", () => {
    expect(toCssPoint({ x: 300, y: 200 }, 2)).toEqual({ x: 150, y: 100 });
  });

  it("dpr absurde (0) → pas de division par zéro, coordonnées inchangées", () => {
    expect(toCssPoint({ x: 300, y: 200 }, 0)).toEqual({ x: 300, y: 200 });
  });
});

describe("resolveTargetPty", () => {
  const state = {
    panePtys: { p1: 11, p2: 22 },
    workspaces: [
      { id: "w1", activePaneId: "p1" },
      { id: "w2", activePaneId: "p2" },
    ],
    activeId: "w2",
  };

  it("pane résolu → son PTY", () => {
    expect(resolveTargetPty(state, "p1")).toBe(11);
  });

  it("pane non résolu (drop hors cellule) → PTY du pane actif du workspace actif", () => {
    expect(resolveTargetPty(state, null)).toBe(22);
  });

  it("pane sans PTY encore enregistré → undefined, JAMAIS le pane actif", () => {
    // Écrire un chemin dans un autre terminal que celui visé serait pire que ne rien faire.
    expect(resolveTargetPty(state, "p3")).toBeUndefined();
  });

  it("aucun workspace actif → undefined", () => {
    expect(resolveTargetPty({ ...state, activeId: null }, null)).toBeUndefined();
  });
});
