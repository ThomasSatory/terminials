import { describe, it, expect } from "vitest";
import { attacherPuces } from "./friseBilan";

describe("attacherPuces", () => {
  it("apparie chaque puce au projet dont elle porte le nom, le reste va dans « autres »", () => {
    const body = [
      "- Sur backend, clarifications sur l'US [86cb](https://x/86cb) : appel à la liste.",
      "- terminals : longue session (2h) pour les groupes.",
      "- Sur feat-dashboard, retours UI.",
    ].join("\n");
    const r = attacherPuces(body, ["terminals", "backend"]);
    expect(r.phrases.get("backend")).toBe("Clarifications sur l'US [86cb](https://x/86cb) : appel à la liste.");
    expect(r.phrases.get("terminals")).toBe("Longue session (2h) pour les groupes.");
    expect(r.autres).toBe("- Sur feat-dashboard, retours UI.");
  });

  it("tolère le gras, la casse et le tiret cadratin", () => {
    const r = attacherPuces("- **Terminals** — a fait X.", ["terminals"]);
    expect(r.phrases.get("terminals")).toBe("A fait X.");
    expect(r.autres).toBe("");
  });

  it("le nom le plus long gagne quand un nom est préfixe d'un autre", () => {
    const r = attacherPuces("- backend-tests : a\n- backend : b", ["backend", "backend-tests"]);
    expect(r.phrases.get("backend-tests")).toBe("A");
    expect(r.phrases.get("backend")).toBe("B");
  });

  it("deux puces pour le même projet : concaténées", () => {
    const r = attacherPuces("- a : x.\n- a : y.", ["a"]);
    expect(r.phrases.get("a")).toBe("X. Y.");
  });

  it("texte hors puces et corps vide", () => {
    expect(attacherPuces("", ["a"])).toEqual({ phrases: new Map(), autres: "" });
    const r = attacherPuces("Un paragraphe.\n- a : x", ["a"]);
    expect(r.phrases.get("a")).toBe("X");
    expect(r.autres).toBe("Un paragraphe.");
  });
});
