import { isUnauthorized, type Summary } from "./activityApi";

/** État UI d'un résumé LLM (§8 du design : idle → bouton, loading → squelette, etc). */
export type SummaryUi =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; summary: Summary }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

export type SummaryEvent =
  | { type: "start" }
  | { type: "ok"; summary: Summary }
  | { type: "fail"; error: unknown };

/**
 * Réducteur pur de l'état d'un résumé. Une erreur "unauthorized: …" (jeton LLM
 * refusé) bascule sur le bandeau ambre dédié plutôt que le bandeau d'erreur
 * générique ; le message d'erreur, lui, est toujours `String(error)`.
 */
export function reduceSummary(_prev: SummaryUi, ev: SummaryEvent): SummaryUi {
  switch (ev.type) {
    case "start":
      return { status: "loading" };
    case "ok":
      return { status: "ok", summary: ev.summary };
    case "fail":
      if (isUnauthorized(ev.error)) return { status: "unauthorized" };
      return { status: "error", message: String(ev.error) };
  }
}
