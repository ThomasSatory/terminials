import type { ActivityEvent, SaisieSettings, TicketRef } from "./activityApi";
import { usDe } from "./frise";

/**
 * Temps à saisir par US : aide à la saisie des temps dans ClickUp.
 *
 * Mesure : un quart d'heure (aligné sur l'epoch) compte dès qu'il porte un
 * événement, partagé entre les US travaillées dedans au prorata de leurs
 * événements (deux worktrees menés de front ne comptent pas double). Les trous
 * courts entre deux activités sur une même US sont comblés (`TROU_MAX`).
 *
 * Saisie, jour par jour : chaque jour travaillé doit totaliser sa cible
 * (7 h 30, 7 h le vendredi par défaut) ; aujourd'hui, seulement le temps déjà
 * écoulé (`ecouleAujourdhui`), pour ne pas proposer des heures de réunion à venir. Les US gardent leur temps mesuré,
 * arrondi au quart d'heure ; tout le reste — activité sans US (dépôt perso,
 * `master`) et temps non tracé (réunions, lecture…) — va sur l'US de réunion.
 * Si les US dépassent la cible, elles sont ramenées à la cible au prorata. Un
 * jour sans aucune activité (congé, jour à venir) n'a rien à saisir ; le
 * week-end n'a pas de cible, seul le mesuré compte.
 *
 * Pur : ni DOM, ni appel Tauri.
 */

const QUART = 900;

/** Réglages tant que ceux du backend ne sont pas lus (mêmes valeurs que `SaisieSettings::default`). */
export const SAISIE_PAR_DEFAUT: SaisieSettings = { journeeMinutes: 450, vendrediMinutes: 420, usReunion: "" };

export interface LigneTemps {
  /** Id de l'US. */
  cle: string;
  ticket: TicketRef;
  /** Projet(s) où l'US a été travaillée. */
  projets: string[];
  /** Temps mesuré, non arrondi. */
  minutes: number;
  /** Ce qu'on saisit, en multiples de 15 min. */
  saisie: number;
  /** Première activité sur l'US dans la plage (epoch s) : début de l'entrée de temps. */
  debut: number;
}

export interface LigneReunion {
  /** `null` : US de réunion inconnue (aucune collecte ne l'a trouvée, pas de réglage). */
  ticket: TicketRef | null;
  /** Activité mesurée sans US, par projet (minutes non arrondies). */
  horsUs: Array<{ projet: string; minutes: number }>;
  saisie: number;
  /** Première activité de la plage (epoch s), 0 sans activité. */
  debut: number;
}

export interface TempsSaisie {
  us: LigneTemps[];
  reunion: LigneReunion;
  /** Somme des saisies : la cible de chaque jour travaillé. */
  total: number;
  /** Jours travaillés de la plage (au moins un événement). */
  jours: number;
}

/** Arrondi au quart d'heure le plus proche, jamais sous 15 min pour un temps non nul. */
export function arrondiQuart(minutes: number): number {
  if (minutes <= 0) return 0;
  return Math.max(15, Math.round(minutes / 15) * 15);
}

/** Minutes à saisir pour un jour de la semaine (0 = dimanche). */
export function cibleDuJour(jourSemaine: number, reglages: SaisieSettings): number {
  if (jourSemaine === 0 || jourSemaine === 6) return 0;
  return jourSemaine === 5 ? reglages.vendrediMinutes : reglages.journeeMinutes;
}

/**
 * Ramène des minutes à `cible` en quarts d'heure, au prorata (plus forts restes).
 * Pur, exporté pour les tests.
 */
export function ramenerA(minutes: number[], cible: number): number[] {
  const total = minutes.reduce((s, m) => s + m, 0);
  const quarts = Math.floor(cible / 15);
  if (total <= 0 || quarts <= 0) return minutes.map(() => 0);
  const exacts = minutes.map((m) => (m * quarts) / total);
  const parts = exacts.map(Math.floor);
  let reste = quarts - parts.reduce((s, p) => s + p, 0);
  const ordre = exacts.map((e, i) => ({ i, f: e - Math.floor(e) })).sort((a, b) => b.f - a.f);
  for (const { i } of ordre) {
    if (reste <= 0) break;
    parts[i] += 1;
    reste -= 1;
  }
  return parts.map((p) => p * 15);
}

function cleJour(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
}

function nomProjet(dir: string, noms: Map<string, string>): string {
  return noms.get(dir) ?? dir.split("/").filter(Boolean).pop() ?? dir;
}

const HORS_US = "\u0000hors-us:";

/**
 * Temps de travail déjà écoulé aujourd'hui, en tranches de 15 min : de la
 * première activité du jour au quart d'heure entamé, moins la pause
 * déjeuner — le plus long trou sans activité (30 min au moins), suivi d'une
 * reprise, qui chevauche 12 h – 14 h. À appeler avant `comblerTrous`, qui boucherait une pause courte.
 */
