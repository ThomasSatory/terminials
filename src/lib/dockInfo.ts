import { etatEspace, messageTermine, type EspaceEtat, type EtatAgent, type SourcesTravail } from "./etatAgent";
import { pluriel } from "./pluriel";

/**
 * Textes du dock : infobulles des avatars et des piles, libellés accessibles, raccourcis.
 * Purs (aucun store) : le composant leur passe l'espace et son état d'agent.
 */

/** Accord en nombre partagé (lib/pluriel), réexporté pour les vues qui l'importaient d'ici. */
export { pluriel };

/** Ce que le dock lit d'un espace pour ses infobulles. */
export interface InfoEspace {
  name: string;
  branch?: string;
  dirty?: boolean;
  ports: number[];
  lastNotification?: { title: string; body: string };
  status?: { label: string; color?: string };
  progress?: { value: number; label?: string };
  /** Sujet du tour que l'agent vient de finir (titre de l'onglet « terminé »). */
  sujetTermine?: string;
  /** Espace en relais (question posée à une autre session, superviseur) : le nom de
      celui dont il attend la réponse. */
  attendDe?: string;
}

/**
 * Ligne dépôt d'un espace, au format des maquettes : `feat/hero-anim •  ·  :5173`.
 * Le `•` signale des modifications non commitées ; hors dépôt git, « hors dépôt ».
 */
export function ligneDepot(w: Pick<InfoEspace, "branch" | "dirty" | "ports">): string {
  const parts = [w.branch ? (w.dirty ? `${w.branch} •` : w.branch) : "hors dépôt"];
  if (w.ports.length) parts.push(`:${w.ports.join(",")}`);
  return parts.join("  ·  ");
}

/** Texte d'une notification d'agent : son corps (la question posée), sinon son titre. */
export function texteNotification(n: InfoEspace["lastNotification"]): string {
  if (!n) return "";
  return n.body.trim() || n.title.trim();
}

/** Ton de la ligne d'état : cyan au travail, accent en attente, vert terminé, texte en
    relais (attend une réponse), discret au repos. */
export type TonDetail = "travail" | "attente" | "termine" | "relais" | "discret";

export interface Infobulle {
  /** Ligne d'état sous le nom (celle des maquettes). */
  detail: string;
  ton: TonDetail;
  /** Lignes complémentaires, discrètes : seulement le libellé d'une progression poussée
      par la CLI (les maquettes s'en tiennent au nom et à la ligne d'état). */
  lignes: string[];
  /** Progression poussée par la CLI, entre 0 et 1. */
  progression: number | null;
}

/** Ce qu'affiche la ligne d'état d'un espace selon son agent. */
export function detailEspace(w: InfoEspace, etat: EtatAgent): { texte: string; ton: TonDetail } {
  // Une question qui attend l'utilisateur prime ; sinon le relais dit qui l'agent attend
  // (maquette Superviseur : « attend api-paiements »).
  if (w.attendDe && etat !== "attente") return { texte: `attend ${w.attendDe}`, ton: "relais" };
  if (etat === "attente") return { texte: texteNotification(w.lastNotification) || "Vous attend", ton: "attente" };
  if (etat === "travail") return { texte: w.status?.label?.trim() || "Au travail…", ton: "travail" };
  if (etat === "termine") return { texte: messageTermine(w.sujetTermine), ton: "termine" };
  return { texte: ligneDepot(w), ton: "discret" };
}

/**
 * Infobulle d'un avatar, en deux lignes comme les maquettes (Dock/02) : nom (dans le
 * titre), puis l'état — question de l'agent qui attend, tâche de l'agent qui travaille,
 * qui il attend en relais, sinon branche et ports. Seule une progression poussée par la
 * CLI y ajoute sa barre et son libellé.
 */
export function infobulleEspace(w: InfoEspace, etat: EtatAgent): Infobulle {
  const { texte, ton } = detailEspace(w, etat);
  const lignes: string[] = [];
  const p = w.progress;
  const progression = p && Number.isFinite(p.value) ? Math.min(1, Math.max(0, p.value)) : null;
  if (p?.label?.trim()) lignes.push(p.label.trim());
  return { detail: texte, ton, lignes, progression };
}

/** Libellé accessible d'un avatar : son nom, l'état de son agent, et ce que fait le clic. */
export function libelleAvatar(nom: string, etat: EtatAgent, ouvert: boolean): string {
  const suffixe =
    etat === "attente"
      ? ", un agent vous attend"
      : etat === "travail"
        ? ", un agent travaille"
        : etat === "termine"
          ? ", l’agent a terminé"
          : "";
  return ouvert ? `${nom}${suffixe} : actions de l’espace` : `${nom}${suffixe}`;
}

/** Raccourci d'un espace (« Ctrl 3 ») : rang dans l'ordre navigable, vide au-delà de 9. */
export function raccourciEspace(ordreNavigable: readonly string[], id: string): string {
  const i = ordreNavigable.indexOf(id);
  return i !== -1 && i < 9 ? `Ctrl ${i + 1}` : "";
}

/** Infobulle et libellé d'une pile (groupe replié). */
export interface InfoPile {
  sousTitre: string;
  ton: TonDetail;
  libelle: string;
  compte: string;
}

/**
 * La pile dit qui réclame : l'agent qui attend (nom · question), sinon celui qui travaille,
 * sinon pourquoi le groupe est replié (faute de place ou à la main).
 */
export function infoPile(p: {
  nomGroupe: string;
  nbMembres: number;
  attente: { nom: string; texte: string } | null;
  travail: { nom: string; texte: string } | null;
  auto: boolean;
}): InfoPile {
  const compte = pluriel(p.nbMembres, "espace");
  const base = `Déplier le groupe ${p.nomGroupe}, ${compte}`;
  if (p.attente)
    return { sousTitre: `${p.attente.nom} · ${p.attente.texte}`, ton: "attente", libelle: `${base}, un agent vous attend`, compte };
  if (p.travail)
    return { sousTitre: `${p.travail.nom} · ${p.travail.texte}`, ton: "travail", libelle: `${base}, un agent travaille`, compte };
  return {
    sousTitre: p.auto ? "Replié faute de place · cliquer pour déplier" : "Cliquer pour déplier",
    ton: "discret",
    libelle: base,
    compte,
  };
}

/** Libellé accessible de l'étiquette d'un groupe. */
export function libelleEtiquette(nomGroupe: string, nbMembres: number, replie: boolean): string {
  return `${replie ? "Déplier" : "Replier"} le groupe ${nomGroupe} (${pluriel(nbMembres, "espace")})`;
}

/**
 * États d'agent de tous les espaces en UNE chaîne (« id=etat|id=etat »), pour un sélecteur
 * de store : le dock ne se re-rend que quand un état change, pas à chaque tour des sondes
 * (branche, ports) qui réallouent la liste des espaces.
 */
export function cleEtatsEspaces(espaces: readonly (EspaceEtat & { id: string })[], s: SourcesTravail): string {
  return espaces.map((w) => `${w.id}=${etatEspace(w, s)}`).join("|");
}

/** Relit la chaîne de `cleEtatsEspaces` (un id peut contenir « = » : on coupe au dernier). */
export function lireCleEtats(cle: string): Map<string, EtatAgent> {
  const m = new Map<string, EtatAgent>();
  for (const paire of cle.split("|")) {
    const i = paire.lastIndexOf("=");
    if (i > 0) m.set(paire.slice(0, i), paire.slice(i + 1) as EtatAgent);
  }
  return m;
}
