import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboardStore } from "../store/dashboard";
import {
  activityApi,
  type ActivityEvent,
  type ActivityStats,
  type ActivityStatus,
  type OpenTask,
  type Reunion,
  type SummaryKind,
  type TicketRef,
} from "../lib/activityApi";
import { dayRange, weekRange } from "../lib/dashboardDay";
import { reduceSummary, redactionEnCours, type SummaryUi } from "../lib/summaryState";

/**
 * Charge les données du dashboard (événements, stats, tâches ouvertes, statut
 * de collecte) pour le jour/la semaine et le mode courants du store. Les
 * réponses obsolètes (jour changé entre-temps) sont ignorées via un compteur
 * de requête.
 */
export function useActivityData(): {
  loading: boolean;
  events: ActivityEvent[];
  stats: ActivityStats | null;
  openTasks: OpenTask[];
  /** US « Réunion » du sprint en cours, trouvée par la collecte ClickUp. */
  reunionUs: TicketRef | null;
  /** Réunions de la plage, relevées dans l'agenda Outlook. */
  reunions: Reunion[];
  status: ActivityStatus | null;
  error: string | null;
  reload(): void;
} {
  const day = useDashboardStore((s) => s.day);
  const mode = useDashboardStore((s) => s.mode);
  const refreshTick = useDashboardStore((s) => s.refreshTick);

  const [loading, setLoading] = useState(true);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const [stats, setStats] = useState<ActivityStats | null>(null);
  const [openTasks, setOpenTasks] = useState<OpenTask[]>([]);
  const [reunionUs, setReunionUs] = useState<TicketRef | null>(null);
  const [reunions, setReunions] = useState<Reunion[]>([]);
  const [status, setStatus] = useState<ActivityStatus | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadTick, setReloadTick] = useState(0);

  const requestId = useRef(0);

  useEffect(() => {
    const id = ++requestId.current;
    setLoading(true);
    setError(null);

    const range = mode === "week" ? weekRange(day) : dayRange(day);

    Promise.all([
      activityApi.query(range.from, range.to),
      activityApi.stats(range.from, range.to),
      activityApi.openTasks(),
      activityApi.status(),
      activityApi.reunionUs(),
      activityApi.reunions(range.from, range.to),
    ])
      .then(([ev, st, tasks, stat, reunion, rdv]) => {
        if (id !== requestId.current) return;
        setEvents(ev);
        setStats(st);
        setOpenTasks(tasks);
        setStatus(stat);
        setReunionUs(reunion);
        setReunions(rdv);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setError(String(err));
        setLoading(false);
      });
  }, [day, mode, refreshTick, reloadTick]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  return { loading, events, stats, openTasks, reunionUs, reunions, status, error, reload };
}

/**
 * État + génération d'un résumé LLM pour `kind`. Le chargement automatique
 * (montage, changement de jour, `refreshTick`) passe par
 * `activity_summary_cached` : lecture seule du cache, donc **jamais** d'appel
 * LLM — sinon chaque commande shell et chaque cycle de collecte brûlait un
 * appel par panneau (Critique #1). Cache vide → état `absent` (« Aucune
 * synthèse pour ce jour »), qui n'est pas une erreur. Seuls les gestes
 * explicites appellent `activity_summary` : le bouton « Rédiger le bilan » /
 * « Régénérer » du récap (`force=true` quand un bilan existe déjà).
 */
export function useSummary(kind: SummaryKind): {
  ui: SummaryUi;
  /** Rédaction (appel LLM) en cours, distincte d'une simple lecture du cache. */
  redaction: boolean;
  generate(force: boolean): void;
} {
  const day = useDashboardStore((s) => s.day);
  const refreshTick = useDashboardStore((s) => s.refreshTick);

  const [ui, setUi] = useState<SummaryUi>({ status: "idle" });
  // Compteur partagé par les deux chemins : une lecture de cache tardive ne doit
  // pas écraser le résultat d'une génération demandée entre-temps (et vice versa).
  const requestId = useRef(0);

  const chargerCache = useCallback(() => {
    const id = ++requestId.current;
    setUi((prev) => reduceSummary(prev, { type: "start", phase: "lecture" }));
    activityApi
      .summaryCached(day, kind)
      .then((summary) => {
        if (id !== requestId.current) return;
        setUi((prev) =>
          summary === null
            ? reduceSummary(prev, { type: "absent" })
            : reduceSummary(prev, { type: "ok", summary }),
        );
      })
      .catch((error: unknown) => {
        if (id !== requestId.current) return;
        setUi((prev) => reduceSummary(prev, { type: "fail", error }));
      });
  }, [day, kind]);

  const generate = useCallback(
    (force: boolean) => {
      const id = ++requestId.current;
      setUi((prev) => reduceSummary(prev, { type: "start", phase: "redaction" }));
      activityApi
        .summary(day, kind, force)
        .then((summary) => {
          if (id !== requestId.current) return;
          setUi((prev) => reduceSummary(prev, { type: "ok", summary, reecrit: true }));
        })
        .catch((error: unknown) => {
          if (id !== requestId.current) return;
          setUi((prev) => reduceSummary(prev, { type: "fail", error }));
        });
    },
    [day, kind],
  );

  useEffect(() => {
    chargerCache();
  }, [chargerCache, refreshTick]);

  return { ui, redaction: redactionEnCours(ui), generate };
}
