/**
 * État d'agent d'un espace ou d'un onglet, tel que l'affichent l'avatar du dock, la
 * mosaïque, la palette et la barre d'onglets :
 * - « attente » : un agent vous attend (notification non lue) — pastille + halo accent ;
 * - « travail » : un agent travaille (hooks Claude Code) — arc cyan qui tourne ;
 * - « termine » : l'agent vient de finir son tour sans rien demander — pied vert, coche et
 *   éclair dans la mosaïque, « Terminé » dans l'infobulle du dock et la palette ; s'efface
 *   quand on consulte l'espace, et de lui-même après DUREE_TERMINE_MS (store workspace,
 *   `tabsTermines`) ;
 * - « repos » : rien à signaler.
 * Priorités : l'attente l'emporte sur tout (c'est elle qui demande d'agir), puis le
 * travail (un autre onglet, ou le même reparti), puis « terminé ».
 */
export type EtatAgent = "travail" | "attente" | "termine" | "repos";

/** Durée de l'état « terminé » après une fin de tour, avant le retour au repos (maquette
    Mosaique : `after < 6 ? 'done' : 'idle'`). Un agent fini hors de vue, lui, vous attend
    (notification non lue), ce qui l'emporte de toute façon. */
export const DUREE_TERMINE_MS = 6000;

/** Sources du travail : tabId → PTY, PTY occupés, onglets « terminés » (store workspace). */
export interface SourcesTravail {
  tabPtys: Record<string, number>;
  busyPtys: Record<number, true>;
  /** Absent : aucun onglet terminé (sources partielles des tests et des appelants anciens). */
  tabsTermines?: Record<string, true>;
}

/** Ce qu'il faut d'un espace pour en déduire l'état. */
export interface EspaceEtat {
  tabs: { id: string }[];
  unread: boolean;
  unreadTabs: string[];
}

function ongletOccupe(s: SourcesTravail, tabId: string): boolean {
  const pty = s.tabPtys[tabId];
  return pty !== undefined && pty in s.busyPtys;
}

function ongletTermine(s: SourcesTravail, tabId: string): boolean {
  return s.tabsTermines !== undefined && tabId in s.tabsTermines;
}

export function etatEspace(w: EspaceEtat, s: SourcesTravail): EtatAgent {
  if (w.unread || w.unreadTabs.length > 0) return "attente";
  if (w.tabs.some((t) => ongletOccupe(s, t.id))) return "travail";
  if (w.tabs.some((t) => ongletTermine(s, t.id))) return "termine";
  return "repos";
}

export function etatOnglet(w: Pick<EspaceEtat, "unreadTabs">, tabId: string, s: SourcesTravail): EtatAgent {
  if (w.unreadTabs.includes(tabId)) return "attente";
  if (ongletOccupe(s, tabId)) return "travail";
  if (ongletTermine(s, tabId)) return "termine";
  return "repos";
}

/** Ligne d'un espace « terminé » (pied de tuile, infobulle du dock, palette) : « Terminé :
    <sujet> », le sujet étant le titre que Claude Code donne à l'onglet pendant le tour ;
    « Terminé » seul sans titre. */
export function messageTermine(sujet: string | undefined): string {
  const s = sujet?.trim();
  return s ? `Terminé : ${s}` : "Terminé";
}

/**
 * État dessiné par un avatar (dock, palette, menus) : « terminé » n'y a pas de marque
 * propre — les maquettes réservent la coche et l'éclair vert à la mosaïque —, l'avatar
 * reste au repos et l'infobulle ou la ligne dit « Terminé ».
 */
export function etatVisuelAvatar(e: EtatAgent): "travail" | "attente" | "repos" {
  return e === "termine" ? "repos" : e;
}
