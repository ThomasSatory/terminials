import type { ActivityEvent, TicketRef, WorkspaceCount } from "./activityApi";
import { dayRange, weekRange, shiftDay } from "./dashboardDay";
import { SANS_WORKSPACE_COLOR, workspaceColor } from "./workspacePalette";

/**
 * Frise d'activité du dashboard : une ligne par projet, des cases de durée
 * fixe teintées selon la densité d'événements, et les commits posés en points.
 * Remplace la chronologie événement par événement sur l'écran principal.
 *
 * Tout est pur : ni DOM, ni appel Tauri. Le composant `Frise` ne fait que
 * peindre le résultat.
 */

/** Compteurs d'une case, par famille d'événement. */
export interface CellCounts {
  commits: number;
  prompts: number;
  commands: number;
  clickup: number;
}

export interface FriseCell extends CellCounts {
  /** Début de la case (epoch secondes). */
  t0: number;
  /** Position de la case dans la frise, 0..1 (bord gauche). */
  left: number;
  /** Largeur relative, 0..1. */
  width: number;
  /** Total d'événements de la case. */
  total: number;
  /** Densité relative à la case la plus chargée de toute la frise, 0..1. */
  density: number;
}

export interface FriseDot {
  ts: number;
  /** Position 0..1. */
  left: number;
  title: string;
  branch: string | null;
  tickets: TicketRef[];
}

export interface FriseRow {
  /** Dossier du workspace ; `null` pour les changements ClickUp sans projet. */
  dir: string | null;
  name: string;
  color: string;
  commits: number;
  events: number;
  cells: FriseCell[];
  dots: FriseDot[];
}

export interface FriseTick {
  /** Position 0..1. */
  left: number;
  label: string;
}

export interface Frise {
  start: number;
  end: number;
  /** Durée d'une case en secondes (900 en mode jour, 3600 en mode semaine). */
  cellSeconds: number;
  rows: FriseRow[];
  ticks: FriseTick[];
}

/** Heures couvertes par défaut en mode jour ; étendues aux heures actives. */
export const HEURE_DEBUT = 7;
export const HEURE_FIN = 20;

const LABEL_JOUR = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric" });

function dayToDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

function hourEpoch(day: string, hour: number): number {
  const d = dayToDate(day);
  d.setHours(hour, 0, 0, 0);
  return Math.floor(d.getTime() / 1000);
}

/**
 * Bornes de la frise en mode jour : 7h → 20h, étendues à l'heure pleine qui
 * précède le premier événement et à celle qui suit le dernier.
 */
export function dayBounds(day: string, events: ActivityEvent[]): { start: number; end: number } {
  let start = hourEpoch(day, HEURE_DEBUT);
  let end = hourEpoch(day, HEURE_FIN);
  const { from, to } = dayRange(day);
  for (const ev of events) {
    if (ev.ts < from || ev.ts >= to) continue;
    const d = new Date(ev.ts * 1000);
    const h = d.getHours();
    if (ev.ts < start) start = hourEpoch(day, h);
    if (ev.ts >= end) end = hourEpoch(day, h + 1);
  }
  return { start, end };
}

/**
 * Bornes en mode semaine : lundi 00:00 → samedi 00:00, étendues au lundi
 * suivant si le week-end porte des événements.
 */
export function weekBounds(day: string, events: ActivityEvent[]): { start: number; end: number; days: string[] } {
  const { from, to, days } = weekRange(day);
  const lundiSuivant = dayRange(shiftDay(days[0], 7)).from;
  const weekend = events.some((ev) => ev.ts >= to && ev.ts < lundiSuivant);
  const tous = weekend ? [...days, shiftDay(days[0], 5), shiftDay(days[0], 6)] : days;
  return { start: from, end: weekend ? lundiSuivant : to, days: tous };
}

function vide(): CellCounts {
  return { commits: 0, prompts: 0, commands: 0, clickup: 0 };
}

function compter(c: CellCounts, ev: ActivityEvent): void {
  switch (ev.kind) {
    case "commit":
      c.commits += 1;
      break;
    case "claude_prompt":
      c.prompts += 1;
      break;
    case "shell_cmd":
      c.commands += 1;
      break;
    case "clickup_change":
      c.clickup += 1;
      break;
    default:
      // Les sessions Claude sont une enveloppe des prompts : pas comptées deux fois.
      break;
  }
}

function totalDe(c: CellCounts): number {
  return c.commits + c.prompts + c.commands + c.clickup;
}

/**
 * Construit la frise. `byWorkspace` fixe l'ordre des lignes (du plus actif au
 * moins actif, même ordre que `colors`) ; une ligne « ClickUp » ferme la liste
 * si des changements sans projet existent. Les lignes sans aucun événement
 * dans la plage sont omises.
 */
