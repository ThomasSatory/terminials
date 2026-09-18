import type { ActivityEvent } from "./activityApi";
import { toDayString, shiftDay } from "./dashboardDay";
import { workspaceColor } from "./workspacePalette";

/**
 * Colonne « Jour par jour » du mode semaine (tâche 17) : une ligne par jour,
 * avec son fait marquant, ses compteurs et sa barre de répartition par
 * workspace. Pur : le composant n'a plus qu'à peindre le résultat.
 */

export interface WeekDaySegment {
  dir: string | null;
  color: string;
  events: number;
}

export interface WeekDayRow {
  /** Jour "YYYY-MM-DD" (heure locale). */
  day: string;
  /** Libellé court, ex. "lun. 15". */
  label: string;
  /** Fait marquant du jour ; vide s'il n'y a rien à dire (jour futur ou sans activité). */
  fait: string;
  future: boolean;
  /** Ligne de compteurs, ex. "5 commits, 31 échanges" ; vide si aucun des deux. */
  compteurs: string;
  /** Répartition des événements par workspace, du plus actif au moins actif. */
  segments: WeekDaySegment[];
}

const LABEL_FORMAT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric" });

function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function compte(n: number, singulier: string, pluriel: string): string {
  return `${n} ${n === 1 ? singulier : pluriel}`;
}

/**
 * Construit les lignes du jour par jour.
 *
 * `days` est la semaine ouvrée (lundi → vendredi, cf. `weekRange`). Un samedi
 * ou un dimanche n'apparaît que s'il porte des événements — la plage interrogée
 * s'arrêtant au samedi matin, c'est en pratique la garantie que le week-end
 * reste invisible tant qu'on n'a rien travaillé dessus.
 */
export function buildWeekDays(
  days: string[],
  events: ActivityEvent[],
  colors: Map<string, string>,
  today: string,
): WeekDayRow[] {
  const parJour = new Map<string, ActivityEvent[]>();
  for (const ev of events) {
    const day = toDayString(new Date(ev.ts * 1000));
    const bucket = parJour.get(day);
    if (bucket) bucket.push(ev);
    else parJour.set(day, [ev]);
  }

  const premier = days[0];
  const dernier = shiftDay(premier, 6);
  const tous = new Set(days);
  for (const day of parJour.keys()) {
    if (day >= premier && day <= dernier) tous.add(day);
  }

  return [...tous]
    .sort()
    .map((day) => ligne(day, (parJour.get(day) ?? []).slice().sort((a, b) => a.ts - b.ts), colors, today));
}

function ligne(
  day: string,
  events: ActivityEvent[],
  colors: Map<string, string>,
  today: string,
): WeekDayRow {
  const commits = events.filter((e) => e.kind === "commit");
  const prompts = events.filter((e) => e.kind === "claude_prompt");
  const commandes = events.filter((e) => e.kind === "shell_cmd");
  const session = events.find((e) => e.kind === "claude_session");

  // Fait marquant : le premier commit dit le mieux ce qui a été fait ; à défaut
  // le titre de la première session Claude, sinon le simple volume de commandes.
  let fait = "";
  if (commits.length > 0) fait = commits[0].title;
  else if (session) fait = session.title;
  else if (commandes.length > 0) fait = compte(commandes.length, "commande", "commandes");

  const compteurs: string[] = [];
  if (commits.length > 0) compteurs.push(compte(commits.length, "commit", "commits"));
  if (prompts.length > 0) compteurs.push(compte(prompts.length, "échange", "échanges"));

  return {
    day,
    label: LABEL_FORMAT.format(dayToDate(day)),
    fait,
    future: day > today,
    compteurs: compteurs.join(", "),
    segments: repartition(events, colors),
  };
}

/** Un segment par workspace, du plus actif au moins actif ; ClickUp (sans dossier) en dernier. */
function repartition(events: ActivityEvent[], colors: Map<string, string>): WeekDaySegment[] {
  const parDir = new Map<string | null, number>();
  for (const ev of events) {
    const dir = ev.workspaceDir ?? null;
    parDir.set(dir, (parDir.get(dir) ?? 0) + 1);
  }
  return [...parDir.entries()]
    .map(([dir, count]) => ({ dir, color: workspaceColor(dir, colors), events: count }))
    .sort((a, b) => {
      if (a.events !== b.events) return b.events - a.events;
      if (a.dir === null) return 1;
      if (b.dir === null) return -1;
      return a.dir.localeCompare(b.dir);
    });
}
