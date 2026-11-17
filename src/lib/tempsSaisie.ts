import type { ActivityEvent, Reunion, SaisieSettings, TicketRef } from "./activityApi";
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
 * écoulé (`ecouleAujourdhui`). Les réunions relevées (agenda Outlook)
 * vont sur l'US de réunion, à leur heure et pour leur durée ; l'activité mesurée
 * pendant une réunion ne compte pour aucune US. Le reste de la cible — temps
 * mesuré, activité sans US (dépôt perso, `master`) et temps non tracé — est
 * lissé au prorata sur les US travaillées ce jour-là ; un jour sans US le
 * répartit sur le « Reste à faire », et seulement à défaut sur la réunion. Un
 * jour sans activité ni réunion n'a rien à saisir ; le week-end n'a pas de
 * cible, seul le mesuré compte.
 *
 * Les entrées proposées (`entrees`) placent les réunions à leur heure, puis les
 * US dans l'ordre de leur première activité, sur les quarts d'heure libres à
 * partir du début de journée — réunions et pause de midi évitées.
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
  /** Projet(s) où l'US a été travaillée ; vide pour une US du « Reste à faire » sans activité. */
  projets: string[];
  /** Temps mesuré, non arrondi. */
  minutes: number;
  /** Ce qu'on saisit, en multiples de 15 min. */
  saisie: number;
  /** Première activité sur l'US dans la plage (epoch s), 0 sans activité. */
  debut: number;
}

/** Une réunion telle que saisie : bornes au quart d'heure (epoch s). */
export interface ReunionPlacee {
  titre: string;
  debut: number;
  fin: number;
}

export interface LigneReunion {
  /** `null` : US de réunion inconnue (aucune collecte ne l'a trouvée, pas de réglage). */
  ticket: TicketRef | null;
  /** Réunions relevées de la plage. */
  reunions: ReunionPlacee[];
  saisie: number;
  /** Première activité de la plage (epoch s), 0 sans activité. */
  debut: number;
}

