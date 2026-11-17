import { describe, it, expect } from "vitest";
import { reduceSummary, redactionEnCours, type SummaryUi } from "./summaryState";
import type { Summary } from "./activityApi";

describe("reduceSummary", () => {
  const idle: SummaryUi = { status: "idle" };
  const summary: Summary = {
    day: "2026-09-17",
    text: "texte du résumé",
    model: "claude-cli:sonnet",
    generatedAt: 1234,
    cached: false,
  };

  it("start -> loading, avec sa phase (lecture du cache ou rédaction)", () => {
    expect(reduceSummary(idle, { type: "start", phase: "lecture" })).toEqual({ status: "loading", phase: "lecture" });
    expect(reduceSummary(idle, { type: "start", phase: "redaction" })).toEqual({ status: "loading", phase: "redaction" });
  });

  it("redactionEnCours : jamais pour une simple lecture du cache", () => {
    expect(redactionEnCours({ status: "loading", phase: "lecture" })).toBe(false);
    expect(redactionEnCours({ status: "loading", phase: "redaction" })).toBe(true);
    expect(redactionEnCours({ status: "ok", summary, refreshing: "lecture" })).toBe(false);
    expect(redactionEnCours({ status: "ok", summary, refreshing: "redaction" })).toBe(true);
    expect(redactionEnCours({ status: "ok", summary })).toBe(false);
  });

  it("ok issu d'une rédaction : marqué réécrit", () => {
    expect(reduceSummary({ status: "loading", phase: "redaction" }, { type: "ok", summary, reecrit: true })).toEqual({
      status: "ok",
      summary,
      reecrit: true,
    });
  });

  it("ok -> ok avec le résumé", () => {
    expect(reduceSummary({ status: "loading", phase: "lecture" }, { type: "ok", summary })).toEqual({
      status: "ok",
      summary,
    });
  });

  it("fail avec une autre erreur -> error avec message String(error)", () => {
    const error = new Error("boom");
    expect(reduceSummary({ status: "loading", phase: "lecture" }, { type: "fail", error })).toEqual({
      status: "error",
      message: String(error),
    });
  });

  describe("régénération depuis un résumé déjà affiché (ok)", () => {
    const ok: SummaryUi = { status: "ok", summary };

    it("start depuis ok -> ok avec refreshing = sa phase, résumé conservé", () => {
      expect(reduceSummary(ok, { type: "start", phase: "redaction" })).toEqual({
        status: "ok",
        summary,
        refreshing: "redaction",
      });
    });

    it("fail (autre erreur) depuis ok -> ok avec lastError=String(error), résumé conservé", () => {
      const refreshing: SummaryUi = { status: "ok", summary, refreshing: "redaction" };
      const error = new Error("boom");
      expect(reduceSummary(refreshing, { type: "fail", error })).toEqual({
        status: "ok",
        summary,
        refreshing: undefined,
        lastError: String(error),
      });
    });

    it("ok depuis ok -> nouveau résumé, refreshing/lastError effacés", () => {
      const failed: SummaryUi = { status: "ok", summary, lastError: "boum" };
      const nouveau: Summary = { ...summary, text: "nouveau texte" };
      expect(reduceSummary(failed, { type: "ok", summary: nouveau })).toEqual({
        status: "ok",
        summary: nouveau,
      });
    });
  });

  describe("lecture du cache sans appel LLM (Critique #1)", () => {
    it("absent depuis loading -> statut absent (aucune synthèse en cache)", () => {
      expect(reduceSummary({ status: "loading", phase: "lecture" }, { type: "absent" })).toEqual({
        status: "absent",
      });
    });

    it("absent depuis ok -> absent : le résumé d'un autre jour ne reste pas affiché", () => {
      const ok: SummaryUi = { status: "ok", summary };
      expect(reduceSummary(ok, { type: "absent" })).toEqual({ status: "absent" });
    });

    it("start depuis absent -> loading", () => {
      expect(reduceSummary({ status: "absent" }, { type: "start", phase: "lecture" })).toEqual({
        status: "loading",
        phase: "lecture",
      });
    });
  });
});
