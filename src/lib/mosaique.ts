/**
 * Logique pure de la mosaïque des agents (Ctrl+Maj+M) : sections par groupe, filtres,
 * disposition de la grille, libellés d'état et de durée, lecture des lignes de terminal
 * (couleur, dernière commande, clés stables pour animer les nouvelles lignes) et
 * navigation clavier entre tuiles. Aucun store, aucun DOM : tout se teste à plat.
 */
import type { EtatAgent } from "./etatAgent";
import { pluriel } from "./pluriel";

/** Ce que la mosaïque sait d'un espace pour le ranger (l'en-tête de tuile lit le reste). */
export interface EspaceMosaique {
  id: string;
  groupId: string | null;
  etat: EtatAgent;
}

/** Groupe tel qu'affiché : couleur déjà éclaircie (`couleurGroupe`). */
export interface GroupeMosaique {
  id: string;
  nom: string;
  couleur: string;
}

/** Filtre « Tous » ; sinon l'id d'un groupe. */
export const FILTRE_TOUS = "tous";

/** Section « hors groupe » : toujours en dernier, carré discret. */
export const ID_HORS_GROUPE = "_hors";
const COULEUR_HORS_GROUPE = "#9296a0";

export interface SectionMosaique {
  id: string;
  nom: string;
  couleur: string;
  horsGroupe: boolean;
  espaces: EspaceMosaique[];
}

/** Rang d'un état quand « En attente d'abord » est coché : ce qui demande d'agir en tête. */
const RANG_ETAT: Record<EtatAgent, number> = { attente: 0, travail: 1, termine: 2, repos: 3 };

/** Le filtre demandé s'il désigne encore un groupe affiché, sinon « Tous » (groupe
    supprimé ou vidé pendant que la mosaïque était fermée). */
export function filtreValide(filtre: string, espaces: EspaceMosaique[]): string {
  if (filtre === FILTRE_TOUS) return filtre;
  return espaces.some((e) => e.groupId === filtre) ? filtre : FILTRE_TOUS;
}

/**
 * Sections affichées : un groupe par section dans l'ordre des groupes, « hors groupe »
 * en dernier, sections vides omises. Filtré, seule la section du groupe reste.
 * « En attente d'abord » trie les tuiles de chaque section (attente, travail, terminé, repos ;
 * ordre d'origine à égalité) puis les sections par leur tuile la plus pressante.
 */
export function construireSections(
  espaces: EspaceMosaique[],
  groupes: GroupeMosaique[],
  filtre: string,
  attenteDabord: boolean,
): SectionMosaique[] {
  const toutes: SectionMosaique[] = groupes.map((g) => ({
    id: g.id,
    nom: g.nom,
    couleur: g.couleur,
    horsGroupe: false,
    espaces: espaces.filter((e) => e.groupId === g.id),
  }));
  // Un espace dont le groupe a disparu (état transitoire) retombe hors groupe.
  const connus = new Set(groupes.map((g) => g.id));
  toutes.push({
    id: ID_HORS_GROUPE,
    nom: "hors groupe",
    couleur: COULEUR_HORS_GROUPE,
    horsGroupe: true,
    espaces: espaces.filter((e) => e.groupId === null || !connus.has(e.groupId)),
  });
  let sections = toutes.filter((s) => s.espaces.length > 0);
  if (filtre !== FILTRE_TOUS) sections = sections.filter((s) => s.id === filtre);
  if (!attenteDabord) return sections;
  const triees = sections.map((s) => ({
    ...s,
    espaces: s.espaces
      .map((e, i) => ({ e, i }))
      .sort((a, b) => RANG_ETAT[a.e.etat] - RANG_ETAT[b.e.etat] || a.i - b.i)
      .map((x) => x.e),
  }));
  const tete = (s: SectionMosaique) => Math.min(...s.espaces.map((e) => RANG_ETAT[e.etat]));
  return triees
    .map((s, i) => ({ s, i }))
    .sort((a, b) => tete(a.s) - tete(b.s) || a.i - b.i)
    .map((x) => x.s);
}

