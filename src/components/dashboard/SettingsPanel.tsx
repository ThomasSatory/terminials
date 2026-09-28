import { useEffect, useState } from "react";
import { activityApi, type ActivitySettings } from "../../lib/activityApi";
import { useDashboardStore } from "../../store/dashboard";

/** "clé: valeur" (une par ligne) <-> objet d'en-têtes HTTP supplémentaires. */
function headersToText(headers: Record<string, string>): string {
  return Object.entries(headers)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n");
}

function textToHeaders(text: string): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    if (key) headers[key] = value;
  }
  return headers;
}

function listToText(items: string[], sep: string): string {
  return items.join(sep);
}

function textToList(text: string, sep: RegExp): string[] {
  return text
    .split(sep)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/**
 * Vrai si le fournisseur LLM choisi expose des réglages détaillés (URL, modèle,
 * jeton, en-têtes, température, max tokens). `claude -p` n'en a aucun : il tourne
 * toujours sur Sonnet et s'authentifie tout seul.
 */
/** « 7.5 » (heures, champ numérique) → 450 minutes, au quart d'heure ; vide ou invalide → 0. */
export function heuresEnMinutes(texte: string): number {
  const h = Number(texte.replace(",", "."));
  return Number.isFinite(h) && h > 0 ? Math.round((h * 60) / 15) * 15 : 0;
}

export function champsLlmDetailles(provider: ActivitySettings["llm"]["provider"]): boolean {
  return provider !== "claude_cli";
}

/**
 * Panneau latéral droit « Réglages » (§8/§9) : formulaire complet des
 * réglages persistés, aux champs soulignés des jetons « Journal » (aucune
 * logique n'a changé avec la refonte, seulement l'habillage). Charge `getSettings` au montage ; « Enregistrer »
 * appelle `setSettings` puis `collectNow` puis rafraîchit le dashboard
 * (`bumpRefresh`) pour que les nouvelles données apparaissent immédiatement.
 */
export function SettingsPanel({ onClose }: { onClose: () => void }) {
  const bumpRefresh = useDashboardStore((s) => s.bumpRefresh);

  const [settings, setSettings] = useState<ActivitySettings | null>(null);
  const [extraHeadersText, setExtraHeadersText] = useState("");
  const [ignoredCommandsText, setIgnoredCommandsText] = useState("");
  const [ticketPatternsText, setTicketPatternsText] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    activityApi
      .getSettings()
      .then((s) => {
        if (cancelled) return;
        setSettings(s);
        setExtraHeadersText(headersToText(s.llm.extraHeaders));
        setIgnoredCommandsText(listToText(s.shell.ignoredCommands, ", "));
        setTicketPatternsText(listToText(s.ticketPatterns, "\n"));
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (!settings) {
    return (
      <div className="dash-settings">
        <div className="dash-skeleton" />
      </div>
    );
  }

  function update(patch: Partial<ActivitySettings>) {
    setSettings((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  async function handleSave() {
    if (!settings) return;
    setSaving(true);
    setError(null);
    try {
      const toSave: ActivitySettings = {
        ...settings,
        llm: { ...settings.llm, extraHeaders: textToHeaders(extraHeadersText) },
        shell: {
          ...settings.shell,
          ignoredCommands: textToList(ignoredCommandsText, /,/),
        },
        ticketPatterns: textToList(ticketPatternsText, /\n/),
      };
      await activityApi.setSettings(toSave);
      await activityApi.collectNow();
      bumpRefresh();
    } catch (err) {
      setError(String(err));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dash-settings">
      {error && <p className="dash-banner-error">{error}</p>}

      <label>
        Fournisseur
        <select
          className="dash-field"
          value={settings.llm.provider}
          onChange={(e) =>
            update({
              llm: {
                ...settings.llm,
                provider: e.target.value as ActivitySettings["llm"]["provider"],
              },
            })
          }
        >
          <option value="claude_cli">Claude Code (claude -p)</option>
          <option value="openai">Gemma / API OpenAI compatible</option>
          <option value="ollama">Ollama</option>
        </select>
      </label>

      {!champsLlmDetailles(settings.llm.provider) && (
        <p className="dash-settings-note">Modèle : sonnet (claude -p)</p>
      )}

      {champsLlmDetailles(settings.llm.provider) && (
        <>
          <label>
            URL de base
            <input
              className="dash-field"
              type="text"
              value={settings.llm.baseUrl}
              onChange={(e) => update({ llm: { ...settings.llm, baseUrl: e.target.value } })}
            />
          </label>

          <label>
            Modèle
            <input
              className="dash-field"
              type="text"
              value={settings.llm.model}
              onChange={(e) => update({ llm: { ...settings.llm, model: e.target.value } })}
            />
          </label>

          <label>
            Jeton LLM
            <input
              className="dash-field"
              type="password"
              value={settings.llm.token}
              onChange={(e) => update({ llm: { ...settings.llm, token: e.target.value } })}
            />
          </label>

          <label>
            En-têtes supplémentaires (une par ligne, « clé: valeur »)
            <textarea
              className="dash-field"
              value={extraHeadersText}
              onChange={(e) => setExtraHeadersText(e.target.value)}
            />
          </label>

          <label>
            Température
            <input
              className="dash-field"
              type="number"
              step="0.1"
              value={settings.llm.temperature}
              onChange={(e) =>
                update({ llm: { ...settings.llm, temperature: Number(e.target.value) } })
              }
            />
          </label>

          <label>
            Max tokens
            <input
              className="dash-field"
              type="number"
              value={settings.llm.maxTokens}
              onChange={(e) =>
                update({ llm: { ...settings.llm, maxTokens: Number(e.target.value) } })
              }
            />
          </label>
        </>
      )}

      <label>
        Source ClickUp
        <select
          className="dash-field"
          value={settings.clickup.source}
          onChange={(e) =>
            update({
              clickup: {
                ...settings.clickup,
                source: e.target.value as ActivitySettings["clickup"]["source"],
              },
            })
          }
        >
          <option value="claude_mcp">Claude Code (MCP ClickUp)</option>
          <option value="api">Clé API</option>
          <option value="off">Désactivé</option>
        </select>
      </label>

      {settings.clickup.source === "claude_mcp" && (
        <p className="dash-settings-note">
          Interroge ClickUp via claude -p (Sonnet), une fois par heure. Environ 1 à 2 minutes par
          collecte.
        </p>
      )}

      {settings.clickup.source === "api" && (
        <label>
          Token ClickUp
          <input
            className="dash-field"
            type="password"
            value={settings.clickup.token}
            onChange={(e) => update({ clickup: { ...settings.clickup, token: e.target.value } })}
          />
        </label>
      )}

      <label>
        Heure de génération
        <input
          className="dash-field"
          type="number"
          min={0}
          max={23}
          value={settings.schedule.hour}
          onChange={(e) =>
            update({ schedule: { ...settings.schedule, hour: Number(e.target.value) } })
          }
        />
      </label>

      <label>
        Minute
        <input
          className="dash-field"
          type="number"
          min={0}
          max={59}
          value={settings.schedule.minute}
          onChange={(e) =>
            update({ schedule: { ...settings.schedule, minute: Number(e.target.value) } })
          }
        />
      </label>

      <label className="dash-settings-check">
        <input
          type="checkbox"
          checked={settings.schedule.weekdaysOnly}
          onChange={(e) =>
            update({ schedule: { ...settings.schedule, weekdaysOnly: e.target.checked } })
          }
        />
        Jours ouvrés seulement
      </label>

      <label className="dash-settings-check">
        <input
          type="checkbox"
          checked={settings.shell.integration}
          onChange={(e) => update({ shell: { ...settings.shell, integration: e.target.checked } })}
        />
        Intégration shell
      </label>

      <label>
        Commandes ignorées (séparées par des virgules)
        <input
          className="dash-field"
          type="text"
          value={ignoredCommandsText}
          onChange={(e) => setIgnoredCommandsText(e.target.value)}
        />
      </label>

      <label>
        E-mail git
        <input
          className="dash-field"
          type="text"
          value={settings.git.authorEmail ?? ""}
          onChange={(e) => update({ git: { authorEmail: e.target.value || null } })}
        />
      </label>

      <label>
        Motifs de tickets (un par ligne)
        <textarea
          className="dash-field"
          value={ticketPatternsText}
          onChange={(e) => setTicketPatternsText(e.target.value)}
        />
      </label>

      <label>
        Heures à saisir du lundi au jeudi
        <input
          className="dash-field"
          type="number"
          min={0}
          max={24}
          step={0.25}
          value={settings.saisie.journeeMinutes / 60}
          onChange={(e) =>
            update({ saisie: { ...settings.saisie, journeeMinutes: heuresEnMinutes(e.target.value) } })
          }
        />
      </label>

      <label>
        Heures à saisir le vendredi
        <input
          className="dash-field"
          type="number"
          min={0}
          max={24}
          step={0.25}
          value={settings.saisie.vendrediMinutes / 60}
          onChange={(e) =>
            update({ saisie: { ...settings.saisie, vendrediMinutes: heuresEnMinutes(e.target.value) } })
          }
        />
      </label>

      <label>
        US de réunion (vide : l'US « Réunion » du sprint en cours)
        <input
          className="dash-field"
          type="text"
          placeholder="ABC-123"
          value={settings.saisie.usReunion}
          onChange={(e) => update({ saisie: { ...settings.saisie, usReunion: e.target.value.trim() } })}
        />
      </label>

      <div className="dash-settings-actions">
        <button
          type="button"
          className="dash-pill dash-pill-accent"
          onClick={handleSave}
          disabled={saving}
        >
          Enregistrer
        </button>
        <button type="button" className="dash-pill" onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  );
}
