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

  describe("régénération depuis un résumé déjà affiché (ok)", () => {
    const ok: SummaryUi = { status: "ok", summary };

    it("start depuis ok -> ok avec refreshing=true, résumé conservé", () => {
      expect(reduceSummary(ok, { type: "start" })).toEqual({
        status: "ok",
        summary,
        refreshing: true,
      });
    });

    it("fail (unauthorized) depuis ok -> ok avec lastError='unauthorized', résumé conservé", () => {
      const refreshing: SummaryUi = { status: "ok", summary, refreshing: true };
      expect(
        reduceSummary(refreshing, { type: "fail", error: "unauthorized: jeton LLM refusé" }),
      ).toEqual({
        status: "ok",
        summary,
        refreshing: false,
        lastError: "unauthorized",
      });
    });

    it("fail (autre erreur) depuis ok -> ok avec lastError=String(error), résumé conservé", () => {
      const refreshing: SummaryUi = { status: "ok", summary, refreshing: true };
      const error = new Error("boom");
      expect(reduceSummary(refreshing, { type: "fail", error })).toEqual({
        status: "ok",
        summary,
        refreshing: false,
        lastError: String(error),
      });
    });

    it("ok depuis ok -> nouveau résumé, refreshing/lastError effacés", () => {
      const failed: SummaryUi = { status: "ok", summary, refreshing: false, lastError: "boum" };
      const nouveau: Summary = { ...summary, text: "nouveau texte" };
      expect(reduceSummary(failed, { type: "ok", summary: nouveau })).toEqual({
        status: "ok",
        summary: nouveau,
      });
    });
  });
});
