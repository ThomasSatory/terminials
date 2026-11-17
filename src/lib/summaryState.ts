import type { Summary } from "./activityApi";

/**
 * État UI d'un résumé LLM (§8 du design : idle → bouton, loading → squelette,
 * etc). `absent` est le résultat d'une lecture de cache qui ne trouve rien
 * (`activity_summary_cached` → `null`) : ce n'est pas une erreur, juste « aucune
 * synthèse pour ce jour », avec le bouton de génération — le chargement
 * automatique ne doit jamais déclencher d'appel LLM (Critique #1). Quand une
 * régénération (`generate(true)`) échoue alors qu'un résumé
 * est déjà affiché, le résumé en cache n'est jamais écrasé (§10) : `ok` gagne
 * alors `refreshing` (régénération en cours) et `lastError` (échec de la
 * dernière régénération, `String(error)`)
 * plutôt que de basculer sur le statut `error` — celui-ci ne sert qu'au tout premier chargement (pas de résumé
 * en cache à préserver).
 *
 * Deux chargements très différents passent par ces états, et l'interface ne doit pas les
 * confondre : la LECTURE du cache (ouverture, changement de jour, collecte — gratuite,
 * quelques millisecondes) et la RÉDACTION demandée par l'utilisateur (appel LLM, des
 * dizaines de secondes, « Rédaction… » et icône qui tourne). `phase` (en chargement) et
 * `refreshing` (résumé déjà affiché) disent lequel est en cours ; `reecrit` marque un
 * résumé qui vient d'une rédaction faite ici (« Bilan réécrit à l'instant »).
 */
export type PhaseResume = "lecture" | "redaction";

export type SummaryUi =
  | { status: "idle" }
  | { status: "loading"; phase: PhaseResume }
  | { status: "absent" }
  | { status: "ok"; summary: Summary; reecrit?: boolean; refreshing?: PhaseResume; lastError?: string }
  | { status: "error"; message: string };

export type SummaryEvent =
  | { type: "start"; phase: PhaseResume }
  | { type: "ok"; summary: Summary; reecrit?: boolean }
  | { type: "absent" }
  | { type: "fail"; error: unknown };

/** Une rédaction (appel LLM) est en cours, résumé affiché ou non. */
export function redactionEnCours(ui: SummaryUi): boolean {
  return (ui.status === "loading" && ui.phase === "redaction") || (ui.status === "ok" && ui.refreshing === "redaction");
}

/**
 * Réducteur pur de l'état d'un résumé. Le message d'erreur est toujours
 * `String(error)`. Voir la
 * doc de `SummaryUi` pour le cas d'une régénération qui échoue alors qu'un
 * résumé est déjà affiché.
 */
export function reduceSummary(prev: SummaryUi, ev: SummaryEvent): SummaryUi {
  switch (ev.type) {
    case "start":
      if (prev.status === "ok") return { ...prev, refreshing: ev.phase, lastError: undefined };
      return { status: "loading", phase: ev.phase };
    case "ok":
      return ev.reecrit ? { status: "ok", summary: ev.summary, reecrit: true } : { status: "ok", summary: ev.summary };
    case "absent":
      // Contrairement à `fail`, on n'a rien à préserver : un cache vide est la
      // vérité pour le jour demandé. Garder le résumé précédent afficherait
      // celui de la veille après un changement de jour.
      return { status: "absent" };
    case "fail":
      if (prev.status === "ok") {
        return {
          ...prev,
          refreshing: undefined,
          lastError: String(ev.error),
        };
      }
      return { status: "error", message: String(ev.error) };
  }
}
