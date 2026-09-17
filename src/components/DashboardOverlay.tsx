import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useDashboardStore } from "../store/dashboard";
import { useWorkspaceStore } from "../store/workspace";
import { focusPane } from "../lib/paneFocus";
import { useActivityData } from "../hooks/useActivityData";
import { activityApi } from "../lib/activityApi";
import { formatDayLabel, collectedAgoLabel } from "../lib/dashboardDay";
import { StatTiles } from "./dashboard/StatTiles";
import { HourChart } from "./dashboard/HourChart";
import { WorkspaceBars } from "./dashboard/WorkspaceBars";
import { Timeline } from "./dashboard/Timeline";
import { SummaryPanel } from "./dashboard/SummaryPanel";
import { OpenTasks } from "./dashboard/OpenTasks";
import { SettingsPanel } from "./dashboard/SettingsPanel";

/** Ouvre un lien externe (ticket ClickUp, lien markdown du résumé) via le plugin opener,
    plutôt que la navigation par défaut du webview. */
function openLink(href: string): void {
  void openUrl(href);
}

/**
 * Overlay global du dashboard d'activité (§8 du design), sur le même modèle que
 * `DiffOverlay` : conteneur focusable superposé à la grille, raccourcis clavier
 * propres au conteneur (aucun listener `window`). N'est jamais lié à un
 * workspace : ouvert même quand aucun workspace n'existe.
 */