export interface TempsSaisie {
  us: LigneTemps[];
  reunion: LigneReunion;
  /** Activité mesurée sans US, par projet (minutes non arrondies) : lissée sur les US. */
  horsUs: Array<{ projet: string; minutes: number }>;
  /** Somme des saisies : la cible de chaque jour travaillé. */
  total: number;
  /** Jours travaillés de la plage (au moins un événement ou une réunion). */
  jours: number;
  /** Entrées de temps proposées, heure par heure, dans l'ordre chronologique. */
  entrees: EntreeTemps[];
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
/** Activité sur la branche de l'US de réunion elle-même : saisie sur la réunion. */
const SUR_REUNION = "\u0000reunion";

/** Pause déjeuner la plus longue retenue : 1 h 30. */
const PAUSE_MAX = 6;

/**
 * Pause déjeuner entre les quarts `debut` et `fin` : le plus long trou sans
 * activité, refermé par une reprise, qui chevauche 12 h – 14 h du jour de `ref`,
 * ramené à 1 h 30 au plus avant 14 h, et à midi s'il a commencé avant 11 h 30 —
 * un trou de 9 h 45 à 14 h 15, c'est du travail non tracé autour d'un déjeuner,
 * pas quatre heures et demie de pause. 30 min au moins. Un trou encore ouvert n'est pas une pause : on est
 * peut-être en réunion. `null` sans pause.
 */
function pauseMidi(actifs: Set<number>, debut: number, fin: number, ref: number): { de: number; n: number } | null {
  const midi = new Date(ref * 1000);
  midi.setHours(12, 0, 0, 0);
  const midiQ = Math.floor(midi.getTime() / 1000 / QUART);
  const quatorzeQ = midiQ + 8;
  let pause: { de: number; n: number } | null = null;
  let trou = 0;
  for (let q = debut; q < fin; q++) {
    if (!actifs.has(q)) {
      trou += 1;
      continue;
    }
    // Trou refermé par une reprise : [q − trou, q − 1] chevauche-t-il 12 h – 14 h ?
    if (trou > 0 && q - 1 >= midiQ && q - trou < quatorzeQ) {
      const de = q - trou >= midiQ - 2 ? q - trou : midiQ;
      const n = Math.min(q, quatorzeQ, de + PAUSE_MAX) - de;
      if (n > (pause?.n ?? 0)) pause = { de, n };
    }
    trou = 0;
  }
  return pause && pause.n >= 2 ? pause : null;
}

/**
 * Temps de travail déjà écoulé aujourd'hui, en tranches de 15 min : du premier
 * quart actif (activité ou réunion) au quart d'heure entamé, moins la pause
 * déjeuner (`pauseMidi`). À appeler avant `comblerTrous`, qui boucherait une pause courte.
 */
export function ecouleAujourdhui(quarts: Map<number, unknown>, maintenant: number): number {
  const actifs = new Set(quarts.keys());
  if (actifs.size === 0) return 0;
  const debut = Math.min(...actifs);
  const fin = Math.floor(maintenant / QUART); // quart en cours, non compté
  if (fin <= debut) return 0;
  const pause = pauseMidi(actifs, debut, fin, maintenant);
  return Math.max(0, fin - debut - (pause?.n ?? 0)) * 15;
}

/** Quarts d'heure vides tolérés entre deux activités sur la même US (45 min d'écart au plus). */
export const TROU_MAX = 2;

/**
 * Comble les trous courts entre deux quarts d'heure actifs d'une même US : un
 * quart d'heure sans événement entre deux prompts, c'est Claude qui travaille
 * ou une relecture dans l'IDE, pas une absence. Le quart comblé compte comme un
 * événement de l'US (partagé avec les autres au prorata). L'activité sans US
 * n'est pas comblée : elle est de toute façon lissée sur les US.
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

/** Quarts d'heure d'une réunion : début et durée arrondis au quart d'heure. */
function quartsDeReunion(r: Reunion): { q0: number; n: number } {
  return { q0: Math.round(r.debut / QUART), n: Math.max(1, Math.round((r.fin - r.debut) / QUART)) };
}

interface Jour {
  semaine: number;
  /** Un instant du jour, pour situer midi. */
  ref: number;
  quarts: Map<number, Map<string, number>>;
  /** Première activité de chaque clé ce jour-là (epoch s). */
  premiers: Map<string, number>;
  reunions: Reunion[];
}

/** Ce qu'un jour fait saisir, par id de tâche, dans l'ordre de placement. */
type Part = { id: string; minutes: number };

/**
 * Place les parts d'un jour : les réunions à leur heure (dans la limite de
 * `reunionMinutes`), le reste sur les quarts libres à partir du début de
 * journée, en sautant réunions et pause de midi. Pur.
 */
function planifierJour(
  actifs: Set<number>,
  reunionQ: number[],
  reunionId: string | null,
  reunionMinutes: number,
  parts: Part[],
  ref: number,
): EntreeTemps[] {
  const tous = [...actifs, ...reunionQ];
  if (tous.length === 0) return [];
  const debut = Math.min(...tous);
  const fin = Math.max(...tous) + 1;
  const pause = pauseMidi(new Set(tous), debut, fin, ref);
  const occupes = new Set(reunionQ);
  const blocs: Array<{ id: string; q: number }> = [];

  // Réunions, dans l'ordre chronologique et dans la limite de la cible.
  let reste = reunionId ? reunionMinutes / 15 : 0;
  for (const q of [...reunionQ].sort((a, b) => a - b)) {
    if (reste <= 0) break;
    blocs.push({ id: reunionId!, q });
    reste -= 1;
  }

  let q = debut;
  for (const part of parts) {
    for (let n = part.minutes / 15; n > 0; n--) {
      while (occupes.has(q) || (pause && q >= pause.de && q < pause.de + pause.n)) q++;
      blocs.push({ id: part.id, q });
      q++;
    }
  }

  // Quarts contigus d'une même tâche → une entrée.
  blocs.sort((a, b) => a.q - b.q);
  const entrees: Array<{ taskId: string; q: number; n: number }> = [];
  for (const b of blocs) {
    const der = entrees[entrees.length - 1];
    if (der && der.taskId === b.id && der.q + der.n === b.q) der.n += 1;
    else entrees.push({ taskId: b.id, q: b.q, n: 1 });
  }
  return entrees.map((e) => ({ taskId: e.taskId, debut: debutEntree(e.q * QUART), minutes: e.n * 15 }));
}

/**
 * `noms` : nom affiché par dossier de workspace. `reunionUs` : US de réunion
 * (celle des réglages, sinon celle du sprint), déjà résolue par le backend.
 * `reunions` : réunions relevées de la plage. `ouvertes` : le « Reste à faire »,
 * repli d'un jour sans US travaillée.
 */
export function tempsParUs(
  events: ActivityEvent[],
  noms: Map<string, string>,
  reglages: SaisieSettings,
  reunionUs: TicketRef | null,
  /** Epoch secondes : la journée en cours ne vise que le temps déjà écoulé. */
  maintenant: number,
  reunions: Reunion[] = [],
  ouvertes: TicketRef[] = [],
): TempsSaisie {
  // Le réglage « US de réunion » est déjà appliqué par le backend (activity_reunion_us).
  const reunion = reunionUs;

  // jour → quart d'heure → clé → nombre d'événements
  const jours = new Map<string, Jour>();
  const tickets = new Map<string, { ticket: TicketRef; projets: Set<string>; debut: number }>();
  let premier = Infinity;
  const jourDe = (ts: number): Jour => {
    const k = cleJour(ts);
    const jour = jours.get(k) ?? { semaine: new Date(ts * 1000).getDay(), ref: ts, quarts: new Map(), premiers: new Map(), reunions: [] };
    jours.set(k, jour);
    return jour;
  };

  for (const ev of events) {
    // Les sessions Claude enveloppent les prompts (comptés un par un) ; un
    // changement ClickUp n'a pas de projet : rien de travaillé à saisir.
    if (ev.kind === "claude_session" || !ev.workspaceDir) continue;
    const projet = nomProjet(ev.workspaceDir, noms);
    const ticket = usDe(ev);
    let cle: string;
    if (ticket && reunion && ticket.id === reunion.id) {
      cle = SUR_REUNION;
    } else if (ticket) {
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
    const jour = jourDe(ev.ts);
    const q = Math.floor(ev.ts / QUART);
    const parCle = jour.quarts.get(q) ?? new Map<string, number>();
    parCle.set(cle, (parCle.get(cle) ?? 0) + 1);
    jour.quarts.set(q, parCle);
    jour.premiers.set(cle, Math.min(jour.premiers.get(cle) ?? Infinity, ev.ts));
  }
  // Une réunion ne compte qu'une fois finie : celles à venir attendent.
  for (const r of reunions) {
    if (r.fin > maintenant) continue;
    jourDe(r.debut).reunions.push(r);
    premier = Math.min(premier, r.debut);
  }

  const mesure = new Map<string, number>(); // clé → minutes, toute la plage
  const saisie = new Map<string, number>(); // id d'US → minutes saisies
  let saisieReunion = 0;
  const entrees: EntreeTemps[] = [];
  const placees: ReunionPlacee[] = [];
  const repli = ouvertes.filter((t) => t.id !== reunion?.id);

  const aujourdhui = cleJour(maintenant);
  for (const [k, jour] of [...jours.entries()].sort((a, b) => a[1].ref - b[1].ref)) {
    const reunionQ = new Set<number>();
    for (const r of jour.reunions) {
      const { q0, n } = quartsDeReunion(r);
      for (let q = q0; q < q0 + n; q++) reunionQ.add(q);
      placees.push({ titre: r.titre, debut: q0 * QUART, fin: (q0 + n) * QUART });
    }
    const actifs = new Set(jour.quarts.keys());
    const occupe = new Map<number, unknown>([...actifs, ...reunionQ].map((q) => [q, null]));
    const ecoule = k === aujourdhui ? ecouleAujourdhui(occupe, maintenant) : Infinity;
    comblerTrous(jour.quarts);
    // Pendant une réunion, on est en réunion : l'activité mesurée n'y compte pas.
    for (const q of reunionQ) jour.quarts.delete(q);

    const duJour = new Map<string, number>();
    for (const parCle of jour.quarts.values()) {
      let total = 0;
      for (const n of parCle.values()) total += n;
      for (const [cle, n] of parCle) duJour.set(cle, (duJour.get(cle) ?? 0) + (QUART * n) / total / 60);
    }
    for (const [cle, m] of duJour) mesure.set(cle, (mesure.get(cle) ?? 0) + m);

    // US du jour, dans l'ordre de leur première activité.
    const cles = [...duJour.keys()]
      .filter((c) => !c.startsWith(HORS_US))
      .sort((a, b) => (jour.premiers.get(a) ?? 0) - (jour.premiers.get(b) ?? 0));
    const arrondis = cles.map((c) => arrondiQuart(duJour.get(c)!));
    const hors = [...duJour.entries()].filter(([c]) => c.startsWith(HORS_US)).reduce((s, [, m]) => s + m, 0);
    const reunionMin = reunionQ.size * 15;
    const pleine = cibleDuJour(jour.semaine, reglages);
    // Week-end : pas de cible, le mesuré seul ; sans US, l'activité sans US n'est pas saisie.
    const cible =
      pleine === 0
        ? reunionMin + (cles.length > 0 ? arrondis.reduce((s, m) => s + m, 0) + arrondiQuart(hors) : 0)
        : Math.min(pleine, ecoule);

    // Les réunions d'abord, à leur heure ; au-delà de la cible, elles ne sont pas saisies.
    const reunionsHeure = Math.min(reunionMin, cible);
    const dispo = cible - reunionsHeure;
    let parts: Part[] = [];
    let repliReunion = 0;
    if (cles.length > 0) {
      const lisses = ramenerA(arrondis, dispo);
      parts = cles.map((c, i) => ({ id: c, minutes: lisses[i] }));
    } else if (repli.length > 0) {
      const lisses = ramenerA(repli.map(() => 1), dispo);
      parts = repli.map((t, i) => ({ id: t.id, minutes: lisses[i] }));
    } else {
      repliReunion = dispo;
    }
    parts = parts.filter((p) => p.minutes > 0);
    const surReunion = parts.find((p) => p.id === SUR_REUNION)?.minutes ?? 0;
    saisieReunion += reunionsHeure + surReunion + repliReunion;
    for (const p of parts) if (p.id !== SUR_REUNION) saisie.set(p.id, (saisie.get(p.id) ?? 0) + p.minutes);

    // Le temps de réunion hors réunions relevées se place comme une US ; sans US de réunion, il n'a pas d'entrée.
    const reunionId = reunion?.id ?? null;
    const aPlacer = parts.flatMap((p) => (p.id !== SUR_REUNION ? [p] : reunionId ? [{ id: reunionId, minutes: p.minutes }] : []));
    if (reunionId && repliReunion > 0) aPlacer.push({ id: reunionId, minutes: repliReunion });
    entrees.push(...planifierJour(actifs, [...reunionQ], reunionId, reunionsHeure, aPlacer, jour.ref));
  }

  const lignes = new Map<string, LigneTemps>();
  for (const [cle, t] of tickets) {
    lignes.set(cle, { cle, ticket: t.ticket, projets: [...t.projets].sort(), minutes: mesure.get(cle) ?? 0, debut: t.debut, saisie: saisie.get(cle) ?? 0 });
  }
  for (const t of repli) {
    const m = saisie.get(t.id) ?? 0;
    if (m > 0 && !lignes.has(t.id)) lignes.set(t.id, { cle: t.id, ticket: t, projets: [], minutes: 0, debut: 0, saisie: m });
  }
  // Une US vue seulement pendant une réunion n'a rien à saisir.
  const us = [...lignes.values()].filter((l) => l.saisie > 0 || l.minutes > 0).sort((a, b) => b.saisie - a.saisie || b.minutes - a.minutes || a.cle.localeCompare(b.cle));
  const horsUs = [...mesure.entries()]
    .filter(([c]) => c.startsWith(HORS_US))
    .map(([c, minutes]) => ({ projet: c.slice(HORS_US.length), minutes }))
    .sort((a, b) => b.minutes - a.minutes);
  const total = us.reduce((s, l) => s + l.saisie, 0) + saisieReunion;
  const debut = Number.isFinite(premier) ? premier : 0;
  return {
    us,
    reunion: { ticket: reunion, reunions: placees, saisie: saisieReunion, debut },
    horsUs,
    total,
    jours: jours.size,
    entrees,
  };
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
 * Ce qu'il reste à saisir dans ClickUp : les entrées proposées moins le déjà
 * saisi (`saisies`, par id de tâche), retiré des premières entrées de chaque
 * tâche. `id` : seulement les entrées de cette tâche.
 */
export function entreesRestantes(temps: TempsSaisie, saisies: Record<string, number>, id?: string): EntreeTemps[] {
  const deja = { ...saisies };
  const restantes: EntreeTemps[] = [];
  for (const e of temps.entrees) {
    const couvert = Math.min(deja[e.taskId] ?? 0, e.minutes);
    deja[e.taskId] = (deja[e.taskId] ?? 0) - couvert;
    const reste = e.minutes - couvert;
    if (reste <= 0 || (id !== undefined && e.taskId !== id)) continue;
    // Une entrée entamée reprend là où la saisie précédente s'est arrêtée.
    restantes.push({ ...e, debut: couvert > 0 ? decaler(e.debut, couvert) : e.debut, minutes: reste });
  }
  return restantes;
}

/** « AAAA-MM-JJ HH:MM » + `minutes`, sans arrondi. */
function decaler(debut: string, minutes: number): string {
  const [date, heure] = debut.split(" ");
  const [a, mo, j] = date.split("-").map(Number);
  const [h, mi] = heure.split(":").map(Number);
  const d = new Date(a, mo - 1, j, h, mi + minutes);
  return `${d.getFullYear()}-${deuxChiffres(d.getMonth() + 1)}-${deuxChiffres(d.getDate())} ${deuxChiffres(d.getHours())}:${deuxChiffres(d.getMinutes())}`;
}

/** Où en est la saisie d'une ligne du récap (bouton « Saisir », reste, « saisi »). */
export type EtatLigne = "a-saisir" | "partiel" | "saisi" | "en-cours";

export function etatLigne(propose: number, deja: number, enCours: boolean): EtatLigne {
  if (enCours) return "en-cours";
  if (deja >= propose) return "saisi";
  return deja > 0 ? "partiel" : "a-saisir";
}
