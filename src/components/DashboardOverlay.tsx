import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useDashboardStore } from "../store/dashboard";
import { useWorkspaceStore } from "../store/workspace";
import { focusPane } from "../lib/paneFocus";
import { useActivityData, useSummary } from "../hooks/useActivityData";
import { activityApi, type ActivitySettings } from "../lib/activityApi";
import { formatDayTitle, formatWeekLabel, collectedAgoLabel } from "../lib/dashboardDay";
import { statsSentence } from "../lib/statsSentence";
import { assignWorkspaceColors } from "../lib/workspacePalette";
import { WorkspaceChips } from "./dashboard/WorkspaceChips";
import { Timeline } from "./dashboard/Timeline";
import { SummaryPanel, SummaryText, summaryFooter } from "./dashboard/SummaryPanel";
import { OpenTasks } from "./dashboard/OpenTasks";
import { SettingsPanel } from "./dashboard/SettingsPanel";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  GearIcon,
} from "./dashboard/icons";
import "./dashboard/dashboard.css";

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
 *
 * Mise en page « Journal » (tâche 17) : barre du haut, en-tête (titre, phrase
 * de chiffres, chips workspaces), puis deux colonnes — le bilan à gauche, la
 * chronologie à droite.
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
  const semaine = mode === "week";
  // Un seul panneau de bilan : son kind suit le mode. Le « reste à faire » est
  // toujours lu (cache seulement), il n'apparaît qu'en mode jour.
  const bilan = useSummary(semaine ? "semaine" : "bilan");
  const reste = useSummary("reste_a_faire");

  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const byWorkspace = stats?.byWorkspace ?? [];
  // Une teinte par workspace pour toute la plage affichée : chips, glyphes de
  // la chronologie et barres du mode semaine partagent la même affectation.
  const colors = useMemo(() => assignWorkspaceColors(byWorkspace), [byWorkspace]);

  // Réglages (jeton ClickUp de « Reste à faire », horaire rappelé par l'état
  // « aucune synthèse ») : lus une fois au montage puis à chaque bumpRefresh
  // (déclenché après un enregistrement par SettingsPanel), pour refléter un
  // changement sans rouvrir l'overlay.
  const [settings, setSettings] = useState<ActivitySettings | null>(null);
  useEffect(() => {
    let cancelled = false;
    activityApi
      .getSettings()
      .then((s) => {
        if (!cancelled) setSettings(s);
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
  // Un champ de formulaire (input/textarea/select) garde toutes ses touches ;
  // Échap y rend seulement le focus au conteneur, comme dans DiffOverlay. Fermer
  // l'overlay détruirait la saisie en cours (un jeton LLM tapé à la main dans
  // les réglages) sur un Échap réflexe.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const target = e.target as HTMLElement;
    const isFormField =
      target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.tagName === "SELECT";
    if (isFormField) {
      if (e.key === "Escape") containerRef.current?.focus();
      return;
    }
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
  // Les chevrons déplacent d'un jour ou d'une semaine selon le mode ; les
  // raccourcis [ et ] restent, eux, au pas d'un jour.
  const pas = semaine ? 7 : 1;

  return (
    <div ref={containerRef} tabIndex={-1} className="dash-overlay" onKeyDown={onKeyDown}>
      <div className="dash-toolbar">
        <span className="dash-toolbar-left">
          <button
            className="dash-icon-btn"
            aria-label={semaine ? "Semaine précédente" : "Jour précédent"}
            title={semaine ? "Semaine précédente" : "Jour précédent ( [ )"}
            onClick={() => shiftDay(-pas)}
          >
            <ChevronLeftIcon />
          </button>
          <button
            className="dash-icon-btn"
            aria-label={semaine ? "Semaine suivante" : "Jour suivant"}
            title={semaine ? "Semaine suivante" : "Jour suivant ( ] )"}
            onClick={() => shiftDay(pas)}
          >
            <ChevronRightIcon />
          </button>
          <button type="button" className="dash-text-btn" onClick={today}>
            {semaine ? "Cette semaine" : "Aujourd'hui"}
          </button>
          <span className="dash-sep" />
          <button
            type="button"
            className="dash-text-btn"
            aria-pressed={!semaine}
            onClick={() => setMode("day")}
          >
            Jour
          </button>
          <button
            type="button"
            className="dash-text-btn"
            aria-pressed={semaine}
            onClick={() => setMode("week")}
          >
            Semaine
          </button>
        </span>
        <span className="dash-toolbar-right">
          <span className="dash-collected" title={hasErrors ? status!.errors.join("\n") : undefined}>
            {agoLabel}
            {hasErrors && " ⚠"}
          </span>
          <button type="button" className="dash-pill" onClick={() => bumpGenerate()}>
            Regénérer la synthèse
          </button>
          <button
            className="dash-icon-btn"
            aria-label="Réglages"
            aria-pressed={settingsOpen}
            onClick={() => setSettingsOpen(!settingsOpen)}
          >
            <GearIcon />
          </button>
          <button className="dash-icon-btn" aria-label="Fermer" title="Fermer (Échap)" onClick={close}>
            <CloseIcon />
          </button>
        </span>
      </div>

      <div className="dash-header">
        <h1 className="dash-title">{semaine ? formatWeekLabel(day) : formatDayTitle(day)}</h1>
        {stats && <p className="dash-sentence">{statsSentence(stats.totals, stats.byWorkspace)}</p>}
        <WorkspaceChips rows={byWorkspace} selected={filterDir} onSelect={setFilterDir} />
      </div>

      <div className="dash-body">
        <div className="dash-left">
          {loading ? (
            <>
              <div className="dash-skeleton" style={{ height: 70 }} />
              <div className="dash-skeleton" style={{ height: 140 }} />
            </>
          ) : error ? (
            <div className="dash-banner-error">
              <p>{error}</p>
              <button type="button" className="dash-pill" onClick={reload}>
                Réessayer
              </button>
            </div>
          ) : (
            <>
              <SummaryPanel
                title={semaine ? "Bilan de la semaine" : "Bilan"}
                ui={bilan.ui}
                generate={bilan.generate}
                onOpenLink={openLink}
                schedule={settings?.schedule}
              />
              <div className="dash-section">
                <h2 className="dash-h2">Reste à faire</h2>
                <OpenTasks
                  tasks={openTasks}
                  hasToken={settings !== null && settings.clickup.token !== ""}
                  onOpen={openLink}
                />
                {/* En mode semaine, seuls les tickets restent : le texte du LLM
                    porte sur la journée. */}
                {!semaine && <SummaryText ui={reste.ui} onOpenLink={openLink} />}
              </div>
              {bilan.ui.status === "ok" && (
                <p className="dash-footnote">{summaryFooter(bilan.ui.summary)}</p>
              )}
            </>
          )}
        </div>

        <div className="dash-right">
          {settingsOpen && (
            <div className="dash-settings-overlay">
              <SettingsPanel onClose={() => setSettingsOpen(false)} />
            </div>
          )}
          <div className="dash-tl-head">
            <h2 className="dash-h2">Chronologie</h2>
            <input
              ref={filterRef}
              type="text"
              className="dash-filter"
              placeholder="filtrer"
              aria-label="Filtrer la chronologie"
              value={filterText}
              onChange={(e) => setFilterText(e.target.value)}
            />
          </div>
          <Timeline
            events={events}
            filterDir={filterDir}
            filterText={filterText}
            colors={colors}
            onOpenTicket={openLink}
          />
        </div>
      </div>
    </div>
  );
}