export function DashboardOverlay() {
  const day = useDashboardStore((s) => s.day);
  const mode = useDashboardStore((s) => s.mode);
  const filterDir = useDashboardStore((s) => s.filterDir);
  const filterText = useDashboardStore((s) => s.filterText);
  const settingsOpen = useDashboardStore((s) => s.settingsOpen);
  const refreshTick = useDashboardStore((s) => s.refreshTick);
  const close = useDashboardStore((s) => s.close);
  const shiftDay = useDashboardStore((s) => s.shiftDay);
  const today = useDashboardStore((s) => s.today);
  const setMode = useDashboardStore((s) => s.setMode);
  const setFilterDir = useDashboardStore((s) => s.setFilterDir);
  const setFilterText = useDashboardStore((s) => s.setFilterText);
  const setSettingsOpen = useDashboardStore((s) => s.setSettingsOpen);
  const bumpGenerate = useDashboardStore((s) => s.bumpGenerate);

  const { loading, events, stats, openTasks, status, error, reload } = useActivityData();

  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  // Home résolu une fois (comme la Sidebar) : abrège l'affichage des répertoires
  // de la timeline. Tant qu'il est vide/indisponible, Timeline affiche le chemin complet.
  const [home, setHome] = useState<string | undefined>(undefined);
  useEffect(() => {
    homeDir()
      .then(setHome)
      .catch(() => {});
  }, []);

  // Présence d'un token ClickUp (section « Reste à faire », §8) : lue une fois
  // au montage puis à chaque bumpRefresh (déclenché après un enregistrement des
  // réglages par SettingsPanel), pour refléter l'ajout d'un token sans rouvrir.
  const [clickupToken, setClickupToken] = useState<string>("");
  useEffect(() => {
    let cancelled = false;
    activityApi
      .getSettings()
      .then((s) => {
        if (!cancelled) setClickupToken(s.clickup.token);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [refreshTick]);

  // Focus au montage (blur implicite du textarea xterm) ; au démontage, le
  // focus revient au terminal actif — même contrat que DiffOverlay.
  useEffect(() => {
    containerRef.current?.focus();
    return () => {
      const s = useWorkspaceStore.getState();
      const w = s.workspaces.find((x) => x.id === s.activeId);
      if (w?.activePaneId) focusPane(w.activePaneId);
    };
  }, []);

  // Clavier de l'overlay — uniquement sur le conteneur focusé (spec §4/§8).
  // Un champ de formulaire (input/textarea/select) garde ses touches, sauf Échap
  // qui ferme toujours l'overlay (réglages, filtre, jeton LLM…).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const isFormField =
      target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
    if (isFormField && e.key !== "Escape") return;
    switch (e.key) {
      case "Escape":
        close();
        break;
      case "[":
        shiftDay(-1);
        break;
      case "]":
        shiftDay(1);
        break;
      case "/":
        e.preventDefault();
        filterRef.current?.focus();
        break;
    }
  };

  const agoLabel = collectedAgoLabel(status?.lastCollect ?? {}, Math.floor(Date.now() / 1000));
  const hasErrors = (status?.errors.length ?? 0) > 0;

  return (
    <div ref={containerRef} tabIndex={-1} className="dash-overlay" onKeyDown={onKeyDown}>
      <div className="dash-toolbar">
        <span className="dash-toolbar-left" style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <button className="icon-btn" title="Jour précédent ( [ )" onClick={() => shiftDay(-1)}>
            ◂
          </button>
          <span>{formatDayLabel(day)}</span>
          <button className="icon-btn" title="Jour suivant ( ] )" onClick={() => shiftDay(1)}>
            ▸
          </button>
          <button type="button" onClick={today}>
            Aujourd'hui
          </button>
          <span className="dash-seg">
            <button type="button" aria-pressed={mode === "day"} onClick={() => setMode("day")}>
              Jour
            </button>
            <button type="button" aria-pressed={mode === "week"} onClick={() => setMode("week")}>
              Semaine
            </button>
          </span>
        </span>
        <span className="dash-toolbar-right" style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <span style={{ color: "#8a8a8a" }} title={hasErrors ? status!.errors.join("\n") : undefined}>
            {agoLabel}
            {hasErrors && " ⚠"}
          </span>
          <button type="button" onClick={() => bumpGenerate()}>
            Générer maintenant
          </button>
          <button
            className="icon-btn"
            title="Réglages"
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            ⚙
          </button>
          <button className="icon-btn" title="Fermer (Échap)" onClick={close}>
            ×
          </button>
        </span>
      </div>

      <div className="dash-body">
        <div className="dash-left">
          {loading ? (
            <>
              <div className="dash-skeleton" style={{ height: 70 }} />
              <div className="dash-skeleton" style={{ height: 140 }} />
              <div className="dash-skeleton" style={{ height: 90 }} />
              <div className="dash-skeleton" style={{ height: 200 }} />
            </>
          ) : error ? (
            <div className="dash-banner dash-banner-err">
              <p>{error}</p>
              <button type="button" onClick={reload}>
                Réessayer
              </button>
            </div>
          ) : (
            <>
              <StatTiles totals={stats!.totals} />
              <div className="dash-card">
                <HourChart
                  data={
                    mode === "day"
                      ? { kind: "hour", byHour: stats!.byHour }
                      : { kind: "day", byDay: stats!.byDay }
                  }
                />
              </div>
              <WorkspaceBars rows={stats!.byWorkspace} selected={filterDir} onSelect={setFilterDir} />
              <input
                ref={filterRef}
                className="dash-input"
                placeholder="filtrer ( / )"
                value={filterText}
                onChange={(e) => setFilterText(e.target.value)}
              />
              {events.length === 0 ? (
                <p style={{ color: "#6f6f6f" }}>Aucune activité ce jour</p>
              ) : (
                <Timeline
                  events={events}
                  filterDir={filterDir}
                  filterText={filterText}
                  onOpenTicket={openLink}
                  home={home}
                />
              )}
            </>
          )}
        </div>

        <div className="dash-right" style={{ position: "relative" }}>
          {settingsOpen && (
            <div
              style={{
                position: "absolute",
                inset: 0,
                zIndex: 5,
                background: "#1e1e1e",
                overflow: "auto",
              }}
            >
              <SettingsPanel onClose={() => setSettingsOpen(false)} />
            </div>
          )}
          {mode === "day" ? (
            <>
              <SummaryPanel kind="bilan" title="Bilan" onOpenLink={openLink} />
              <OpenTasks tasks={openTasks} hasToken={clickupToken !== ""} onOpen={openLink} />
              <SummaryPanel kind="reste_a_faire" title="Reste à faire" onOpenLink={openLink} />
            </>
          ) : (
            <SummaryPanel kind="semaine" title="Semaine" onOpenLink={openLink} />
          )}
        </div>
      </div>
    </div>
  );
}