export interface DispositionGrille {
  /** Largeur minimale d'une colonne (px) : `auto-fill` en déduit le nombre de colonnes. */
  largeurMin: number;
  /** Lignes de terminal montrées par tuile. */
  nbLignes: number;
  /** Corps du mini-terminal (px). */
  taillePolice: number;
}

/**
 * Filtré sur un groupe, les tuiles grandissent pour remplir l'écran : 2 colonnes
 * jusqu'à 4 espaces, 3 au-delà, et chaque tuile montre presque deux fois plus de sortie.
 */
export function dispositionGrille(filtre: string, nbEspacesFiltres: number): DispositionGrille {
  if (filtre === FILTRE_TOUS) return { largeurMin: 260, nbLignes: 6, taillePolice: 11.5 };
  return nbEspacesFiltres <= 4
    ? { largeurMin: 520, nbLignes: 12, taillePolice: 12 }
    : { largeurMin: 400, nbLignes: 11, taillePolice: 12 };
}

/** `grid-template-columns` de la grille : jamais plus large que l'écran (min(…, 100%)). */
export function colonnesGrille(largeurMin: number): string {
  return `repeat(auto-fill, minmax(min(${largeurMin}px, 100%), 1fr))`;
}

export type CompteEtats = Record<EtatAgent, number>;

export function compterEtats(espaces: EspaceMosaique[]): CompteEtats {
  const c: CompteEtats = { travail: 0, attente: 0, termine: 0, repos: 0 };
  for (const e of espaces) c[e.etat]++;
  return c;
}

/** Accord en nombre partagé (lib/pluriel), réexporté pour les vues qui l'importaient d'ici. */
export { pluriel };

/** « 14 espaces · 4 au travail · 2 vous attendent » (l'attente n'apparaît que s'il y en a). */
export function resumeMosaique(espaces: EspaceMosaique[]): string {
  const c = compterEtats(espaces);
  return (
    `${pluriel(espaces.length, "espace", "espaces")} · ${c.travail} au travail` +
    (c.attente ? ` · ${pluriel(c.attente, "vous attend", "vous attendent")}` : "")
  );
}

/** Pastilles de l'en-tête de section : seulement les états présents. */
export function partiesSection(espaces: EspaceMosaique[]): { etat: EtatAgent; texte: string }[] {
  const c = compterEtats(espaces);
  const parts: { etat: EtatAgent; texte: string }[] = [];
  if (c.travail) parts.push({ etat: "travail", texte: `${c.travail} au travail` });
  if (c.attente) parts.push({ etat: "attente", texte: pluriel(c.attente, "vous attend", "vous attendent") });
  if (c.termine) parts.push({ etat: "termine", texte: pluriel(c.termine, "terminé", "terminés") });
  if (c.repos) parts.push({ etat: "repos", texte: `${c.repos} au repos` });
  return parts;
}

export interface FiltreMosaique {
  id: string;
  libelle: string;
  /** Carré du groupe ; null pour « Tous ». */
  couleur: string | null;
  nombre: number;
  /** Indicateur du bouton : l'attente prime sur le travail, « Tous » n'en porte pas. */
  indicateur: "attente" | "travail" | null;
  presse: boolean;
  aria: string;
}

/** Boutons de filtre : « Tous » puis chaque groupe non vide, dans l'ordre des groupes. */
export function filtresMosaique(
  espaces: EspaceMosaique[],
  groupes: GroupeMosaique[],
  filtre: string,
): FiltreMosaique[] {
  const defs = [
    { id: FILTRE_TOUS, libelle: "Tous", couleur: null as string | null, membres: espaces },
    ...groupes.map((g) => ({
      id: g.id,
      libelle: g.nom,
      couleur: g.couleur as string | null,
      membres: espaces.filter((e) => e.groupId === g.id),
    })),
  ].filter((d) => d.id === FILTRE_TOUS || d.membres.length > 0);
  return defs.map((d) => {
    const c = compterEtats(d.membres);
    const tous = d.id === FILTRE_TOUS;
    return {
      id: d.id,
      libelle: d.libelle,
      couleur: d.couleur,
      nombre: d.membres.length,
      indicateur: tous ? null : c.attente ? "attente" : c.travail ? "travail" : null,
      presse: filtre === d.id,
      aria:
        (tous ? "Tous les espaces" : `Groupe ${d.libelle}`) +
        `, ${pluriel(d.membres.length, "espace", "espaces")}` +
        (c.attente ? `, ${c.attente} en attente` : "") +
        (c.travail ? `, ${c.travail} au travail` : ""),
    };
  });
}

