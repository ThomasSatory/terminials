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
 * Panneau latéral droit « Réglages » (§8/§9) : formulaire complet des
 * réglages persistés. Charge `getSettings` au montage ; « Enregistrer »
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
      <div className="dash-card dash-settings">
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
    <div className="dash-card dash-settings">
      {error && <p className="dash-banner dash-banner-error">{error}</p>}

      <label>
        Fournisseur
        <select
          className="dash-input"
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
          <option value="openai">openai</option>
          <option value="ollama">ollama</option>
          <option value="claude_cli">claude_cli</option>
        </select>
      </label>

      <label>
        URL de base
        <input
          className="dash-input"
          type="text"
          value={settings.llm.baseUrl}
          onChange={(e) => update({ llm: { ...settings.llm, baseUrl: e.target.value } })}
        />
      </label>

      <label>
        Modèle
        <input
          className="dash-input"
          type="text"
          value={settings.llm.model}
          onChange={(e) => update({ llm: { ...settings.llm, model: e.target.value } })}
        />
      </label>

      <label>
        Jeton LLM
        <input
          className="dash-input"
          type="password"
          value={settings.llm.token}
          onChange={(e) => update({ llm: { ...settings.llm, token: e.target.value } })}
        />
      </label>

      <label>
        En-têtes supplémentaires (une par ligne, « clé: valeur »)
        <textarea
          className="dash-input"
          value={extraHeadersText}
          onChange={(e) => setExtraHeadersText(e.target.value)}
        />
      </label>

      <label>
        Température
        <input
          className="dash-input"
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
          className="dash-input"
          type="number"
          value={settings.llm.maxTokens}
          onChange={(e) => update({ llm: { ...settings.llm, maxTokens: Number(e.target.value) } })}
        />
      </label>

      <label>
        Token ClickUp
        <input
          className="dash-input"
          type="password"
          value={settings.clickup.token}
          onChange={(e) => update({ clickup: { token: e.target.value } })}
        />
      </label>

      <label>
        Heure de génération
        <input
          className="dash-input"
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
          className="dash-input"
          type="number"
          min={0}
          max={59}
          value={settings.schedule.minute}
          onChange={(e) =>
            update({ schedule: { ...settings.schedule, minute: Number(e.target.value) } })
          }
        />
      </label>

      <label>
        <input
          type="checkbox"
          checked={settings.schedule.weekdaysOnly}
          onChange={(e) =>
            update({ schedule: { ...settings.schedule, weekdaysOnly: e.target.checked } })
          }
        />
        Jours ouvrés seulement
      </label>

      <label>
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
          className="dash-input"
          type="text"
          value={ignoredCommandsText}
          onChange={(e) => setIgnoredCommandsText(e.target.value)}
        />
      </label>

      <label>
        E-mail git
        <input
          className="dash-input"
          type="text"
          value={settings.git.authorEmail ?? ""}
          onChange={(e) => update({ git: { authorEmail: e.target.value || null } })}
        />
      </label>

      <label>
        Motifs de tickets (un par ligne)
        <textarea
          className="dash-input"
          value={ticketPatternsText}
          onChange={(e) => setTicketPatternsText(e.target.value)}
        />
      </label>

      <div className="dash-settings-actions">
        <button type="button" onClick={handleSave} disabled={saving}>
          Enregistrer
        </button>
        <button type="button" onClick={onClose}>
          Fermer
        </button>
      </div>
    </div>
  );
}
