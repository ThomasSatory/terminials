import type { ActivityEvent, Reunion, TicketRef } from "./activityApi";
import { dayRange, isWeekend, shiftDay, toDayString, weekRange } from "./dashboardDay";
import { extraitPrompt, usDe, type Frise, type FriseCell } from "./frise";
import { parseMarkdown, type Inline } from "./markdownLite";

/**
 * Logique pure du récap de la journée : tout ce que la vue affiche (sélecteur de
 * jours, chiffres, colonnes du rythme, puces du bilan, chronologie, texte du
 * daily) est calculé ici à partir des données réelles, sans DOM ni appel Tauri.
 * Les composants ne font que peindre ces structures.
 */

const QUART = 900;

// ---------------------------------------------------------------- Formats

/** « 45 min », « 2 h », « 2 h 05 » : la notation des maquettes (pas de « 1 h 00 »). */
export function duree(minutes: number): string {
  const m = Math.max(0, Math.round(minutes));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  return r === 0 ? `${h} h` : `${h} h ${String(r).padStart(2, "0")}`;
}

/** « 9h05 » : heure locale d'un epoch (secondes). */
export function heure(ts: number): string {
  const d = new Date(ts * 1000);
  return `${d.getHours()}h${String(d.getMinutes()).padStart(2, "0")}`;
}

function jourEnDate(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, m - 1, d);
}

const COURT = new Intl.DateTimeFormat("fr-FR", { weekday: "short", day: "numeric" });

/** « lun. 16 » : libellé d'un bouton du sélecteur de jours. */
export function jourCourt(day: string): string {
  return COURT.format(jourEnDate(day));
}

/**
 * Numéro de semaine ISO 8601 (la semaine 1 contient le premier jeudi de l'année),
 * affiché dans la barre du haut du récap.
 */
export function numeroSemaine(day: string): number {
  const jeudi = jourEnDate(day);
  jeudi.setDate(jeudi.getDate() - ((jeudi.getDay() + 6) % 7) + 3);
  const premier = new Date(jeudi.getFullYear(), 0, 4);
  premier.setDate(premier.getDate() - ((premier.getDay() + 6) % 7) + 3);
  // `round` absorbe l'heure d'écart d'un changement d'heure entre les deux jeudis.
  return 1 + Math.round((jeudi.getTime() - premier.getTime()) / (7 * 24 * 3600 * 1000));
}

/** « 3 commits », « 1 commit », « 0 commit » : en français, le pluriel commence à 2. */
export function compte(n: number, singulier: string, pluriel: string): string {
  return `${n} ${n <= 1 ? singulier : pluriel}`;
}

// ---------------------------------------------------------------- Activité mesurée

/**
 * Un événement compte dans le rythme s'il appartient à un espace : une session
 * Claude n'est que l'enveloppe de ses prompts (déjà comptés un par un).
 */
function compteDansLeRythme(ev: ActivityEvent): ev is ActivityEvent & { workspaceDir: string } {
  return !!ev.workspaceDir && ev.kind !== "claude_session";
}

export interface Activite {
  /** Quarts d'heure actifs × 15. */
  minutes: number;
  /** Début du premier quart actif, fin du dernier (epoch s), null sans activité. */
  premier: number | null;
  dernier: number | null;
  /** Minutes actives par dossier d'espace, dans l'ordre de première activité. */
  parDir: Map<string, number>;
}

/**
 * Temps actif d'une plage : un quart d'heure compte dès qu'il porte un événement,
 * une fois par espace (deux espaces menés de front comptent chacun le quart).
 */
export function activite(events: ActivityEvent[], from: number, to: number): Activite {
  const quarts = new Set<number>();
  const parDir = new Map<string, Set<number>>();
  const tries = events.filter((ev) => ev.ts >= from && ev.ts < to).sort((a, b) => a.ts - b.ts);
  for (const ev of tries) {
    if (!compteDansLeRythme(ev)) continue;
    const q = Math.floor(ev.ts / QUART);
    quarts.add(q);
    const set = parDir.get(ev.workspaceDir) ?? new Set<number>();
    set.add(q);
    parDir.set(ev.workspaceDir, set);
  }
  const liste = [...quarts];
  return {
    minutes: quarts.size * 15,
    premier: liste.length ? Math.min(...liste) * QUART : null,
    dernier: liste.length ? (Math.max(...liste) + 1) * QUART : null,
    parDir: new Map([...parDir].map(([dir, qs]) => [dir, qs.size * 15])),
  };
}

