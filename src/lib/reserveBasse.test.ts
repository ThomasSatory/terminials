import { describe, expect, it } from "vitest";
import { reserveBasse } from "./reserveBasse";

describe("reserveBasse", () => {
  it("garde la place du dock quand il est affiché", () => {
    expect(reserveBasse(true)).toBe("var(--reserve-dock)");
  });

  it("ne garde qu'une respiration quand le dock est masqué", () => {
    expect(reserveBasse(false)).toBe("var(--reserve-sans-dock)");
  });
});