export function ecouleAujourdhui(quarts: Map<number, unknown>, maintenant: number): number {
  const actifs = [...quarts.keys()];
  if (actifs.length === 0) return 0;
  const debut = Math.min(...actifs);
  const fin = Math.floor(maintenant / QUART); // quart en cours, non compté
  if (fin <= debut) return 0;
  const midi = new Date(maintenant * 1000);
  midi.setHours(12, 0, 0, 0);
  const midiQ = Math.floor(midi.getTime() / 1000 / QUART);
  const quatorzeQ = midiQ + 8;
  let pause = 0;
  let trou = 0;
  for (let q = debut; q < fin; q++) {
    if (!quarts.has(q)) {
      trou += 1;
      continue;
    }
    // Trou refermé par une reprise : [q − trou, q − 1] chevauche-t-il 12 h – 14 h ?
    // Un trou encore ouvert (rien depuis) n'est pas une pause : on est peut-être
    // en réunion, et c'est justement ce temps-là qu'il faut saisir.
    if (trou > 0 && q - 1 >= midiQ && q - trou < quatorzeQ) pause = Math.max(pause, trou);
    trou = 0;
  }
  if (pause < 2) pause = 0;
  return Math.max(0, fin - debut - pause) * 15;
}

/** Quarts d'heure vides tolérés entre deux activités sur la même US (45 min d'écart au plus). */
export const TROU_MAX = 2;

/**
 * Comble les trous courts entre deux quarts d'heure actifs d'une même US : un
 * quart d'heure sans événement entre deux prompts, c'est Claude qui travaille
 * ou une relecture dans l'IDE, pas une absence. Le quart comblé compte comme un
 * événement de l'US (partagé avec les autres au prorata). L'activité sans US
 * n'est pas comblée : elle finit de toute façon sur la réunion.
 */
function comblerTrous(quarts: Map<number, Map<string, number>>): void {
  const parCle = new Map<string, number[]>();
  for (const [q, cles] of quarts) {
    for (const cle of cles.keys()) {
      if (!cle.startsWith(HORS_US)) parCle.set(cle, [...(parCle.get(cle) ?? []), q]);
    }
  }
  for (const [cle, qs] of parCle) {
    qs.sort((a, b) => a - b);
    for (let i = 1; i < qs.length; i++) {
      const vides = qs[i] - qs[i - 1] - 1;
      if (vides < 1 || vides > TROU_MAX) continue;
      for (let q = qs[i - 1] + 1; q < qs[i]; q++) {
        const cles = quarts.get(q) ?? new Map<string, number>();
        cles.set(cle, (cles.get(cle) ?? 0) + 1);
        quarts.set(q, cles);
      }
    }
  }
}

/**
 * `noms` : nom affiché par dossier de workspace. `reunionUs` : US de réunion
 * (celle des réglages, sinon celle du sprint), déjà résolue par le backend.
 */
