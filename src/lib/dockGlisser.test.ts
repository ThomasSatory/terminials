import { describe, it, expect } from "vitest";
import { memeCible, memeVisee } from "./dockGlisser";

describe("memeCible", () => {
  it("compare chaque genre de cible champ à champ", () => {
    expect(memeCible({ kind: "into-group", groupId: "g" }, { kind: "into-group", groupId: "g" })).toBe(true);
    expect(memeCible({ kind: "into-group", groupId: "g" }, { kind: "into-group", groupId: "h" })).toBe(false);
    expect(memeCible({ kind: "group", index: 1, boundary: 3 }, { kind: "group", index: 1, boundary: 3 })).toBe(true);
    expect(memeCible({ kind: "group", index: 1, boundary: 3 }, { kind: "group", index: 1, boundary: 4 })).toBe(false);
    const ws = { kind: "workspace" as const, groupId: null, index: 0, boundary: 0 };
    expect(memeCible(ws, { ...ws })).toBe(true);
    expect(memeCible(ws, { ...ws, groupId: "g" })).toBe(false);
    expect(memeCible(ws, { ...ws, index: 1 })).toBe(false);
  });

  it("deux genres différents ne se confondent jamais", () => {
    expect(memeCible({ kind: "group", index: 0, boundary: 0 }, { kind: "workspace", groupId: null, index: 0, boundary: 0 })).toBe(false);
  });
});

describe("memeVisee", () => {
  const v = { cible: { kind: "group" as const, index: 0, boundary: 1 }, trait: 120 };

  it("même cible et même trait : rien à reposer", () => {
    expect(memeVisee(v, { cible: { ...v.cible }, trait: 120 })).toBe(true);
  });

  it("le trait qui bouge suffit à changer la visée", () => {
    expect(memeVisee(v, { ...v, trait: 172 })).toBe(false);
    expect(memeVisee(v, { ...v, trait: null })).toBe(false);
  });

  it("null n'égale que null", () => {
    expect(memeVisee(null, null)).toBe(true);
    expect(memeVisee(v, null)).toBe(false);
    expect(memeVisee(null, v)).toBe(false);
  });
});
