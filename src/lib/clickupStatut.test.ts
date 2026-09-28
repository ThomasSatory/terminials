import { describe, it, expect } from "vitest";
import { tonStatut } from "./clickupStatut";

describe("tonStatut", () => {
  it("reconnaît les familles usuelles, neutre sinon", () => {
    expect(tonStatut("bloqué")).toBe("bloque");
    expect(tonStatut("code review")).toBe("revue");
    expect(tonStatut("test")).toBe("test");
    expect(tonStatut("en cours")).toBe("encours");
    expect(tonStatut("terminé")).toBe("fini");
    expect(tonStatut("backlog")).toBe("neutre");
    expect(tonStatut(null)).toBe("neutre");
  });
});