export const LIBELLE_ETAT: Record<EtatAgent, string> = {
  travail: "au travail",
  attente: "vous attend",
  termine: "terminé",
  repos: "au repos",
};

/** Ligne sous le nom : branche, marque « • » si modifié, ports ouverts ; « hors dépôt »
    sans branche connue (dossier hors git). */
export function ligneBranche(w: { branch?: string; dirty?: boolean; ports?: number[]; gitConnu?: boolean }): string {
  // Sonde git pas encore passée : rien plutôt qu'un « hors dépôt » faux. Absent du type
  // appelant (tests, anciens appels) : considéré connu.
  if (!w.branch && w.gitConnu === false) return "";
  const base = w.branch ? w.branch + (w.dirty ? " •" : "") : "hors dépôt";
  const ports = w.ports?.length ? "  ·  " + w.ports.map((p) => `:${p}`).join(" ") : "";
  return base + ports;
}

/** Dossier affiché en pied de tuile : le dossier personnel abrégé en « ~ » (le chemin
    complet tronqué perdrait justement sa fin, la partie parlante). `home` : le vrai
    dossier personnel quand il est connu (il n'est pas toujours sous /home) ; sinon la
    forme usuelle /home/<nom>. */
export function cheminCourt(cwd: string, home?: string | null): string {
  const h = home?.replace(/\/+$/, "");
  if (h) {
    if (cwd === h) return "~";
    if (cwd.startsWith(h + "/")) return "~" + cwd.slice(h.length);
  }
  return cwd.replace(/^\/(?:home|Users)\/[^/]+(?=\/|$)/, "~");
}

/** Titre d'onglet poussé par le terminal, sans le glyphe d'animation que Claude Code y
    préfixe (« ✳ Refonte du dock » → « Refonte du dock »). */
export function titreSansGlyphe(titre: string | undefined): string {
  return (titre ?? "").replace(/^[^\p{L}\p{N}~/.]+/u, "").trim();
}

/** Ton d'une ligne de terminal : le texte arrive sans couleurs ANSI, on retrouve la
    hiérarchie de la maquette à partir des marqueurs de Claude Code et du shell. */
export type TonLigne = "fort" | "texte" | "discret";

export function tonLigne(ligne: string): TonLigne {
  const t = ligne.trimStart();
  if (/^[❯●⏺>$]/u.test(t)) return "fort";
  if (/^[⎿└│]/u.test(t)) return "discret";
  return "texte";
}

/** Un aperçu de terminal n'apprend rien s'il ne contient que des invites vides (« ❯ »,
    « $ »…) ou des lignes blanches : la carte de validation ne l'affiche pas alors. */
