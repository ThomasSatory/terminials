import type { OpenTask } from "./activityApi";

/**
 * Tri et libellés des tâches ouvertes du récap (dashboard/OpenTasks). Purs, testés sans
 * rendu.
 */

/**
 * Rangs de priorité (plus petit = plus urgent) pour le tri secondaire. Une priorité
 * absente ou inconnue est traitée comme la moins urgente.
 */
const PRIORITY_RANK: Record<string, number> = {
  urgent: 0,
  high: 1,
  haute: 1,
  normal: 2,
  normale: 2,
  low: 3,
  basse: 3,
};

export function priorityRank(priority: string | null | undefined): number {
  if (!priority) return 4;
  return PRIORITY_RANK[priority.toLowerCase()] ?? 4;
}

/** Trie par échéance croissante (sans échéance en dernier), puis par priorité. */
export function compareTasks(a: OpenTask, b: OpenTask): number {
  const dueA = a.dueDate ?? null;
  const dueB = b.dueDate ?? null;
  if (dueA !== dueB) {
    if (dueA === null) return 1;
    if (dueB === null) return -1;
    return dueA - dueB;
  }
  return priorityRank(a.priority) - priorityRank(b.priority);
}

const DUE_FORMAT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric" });

/** Échéance courte d'une tâche, ex. "ven. 19". */
export function formatTaskDue(ts: number): string {
  return DUE_FORMAT.format(new Date(ts * 1000));
}

/** Libellé du bouton de dépliage. */
export function foldLabel(open: boolean, reste: number): string {
  if (open) return "Replier";
  return reste === 1 ? "+ 1 autre" : `+ ${reste} autres`;
}