export function buildFrise(
  mode: "day" | "week",
  day: string,
  events: ActivityEvent[],
  byWorkspace: WorkspaceCount[],
  colors: Map<string, string>,
): Frise {
  const cellSeconds = mode === "day" ? 900 : 3600;
  const bounds: { start: number; end: number; days?: string[] } =
    mode === "day" ? dayBounds(day, events) : weekBounds(day, events);
  const { start, end } = bounds;
  const span = Math.max(end - start, cellSeconds);
  const nCells = Math.ceil(span / cellSeconds);

  const inRange = events.filter((ev) => ev.ts >= start && ev.ts < end);
  const parDir = new Map<string | null, ActivityEvent[]>();
  for (const ev of inRange) {
    const dir = ev.workspaceDir ?? null;
    const bucket = parDir.get(dir);
    if (bucket) bucket.push(ev);
    else parDir.set(dir, [ev]);
  }

  const ordre: Array<{ dir: string | null; name: string }> = [...byWorkspace]
    .sort((a, b) => b.events - a.events || a.dir.localeCompare(b.dir))
    .map((w) => ({ dir: w.dir, name: w.name }));
  // Projets vus dans les événements mais absents des stats (rare : stats et
  // événements viennent de deux requêtes) : ajoutés à la fin, par nom de dossier.
  for (const dir of parDir.keys()) {
    if (dir !== null && !ordre.some((o) => o.dir === dir)) {
      ordre.push({ dir, name: dir.split("/").filter(Boolean).pop() ?? dir });
    }
  }
  if (parDir.has(null)) ordre.push({ dir: null, name: "ClickUp" });

  const rows: FriseRow[] = [];
  let maxTotal = 0;
  for (const { dir, name } of ordre) {
    const evs = parDir.get(dir);
    if (!evs || evs.length === 0) continue;
    const counts: CellCounts[] = Array.from({ length: nCells }, vide);
    const dots: FriseDot[] = [];
    for (const ev of evs) {
      const i = Math.min(nCells - 1, Math.floor((ev.ts - start) / cellSeconds));
      compter(counts[i], ev);
      if (ev.kind === "commit") {
        dots.push({
          ts: ev.ts,
          left: (ev.ts - start) / span,
          title: ev.title,
          branch: ev.branch ?? null,
          tickets: ev.tickets,
        });
      }
    }
    for (const c of counts) maxTotal = Math.max(maxTotal, totalDe(c));
    rows.push({
      dir,
      name,
      color: dir === null ? SANS_WORKSPACE_COLOR : workspaceColor(dir, colors),
      commits: dots.length,
      events: evs.length,
      cells: counts.map((c, i) => ({
        ...c,
        t0: start + i * cellSeconds,
        left: (i * cellSeconds) / span,
        width: cellSeconds / span,
        total: totalDe(c),
        density: 0,
      })),
      dots: dots.sort((a, b) => a.ts - b.ts),
    });
  }
  // Densité normalisée sur toute la frise, pour que deux projets se comparent.
  if (maxTotal > 0) {
    for (const row of rows) {
      for (const cell of row.cells) cell.density = cell.total / maxTotal;
    }
  }

  return { start, end, cellSeconds, rows, ticks: ticksFor(mode, start, end, bounds) };
}

function ticksFor(
  mode: "day" | "week",
  start: number,
  end: number,
  bounds: { days?: string[] },
): FriseTick[] {
  const span = end - start;
  if (mode === "day") {
    const ticks: FriseTick[] = [];
    for (let t = start; t < end; t += 3600) {
      const h = new Date(t * 1000).getHours();
      ticks.push({ left: (t - start) / span, label: `${h}h` });
    }
    return ticks;
  }
  return (bounds.days ?? []).map((d) => ({
    left: (dayRange(d).from - start) / span,
    label: LABEL_JOUR.format(dayToDate(d)),
  }));
}

/** « 9h15 » (mode jour) ou « mar. 16, 9h » (mode semaine) : début d'une case. */
export function cellLabel(t0: number, mode: "day" | "week"): string {
  const d = new Date(t0 * 1000);
  const h = d.getHours();
  const m = d.getMinutes();
  const hm = m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
  if (mode === "day") return hm;
  return `${LABEL_JOUR.format(d)}, ${hm}`;
}

function pluriel(n: number, s: string, p: string): string {
  return `${n} ${n === 1 ? s : p}`;
}

/** Infobulle d'une case : « 9h15 · 12 commandes, 3 échanges, 1 commit ». Vide si rien. */
export function cellTooltip(cell: FriseCell, mode: "day" | "week"): string {
  if (cell.total === 0) return "";
  const parts: string[] = [];
  if (cell.commands > 0) parts.push(pluriel(cell.commands, "commande", "commandes"));
  if (cell.prompts > 0) parts.push(pluriel(cell.prompts, "échange", "échanges"));
  if (cell.commits > 0) parts.push(pluriel(cell.commits, "commit", "commits"));
  if (cell.clickup > 0) parts.push(pluriel(cell.clickup, "changement ClickUp", "changements ClickUp"));
  return `${cellLabel(cell.t0, mode)} · ${parts.join(", ")}`;
}

/** Infobulle d'un point : heure, sujet, branche et tickets. */
export function dotTooltip(dot: FriseDot, mode: "day" | "week"): string {
  const d = new Date(dot.ts * 1000);
  const quand = mode === "day"
    ? `${d.getHours()}h${String(d.getMinutes()).padStart(2, "0")}`
    : `${LABEL_JOUR.format(d)}, ${d.getHours()}h${String(d.getMinutes()).padStart(2, "0")}`;
  const lignes = [`${quand} · ${dot.title}`];
  if (dot.branch) lignes.push(dot.branch);
  for (const t of dot.tickets) lignes.push(t.name ? `${t.id} — ${t.name}` : t.id);
  return lignes.join("\n");
}
