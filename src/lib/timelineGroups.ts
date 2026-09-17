import type { ActivityEvent, EventKind } from "./activityApi";
import { basename } from "./palette";

/**
 * Regroupement de la timeline du dashboard par workspace (§8 du design) :
 * filtre dir/texte puis groupement, en pur pour rester testable sans DOM.
 */

export interface TimelineGroup {
  dir: string | null;
  name: string;
  events: ActivityEvent[];
}

function matchesText(ev: ActivityEvent, needle: string): boolean {
  if (ev.title.toLowerCase().includes(needle)) return true;
  if (ev.branch && ev.branch.toLowerCase().includes(needle)) return true;
  if (ev.ticketIds.some((id) => id.toLowerCase().includes(needle))) return true;
  return false;
}

/**
 * Groupe les événements par workspace (`workspaceDir`), dans l'ordre
 * d'apparition du premier événement de chaque groupe, sauf le groupe ClickUp
 * (`dir === null`) qui est toujours placé en dernier. `filterDir` restreint
 * à un seul workspace ; `filterText` filtre (insensible à la casse) sur le
 * titre, la branche ou les identifiants de ticket.
 */
export function groupTimeline(
  events: ActivityEvent[],
  filterDir: string | null,
  filterText: string,
): TimelineGroup[] {
  const needle = filterText.trim().toLowerCase();

  const filtered = events.filter((ev) => {
    const dir = ev.workspaceDir ?? null;
    if (filterDir !== null && dir !== filterDir) return false;
    if (needle && !matchesText(ev, needle)) return false;
    return true;
  });

  const order: Array<string | null> = [];
  const byDir = new Map<string | null, ActivityEvent[]>();
  for (const ev of filtered) {
    const dir = ev.workspaceDir ?? null;
    let bucket = byDir.get(dir);
    if (!bucket) {
      bucket = [];
      byDir.set(dir, bucket);
      order.push(dir);
    }
    bucket.push(ev);
  }

  const dirsFirst = order.filter((d) => d !== null);
  const orderedDirs = order.includes(null) ? [...dirsFirst, null] : dirsFirst;

  return orderedDirs.map((dir) => ({
    dir,
    name: dir === null ? "ClickUp" : basename(dir),
    events: byDir.get(dir) ?? [],
  }));
}

const EVENT_ICONS: Record<EventKind, string> = {
  commit: "●",
  claude_prompt: "✦",
  claude_session: "◷",
  shell_cmd: "›",
  clickup_change: "◆",
};

/** Icône affichée devant un événement de la timeline, par kind. */
export function eventIcon(kind: EventKind): string {
  return EVENT_ICONS[kind];
}
