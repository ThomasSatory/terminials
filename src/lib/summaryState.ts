import { isUnauthorized, type Summary } from "./activityApi";

/**
 * État UI d'un résumé LLM (§8 du design : idle → bouton, loading → squelette,
 * etc). Quand une régénération (`generate(true)`) échoue alors qu'un résumé
 * est déjà affiché, le résumé en cache n'est jamais écrasé (§10) : `ok` gagne
 * alors `refreshing` (régénération en cours) et `lastError` (échec de la
 * dernière régénération, `"unauthorized"` pour un jeton LLM refusé, sinon
 * `String(error)`) plutôt que de basculer sur les statuts `unauthorized`/
 * `error` — ceux-ci ne servent qu'au tout premier chargement (pas de résumé
 * en cache à préserver).
 */
export type SummaryUi =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ok"; summary: Summary; refreshing?: boolean; lastError?: string }
  | { status: "unauthorized" }
  | { status: "error"; message: string };

export type SummaryEvent =
  | { type: "start" }
  | { type: "ok"; summary: Summary }
  | { type: "fail"; error: unknown };

/**
 * Réducteur pur de l'état d'un résumé. Une erreur "unauthorized: …" (jeton LLM
 * refusé) bascule sur le bandeau ambre dédié plutôt que le bandeau d'erreur
 * générique ; le message d'erreur, lui, est toujours `String(error)`. Voir la
 * doc de `SummaryUi` pour le cas d'une régénération qui échoue alors qu'un
 * résumé est déjà affiché.
 */
export function reduceSummary(prev: SummaryUi, ev: SummaryEvent): SummaryUi {
  switch (ev.type) {
    case "start":
      if (prev.status === "ok") return { ...prev, refreshing: true, lastError: undefined };
      return { status: "loading" };
    case "ok":
      return { status: "ok", summary: ev.summary };
    case "fail":
      if (prev.status === "ok") {
        return {
          ...prev,
          refreshing: false,
          lastError: isUnauthorized(ev.error) ? "unauthorized" : String(ev.error),
        };
      }
      if (isUnauthorized(ev.error)) return { status: "unauthorized" };
      return { status: "error", message: String(ev.error) };
  }
}
