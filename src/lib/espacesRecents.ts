import { couleurEspace } from "./couleurEspace";
import { parseClaudeSession, type ClaudeSession } from "./claudeResume";

/**
 * Espaces récemment fermés, proposés par l'accueil (liste « Reprendre »). L'app n'a
 * aucune autre source d'espaces récents : on retient donc le nom, le dossier, la
 * couleur et la branche de chaque espace au moment où il disparaît du store, dans le localStorage.
 *
 * Tout ce fichier est pur (aucune lecture de store ni de stockage) hormis `lireRecents`
 * / `ecrireRecents`, qui prennent le stockage en paramètre pour rester testables.
 */

export interface EspaceRecent {
  nom: string;
  cwd: string;
  /** Couleur d'affichage (#rrggbb) au moment de la fermeture, pour l'avatar de la liste. */
  couleur: string;
  /** Couleur propre de l'espace, si elle en avait une : rétablie à la réouverture. */
  propre?: string;
  /** Dernière branche connue (absente hors dépôt) : la liste affiche « chemin · branche ». */
  branche?: string;
  /** Nombre d'onglets à la fermeture, quand il y en avait plusieurs. */
  onglets?: number;
  /** Session Claude de chaque onglet (null = aucune), reprise à la réouverture. Omis quand
      aucun onglet n'en portait : la liste n'affiche alors pas « session Claude à reprendre ». */
  sessions?: (ClaudeSession | null)[];
  /** Groupe de l'espace à la fermeture (nom et couleur) : il y revient à la réouverture,
      le groupe étant recréé s'il a disparu entre-temps. Absent : hors groupe. */
  groupe?: { nom: string; couleur: string };
  /** Instant de la fermeture, en ms depuis l'époque. */
  ferme: number;
}

/** Ce qu'il faut d'un espace pour le retenir. */
export interface EspaceFerme {
  id: string;
  cwd: string;
  name: string;
  color?: string;
  branch?: string;
  tabs?: readonly { claude?: ClaudeSession }[];
  /** Groupe d'appartenance au moment de la fermeture (null ou absent : hors groupe). */
  groupe?: { name: string; color: string } | null;
}

export const CLE_RECENTS = "terminials:recents:v1";
/** Nombre d'espaces retenus : la liste de l'accueil reste une aide-mémoire, pas un historique. */
export const MAX_RECENTS = 6;

const memeEspace = (a: Pick<EspaceRecent, "cwd" | "nom">, b: Pick<EspaceRecent, "cwd" | "nom">) =>
  a.cwd === b.cwd && a.nom === b.nom;

/** Espaces présents dans `avant` et absents de `apres` (par id), dans l'ordre d'`avant`. */
export function espacesDisparus<T extends { id: string }>(avant: readonly T[], apres: readonly T[]): T[] {
  if (avant === apres) return [];
  const restants = new Set(apres.map((w) => w.id));
  return avant.filter((w) => !restants.has(w.id));
}

/** Fiche à retenir pour un espace qui se ferme ; null s'il n'a pas de dossier à rouvrir. */
export function fiche(ws: EspaceFerme, maintenant: number): EspaceRecent | null {
  if (!ws.cwd) return null;
  const onglets = ws.tabs?.length ?? 1;
  const sessions = (ws.tabs ?? []).map((t) => t.claude ?? null);
  return {
    nom: ws.name,
    cwd: ws.cwd,
    couleur: couleurEspace(ws),
    ...(ws.color ? { propre: ws.color } : {}),
    ...(ws.branch ? { branche: ws.branch } : {}),
    ...(onglets > 1 ? { onglets } : {}),
    ...(sessions.some((x) => x !== null) ? { sessions } : {}),
    ...(ws.groupe ? { groupe: { nom: ws.groupe.name, couleur: ws.groupe.color } } : {}),
    ferme: maintenant,
  };
}

/** Ajoute une fiche en tête : même nom + même dossier = même espace, la plus récente gagne. */
export function ajouterRecent(liste: readonly EspaceRecent[], e: EspaceRecent, max = MAX_RECENTS): EspaceRecent[] {
  return [e, ...liste.filter((x) => !memeEspace(x, e))].slice(0, max);
}

/** Retire une fiche (espace rouvert depuis la liste). */
export function retirerRecent(liste: readonly EspaceRecent[], e: Pick<EspaceRecent, "cwd" | "nom">): EspaceRecent[] {
  return liste.filter((x) => !memeEspace(x, e));
}

const estTexte = (v: unknown): v is string => typeof v === "string" && v.length > 0;

/** Borne des onglets rouverts : une valeur corrompue ne lance pas des centaines de shells. */
const MAX_ONGLETS = 32;

