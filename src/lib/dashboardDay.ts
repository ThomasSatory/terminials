/**
 * Utilitaires de jours pour le dashboard d'activité, tout en heure LOCALE du
 * navigateur (jamais UTC) : un "jour" est une chaîne "YYYY-MM-DD" représentant
 * minuit local → minuit local suivant. Aucune dépendance externe.
 */

/** Formate une Date en jour local "YYYY-MM-DD" (mois/jour sur 2 chiffres). */
export function toDayString(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Jour local courant (paramètre `now` injectable pour les tests). */
export function todayString(now: Date = new Date()): string {
  return toDayString(now);
}

/** Découpe un jour "YYYY-MM-DD" en composants numériques. */
function parseDay(day: string): { y: number; m: number; d: number } {
  const [y, m, d] = day.split("-").map(Number);
  return { y, m, d };
}

/** Construit minuit local pour un jour "YYYY-MM-DD". */
function dayToDate(day: string): Date {
  const { y, m, d } = parseDay(day);
  return new Date(y, m - 1, d);
}

/** Décale un jour de `delta` jours (traverse mois/années correctement, DST inclus
 *  puisqu'on ne manipule que des composants Y/M/D via le constructeur Date local). */
export function shiftDay(day: string, delta: number): string {
  const { y, m, d } = parseDay(day);
  return toDayString(new Date(y, m - 1, d + delta));
}

/** Plage epoch secondes [minuit local, minuit local du lendemain). `to` est
 *  reconstruit par composants (comme `weekRange`), PAS par `from + 86400` : les
 *  deux jours de changement d'heure par an durent 23 h ou 25 h en local. */
export function dayRange(day: string): { from: number; to: number } {
  const from = Math.floor(dayToDate(day).getTime() / 1000);
  const to = Math.floor(dayToDate(shiftDay(day, 1)).getTime() / 1000);
  return { from, to };
}

/**
 * Semaine ouvrée (lundi → samedi exclu, soit lundi..vendredi = 5 jours) contenant `day`.
 * `to` est minuit local du samedi (= début du jour suivant le dernier jour de la semaine).
 */
export function weekRange(day: string): { from: number; to: number; days: string[] } {
  const date = dayToDate(day);
  // getDay() : 0=dimanche..6=samedi. Décalage vers lundi=0.
  const dow = (date.getDay() + 6) % 7;
  const monday = shiftDay(day, -dow);
  const days = Array.from({ length: 5 }, (_, i) => shiftDay(monday, i));
  const from = dayRange(monday).from;
  const saturday = shiftDay(monday, 5);
  const to = dayRange(saturday).from;
  return { from, to, days };
}

/** Vrai si `day` tombe un samedi ou un dimanche. */
export function isWeekend(day: string): boolean {
  const dow = dayToDate(day).getDay(); // 0=dimanche, 6=samedi
  return dow === 0 || dow === 6;
}

/** Dernier jour ouvré STRICTEMENT avant `day` (jamais `day` lui-même, même s'il est ouvré). */
export function lastWorkingDay(day: string): string {
  let cur = shiftDay(day, -1);
  while (isWeekend(cur)) cur = shiftDay(cur, -1);
  return cur;
}

const DAY_LABEL_FORMAT = new Intl.DateTimeFormat("fr-FR", {
  weekday: "long",
  day: "numeric",
  month: "long",
  year: "numeric",
});

/** Libellé long fr-FR d'un jour, ex. "mercredi 16 septembre 2026". */
export function formatDayLabel(day: string): string {
  return DAY_LABEL_FORMAT.format(dayToDate(day));
}

/** Heure locale "HH:MM" d'un timestamp epoch secondes. */
export function formatHm(ts: number): string {
  const d = new Date(ts * 1000);
  const h = String(d.getHours()).padStart(2, "0");
  const m = String(d.getMinutes()).padStart(2, "0");
  return `${h}:${m}`;
}

/** Durée lisible : "1 h 05" au-delà d'une heure, sinon "45 min" (0 → "0 min"). */
export function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${h} h ${String(m).padStart(2, "0")}`;
}

/**
 * Libellé « collecté il y a N min » de la barre du haut (§8), à partir du plus
 * récent timestamp de `ActivityStatus.lastCollect` (une entrée par source :
 * git, claude, clickup). Aucune entrée → "jamais collecté". Une horloge en
 * dérive (dernière collecte dans le futur) est plancherée à 0 min plutôt que
 * d'afficher une durée négative.
 */
export function collectedAgoLabel(lastCollect: Record<string, number>, now: number): string {
  const values = Object.values(lastCollect);
  if (values.length === 0) return "jamais collecté";
  const last = Math.max(...values);
  const minutes = Math.max(0, Math.floor((now - last) / 60));
  return `collecté il y a ${minutes} min`;
}