// ---------------------------------------------------------------- Sélecteur de jours

export interface JourSelecteur {
  day: string;
  label: string;
  /** « Lundi 16 novembre » (lecteur d'écran, surtitre). */
  long: string;
  future: boolean;
  aujourdhui: boolean;
  minutes: number;
  /** Répartition par espace, dans l'ordre de première activité. */
  barre: Array<{ dir: string; couleur: string; minutes: number }>;
}

const LONG = new Intl.DateTimeFormat("fr-FR", { weekday: "long", day: "numeric", month: "long" });

/** « Lundi 16 novembre ». */
export function jourLong(day: string): string {
  const s = LONG.format(jourEnDate(day));
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Jours du sélecteur : la semaine ouvrée de `day`, plus `day` lui-même s'il tombe
 * un week-end (on ne cache jamais le jour affiché). `events` couvre la semaine.
 */
export function joursSelecteur(
  day: string,
  today: string,
  events: ActivityEvent[],
  couleur: (dir: string) => string,
): JourSelecteur[] {
  const jours = [...weekRange(day).days];
  if (isWeekend(day)) jours.push(day);
  jours.sort();
  return jours.map((d) => {
    const { from, to } = dayRange(d);
    const a = activite(events, from, to);
    return {
      day: d,
      label: jourCourt(d),
      long: jourLong(d),
      future: d > today,
      aujourdhui: d === today,
      minutes: a.minutes,
      barre: [...a.parDir].map(([dir, minutes]) => ({ dir, couleur: couleur(dir), minutes })),
    };
  });
}

/**
 * Jour ouvré voisin (`delta` = ±1) pour les chevrons et `[` `]` : les week-ends sont
 * sautés, et l'on ne va jamais au-delà d'aujourd'hui (null : pas de voisin).
 */
export function jourVoisin(day: string, delta: 1 | -1, today: string): string | null {
  let d = shiftDay(day, delta);
  while (isWeekend(d) && d !== today) d = shiftDay(d, delta);
  return d > today ? null : d;
}

// ---------------------------------------------------------------- Rythme (frise empilée)

export interface Segment {
  dir: string;
  name: string;
  couleur: string;
  /** Hauteur relative à la pile la plus haute de la plage, 0..1. */
  part: number;
  /** Part du créneau attribuée à l'espace, au prorata de ses événements. */
  minutes: number;
  /** « 3 échanges, 1 commit ». */
  detail: string;
  us: TicketRef[];
  /** Dernier message utile envoyé à l'agent pendant le créneau. */
  prompt: string | null;
}

export interface CommitPose {
  ts: number;
  dir: string;
  name: string;
  couleur: string;
  titre: string;
}

export interface Colonne {
  i: number;
  t0: number;
  t1: number;
  /** Créneau pas encore commencé (journée en cours). */
  future: boolean;
  /** Du bas vers le haut de la pile : l'espace le plus actif de la plage en bas. */
  segments: Segment[];
  reunions: Reunion[];
  commits: CommitPose[];
}

/** « 3 échanges, 2 commandes, 1 commit » : ce qu'un créneau contient pour un espace. */
export function detailCompteurs(c: Pick<FriseCell, "prompts" | "commands" | "commits" | "clickup">): string {
  const parts: string[] = [];
  if (c.prompts > 0) parts.push(compte(c.prompts, "échange", "échanges"));
  if (c.commands > 0) parts.push(compte(c.commands, "commande", "commandes"));
  if (c.commits > 0) parts.push(compte(c.commits, "commit", "commits"));
  if (c.clickup > 0) parts.push(compte(c.clickup, "changement de ticket", "changements de ticket"));
  return parts.join(", ");
}

/**
 * Colonnes du rythme : une par case de la frise (quart d'heure en mode jour, heure
 * en mode semaine), vides comprises, pour que l'axe du temps reste régulier.
 */
export function colonnesRythme(frise: Frise, reunions: Reunion[], maintenant: number): Colonne[] {
  const n = Math.ceil((frise.end - frise.start) / frise.cellSeconds);
  const colonnes: Colonne[] = [];
  let maxPile = 0;
  for (let i = 0; i < n; i++) {
    const t0 = frise.start + i * frise.cellSeconds;
    const t1 = t0 + frise.cellSeconds;
    const actifs = frise.rows.filter((r) => (r.cells[i]?.total ?? 0) > 0);
    const pile = actifs.reduce((s, r) => s + r.cells[i].total, 0);
    maxPile = Math.max(maxPile, pile);
    colonnes.push({
      i,
      t0,
      t1,
      future: t0 >= maintenant,
      segments: actifs.map((r) => {
        const cell = r.cells[i];
        return {
          dir: r.dir,
          name: r.name,
          couleur: r.color,
          part: cell.total,
          minutes: Math.max(1, Math.round(((frise.cellSeconds / 60) * cell.total) / pile)),
          detail: detailCompteurs(cell),
          us: cell.us,
          prompt: cell.extraits.length ? cell.extraits[cell.extraits.length - 1] : null,
        };
      }),
      reunions: reunions.filter((r) => r.debut < t1 && r.fin > t0),
      commits: frise.rows.flatMap((r) =>
        r.dots
          .filter((d) => d.ts >= t0 && d.ts < t1)
          .map((d) => ({ ts: d.ts, dir: r.dir, name: r.name, couleur: r.color, titre: d.title })),
      ),
    });
  }
  if (maxPile > 0) for (const c of colonnes) for (const s of c.segments) s.part /= maxPile;
  return colonnes;
}

/** Tous les commits de la frise, dans l'ordre du temps. */
export function commitsFrise(frise: Frise): CommitPose[] {
  return frise.rows
    .flatMap((r) => r.dots.map((d) => ({ ts: d.ts, dir: r.dir, name: r.name, couleur: r.color, titre: d.title })))
    .sort((a, b) => a.ts - b.ts);
}

/** Cercle de commit posé sur la frise : un commit, ou plusieurs trop proches pour être distingués. */
export interface GroupeCommits {
  /** Position 0..1 du cercle. */
  x: number;
  /** Du plus ancien au plus récent. */
  commits: CommitPose[];
}

/** Diamètre d'un cercle de commit (px) et écart minimal entre deux centres (px). */
export const DIAMETRE_COMMIT = 10;
export const ECART_COMMITS = DIAMETRE_COMMIT + 3;
/** Distance minimale (px) entre le centre d'un cercle et le trait « maintenant ». */
export const RETRAIT_MAINTENANT = DIAMETRE_COMMIT / 2 + 4;

/**
 * Cercles de commit de la frise, sans chevauchement (mode semaine : une heure ne fait
 * que quelques pixels) : un commit à moins de `ECART_COMMITS` px du cercle précédent le
 * rejoint, et aucun cercle ne mord sur le trait « maintenant » ni sur son étiquette.
 * `largeur` est celle de la frise en px ; inconnue (0), chaque commit garde son cercle.
 */
export function grouperCommits(
  commits: readonly CommitPose[],
  position: (ts: number) => number,
  largeur: number,
  maintenant: number | null,
): GroupeCommits[] {
  const tries = [...commits].sort((a, b) => a.ts - b.ts);
  if (largeur <= 0) return tries.map((c) => ({ x: position(c.ts), commits: [c] }));
  const xMax = maintenant === null ? Infinity : position(maintenant) * largeur - RETRAIT_MAINTENANT;
  const groupes: { px: number; commits: CommitPose[] }[] = [];
  for (const c of tries) {
    const px = Math.min(position(c.ts) * largeur, xMax);
    const dernier = groupes[groupes.length - 1];
    if (dernier && px - dernier.px < ECART_COMMITS) dernier.commits.push(c);
    else groupes.push({ px, commits: [c] });
  }
  return groupes.map((g) => ({ x: Math.max(0, g.px) / largeur, commits: g.commits }));
}

export interface Repere {
  /** Position 0..1. */
  left: number;
  label: string;
  /** Ancrage du libellé : le premier collé à gauche, le dernier à droite. */
  ancre: "debut" | "centre" | "fin";
}

/**
 * Repères de l'axe : chaque heure pleine, bornes comprises (mode jour), ou chaque
 * jour (mode semaine, libellés de `frise.ticks`).
 */
export function reperes(frise: Frise, mode: "day" | "week"): Repere[] {
  const span = frise.end - frise.start;
  if (mode === "week") return frise.ticks.map((t) => ({ left: t.left, label: t.label, ancre: "debut" }));
  const out: Repere[] = [];
  for (let t = frise.start; t <= frise.end; t += 3600) {
    out.push({ left: (t - frise.start) / span, label: `${new Date(t * 1000).getHours()}h`, ancre: "centre" });
  }
  if (out.length) {
    out[0].ancre = "debut";
    out[out.length - 1].ancre = "fin";
  }
  return out;
}

/** Position relative (0..1, bornée) d'un instant dans la frise. */
export function position(frise: Frise, ts: number): number {
  return Math.min(1, Math.max(0, (ts - frise.start) / (frise.end - frise.start)));
}

/** « 2 espaces en parallèle », « un espace actif », « aucune activité ». */
export function sousTitreCreneau(n: number): string {
  if (n > 1) return `${n} espaces en parallèle`;
  return n === 1 ? "un espace actif" : "aucune activité";
}

// ---------------------------------------------------------------- Bilan par projet

export type Etiquette = "bloqué" | "en attente" | "en cours";

/**
 * Étiquette d'une puce du bilan, lue dans sa phrase : le bilan est rédigé en prose,
 * on y reconnaît ce qui bloque, ce qui attend quelqu'un et ce qui reste en cours.
 */
export function etiquettePuce(texte: string): Etiquette | null {
  const t = texte.toLowerCase();
  if (/bloqu|block/.test(t)) return "bloqué";
  if (/en attente|attend\b|attendent\b/.test(t)) return "en attente";
  // « tourne encore », « encore sur les derniers tests » : un travail pas fini.
  if (/en cours|reste à|à finir|pas encore|inachev|\bencore\b|\btourne(nt)?\b/.test(t)) return "en cours";
  return null;
}

export interface Puce {
  inl: Inline[];
  /** Texte brut (liens réduits à leur libellé), pour le daily et l'étiquette. */
  texte: string;
  etiquette: Etiquette | null;
}

/** Texte brut d'une suite d'éléments en ligne. */
export function texteInline(inl: Inline[]): string {
  return inl.map((n) => (n.t === "link" ? n.text : n.v)).join("").trim();
}

/** Puces d'un texte markdown du bilan : items de listes et paragraphes, titres ignorés. */
export function pucesDe(markdown: string): Puce[] {
  const puces: Puce[] = [];
  const ajouter = (inl: Inline[]) => {
    const texte = texteInline(inl);
    if (texte !== "") puces.push({ inl, texte, etiquette: etiquettePuce(texte) });
  };
  for (const bloc of parseMarkdown(markdown)) {
    if (bloc.t === "ul" || bloc.t === "ol") bloc.items.forEach(ajouter);
    else if (bloc.t === "p") ajouter(bloc.inl);
  }
  return puces;
}

/** Drapeau d'une section repliée : ce qui mérite d'être vu sans la déplier. */
export function drapeauSection(puces: Puce[]): Etiquette | null {
  return (
    puces.find((p) => p.etiquette === "bloqué")?.etiquette ??
    puces.find((p) => p.etiquette === "en attente")?.etiquette ??
    null
  );
}

/**
 * Texte de « Copier pour le daily » : l'en-tête, puis chaque projet suivi de ses
 * puces, l'étiquette entre crochets. Les projets sans puce sont omis.
 */
export function texteDaily(
  entete: string,
  sections: Array<{ name: string; puces: Puce[] }>,
): string[] {
  const out = [entete, ""];
  for (const s of sections) {
    if (s.puces.length === 0) continue;
    out.push(s.name);
    for (const p of s.puces) out.push(`- ${p.texte}${p.etiquette ? ` [${p.etiquette}]` : ""}`);
    out.push("");
  }
  while (out.length && out[out.length - 1] === "") out.pop();
  return out;
}

/** Branche la plus récente vue sur un dossier dans la plage, null hors dépôt. */
export function derniereBranche(events: ActivityEvent[], dir: string): string | null {
  let best: { ts: number; branch: string } | null = null;
  for (const ev of events) {
    if (ev.workspaceDir !== dir || !ev.branch) continue;
    if (!best || ev.ts > best.ts) best = { ts: ev.ts, branch: ev.branch };
  }
  return best?.branch ?? null;
}

/** Noms des tickets connus (événements et tâches ouvertes), pour l'infobulle des pastilles. */
export function nomsTickets(events: ActivityEvent[], taches: TicketRef[]): Map<string, string> {
  const noms = new Map<string, string>();
  const noter = (t: TicketRef | null | undefined) => {
    if (t?.name && !noms.has(t.id)) noms.set(t.id, t.name);
  };
  taches.forEach(noter);
  for (const ev of events) {
    noter(ev.usTicket);
    ev.tickets.forEach(noter);
  }
  return noms;
}

/** « Bilan rédigé à 18h04 », ou « … le mar. 17 à 7h02 » s'il l'a été un autre jour. */
export function libelleRedaction(generatedAt: number, day: string): string {
  const jour = toDayString(new Date(generatedAt * 1000));
  return jour === day
    ? `Bilan rédigé à ${heure(generatedAt)}`
    : `Bilan rédigé le ${jourCourt(jour)} à ${heure(generatedAt)}`;
}

/**
 * Libellé d'un bilan affiché : « Bilan réécrit à l’instant » juste après une rédaction
 * demandée ici (maquette Recap), sinon l'heure de sa rédaction. `maintenant` en secondes.
 */
export function libelleBilan(
  s: { generatedAt: number; day: string },
  reecrit: boolean,
  maintenant: number,
): string {
  if (reecrit && maintenant - s.generatedAt < 120) return "Bilan réécrit à l’instant";
  return libelleRedaction(s.generatedAt, s.day);
}

/**
 * Rappel de la rédaction automatique, construit depuis les réglages réels : inutile
 * de promettre 7 h du lundi au vendredi si l'horaire a changé.
 */
export function phraseHoraire(schedule: { hour: number; minute: number; weekdaysOnly: boolean }): string {
  const h = schedule.minute === 0 ? `${schedule.hour} h` : `${schedule.hour} h ${String(schedule.minute).padStart(2, "0")}`;
  return `Il se rédige seul à ${h} ${schedule.weekdaysOnly ? "du lundi au vendredi" : "chaque jour"}.`;
}

// ---------------------------------------------------------------- Temps à saisir

/** « 0 ligne saisie sur 5 », « 2 lignes saisies sur 5 ». */
export function lignesSaisies(n: number, total: number): string {
  return `${n} ligne${n > 1 ? "s" : ""} saisie${n > 1 ? "s" : ""} sur ${total}`;
}

// ---------------------------------------------------------------- Chronologie

export type GenreChrono = "commit" | "prompt" | "shell" | "reunion" | "ticket";

export interface ItemChrono {
  ts: number;
  genre: GenreChrono;
  texte: string;
  dir: string | null;
  /** Nom de l'espace, vide pour une réunion ou un ticket sans espace. */
  nom: string;
  /** Répétitions consécutives fusionnées (« npm test » relancé trois fois). */
  fois: number;
}

export interface HeureChrono {
  heure: string;
  items: ItemChrono[];
}

function genreDe(ev: ActivityEvent): GenreChrono | null {
  switch (ev.kind) {
    case "commit":
      return "commit";
    case "claude_prompt":
      return "prompt";
    case "shell_cmd":
      return "shell";
    case "clickup_change":
      return "ticket";
    default:
      return null;
  }
}

/**
 * Chronologie heure par heure : commits, prompts utiles (le bruit est écarté par
 * `extraitPrompt`), commandes, changements de ticket et réunions. Les répétitions
 * consécutives d'une même ligne sont fusionnées. `filtre` cherche dans le texte, le
 * nom de l'espace, la branche et les tickets.
 */
export function chronologie(
  events: ActivityEvent[],
  reunions: Reunion[],
  nomDe: (dir: string) => string,
  filtre: string,
): HeureChrono[] {
  const aiguille = filtre.trim().toLowerCase();
  const items: Array<ItemChrono & { cherche: string }> = [];
  for (const ev of events) {
    const genre = genreDe(ev);
    if (!genre) continue;
    const texte = genre === "prompt" ? extraitPrompt(ev.title) : ev.title.trim();
    if (!texte) continue;
    const dir = ev.workspaceDir ?? null;
    const nom = dir ? nomDe(dir) : "";
    const us = usDe(ev);
    items.push({
      ts: ev.ts,
      genre,
      texte: genre === "prompt" ? `« ${texte} »` : texte,
      dir,
      nom,
      fois: 1,
      cherche: [texte, nom, ev.branch ?? "", us?.id ?? "", ...ev.ticketIds].join(" ").toLowerCase(),
    });
  }
  for (const r of reunions) {
    const texte = `Réunion : ${r.titre} (${duree((r.fin - r.debut) / 60)})`;
    items.push({ ts: r.debut, genre: "reunion", texte, dir: null, nom: "", fois: 1, cherche: texte.toLowerCase() });
  }
  items.sort((a, b) => a.ts - b.ts);

  const heures: HeureChrono[] = [];
  for (const it of items) {
    if (aiguille && !it.cherche.includes(aiguille)) continue;
    const h = `${new Date(it.ts * 1000).getHours()}h`;
    let groupe = heures[heures.length - 1];
    if (!groupe || groupe.heure !== h) {
      groupe = { heure: h, items: [] };
      heures.push(groupe);
    }
    const prec = groupe.items[groupe.items.length - 1];
    if (prec && prec.genre === it.genre && prec.dir === it.dir && prec.texte === it.texte) {
      prec.fois += 1;
      continue;
    }
    groupe.items.push({ ts: it.ts, genre: it.genre, texte: it.texte, dir: it.dir, nom: it.nom, fois: 1 });
  }
  return heures;
}

// ---------------------------------------------------------------- Frise (rendu)

/** Position en pourcentage CSS (« 12.500% ») d'une fraction de la plage. */
export function pct(x: number): string {
  return `${(x * 100).toFixed(3)}%`;
}

/** Libellé lisible d'une colonne de la frise pour les lecteurs d'écran. */
/** « mar. 10 » : jour d'un instant (secondes), préfixe des créneaux de la vue semaine,
    où la même heure revient chaque jour. */
export function jourDe(ts: number): string {
  return COURT.format(new Date(ts * 1000));
}

/** Plage d'un créneau : « 10h00 – 11h00 », précédée du jour en vue semaine. */
export function plageCreneau(c: Pick<Colonne, "t0" | "t1">, semaine = false): string {
  const plage = `${heure(c.t0)} – ${heure(c.t1)}`;
  return semaine ? `${jourDe(c.t0)} · ${plage}` : plage;
}

export function ariaColonne(c: Pick<Colonne, "t0" | "t1" | "future" | "segments">, semaine = false): string {
  const plage = `${semaine ? `${jourDe(c.t0)}, ` : ""}${heure(c.t0)} à ${heure(c.t1)}`;
  if (c.future) return `${plage} : à venir`;
  if (c.segments.length === 0) return `${plage} : aucune activité`;
  return `${plage} : ${c.segments.map((s) => s.name).join(", ")}`;
}
