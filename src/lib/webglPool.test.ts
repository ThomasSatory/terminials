import { beforeEach, describe, expect, it, vi } from "vitest";
import { oublierWebgl, reserverWebgl, tenantsWebgl, viderWebgl } from "./webglPool";

describe("webglPool", () => {
  beforeEach(() => viderWebgl());

  it("garde les terminaux sous la borne sans rien libérer", () => {
    const liberer = vi.fn();
    reserverWebgl("a", liberer, 2);
    reserverWebgl("b", liberer, 2);
    expect(tenantsWebgl()).toEqual(["a", "b"]);
    expect(liberer).not.toHaveBeenCalled();
  });

  it("libère le terminal montré le moins récemment quand la borne est dépassée", () => {
    const a = vi.fn();
    const b = vi.fn();
    reserverWebgl("a", a, 2);
    reserverWebgl("b", b, 2);
    // « a » remontré : c'est « b » le plus ancien.
    reserverWebgl("a", a, 2);
    reserverWebgl("c", vi.fn(), 2);
    expect(b).toHaveBeenCalledOnce();
    expect(a).not.toHaveBeenCalled();
    expect(tenantsWebgl()).toEqual(["a", "c"]);
  });

  it("oublie un terminal démonté ou dont le contexte est perdu", () => {
    const a = vi.fn();
    reserverWebgl("a", a, 1);
    oublierWebgl("a");
    reserverWebgl("b", vi.fn(), 1);
    expect(a).not.toHaveBeenCalled();
    expect(tenantsWebgl()).toEqual(["b"]);
  });
});