export function apercuParlant(lignes: readonly string[]): boolean {
  return lignes.some((l) => {
    const t = l.trim();
    return t !== "" && !/^[❯›>$%#]$/u.test(t);
  });
}

/** Invite de shell suivie d'une commande : « ❯ git status », « user@hôte:~/x$ ls ». */
const INVITE = /(?:^|\s|[\w~/)\]])(?:❯|\$|%|#|›)\s+(\S.*)$/u;

/**
 * Dernière commande tapée, lue en remontant les lignes (pied d'une tuile au repos,
 * comme « ❯ git status » dans la maquette) ; null si aucune ligne n'y ressemble.
 */
export function derniereCommande(lignes: string[]): string | null {
  for (let i = lignes.length - 1; i >= 0; i--) {
    const m = INVITE.exec(lignes[i].trimEnd());
    if (m) return `❯ ${m[1].trim()}`;
  }
  return null;
}

/**
 * Clés React des lignes d'un mini-terminal, stables d'une lecture à l'autre : une ligne
 * qui ne fait que remonter garde sa clé (pas d'animation), seule la ligne vraiment
 * nouvelle en reçoit une neuve et s'anime en entrant.
 *
 * On cherche le plus petit décalage `d` tel que les lignes précédentes, privées des `d`
 * premières, recouvrent le début des suivantes — à l'identique, ou à la dernière ligne
 * près (Claude Code réécrit sa ligne d'activité en place pendant qu'une nouvelle sortie
 * arrive). Sans recouvrement (écran redessiné, invite modifiée en place), les clés
 * restent attachées aux positions : le texte change sans rejouer d'animation.
 */
export function alignerCles(
  precedentes: string[],
  clesPrecedentes: number[],
  suivantes: string[],
  prochaineCle: number,
): { cles: number[]; prochaineCle: number } {
  const neuves = (n: number) => {
    const out: number[] = [];
    for (let i = 0; i < n; i++) out.push(prochaineCle++);
    return out;
  };
  const recouvre = (d: number, tolerant: boolean) => {
    const n = precedentes.length - d;
    if (n < 1 || n > suivantes.length || (tolerant && n < 2)) return false;
    for (let i = 0; i < n; i++) {
      if (precedentes[d + i] !== suivantes[i] && !(tolerant && i === n - 1)) return false;
    }
    return true;
  };
  if (precedentes.length > 0) {
    for (const tolerant of [false, true]) {
      for (let d = 0; d < precedentes.length; d++) {
        if (!recouvre(d, tolerant)) continue;
        const gardees = clesPrecedentes.slice(d);
        return { cles: [...gardees, ...neuves(suivantes.length - gardees.length)], prochaineCle };
      }
    }
  }
  const cles = suivantes.map((_, i) => (i < clesPrecedentes.length ? clesPrecedentes[i] : prochaineCle++));
  return { cles, prochaineCle };
}

/** Durée écoulée en « m:ss », « h:mm:ss » au-delà d'une heure. */
export function chrono(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, "0");
  return h > 0 ? `${h}:${String(m).padStart(2, "0")}:${ss}` : `${m}:${ss}`;
}

