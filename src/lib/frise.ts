import type { ActivityEvent, TicketRef, WorkspaceCount } from "./activityApi";
import { dayRange, weekRange, shiftDay } from "./dashboardDay";
import { workspaceColor } from "./workspacePalette";

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
  /** US travaillées pendant la case (branche ou worktree), sans doublon. */
  us: TicketRef[];
  /** Derniers messages envoyés à Claude pendant la case, tronqués (infobulle). */
  extraits: string[];
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
  /** Dossier du workspace. */
  dir: string;
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

/** US d'un événement : celle de sa branche, sinon le premier ticket cité. */
export function usDe(ev: ActivityEvent): TicketRef | null {
  return ev.usTicket ?? ev.tickets[0] ?? null;
}

/** Messages à Claude retenus par case dans l'infobulle. */
const EXTRAITS_PAR_CASE = 2;
const EXTRAIT_MAX = 90;

/**
 * Message à Claude lisible dans l'infobulle, ou `null` pour le bruit : sorties
 * de commandes (`<bash-stdout>`, `<command-name>`…), messages entre sessions,
 * réponses d'un mot (« fait », « ok »).
 */
export function extraitPrompt(title: string): string | null {
  const t = title.replace(/\s+/g, " ").trim();
  if (t.startsWith("<") || t.startsWith("Another Claude session")) return null;
  if (t.length < 12) return null;
  return t.length > EXTRAIT_MAX ? `${t.slice(0, EXTRAIT_MAX - 1).trimEnd()}…` : t;
}

/**
 * Construit la frise. `byWorkspace` fixe l'ordre des lignes (du plus actif au
 * moins actif, même ordre que `colors`). Les événements sans projet et les
 * lignes sans aucun événement dans la plage sont omis.
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

  const ordre: Array<{ dir: string; name: string }> = [...byWorkspace]
    .sort((a, b) => b.events - a.events || a.dir.localeCompare(b.dir))
    .map((w) => ({ dir: w.dir, name: w.name }));
  // Projets vus dans les événements mais absents des stats (rare : stats et
  // événements viennent de deux requêtes) : ajoutés à la fin, par nom de dossier.
  for (const dir of parDir.keys()) {
    if (dir !== null && !ordre.some((o) => o.dir === dir)) {
      ordre.push({ dir, name: dir.split("/").filter(Boolean).pop() ?? dir });
    }
  }
  // Les changements ClickUp sans projet n'ont pas de ligne : ils restent dans
  // le digest du bilan, mais une ligne « ClickUp » ne dit rien du travail fait.

  const rows: FriseRow[] = [];
  let maxTotal = 0;
  for (const { dir, name } of ordre) {
    const evs = parDir.get(dir);
    if (!evs || evs.length === 0) continue;
    const counts: CellCounts[] = Array.from({ length: nCells }, vide);
    const us: TicketRef[][] = Array.from({ length: nCells }, () => []);
    const extraits: string[][] = Array.from({ length: nCells }, () => []);
    const dots: FriseDot[] = [];
    for (const ev of evs) {
      const i = Math.min(nCells - 1, Math.floor((ev.ts - start) / cellSeconds));
      compter(counts[i], ev);
      const ticket = usDe(ev);
      if (ticket && ev.kind !== "claude_session" && !us[i].some((t) => t.id === ticket.id)) {
        us[i].push(ticket);
      }
      const extrait = ev.kind === "claude_prompt" ? extraitPrompt(ev.title) : null;
      if (extrait) extraits[i] = [...extraits[i], extrait].slice(-EXTRAITS_PAR_CASE);
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
      color: workspaceColor(dir, colors),
      commits: dots.length,
      events: evs.length,
      cells: counts.map((c, i) => ({
        ...c,
        t0: start + i * cellSeconds,
        left: (i * cellSeconds) / span,
        width: cellSeconds / span,
        total: totalDe(c),
        density: 0,
        us: us[i],
        extraits: extraits[i],
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

/** « 12 commandes, 3 échanges, 1 commit » : le contenu d'une case. */
function detailCase(cell: CellCounts): string {
  const parts: string[] = [];
  if (cell.commands > 0) parts.push(pluriel(cell.commands, "commande", "commandes"));
  if (cell.prompts > 0) parts.push(pluriel(cell.prompts, "échange", "échanges"));
  if (cell.commits > 0) parts.push(pluriel(cell.commits, "commit", "commits"));
  if (cell.clickup > 0) parts.push(pluriel(cell.clickup, "changement ClickUp", "changements ClickUp"));
  return parts.join(", ");
}

