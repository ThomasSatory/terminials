import type { OpenTask } from "../../lib/activityApi";

/**
 * Rangs de priorité ClickUp (plus petit = plus urgent) pour le tri secondaire.
 * Une priorité absente ou inconnue est traitée comme la moins urgente.
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

function priorityRank(priority: string | null | undefined): number {
  if (!priority) return 4;
  return PRIORITY_RANK[priority.toLowerCase()] ?? 4;
}

/** Trie par échéance croissante (sans échéance en dernier), puis par priorité. */
function compareTasks(a: OpenTask, b: OpenTask): number {
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

/** Échéance courte d'une tâche, ex. "ven. 19". Pure, testée sans rendu. */
export function formatTaskDue(ts: number): string {
  return DUE_FORMAT.format(new Date(ts * 1000));
}

/**
 * Tickets ClickUp ouverts, en tête de « Reste à faire » (tâche 17) : une ligne
 * par ticket, identifiant en pastille laiton, nom en serif, échéance à droite.
 * Triés par échéance puis priorité. Sans jeton ClickUp configuré, une simple
 * ligne atténuée invite à en ajouter un plutôt que d'appeler l'API.
 */
export function OpenTasks({
  tasks,
  hasToken,
  onOpen,
}: {
  tasks: OpenTask[];
  hasToken: boolean;
  onOpen: (url: string) => void;
}) {
  if (!hasToken) {
    return <p className="dash-tasks-empty">Ajouter un token ClickUp dans les réglages</p>;
  }

  const sorted = [...tasks].sort(compareTasks);

  return (
    <ul className="dash-tasks">
      {sorted.map((task) => (
        <li key={task.id} className="dash-task">
          <a
            className="dash-task-id"
            href={task.url}
            title={task.listName ?? task.status}
            onClick={(e) => {
              e.preventDefault();
              onOpen(task.url);
            }}
          >
            {task.id}
          </a>
          <span className="dash-task-name" title={task.status}>
            {task.name}
          </span>
          {task.dueDate != null && (
            <span className="dash-task-due">{formatTaskDue(task.dueDate)}</span>
          )}
        </li>
      ))}
    </ul>
  );
}
