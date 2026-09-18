import type { ActivityEvent, EventKind, TicketRef } from "./activityApi";
import { basename } from "./palette";
import { workspaceColor } from "./workspacePalette";

/**
 * Chronologie du dashboard « Journal » (tâche 17) : une règle verticale groupée
 * **par heure**, plus par workspace. Dans une heure donnée, les commits et les
 * changements ClickUp gardent leur ligne ; les commandes shell et les prompts
 * Claude sont agrégés par (heure, workspace) pour que la colonne reste lisible.
 * Tout est pur : aucun DOM, aucun appel Tauri.
 */

export interface TimelineLine {
  kind: EventKind;
  /** Teinte du workspace de la ligne (glyphe et suffixe). */
  color: string;
  text: string;
  /** Ligne secondaire (commandes, échanges, sessions) : encre atténuée. */
  muted: boolean;
  tickets: TicketRef[];
  /** Nom du projet, seulement pour les workspaces autres que le plus actif. */
  workspaceName?: string;
}

export interface TimelineHour {
  hour: number;
  lines: TimelineLine[];
}

/**
 * Commandes dont le premier mot ne dit rien à lui seul : on garde deux mots
 * (« cargo test », « npm run », « make api-back ») plutôt qu'un « cargo » ou
 * « npm » qui ne distinguerait rien.
 */
const LANCEURS = new Set([
  "npm",
  "npx",
  "pnpm",
  "yarn",
  "cargo",
  "git",
  "make",
  "docker",
  "sudo",
  "node",
  "python",
  "python3",
  "go",
  "gh",
  "systemctl",
  "kubectl",
]);

/** Étiquette courte d'une commande shell : premier mot, ou deux si c'est un lanceur. */
export function commandLabel(title: string): string {
  const mots = title.trim().split(/\s+/).filter(Boolean);
  if (mots.length === 0) return "";
  if (mots.length > 1 && LANCEURS.has(mots[0])) return `${mots[0]} ${mots[1]}`;
  return mots[0];
}

function matchesText(ev: ActivityEvent, needle: string): boolean {
  if (ev.title.toLowerCase().includes(needle)) return true;
  if (ev.branch && ev.branch.toLowerCase().includes(needle)) return true;
  if (ev.ticketIds.some((id) => id.toLowerCase().includes(needle))) return true;
  return false;
}

function compte(n: number, singulier: string, pluriel: string): string {
  return `${n} ${n === 1 ? singulier : pluriel}`;
}

/** Agrégat d'un kind répétitif (shell ou prompt) pour un couple (heure, workspace). */
interface Agregat {
  kind: EventKind;
  dir: string | null;
  count: number;
  /** Étiquettes distinctes des commandes, dans l'ordre d'apparition (shell seulement). */
  labels: string[];
}

type Element = { type: "event"; ev: ActivityEvent } | { type: "agregat"; agregat: Agregat };

/** Kinds agrégés par (heure, workspace) ; les autres gardent une ligne chacun. */
const AGREGES: ReadonlySet<EventKind> = new Set<EventKind>(["shell_cmd", "claude_prompt"]);

function texteAgregat(a: Agregat): string {
  if (a.kind === "claude_prompt") {
    return compte(a.count, "échange avec Claude", "échanges avec Claude");
  }
  const total = compte(a.count, "commande", "commandes");
  const premieres = a.labels.slice(0, 2);
  return premieres.length === 0 ? total : `${total}, dont ${premieres.join(" et ")}`;
}

/**
 * Regroupe les événements filtrés par heure locale.
 *
 * `colors` vient de `assignWorkspaceColors` : son **ordre d'insertion** désigne
 * le workspace le plus actif de la plage affichée (première clé), dont les
 * lignes ne portent pas de nom de projet — seules celles des autres en portent
 * un, dans leur teinte. Une heure sans événement n'apparaît pas.
 */
export function groupByHour(
  events: ActivityEvent[],
  filterDir: string | null,
  filterText: string,
  colors: Map<string, string>,
): TimelineHour[] {
  const needle = filterText.trim().toLowerCase();
  const principal = colors.keys().next().value ?? null;

  const retenus = events
    .filter((ev) => {
      const dir = ev.workspaceDir ?? null;
      if (filterDir !== null && dir !== filterDir) return false;
      if (needle && !matchesText(ev, needle)) return false;
      return true;
    })
    .sort((a, b) => a.ts - b.ts);

  const heures = new Map<number, Element[]>();
  const agregats = new Map<string, Agregat>();

  for (const ev of retenus) {
    const hour = new Date(ev.ts * 1000).getHours();
    let elements = heures.get(hour);
    if (!elements) {
      elements = [];
      heures.set(hour, elements);
    }
    const dir = ev.workspaceDir ?? null;

    if (!AGREGES.has(ev.kind)) {
      elements.push({ type: "event", ev });
      continue;
    }

    const cle = `${hour}|${dir ?? ""}|${ev.kind}`;
    let agregat = agregats.get(cle);
    if (!agregat) {
      agregat = { kind: ev.kind, dir, count: 0, labels: [] };
      agregats.set(cle, agregat);
      elements.push({ type: "agregat", agregat });
    }
    agregat.count += 1;
    if (ev.kind === "shell_cmd") {
      const label = commandLabel(ev.title);
      if (label && !agregat.labels.includes(label)) agregat.labels.push(label);
    }
  }

  return [...heures.keys()]
    .sort((a, b) => a - b)
    .map((hour) => ({
      hour,
      lines: (heures.get(hour) ?? []).map((element) => ligne(element, principal, colors)),
    }));
}

function ligne(
  element: Element,
  principal: string | null,
  colors: Map<string, string>,
): TimelineLine {
  const dir = element.type === "event" ? element.ev.workspaceDir ?? null : element.agregat.dir;
  const suffixe = dir !== null && dir !== principal ? { workspaceName: basename(dir) } : {};
  const base = { color: workspaceColor(dir, colors), ...suffixe };

  if (element.type === "agregat") {
    return {
      kind: element.agregat.kind,
      text: texteAgregat(element.agregat),
      muted: true,
      tickets: [],
      ...base,
    };
  }
  const { ev } = element;
  return {
    kind: ev.kind,
    text: ev.title,
    // Une session Claude est un repère de contexte, pas un fait : encre atténuée.
    muted: ev.kind === "claude_session",
    tickets: ev.tickets,
    ...base,
  };
}
