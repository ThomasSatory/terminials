import { useCallback, useEffect, useRef, useState } from "react";
import { useDashboardStore } from "../store/dashboard";
import {
  activityApi,
  type ActivityEvent,
  type ActivityStats,
  type ActivityStatus,
  type OpenTask,
  type SummaryKind,
} from "../lib/activityApi";
import { dayRange, weekRange } from "../lib/dashboardDay";
import { reduceSummary, type SummaryUi } from "../lib/summaryState";

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
    ])
      .then(([ev, st, tasks, stat]) => {
        if (id !== requestId.current) return;
        setEvents(ev);
        setStats(st);
        setOpenTasks(tasks);
        setStatus(stat);
        setLoading(false);
      })
      .catch((err: unknown) => {
        if (id !== requestId.current) return;
        setError(String(err));
        setLoading(false);
      });
  }, [day, mode, refreshTick, reloadTick]);

  const reload = useCallback(() => setReloadTick((t) => t + 1), []);

  return { loading, events, stats, openTasks, status, error, reload };
}

/**
 * État + génération d'un résumé LLM pour `kind`. Régénère (lecture cache,
 * `force=false`) au montage et quand `day`/`refreshTick` changent ; régénère
 * en forçant (`force=true`) quand `generateTick` (bouton « Générer
 * maintenant » de la barre du haut, ajouté par une tâche ultérieure) change.
 */
export function useSummary(kind: SummaryKind): { ui: SummaryUi; generate(force: boolean): void } {
  const day = useDashboardStore((s) => s.day);
  const refreshTick = useDashboardStore((s) => s.refreshTick);
  // `generateTick` n'existe pas encore dans le store (tâche ultérieure) : lu
  // défensivement pour compiler dès maintenant sans dépendre de ce champ.
  const generateTick = useDashboardStore((s) => (s as { generateTick?: number }).generateTick ?? 0);

  const [ui, setUi] = useState<SummaryUi>({ status: "idle" });
  const requestId = useRef(0);

  const generate = useCallback(
    (force: boolean) => {
      const id = ++requestId.current;
      setUi((prev) => reduceSummary(prev, { type: "start" }));
      activityApi
        .summary(day, kind, force)
        .then((summary) => {
          if (id !== requestId.current) return;
          setUi((prev) => reduceSummary(prev, { type: "ok", summary }));
        })
        .catch((error: unknown) => {
          if (id !== requestId.current) return;
          setUi((prev) => reduceSummary(prev, { type: "fail", error }));
        });
    },
    [day, kind],
  );

  useEffect(() => {
    generate(false);
  }, [generate, refreshTick]);

  const generateTickRef = useRef(generateTick);
  useEffect(() => {
    if (generateTick !== generateTickRef.current) {
      generateTickRef.current = generateTick;
      generate(true);
    }
  }, [generateTick, generate]);

  return { ui, generate };
}
