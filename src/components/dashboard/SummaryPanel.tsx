import { useState } from "react";
import { FoldedMarkdown } from "./Fold";
import { activityApi, type ActivitySettings, type Summary } from "../../lib/activityApi";
import { formatHm } from "../../lib/dashboardDay";
import type { SummaryUi } from "../../lib/summaryState";

type Schedule = ActivitySettings["schedule"];

/** Pied de la colonne gauche : « Synthèse générée à HH:MM par <model> ». Pur, testé sans rendu. */
export function summaryFooter(summary: Summary): string {
  return `Synthèse générée à ${formatHm(summary.generatedAt)} par ${summary.model}`;
}

/**
 * Phrase de rappel de la génération automatique, affichée sous le bouton quand
 * aucune synthèse n'existe. Construite depuis les réglages réels : inutile de
 * promettre 7 h du lundi au vendredi si l'utilisateur a changé l'horaire.
 */
export function scheduleSentence(schedule: Schedule): string {
  const heure = schedule.minute === 0 ? `${schedule.hour} h` : `${schedule.hour} h ${schedule.minute}`;
  const jours = schedule.weekdaysOnly ? "du lundi au vendredi" : "chaque jour";
  return `La synthèse se génère seule à ${heure} ${jours}.`;
}

/** Saisie d'un nouveau jeton LLM après un refus, puis nouvelle tentative. */
function TokenExpire({ generate }: { generate: (force: boolean) => void }) {
  const [token, setToken] = useState("");
  const [saving, setSaving] = useState(false);

  async function enregistrerPuisReessayer() {
    setSaving(true);
    try {
      const settings = await activityApi.getSettings();
      settings.llm.token = token;
      await activityApi.setSettings(settings);
      generate(true);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dash-banner-warning">
      <p>Jeton LLM expiré</p>
      <input
        className="dash-field"
        type="password"
        value={token}
        placeholder="Nouveau jeton"
        onChange={(e) => setToken(e.target.value)}
      />
      <button type="button" className="dash-pill" onClick={enregistrerPuisReessayer} disabled={saving}>
        Valider
      </button>
    </div>
  );
}

/**
 * Bilan du jour ou de la semaine (colonne gauche, tâche 17) : un titre serif
 * laiton et la prose du LLM, repliée au premier bloc (cf. `FoldedMarkdown`).
 * Composant de présentation pur — l'état vient du hook `useSummary` tenu par
 * l'overlay, qui a besoin du même résumé pour le pied de colonne.
 */
export function SummaryPanel({
  title,
  ui,
  generate,
  onOpenLink,
  schedule,
}: {
  title: string;
  ui: SummaryUi;
  generate: (force: boolean) => void;
  onOpenLink: (href: string) => void;
  schedule?: Schedule;
}) {
  return (
    <div className="dash-section">
      <h2 className="dash-h2">{title}</h2>

      {(ui.status === "loading" || ui.status === "idle") && (
        <div className="dash-skeleton" style={{ height: 90 }} />
      )}

      {/* Cache vide : ce n'est pas une erreur, la génération reste un geste explicite. */}
      {ui.status === "absent" && (
        <div className="dash-absent">
          <p className="dash-absent-text">Aucune synthèse pour cette journée.</p>
          <div className="dash-absent-actions">
            <button
              type="button"
              className="dash-pill dash-pill-accent"
              onClick={() => generate(false)}
            >
              Générer la synthèse
            </button>
          </div>
          {schedule && <p className="dash-absent-note">{scheduleSentence(schedule)}</p>}
        </div>
      )}

      {ui.status === "ok" && (
        <>
          <FoldedMarkdown
            text={ui.summary.text}
            onOpenLink={onOpenLink}
            className="dash-prose"
          />
          {/* Un échec de régénération ne doit jamais faire disparaître le résumé en
              cache (§10) : on l'affiche toujours ci-dessus, avec un bandeau d'erreur
              en plus plutôt qu'à sa place. */}
          {ui.lastError === "unauthorized" && <TokenExpire generate={generate} />}
          {ui.lastError !== undefined && ui.lastError !== "unauthorized" && (
            <div className="dash-banner-error">
              <p>{ui.lastError}</p>
              <button type="button" className="dash-pill" onClick={() => generate(true)}>
                Réessayer
              </button>
            </div>
          )}
        </>
      )}

      {ui.status === "unauthorized" && <TokenExpire generate={generate} />}

      {ui.status === "error" && (
        <div className="dash-banner-error">
          <p>{ui.message}</p>
          <button type="button" className="dash-pill" onClick={() => generate(false)}>
            Réessayer
          </button>
        </div>
      )}
    </div>
  );
}

/**
 * Texte « reste à faire » du LLM, rendu **sous** les tickets ClickUp et sur la
 * même grille (repère « note » à gauche, cf. `dashboard.css`). Tant qu'aucune
 * synthèse n'existe, rien ne s'affiche : les tickets suffisent, et le bouton de
 * génération vit dans le bilan juste au-dessus.
 */
export function SummaryText({
  ui,
  onOpenLink,
}: {
  ui: SummaryUi;
  onOpenLink: (href: string) => void;
}) {
  if (ui.status !== "ok") return null;
  return <FoldedMarkdown text={ui.summary.text} onOpenLink={onOpenLink} className="dash-reste" />;
}