/** Onglets et sessions relus d'une source non sûre : chaque session est revalidée (son id
    finit tapé dans un shell), le compte d'onglets borné à au moins une par session. */
function lireOnglets(onglets: unknown, sessions: unknown): Pick<EspaceRecent, "onglets" | "sessions"> {
  const liste = Array.isArray(sessions) ? sessions.map(parseClaudeSession) : [];
  const avecSessions = liste.some((x) => x !== null);
  const n = Math.min(
    MAX_ONGLETS,
    Math.max(typeof onglets === "number" && Number.isInteger(onglets) ? onglets : 1, avecSessions ? liste.length : 1),
  );
  return {
    ...(n > 1 ? { onglets: n } : {}),
    ...(avecSessions ? { sessions: liste.slice(0, n) } : {}),
  };
}

/** Groupe relu d'une sauvegarde : nom et couleur texte, sinon rien (hors groupe). */
function lireGroupe(g: unknown): Pick<EspaceRecent, "groupe"> {
  if (typeof g !== "object" || g === null) return {};
  const { nom, couleur } = g as Record<string, unknown>;
  return estTexte(nom) && estTexte(couleur) ? { groupe: { nom, couleur } } : {};
}

/** Vrai si l'espace récent est ouvert en ce moment (même nom, même dossier). */
export function estOuvert(e: Pick<EspaceRecent, "cwd" | "nom">, ouverts: readonly { cwd: string; name: string }[]): boolean {
  return ouverts.some((w) => w.cwd === e.cwd && w.name === e.nom);
}

/** Relit une sauvegarde : tout ce qui n'a pas la bonne forme est écarté, jamais d'exception. */
export function parserRecents(brut: unknown, max = MAX_RECENTS): EspaceRecent[] {
  if (!Array.isArray(brut)) return [];
  const liste: EspaceRecent[] = [];
  for (const e of brut) {
    if (typeof e !== "object" || e === null) continue;
    const r = e as Record<string, unknown>;
    if (!estTexte(r.nom) || !estTexte(r.cwd) || !estTexte(r.couleur)) continue;
    if (typeof r.ferme !== "number" || !Number.isFinite(r.ferme)) continue;
    liste.push({
      nom: r.nom,
      cwd: r.cwd,
      couleur: r.couleur,
      ...(estTexte(r.propre) ? { propre: r.propre } : {}),
      // Champ ajouté après coup : une sauvegarde plus ancienne, sans lui, reste valide.
      ...(estTexte(r.branche) ? { branche: r.branche } : {}),
      ...lireOnglets(r.onglets, r.sessions),
      ...lireGroupe(r.groupe),
      ferme: r.ferme,
    });
  }
  return liste.slice(0, max);
}

type Stockage = Pick<Storage, "getItem" | "setItem">;

/** Liste enregistrée ; vide si le stockage est absent, illisible ou corrompu. */
export function lireRecents(stockage: Stockage | undefined): EspaceRecent[] {
  try {
    const brut = stockage?.getItem(CLE_RECENTS);
    return brut ? parserRecents(JSON.parse(brut)) : [];
  } catch {
    return [];
  }
}

export function ecrireRecents(stockage: Stockage | undefined, liste: readonly EspaceRecent[]): void {
  try {
    stockage?.setItem(CLE_RECENTS, JSON.stringify(liste));
  } catch {
    // Stockage plein ou interdit : la liste de l'accueil est une commodité, jamais bloquante.
  }
}

/**
 * « il y a 5 min », « il y a 2 h », « hier », « il y a 3 j », puis la date courte au-delà
 * d'un mois. Une horloge qui recule (instant futur) donne « à l'instant ».
 */
export function quandRelatif(ferme: number, maintenant: number): string {
  const min = Math.floor((maintenant - ferme) / 60_000);
  if (min < 1) return "à l'instant";
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  if (j === 1) return "hier";
  if (j < 30) return `il y a ${j} j`;
  return new Date(ferme).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
}

/** Dossier lisible : le dossier personnel devient « ~ ». */
export function cheminCourt(cwd: string, home?: string): string {
  if (!home) return cwd;
  const h = home.replace(/\/+$/, "");
  if (!h) return cwd;
  if (cwd === h) return "~";
  return cwd.startsWith(h + "/") ? "~" + cwd.slice(h.length) : cwd;
}

/** Ligne secondaire d'un espace récent, au format de la maquette Accueil :
    « chemin  ·  branche » (deux espaces de part et d'autre du point), « hors dépôt » quand
    l'espace n'avait pas de branche connue. */
export function metaRecent(e: Pick<EspaceRecent, "cwd" | "branche">, home?: string): string {
  return `${cheminCourt(e.cwd, home)}  ·  ${e.branche ?? "hors dépôt"}`;
}
