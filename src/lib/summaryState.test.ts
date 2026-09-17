import { describe, it, expect } from "vitest";
import { reduceSummary, type SummaryUi } from "./summaryState";
import type { Summary } from "./activityApi";

describe("reduceSummary", () => {
  const idle: SummaryUi = { status: "idle" };
  const summary: Summary = {
    text: "texte du résumé",
    model: "openai:google/gemma-4-31B-it",
    generatedAt: 1234,
    cached: false,
  };

  it("start -> loading", () => {
    expect(reduceSummary(idle, { type: "start" })).toEqual({ status: "loading" });
  });

  it("ok -> ok avec le résumé", () => {
    expect(reduceSummary({ status: "loading" }, { type: "ok", summary })).toEqual({
      status: "ok",
      summary,
    });
  });

  it("fail avec 'unauthorized: jeton LLM refusé' -> unauthorized", () => {
    expect(
      reduceSummary(
        { status: "loading" },
        { type: "fail", error: "unauthorized: jeton LLM refusé" },
      ),
    ).toEqual({ status: "unauthorized" });
  });

  it("fail avec une autre erreur -> error avec message String(error)", () => {
    const error = new Error("boom");
    expect(reduceSummary({ status: "loading" }, { type: "fail", error })).toEqual({
      status: "error",
      message: String(error),
    });
  });
});
