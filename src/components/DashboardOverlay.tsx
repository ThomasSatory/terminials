import { useEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useDashboardStore } from "../store/dashboard";
import { useWorkspaceStore } from "../store/workspace";
import { focusTab } from "../lib/tabFocus";
import { useActivityData, useSummary } from "../hooks/useActivityData";
import { activityApi, clickupActif, type ActivitySettings } from "../lib/activityApi";
import {
  formatDayTitle,
  formatWeekLabel,
  collectedAgoLabel,
  weekRange,
  todayString,
} from "../lib/dashboardDay";
import { statsSentence } from "../lib/statsSentence";
import { assignWorkspaceColors } from "../lib/workspacePalette";
import { buildWeekDays } from "../lib/weekDays";
import { buildFrise } from "../lib/frise";
import { splitTitle } from "../lib/summaryTitle";
import { attacherPuces } from "../lib/friseBilan";
import { Frise } from "./dashboard/Frise";
import { Timeline } from "./dashboard/Timeline";
import { WeekDays } from "./dashboard/WeekDays";
import { SummaryPanel, summaryFooter } from "./dashboard/SummaryPanel";
import { OpenTasks } from "./dashboard/OpenTasks";
import { SettingsPanel } from "./dashboard/SettingsPanel";
import {
  ChevronLeftIcon,
  ChevronRightIcon,
  CloseIcon,
  GearIcon,
  RefreshIcon,
} from "./dashboard/icons";
import "./dashboard/dashboard.css";

/** Ouvre un lien externe (ticket ClickUp, lien markdown du résumé) via le plugin opener,
    plutôt que la navigation par défaut du webview. */
function openLink(href: string): void {
  void openUrl(href);
}

/**
 * Overlay global du dashboard d'activité, sur le même modèle que `DiffOverlay` :
 * conteneur focusable superposé à la grille, raccourcis clavier propres au
 * conteneur (aucun listener `window`). N'est jamais lié à un workspace.
 *
 * Mise en page « un écran » (2026-09-22) : barre du haut, en-tête (date, titre
 * de journée écrit par le LLM, phrase de chiffres), frise d'activité par
 * projet — chaque ligne porte la phrase du bilan LLM pour ce projet —, puis
 * deux colonnes courtes : le reste du bilan (ou sa mention de génération) et
 * les tickets. La chronologie détaillée et le jour par jour vivent dans un
 * volet à droite (touche `d`), les réglages dans le même volet (⚙).
 */