export function tempsParUs(
  events: ActivityEvent[],
  noms: Map<string, string>,
  reglages: SaisieSettings,
  reunionUs: TicketRef | null,
  /** Epoch secondes : la journée en cours ne vise que le temps déjà écoulé. */
  maintenant: number,
): TempsSaisie {
  // Le réglage « US de réunion » est déjà appliqué par le backend (activity_reunion_us).
  const reunion = reunionUs;

  // jour → quart d'heure → clé → nombre d'événements
  const jours = new Map<string, { semaine: number; quarts: Map<number, Map<string, number>> }>();
  const tickets = new Map<string, { ticket: TicketRef; projets: Set<string>; debut: number }>();
  let premier = Infinity;

  for (const ev of events) {
    // Les sessions Claude enveloppent les prompts (comptés un par un) ; un
    // changement ClickUp n'a pas de projet : rien de travaillé à saisir.
    if (ev.kind === "claude_session" || !ev.workspaceDir) continue;
    const projet = nomProjet(ev.workspaceDir, noms);
    const ticket = usDe(ev);
    let cle: string;
    if (ticket && ticket.id !== reunion?.id) {
      cle = ticket.id;
      const t = tickets.get(cle) ?? { ticket, projets: new Set<string>(), debut: ev.ts };
      t.debut = Math.min(t.debut, ev.ts);
      // Le nom et l'état résolus l'emportent sur une référence nue.
      if (!t.ticket.name && ticket.name) t.ticket = ticket;
      t.projets.add(projet);
      tickets.set(cle, t);
    } else {
      cle = HORS_US + projet;
    }
    premier = Math.min(premier, ev.ts);
    const k = cleJour(ev.ts);
    const jour = jours.get(k) ?? { semaine: new Date(ev.ts * 1000).getDay(), quarts: new Map() };
    const q = Math.floor(ev.ts / QUART);
    const parCle = jour.quarts.get(q) ?? new Map<string, number>();
    parCle.set(cle, (parCle.get(cle) ?? 0) + 1);
    jour.quarts.set(q, parCle);
    jours.set(k, jour);
  }

  const mesure = new Map<string, number>(); // clé → minutes, toute la plage
  const saisie = new Map<string, number>(); // id d'US → minutes saisies
  let saisieReunion = 0;

  const aujourdhui = cleJour(maintenant);
  for (const [k, jour] of jours) {
    const ecoule = k === aujourdhui ? ecouleAujourdhui(jour.quarts, maintenant) : Infinity;
    comblerTrous(jour.quarts);
    const duJour = new Map<string, number>();
    for (const parCle of jour.quarts.values()) {
      let total = 0;
      for (const n of parCle.values()) total += n;
      for (const [cle, n] of parCle) duJour.set(cle, (duJour.get(cle) ?? 0) + (QUART * n) / total / 60);
    }
    for (const [cle, m] of duJour) mesure.set(cle, (mesure.get(cle) ?? 0) + m);

    const cles = [...duJour.keys()].filter((c) => !c.startsWith(HORS_US));
    const arrondis = cles.map((c) => arrondiQuart(duJour.get(c)!));
    const sommeUs = arrondis.reduce((s, m) => s + m, 0);
    const pleine = cibleDuJour(jour.semaine, reglages);
    const cible = Math.min(pleine, ecoule);
    let parts = arrondis;
    if (cible === 0) {
      // Week-end : pas de cible, le mesuré sans US va tel quel à la réunion.
      const hors = [...duJour.entries()].filter(([c]) => c.startsWith(HORS_US)).reduce((s, [, m]) => s + m, 0);
      saisieReunion += arrondiQuart(hors);
    } else if (sommeUs > cible) {
      parts = ramenerA(arrondis, cible);
    } else {
      saisieReunion += cible - sommeUs;
    }
    cles.forEach((c, i) => saisie.set(c, (saisie.get(c) ?? 0) + parts[i]));
  }

  const us: LigneTemps[] = [...tickets.entries()]
    .map(([cle, t]) => ({
      cle,
      ticket: t.ticket,
      projets: [...t.projets].sort(),
      minutes: mesure.get(cle) ?? 0,
      debut: t.debut,
      saisie: saisie.get(cle) ?? 0,
    }))
    .sort((a, b) => b.saisie - a.saisie || b.minutes - a.minutes || a.cle.localeCompare(b.cle));
  const horsUs = [...mesure.entries()]
    .filter(([c]) => c.startsWith(HORS_US))
    .map(([c, minutes]) => ({ projet: c.slice(HORS_US.length), minutes }))
    .sort((a, b) => b.minutes - a.minutes);
  const total = us.reduce((s, l) => s + l.saisie, 0) + saisieReunion;
  const debut = Number.isFinite(premier) ? premier : 0;
  return { us, reunion: { ticket: reunion, horsUs, saisie: saisieReunion, debut }, total, jours: jours.size };
}

/** Une entrée à créer dans ClickUp (miroir de `EntreeTemps` côté Rust). */
export interface EntreeTemps {
  taskId: string;
  /** « AAAA-MM-JJ HH:MM », heure locale, au quart d'heure. */
  debut: string;
  minutes: number;
}

function deuxChiffres(n: number): string {
  return String(n).padStart(2, "0");
}

/** Epoch → « AAAA-MM-JJ HH:MM » local, ramené au quart d'heure inférieur. */
export function debutEntree(ts: number): string {
  const d = new Date(Math.floor(ts / QUART) * QUART * 1000);
  return `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())} ${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`;
}

/**
 * Ce qu'il reste à saisir dans ClickUp : le proposé moins le déjà saisi
 * (`saisies`, par id d'US), ligne par ligne. Rien pour une US déjà couverte ni
 * pour une réunion inconnue.
 */
export function entreesRestantes(temps: TempsSaisie, saisies: Record<string, number>): EntreeTemps[] {
  const lignes = temps.us.map((l) => ({ id: l.ticket.id, saisie: l.saisie, debut: l.debut }));
  if (temps.reunion.ticket) {
    lignes.push({ id: temps.reunion.ticket.id, saisie: temps.reunion.saisie, debut: temps.reunion.debut });
  }
  return lignes
    .map((l) => ({ taskId: l.id, debut: debutEntree(l.debut), minutes: l.saisie - (saisies[l.id] ?? 0) }))
    .filter((e) => e.minutes > 0);
}