/** « il y a 12 s », « il y a 3 min », « il y a 2 h », « hier », « il y a 4 j ». */
export function ilYA(ms: number): string {
  const s = Math.max(1, Math.floor(ms / 1000));
  if (s < 60) return `il y a ${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.floor(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.floor(h / 24);
  return j === 1 ? "hier" : `il y a ${j} j`;
}

/** Repère de temps sous l'état : depuis quand on vous attend, depuis quand l'agent
    travaille, ou de quand date le dernier changement. Vide seulement si l'espace n'est
    pas encore suivi (instant transitoire entre son apparition et la lecture du store). */
export function etiquetteTemps(etat: EtatAgent, depuis: number | null, maintenant: number): string {
  if (depuis === null) return "";
  const ecart = maintenant - depuis;
  if (etat === "attente") return `depuis ${chrono(ecart)}`;
  if (etat === "travail") return chrono(ecart);
  // « terminé » : la maquette dit « à l'instant » la première minute.
  if (etat === "termine" && ecart < 60_000) return "à l’instant";
  return ilYA(ecart);
}

/**
 * Dernier changement d'état d'un espace. Sans transition vue (état trouvé au lancement,
 * espace créé ou restauré en cours de route), `depuis` est le moment où on l'a vu pour la
 * première fois : un minorant fiable, puisque ni l'attente ni le travail ne sont
 * persistés (au lancement, tout espace repart au repos avec un shell neuf). La maquette
 * date toujours chaque tuile, même au repos : mieux vaut « il y a 3 h » (depuis le
 * lancement) qu'un repère vide.
 */
export interface SuiviEtat {
  etat: EtatAgent;
  depuis: number;
}

/**
 * Met à jour le suivi des changements d'état. Rend la MÊME Map si rien n'a changé (les
 * abonnés ne sont alors pas notifiés), et garde les entrées inchangées par référence.
 * Les espaces disparus sont oubliés.
 */
export function majSuivi(
  suivi: Map<string, SuiviEtat>,
  etats: [string, EtatAgent][],
  maintenant: number,
): Map<string, SuiviEtat> {
  let change = etats.length !== suivi.size;
  const out = new Map<string, SuiviEtat>();
  for (const [id, etat] of etats) {
    const avant = suivi.get(id);
    if (avant && avant.etat === etat) {
      out.set(id, avant);
      continue;
    }
    change = true;
    out.set(id, { etat, depuis: maintenant });
  }
  return change ? out : suivi;
}

/** Pied d'une tuile « terminé » (partagé avec le dock et la palette). */
export { messageTermine } from "./etatAgent";

/**
 * Ce qui suit « Terminé : » au pied d'une tuile terminée : le corps de la dernière
 * notification de fin de tour (hook Stop, `notify --attente fin`), sinon le sujet du
 * tour (titre de l'onglet), sinon rien (« Terminé » seul).
 */
export function sujetTermine(
  notification: { body?: string; attente?: string } | undefined,
  titreOnglet: string | undefined,
): string {
  const corps = notification?.attente === "fin" ? (notification.body ?? "").trim() : "";
  return corps || titreSansGlyphe(titreOnglet);
}

/** Libellé lu par un lecteur d'écran sur la tuile : nom, état, et ce qui l'occupe. */
export function ariaTuile(nom: string, etat: EtatAgent, detail: string): string {
  const base = `Ouvrir le terminal de ${nom}, ${LIBELLE_ETAT[etat]}`;
  return (etat === "travail" || etat === "attente") && detail ? `${base} : ${detail}` : base;
}

/** Cadence du trait de balayage d'une tuile au travail : décalée d'un espace à l'autre
    pour que la grille ne batte jamais d'un seul bloc. */
export function cadenceBalayage(nom: string): { duree: string; delai: string } {
  return {
    duree: `${(1.5 + (nom.length % 5) * 0.23).toFixed(2)}s`,
    delai: `-${((nom.length * 0.37) % 1.5).toFixed(2)}s`,
  };
}

/** Rectangle d'une tuile à l'écran (getBoundingClientRect). */
export interface RectTuile {
  left: number;
  top: number;
  width: number;
  height: number;
}

export type ToucheNavigation = "ArrowLeft" | "ArrowRight" | "ArrowUp" | "ArrowDown" | "Home" | "End";

export function estToucheNavigation(key: string): key is ToucheNavigation {
  return ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(key);
}

/**
 * Tuile à atteindre depuis `index` : gauche/droite suivent l'ordre de lecture (d'une
 * section à l'autre), haut/bas cherchent la rangée voisine la plus proche puis la tuile
 * la mieux alignée horizontalement — la grille change de colonnes avec la fenêtre et le
 * filtre, seule la géométrie réelle fait foi. Rend `index` s'il n'y a rien dans ce sens.
 */
export function tuileVoisine(rects: RectTuile[], index: number, touche: ToucheNavigation): number {
  const n = rects.length;
  if (n === 0) return -1;
  if (touche === "Home") return 0;
  if (touche === "End") return n - 1;
  if (index < 0 || index >= n) return 0;
  if (touche === "ArrowLeft") return Math.max(0, index - 1);
  if (touche === "ArrowRight") return Math.min(n - 1, index + 1);
  const cx = (r: RectTuile) => r.left + r.width / 2;
  const cy = (r: RectTuile) => r.top + r.height / 2;
  const ici = rects[index];
  const bas = touche === "ArrowDown";
  let meilleur = index;
  let meilleurDy = Infinity;
  let meilleurDx = Infinity;
  rects.forEach((r, i) => {
    if (i === index) return;
    const dy = bas ? cy(r) - cy(ici) : cy(ici) - cy(r);
    // Même rangée (centres à moins d'une demi-hauteur) : ce n'est pas « au-dessus ».
    if (dy <= ici.height / 2) return;
    const dx = Math.abs(cx(r) - cx(ici));
    if (dy < meilleurDy - 1 || (Math.abs(dy - meilleurDy) <= 1 && dx < meilleurDx)) {
      meilleur = i;
      meilleurDy = dy;
      meilleurDx = dx;
    }
  });
  return meilleur;
}