export function DashboardOverlay() {
  const day = useDashboardStore((s) => s.day);
  const mode = useDashboardStore((s) => s.mode);
  const filterDir = useDashboardStore((s) => s.filterDir);
  const filterText = useDashboardStore((s) => s.filterText);
  const settingsOpen = useDashboardStore((s) => s.settingsOpen);
  const detailsOpen = useDashboardStore((s) => s.detailsOpen);
  const refreshTick = useDashboardStore((s) => s.refreshTick);
  const close = useDashboardStore((s) => s.close);
  const shiftDay = useDashboardStore((s) => s.shiftDay);
  const today = useDashboardStore((s) => s.today);
  const setDay = useDashboardStore((s) => s.setDay);
  const setMode = useDashboardStore((s) => s.setMode);
  const setFilterText = useDashboardStore((s) => s.setFilterText);
  const setSettingsOpen = useDashboardStore((s) => s.setSettingsOpen);
  const setDetailsOpen = useDashboardStore((s) => s.setDetailsOpen);
  const bumpGenerate = useDashboardStore((s) => s.bumpGenerate);

  const { loading, events, stats, openTasks, status, error, reload } = useActivityData();
  const semaine = mode === "week";
  // Un seul bilan : son kind suit le mode. Le « reste à faire » du LLM n'est
  // plus affiché : les tickets du sprint suffisent.
  const bilan = useSummary(semaine ? "semaine" : "bilan");

  const containerRef = useRef<HTMLDivElement>(null);
  const filterRef = useRef<HTMLInputElement>(null);

  const byWorkspace = stats?.byWorkspace ?? [];
  // Une teinte par workspace pour toute la plage affichée : frise, glyphes de la
  // chronologie et barres du jour par jour partagent la même affectation.
  const colors = useMemo(() => assignWorkspaceColors(byWorkspace), [byWorkspace]);
  const frise = useMemo(
    () => buildFrise(mode, day, events, byWorkspace, colors),
    [mode, day, events, byWorkspace, colors],
  );
  // Lignes du « jour par jour » : calculées même en mode jour (coût négligeable,
  // et le hook `useMemo` doit rester inconditionnel).
  const weekRows = useMemo(
    () => buildWeekDays(weekRange(day).days, events, colors, todayString()),
    [day, events, colors],
  );
  // Titre de journée et puces : séparés une fois par synthèse.
  const synthese = useMemo(
    () => (bilan.ui.status === "ok" ? splitTitle(bilan.ui.summary.text) : { title: "", body: "" }),
    [bilan.ui],
  );
  // Puces par projet → lignes de la frise ; le reste va au panneau Bilan.
  const attache = useMemo(
    () => attacherPuces(synthese.body, frise.rows.map((r) => r.name)),
    [synthese.body, frise.rows],
  );

  // Réglages (jeton ClickUp des tickets, horaire rappelé par l'état « aucune
  // synthèse ») : lus une fois au montage puis à chaque bumpRefresh.
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
      if (w?.activeTabId) focusTab(w.activeTabId);
    };
  }, []);

  // Clavier de l'overlay — uniquement sur le conteneur focusé. Un champ de
  // formulaire garde toutes ses touches ; Échap y rend seulement le focus au
  // conteneur (fermer détruirait une saisie en cours, un jeton par exemple).
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
        // Échap referme d'abord un volet ouvert, puis l'overlay.
        if (detailsOpen) setDetailsOpen(false);
        else if (settingsOpen) setSettingsOpen(false);
        else close();
        break;
      case "[":
        shiftDay(-1);
        break;
      case "]":
        shiftDay(1);
        break;
      case "d":
        setDetailsOpen(!detailsOpen);
        break;
      case "/":
        e.preventDefault();
        if (!detailsOpen) setDetailsOpen(true);
        // Le champ n'existe qu'une fois le volet monté : focus au tick suivant.
        setTimeout(() => filterRef.current?.focus(), 0);
        break;
    }
  };

  /** Clic sur une ligne du « jour par jour » : on ouvre la journée en mode jour. */
  const ouvrirJour = (jour: string) => {
    setDay(jour);
    setMode("day");
    setDetailsOpen(false);
  };

  const agoLabel = collectedAgoLabel(status?.lastCollect ?? {}, Math.floor(Date.now() / 1000));
  const errors = status?.errors ?? [];
  const gearTitle = [agoLabel, ...errors].join("\n");
  // Les chevrons déplacent d'un jour ou d'une semaine selon le mode ; les
  // raccourcis [ et ] restent, eux, au pas d'un jour.
  const pas = semaine ? 7 : 1;
  const regenTitle =
    bilan.ui.status === "ok" ? `${summaryFooter(bilan.ui.summary)} — régénérer` : "Régénérer la synthèse";

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
          <button
            type="button"
            className="dash-text-btn"
            aria-pressed={detailsOpen}
            title="Chronologie détaillée ( d )"
            onClick={() => setDetailsOpen(!detailsOpen)}
          >
            Détails
          </button>
          <button
            className={errors.length > 0 ? "dash-icon-btn dash-icon-btn-alerte" : "dash-icon-btn"}
            aria-label="Réglages"
            aria-pressed={settingsOpen}
            title={gearTitle}
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
        <p className="dash-date">{semaine ? formatWeekLabel(day) : formatDayTitle(day)}</p>
        <h1 className="dash-title">
          {synthese.title !== "" ? synthese.title : semaine ? "La semaine" : "La journée"}
          <button
            type="button"
            className="dash-icon-btn dash-regen"
            aria-label="Régénérer la synthèse"
            title={regenTitle}
            onClick={() => bumpGenerate()}
          >
            <RefreshIcon />
          </button>
        </h1>
        {stats && <p className="dash-sentence">{statsSentence(stats.totals, stats.byWorkspace)}</p>}
      </div>

      <div className="dash-body">
        {loading ? (
          <>
            <div className="dash-skeleton" style={{ height: 90 }} />
            <div className="dash-skeleton" style={{ height: 70 }} />
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
            <Frise
              frise={frise}
              mode={mode}
              phrases={attache.phrases}
              onOpenTicket={openLink}
              onOpenLink={openLink}
            />
            <div className="dash-columns">
              <SummaryPanel
                title={semaine ? "Bilan de la semaine" : "Bilan"}
                ui={bilan.ui}
                body={attache.autres}
                generate={bilan.generate}
                onOpenLink={openLink}
                schedule={settings?.schedule}
              />
              <div className="dash-section">
                <h2 className="dash-h2">Reste à faire</h2>
                <OpenTasks
                  tasks={openTasks}
                  active={settings !== null && clickupActif(settings.clickup)}
                  onOpen={openLink}
                />
              </div>
            </div>
          </>
        )}

        {settingsOpen && (
          <aside className="dash-drawer">
            <SettingsPanel onClose={() => setSettingsOpen(false)} />
          </aside>
        )}
        {detailsOpen && (
          <aside className="dash-drawer">
            <div className="dash-tl-head">
              <h2 className="dash-h2">{semaine ? "Jour par jour" : "Chronologie"}</h2>
              {semaine ? (
                <span className="dash-chips-hint">cliquer pour ouvrir la journée</span>
              ) : (
                <input
                  ref={filterRef}
                  type="text"
                  className="dash-filter"
                  placeholder="filtrer"
                  aria-label="Filtrer la chronologie"
                  value={filterText}
                  onChange={(e) => setFilterText(e.target.value)}
                />
              )}
            </div>
            {semaine ? (
              <WeekDays rows={weekRows} selectedDay={day} onSelect={ouvrirJour} />
            ) : (
              <Timeline
                events={events}
                filterDir={filterDir}
                filterText={filterText}
                colors={colors}
                onOpenTicket={openLink}
              />
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