/** Part d'un projet dans une colonne empilée. */
export interface FriseSegment {
  name: string;
  color: string;
  cell: FriseCell;
  /** Hauteur relative à la pile la plus haute de toute la frise, 0..1. */
  part: number;
}

/** Une case de temps, tous projets confondus : les projets actifs empilés. */
export interface FriseColonne {
  t0: number;
  left: number;
  width: number;
  /** Dans l'ordre des lignes de la frise (le plus actif en bas de la pile). */
  segments: FriseSegment[];
}

/**
 * Vue « rythme » de la frise : pour chaque case où au moins un projet est
 * actif, une colonne où les projets s'empilent. La hauteur totale d'une pile
 * dit l'intensité du moment, les couleurs disent sur quoi.
 */
export function colonnesEmpilees(frise: Frise): FriseColonne[] {
  if (frise.rows.length === 0) return [];
  const n = frise.rows[0].cells.length;
  const colonnes: FriseColonne[] = [];
  let maxPile = 0;
  for (let i = 0; i < n; i++) {
    const segments: FriseSegment[] = [];
    let pile = 0;
    for (const row of frise.rows) {
      const cell = row.cells[i];
      if (cell.total === 0) continue;
      segments.push({ name: row.name, color: row.color, cell, part: cell.total });
      pile += cell.total;
    }
    if (segments.length === 0) continue;
    maxPile = Math.max(maxPile, pile);
    const { t0, left, width } = frise.rows[0].cells[i];
    colonnes.push({ t0, left, width, segments });
  }
  for (const col of colonnes) {
    for (const seg of col.segments) seg.part /= maxPile;
  }
  return colonnes;
}

/** Un projet dans l'infobulle d'une colonne. */
export interface SurvolProjet {
  name: string;
  color: string;
  detail: string;
  us: TicketRef[];
  commits: string[];
  extraits: string[];
}

export interface SurvolColonne {
  t0: number;
  /** « 9h15 – 9h30 », « mar. 16, 9h – 10h ». */
  titre: string;
  projets: SurvolProjet[];
}

/**
 * Contenu de l'infobulle d'une colonne : la plage horaire, puis pour chaque
 * projet actif ce qui s'y est passé — compteurs, US, sujets des commits et
 * derniers messages à Claude.
 */
export function survolColonne(col: FriseColonne, frise: Frise, mode: "day" | "week"): SurvolColonne {
  const fin = cellLabel(col.t0 + frise.cellSeconds, "day");
  const projets = col.segments.map((seg) => {
    const row = frise.rows.find((r) => r.name === seg.name);
    const commits = (row?.dots ?? [])
      .filter((d) => d.ts >= col.t0 && d.ts < col.t0 + frise.cellSeconds)
      .map((d) => d.title);
    return {
      name: seg.name,
      color: seg.color,
      detail: detailCase(seg.cell),
      us: seg.cell.us,
      commits,
      extraits: seg.cell.extraits,
    };
  });
  return { t0: col.t0, titre: `${cellLabel(col.t0, mode)} – ${fin}`, projets };
}

/** Colonne sous l'abscisse relative `x` (0..1), ou `null` entre deux colonnes actives. */
export function colonneA(colonnes: FriseColonne[], x: number): FriseColonne | null {
  return colonnes.find((c) => x >= c.left && x < c.left + c.width) ?? null;
}

/** Temps actif d'un projet (cases non vides), « 45 min », « 2 h », « 5 h 15 ». */
export function dureeActive(row: FriseRow, cellSeconds: number): string {
  const minutes = Math.round((row.cells.filter((c) => c.total > 0).length * cellSeconds) / 60);
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  return m === 0 ? `${h} h` : `${h} h ${String(m).padStart(2, "0")}`;
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
