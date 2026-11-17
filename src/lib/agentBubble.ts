import { couleurEspace } from "./couleurEspace";
import { monogramme } from "./monogram";

/**
 * Logique pure de la bulle « un agent vous attend » : quel espace la mérite, quoi y
 * écrire, vers quel onglet « Aller » mène. Le composant (AgentBubble) n'ajoute que le
 * suivi du store, la mesure de l'avatar et l'animation.
 */

export interface NotificationBrute {
  title: string;
  body: string;
}

/** Ce qu'il faut d'un espace du store pour décider d'une bulle. */
export interface EspaceNotifiable {
  id: string;
  name: string;
  cwd: string;
  color?: string;
  branch?: string;
  tabs: { id: string; title?: string }[];
  activeTabId: string | null;
  unread: boolean;
  unreadTabs: string[];
  lastNotification?: NotificationBrute;
}

/** Contenu affiché par la bulle, figé au moment où elle est choisie. */
export interface Bulle {
  wsId: string;
  /** Rang d'arrivée de la notification : plus il est grand, plus elle est récente. */
  rang: number;
  tabId: string | null;
  nom: string;
  mono: string;
  couleur: string;
  /** « fix/webhook · onglet claude » (maquette : branche puis onglet). */
  contexte: string;
  /** Ligne principale (14 px) : le message de l'agent. */
  question: string;
  /** Ligne mono sous la question : le titre de la notification, s'il apporte quelque chose. */
  detail: string;
}

export type Arrivees = ReadonlyMap<string, { notif: NotificationBrute; rang: number }>;

/** Espace qui attend, hors espace actif : l'actif est sous les yeux, il n'a pas besoin de bulle. */
export function reclameLAttention(w: EspaceNotifiable, activeId: string | null): boolean {
  return w.id !== activeId && (w.unread || w.unreadTabs.length > 0) && w.lastNotification !== undefined;
}

/**
 * Onglet que la notification concerne : le dernier à s'être signalé, sinon l'onglet actif
 * de l'espace (notification sans onglet identifiable). null si l'espace n'a aucun onglet.
 */
export function ongletConcerne(w: Pick<EspaceNotifiable, "tabs" | "unreadTabs" | "activeTabId">): string | null {
  for (let i = w.unreadTabs.length - 1; i >= 0; i--) {
    if (w.tabs.some((t) => t.id === w.unreadTabs[i])) return w.unreadTabs[i];
  }
  if (w.activeTabId && w.tabs.some((t) => t.id === w.activeTabId)) return w.activeTabId;
  return w.tabs[0]?.id ?? null;
}

/** Message et titre à afficher : le corps fait la question, le titre n'est gardé que distinct. */
export function texteBulle(n: NotificationBrute): { question: string; detail: string } {
  const titre = n.title.trim();
  const corps = n.body.trim();
  const question = corps || titre;
  return { question, detail: titre && titre !== question ? titre : "" };
}

/**
 * Met à jour le rang d'arrivée des notifications. Une notification est nouvelle quand
 * l'objet `lastNotification` d'un espace n'est plus celui déjà vu (le store en crée un
 * à chaque `setNotification`, même si le texte est identique : l'agent a re-sollicité).
 * Les espaces disparus sont oubliés. Pure : rend les nouvelles tables sans muter, et la
 * table `vues` elle-même quand rien n'a changé (l'appelant tourne à chaque mutation du
 * store : inutile d'allouer une table identique).
 */
export function suivreArrivees(
  vues: Arrivees,
  compteur: number,
  espaces: readonly Pick<EspaceNotifiable, "id" | "lastNotification">[],
): { arrivees: Arrivees; compteur: number } {
  const arrivees = new Map<string, { notif: NotificationBrute; rang: number }>();
  let c = compteur;
  let inchange = true;
  for (const w of espaces) {
    const n = w.lastNotification;
    if (!n) continue;
    const vue = vues.get(w.id);
    if (vue && vue.notif === n) arrivees.set(w.id, vue);
    else {
      arrivees.set(w.id, { notif: n, rang: ++c });
      inchange = false;
    }
  }
  // Même taille et aucune entrée neuve : chaque entrée de `vues` a été reprise telle quelle.
  if (inchange && arrivees.size === vues.size) return { arrivees: vues, compteur };
  return { arrivees, compteur: c };
}

/** Raccourci d'accès à l'espace (« Ctrl 3 »), null au-delà du neuvième. */
export function raccourciEspace(index: number): string | null {
  return index >= 0 && index < 9 ? `Ctrl ${index + 1}` : null;
}

/**
 * La bulle à afficher : l'espace qui attend dont la notification est la plus récente,
 * parmi celles que l'utilisateur n'a pas écartées (`ecarteJusqua` : rang le plus haut
 * fermé par la croix, qui écarte aussi les plus anciennes). null si personne n'attend.
 */
export function choisirBulle(
  espaces: readonly EspaceNotifiable[],
  activeId: string | null,
  arrivees: Arrivees,
  ecarteJusqua: number,
): Bulle | null {
  let choix: { w: EspaceNotifiable; rang: number } | null = null;
  for (const w of espaces) {
    if (!reclameLAttention(w, activeId)) continue;
    const rang = arrivees.get(w.id)?.rang ?? 0;
    if (rang <= ecarteJusqua) continue;
    if (!choix || rang > choix.rang) choix = { w, rang };
  }
  if (!choix) return null;
  const { w, rang } = choix;
  const tabId = ongletConcerne(w);
  const onglet = w.tabs.find((t) => t.id === tabId);
  const { question, detail } = texteBulle(w.lastNotification as NotificationBrute);
  return {
    wsId: w.id,
    rang,
    tabId,
    nom: w.name,
    mono: monogramme(w.name),
    couleur: couleurEspace(w),
    contexte: `${w.branch?.trim() || "hors dépôt"} · onglet ${onglet?.title?.trim() || "terminal"}`,
    question,
    detail,
  };
}

/** Deux bulles qui s'afficheraient à l'identique : évite un rendu à chaque tick du store. */
export function memeBulle(a: Bulle | null, b: Bulle | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return (
    a.wsId === b.wsId &&
    a.rang === b.rang &&
    a.tabId === b.tabId &&
    a.nom === b.nom &&
    a.couleur === b.couleur &&
    a.contexte === b.contexte &&
    a.question === b.question &&
    a.detail === b.detail
  );
}
