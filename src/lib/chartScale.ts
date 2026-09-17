import type { HourCounts, KindCounts } from "./activityApi";

/**
 * Échelles et découpage des graphiques SVG maison du dashboard (§8 du design) :
 * pas de bibliothèque de charts, tout est calculé ici en pur pour rester testable
 * sans DOM.
 */

export const KIND_COLORS = {
  commit: "#2ecc71",
  claude_prompt: "#3b82f6",
  shell_cmd: "#8a8a8a",
  clickup_change: "#9b59b6",
} as const;

export const KIND_LABELS = {
  commit: "commits",
  claude_prompt: "prompts Claude",
  shell_cmd: "commandes",
  clickup_change: "ClickUp",
} as const;

/** Ordre des kinds : empilement des segments (bas → haut) et parcours des tooltips. */
export const KIND_ORDER = Object.keys(KIND_COLORS) as Array<keyof typeof KIND_COLORS>;

/** Somme des 4 kinds comptés (hors `claude_session`, absent de `KindCounts`). */
export function kindTotal(c: KindCounts): number {
  return c.commit + c.claude_prompt + c.shell_cmd + c.clickup_change;
}

/**
 * Plage d'heures à afficher : 7h-20h par défaut, étendue (bornes contiguës)
 * aux heures ayant au moins un événement en dehors de cette plage.
 */
export function visibleHours(byHour: HourCounts[]): number[] {
  const nonEmpty = byHour.filter((h) => kindTotal(h) > 0).map((h) => h.hour);
  const lo = nonEmpty.length ? Math.min(7, ...nonEmpty) : 7;
  const hi = nonEmpty.length ? Math.max(20, ...nonEmpty) : 20;
  const hours: number[] = [];
  for (let h = lo; h <= hi; h++) hours.push(h);
  return hours;
}

/** Max « joli » (1, 2 ou 5 × 10^n) au-dessus des valeurs données, minimum 1. */
export function niceMax(values: number[]): number {
  const m = values.length ? Math.max(...values) : 0;
  if (m <= 0) return 1;
  const exp = Math.floor(Math.log10(m));
  const base = Math.pow(10, exp);
  const candidates = [1, 2, 5, 10].map((c) => c * base);
  return candidates.find((c) => c >= m) ?? candidates[candidates.length - 1];
}

/**
 * Découpe une barre empilée (une heure ou un jour) en segments par kind,
 * dans l'ordre commit, claude_prompt, shell_cmd, clickup_change, empilés du
 * bas (`y + h` = `height`) vers le haut. `total` est le max de l'échelle
 * (ex. `niceMax` sur toutes les barres) ; les kinds à 0 sont omis.
 */
export function stackSegments(
  c: KindCounts,
  total: number,
  height: number,
): Array<{ kind: keyof typeof KIND_COLORS; y: number; h: number }> {
  if (total <= 0) return [];
  const scale = height / total;
  const segments: Array<{ kind: keyof typeof KIND_COLORS; y: number; h: number }> = [];
  let y = height;
  for (const kind of KIND_ORDER) {
    const count = c[kind];
    if (count <= 0) continue;
    const h = count * scale;
    y -= h;
    segments.push({ kind, y, h });
  }
  return segments;
}
