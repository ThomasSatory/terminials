import { useState } from "react";
import { Markdown } from "./Markdown";
import { useSummary } from "../../hooks/useActivityData";
import { activityApi, type Summary, type SummaryKind } from "../../lib/activityApi";
import { formatHm } from "../../lib/dashboardDay";

/** Pied de résumé (§8) : « généré à HH:MM par <model> ». Fonction pure, testée sans rendu. */
export function summaryFooter(summary: Summary): string {
  return `généré à ${formatHm(summary.generatedAt)} par ${summary.model}`;
}

/**
 * Panneau de résumé LLM (Bilan / Reste à faire texte / Semaine, §8, colonne
 * droite). Pas de test de rendu (dépend du hook + de `invoke`) : voir
 * `summaryFooter` ci-dessus pour la partie pure testée.
 */
export function SummaryPanel({
  kind,
  title,
  onOpenLink,
}: {
  kind: SummaryKind;
  title: string;
  onOpenLink: (href: string) => void;
}) {
  const { ui, generate } = useSummary(kind);
  const [tokenInput, setTokenInput] = useState("");
  const [savingToken, setSavingToken] = useState(false);

  async function saveTokenAndRetry() {
    setSavingToken(true);
    try {
      const settings = await activityApi.getSettings();
      settings.llm.token = tokenInput;
      await activityApi.setSettings(settings);
      generate(true);
    } finally {
      setSavingToken(false);
    }
  }

  return (
    <div className="dash-card dash-summary">
      <h3>{title}</h3>

      {ui.status === "idle" && (
        <button type="button" onClick={() => generate(false)}>
          Générer
        </button>
      )}

      {ui.status === "loading" && <div className="dash-skeleton" />}

      {/* Cache vide : ce n'est pas une erreur, la génération reste un geste explicite. */}
      {ui.status === "absent" && (
        <>
          <p>Aucune synthèse pour ce jour</p>
          <button type="button" onClick={() => generate(false)}>
            Générer maintenant
          </button>
        </>
      )}

      {ui.status === "ok" && (
        <>
          <Markdown text={ui.summary.text} onOpenLink={onOpenLink} />
          <p className="dash-summary-footer">
            {summaryFooter(ui.summary)}{" "}
            <button type="button" onClick={() => generate(true)} aria-label="Régénérer">
              {ui.refreshing ? "…" : "↻"}
            </button>
          </p>
          {/* Un échec de régénération ne doit jamais faire disparaître le résumé en
              cache (§10) : on l'affiche toujours ci-dessus, avec un bandeau d'erreur
              en plus plutôt qu'à sa place. */}
          {ui.lastError === "unauthorized" && (
            <div className="dash-banner dash-banner-warning">
              <p>Jeton LLM expiré</p>
              <input
                className="dash-input"
                type="password"
                value={tokenInput}
                placeholder="Nouveau jeton"
                onChange={(e) => setTokenInput(e.target.value)}
              />
              <button type="button" onClick={saveTokenAndRetry} disabled={savingToken}>
                Valider
              </button>
            </div>
          )}
          {ui.lastError !== undefined && ui.lastError !== "unauthorized" && (
            <div className="dash-banner dash-banner-error">
              <p>{ui.lastError}</p>
              <button type="button" onClick={() => generate(true)}>
                Réessayer
              </button>
            </div>
          )}
        </>
      )}

      {ui.status === "unauthorized" && (
        <div className="dash-banner dash-banner-warning">
          <p>Jeton LLM expiré</p>
          <input
            className="dash-input"
            type="password"
            value={tokenInput}
            placeholder="Nouveau jeton"
            onChange={(e) => setTokenInput(e.target.value)}
          />
          <button type="button" onClick={saveTokenAndRetry} disabled={savingToken}>
            Valider
          </button>
        </div>
      )}

      {ui.status === "error" && (
        <div className="dash-banner dash-banner-error">
          <p>{ui.message}</p>
          <button type="button" onClick={() => generate(false)}>
            Réessayer
          </button>
        </div>
      )}
    </div>
  );
}
