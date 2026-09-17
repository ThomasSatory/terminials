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

function formatDueDate(ts: number): string {
  const d = new Date(ts * 1000);
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  return `${day}/${month}`;
}

/**
 * Section « Reste à faire » (partie haute, §8) : tâches ClickUp ouvertes,
 * triées par échéance puis priorité. Sans jeton ClickUp configuré, invite à
 * en ajouter un dans les réglages plutôt que d'appeler l'API.
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
    return (
      <div className="dash-card dash-open-tasks">
        <p className="dash-banner">Ajouter un token ClickUp dans ⚙</p>
      </div>
    );
  }

  const sorted = [...tasks].sort(compareTasks);

  return (
    <div className="dash-card dash-open-tasks">
      <ul>
        {sorted.map((task) => (
          <li key={task.id} className="dash-task">
            <a
              href={task.url}
              onClick={(e) => {
                e.preventDefault();
                onOpen(task.url);
              }}
            >
              {task.name}
            </a>
            <span className="dash-task-status">{task.status}</span>
            {task.dueDate != null && (
              <span className="dash-task-due">{formatDueDate(task.dueDate)}</span>
            )}
            {task.listName && <span className="dash-task-list">{task.listName}</span>}
          </li>
        ))}
      </ul>
    </div>
  );
}
