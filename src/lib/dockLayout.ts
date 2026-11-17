/**
 * Géométrie du dock (maquettes Dock et Groupes) : largeur des segments, repli automatique
 * des groupes quand la place manque, pile d'avatars d'un groupe replié, position de
 * l'indicateur d'espace actif.
 *
 * Tout est connu au pixel près sans mesurer le DOM : les boutons d'avatar font la taille
 * de l'avatar + 4 (44 px en densité normale) au pas de bouton + 8 (52), l'étiquette d'un
 * groupe reçoit une largeur explicite calculée ici (JetBrains Mono 11 px, 6,6 px par
 * signe), la pile fait trois décalages, un bouton et le compteur (88 px). La taille des
 * avatars suit le réglage « Densité du dock » (32, 40 ou 48 px) ; chaque fonction la
 * reçoit en dernier argument, 40 par défaut. Le composant n'a donc à mesurer que la place
 * disponible ; l'estimation et le rendu ne peuvent pas diverger, et le repli ne
 * « clignote » pas d'une image à l'autre.
 */

/** Bouton d'avatar en densité normale (disque de 40 + marge de survol). */
export const LARGEUR_AVATAR = 44;
/** Pas entre deux avatars voisins (44 + écart de 8). */
export const PAS_AVATAR = 52;
/** Écart entre segments de la bande (gap du flex). */
export const ECART_BANDE = 8;
/** Séparateur après le hors-groupe : filet de 1 px + un écart de 8. */
export const LARGEUR_SEPARATEUR = 9;
/** Pile d'un groupe replié : trois avatars décalés de 10 px + compteur. */
export const LARGEUR_PILE = 88;
/** Décalage entre deux avatars empilés. */
export const DECALAGE_PILE = 10;
/** Taille d'avatar par défaut (densité normale). */
export const TAILLE_AVATAR_DEFAUT = 40;
/** Place du compteur à droite d'une pile (22 px + marge de 2). */
const LARGEUR_COMPTEUR_PILE = 24;

/** Mesures du dock qui découlent de la taille des avatars. */
export interface GeometrieAvatars {
  /** Diamètre du disque. */
  avatar: number;
  /** Bouton qui le porte (marge de survol de 2 px de chaque côté). */
  bouton: number;
  /** Pas entre deux avatars voisins. */
  pas: number;
  /** Pile d'un groupe replié. */
  pile: number;
  /** Abscisse du compteur dans la boîte d'une pile. */
  compteur: number;
  /** Hauteur des filets verticaux (70 % de l'avatar, 28 px en normal). */
  filet: number;
  /** Distance de l'infobulle au bas du bouton (bouton + 18). */
  infobulle: number;
}

export function geometrieAvatars(taille: number = TAILLE_AVATAR_DEFAUT): GeometrieAvatars {
  const bouton = taille + 4;
  return {
    avatar: taille,
    bouton,
    pas: bouton + ECART_BANDE,
    pile: (VISIBLES_PILE - 1) * DECALAGE_PILE + bouton + LARGEUR_COMPTEUR_PILE,
    compteur: (VISIBLES_PILE - 1) * DECALAGE_PILE + bouton + 2,
    filet: Math.round(taille * 0.7),
    infobulle: bouton + 18,
  };
}

/** Avatars visibles dans une pile : les suivants s'effacent dessous. */
export const VISIBLES_PILE = 3;
/** Étiquette de groupe plafonnée : un nom très long s'abrège (points de suspension). */
export const LARGEUR_ETIQUETTE_MAX = 166;

/** Un segment de la bande : le hors-groupe (id null) ou un groupe. */
export interface SegmentDock<W> {
  id: string | null;
  nom: string;
  membres: W[];
}

/**
 * Segments dans l'ordre du dock : hors-groupe d'abord (comme en tête de l'ancienne barre
 * latérale), puis chaque groupe dans l'ordre de `groups`. Le hors-groupe n'apparaît que
 * s'il a des membres ; un groupe vide garde son étiquette (on peut y déposer un espace).
 */
export function segmentsDock<W extends { groupId: string | null }>(
  workspaces: readonly W[],
  groups: readonly { id: string; name: string }[],
): SegmentDock<W>[] {
  const segs: SegmentDock<W>[] = [];
  const horsGroupe = workspaces.filter((w) => w.groupId === null);
  if (horsGroupe.length) segs.push({ id: null, nom: "Hors groupe", membres: horsGroupe });
  for (const g of groups) segs.push({ id: g.id, nom: g.name, membres: workspaces.filter((w) => w.groupId === g.id) });
  return segs;
}

/** Largeur de l'étiquette d'un groupe : 34 px de marges et carré + 6,6 px par signe. */
export function largeurEtiquette(nom: string): number {
  return Math.min(LARGEUR_ETIQUETTE_MAX, 34 + Math.ceil([...nom].length * 6.6));
}

/** Largeur de la boîte des membres : rangée d'avatars, pile si replié, rien si vide. */
export function largeurMembres(n: number, replie: boolean, taille: number = TAILLE_AVATAR_DEFAUT): number {
  if (n <= 0) return 0;
  const g = geometrieAvatars(taille);
  return replie ? g.pile : n * g.pas - ECART_BANDE;
}

/** Largeur d'un segment. Groupe : marge 6 + étiquette + 2 + membres + marge 4. */
export function largeurSegment(seg: SegmentDock<unknown>, replie: boolean, taille: number = TAILLE_AVATAR_DEFAUT): number {
  const m = largeurMembres(seg.membres.length, seg.id !== null && replie, taille);
  return seg.id === null ? m : 6 + largeurEtiquette(seg.nom) + 2 + m + 4;
}

/** Abscisse de début de chaque segment dans la bande (et largeur totale en fin). */
function abscisses(segs: readonly SegmentDock<unknown>[], replis: ReadonlySet<string>, taille: number): number[] {
  const xs: number[] = [];
  let x = 0;
  segs.forEach((seg, i) => {
    xs.push(x);
    x += largeurSegment(seg, seg.id !== null && replis.has(seg.id), taille);
    if (i < segs.length - 1) x += ECART_BANDE + (seg.id === null ? LARGEUR_SEPARATEUR : 0);
  });
  xs.push(x);
  return xs;
}

/** Largeur totale de la bande des espaces, selon les groupes repliés. */
export function largeurBande(
  segs: readonly SegmentDock<unknown>[],
  replis: ReadonlySet<string>,
  taille: number = TAILLE_AVATAR_DEFAUT,
): number {
  const xs = abscisses(segs, replis, taille);
  return xs[xs.length - 1];
}

/** Rang de consultation d'un groupe : 0 = le plus récent ; jamais consulté = dernier. */
function rang(recents: readonly string[], id: string): number {
  const i = recents.indexOf(id);
  return i === -1 ? Number.MAX_SAFE_INTEGER : i;
}

/** Remonte un groupe en tête des groupes récemment consultés. */
export function consulterGroupe(recents: readonly string[], id: string): string[] {
  if (recents[0] === id) return recents as string[];
  return [id, ...recents.filter((x) => x !== id)];
}

export interface EntreeRepli {
  segments: readonly SegmentDock<unknown>[];
  /** Groupes repliés à la main (persistés). */
  replisManuels: ReadonlySet<string>;
  /** Groupes du plus au moins récemment consultés. */
  recents: readonly string[];
  /** Groupe de l'espace actif (null : hors groupe ou aucun). */
  groupeActif: string | null;
  /** Place disponible pour la bande, en px (Infinity tant qu'elle n'est pas mesurée). */
  disponible: number;
  /** Taille des avatars (densité du dock) ; 40 par défaut. */
  taille?: number;
}

export interface Repli {
  /** Groupes affichés repliés : manuels + automatiques. */
  replis: Set<string>;
  /** Groupes repliés faute de place (l'infobulle de la pile le dit). */
  auto: Set<string>;
  /** Même tout replié, la bande déborde : elle défile, bords estompés. */
  defile: boolean;
}

/**
 * Repli automatique : tant que la bande ne tient pas, on replie le groupe le MOINS
 * récemment consulté, jamais celui de l'espace actif ni le dernier déplié à la main.
 * S'il ne tient toujours pas (fenêtre très étroite), la bande défile.
 */
export function replisAutomatiques(e: EntreeRepli): Repli {
  const replis = new Set(e.replisManuels);
  const auto = new Set<string>();
  const garder = new Set([e.groupeActif, e.recents[0]].filter((x): x is string => !!x));
  const taille = e.taille ?? TAILLE_AVATAR_DEFAUT;
  const candidats = e.segments
    .filter((s): s is SegmentDock<unknown> & { id: string } => s.id !== null)
    .filter((s) => !replis.has(s.id) && !garder.has(s.id))
    // On ne replie que ce qui fait gagner de la place : un groupe vide ou dont la pile est
    // aussi large que sa rangée dépliée (un seul membre) élargirait la bande au lieu de la réduire.
    .filter((s) => largeurMembres(s.membres.length, true, taille) < largeurMembres(s.membres.length, false, taille))
    // Tri stable : à rang égal (jamais consultés), l'ordre du dock décide.
    .sort((a, b) => rang(e.recents, b.id) - rang(e.recents, a.id));
  while (largeurBande(e.segments, replis, taille) > e.disponible && candidats.length) {
    const g = candidats.shift()!;
    replis.add(g.id);
    auto.add(g.id);
  }
  return { replis, auto, defile: largeurBande(e.segments, replis, taille) > e.disponible };
}

export type EtatPile = "travail" | "attente" | "repos";

export interface Pile {
  /** Ids dans l'ordre d'empilement : le représentant en tête (au-dessus). */
  ordre: string[];
  /** Membre qui porte l'état du groupe : en attente, sinon au travail, sinon actif. */
  representant: string | null;
  /** État remonté par la pile : l'attente prime sur le travail. */
  etat: EtatPile;
}

/**
 * Pile d'un groupe replié : le membre qui compte passe en tête (un agent qui attend,
 * sinon un agent qui travaille, sinon l'espace actif, sinon le premier) et la pile
 * remonte l'état de tous ses membres.
 */
export function pileGroupe(ids: readonly string[], etats: ReadonlyMap<string, EtatPile>, activeId: string | null): Pile {
  const attente = ids.find((id) => etats.get(id) === "attente");
  const travail = ids.find((id) => etats.get(id) === "travail");
  const representant = attente ?? travail ?? ids.find((id) => id === activeId) ?? ids[0] ?? null;
  const ordre = representant === null ? [] : [representant, ...ids.filter((id) => id !== representant)];
  return { ordre, representant, etat: attente ? "attente" : travail ? "travail" : "repos" };
}

/** Place d'un avatar dans la boîte des membres : décalage, empilement, visibilité. */
export interface PlaceMembre {
  x: number;
  z: number;
  visible: boolean;
}

/** Rangée : un avatar par pas (52 px en normal). Pile : décalés de 10 px, le représentant dessus. */
export function placeMembre(
  index: number,
  rangPile: number,
  replie: boolean,
  taille: number = TAILLE_AVATAR_DEFAUT,
): PlaceMembre {
  if (!replie) return { x: index * geometrieAvatars(taille).pas, z: 1, visible: true };
  return {
    x: Math.min(rangPile, VISIBLES_PILE - 1) * DECALAGE_PILE,
    z: 10 - rangPile,
    visible: rangPile < VISIBLES_PILE,
  };
}

/**
 * Abscisse de l'indicateur (boîte de la largeur d'un bouton, centrée sous l'avatar) dans la
 * bande, ou null si l'espace actif n'y est pas. Sous une pile, il se pose sous son
 * deuxième avatar, au centre visuel de la pile.
 */
export function abscisseIndicateur(
  segs: readonly SegmentDock<{ id: string }>[],
  replis: ReadonlySet<string>,
  activeId: string | null,
  taille: number = TAILLE_AVATAR_DEFAUT,
): number | null {
  if (activeId === null) return null;
  const xs = abscisses(segs, replis, taille);
  for (let s = 0; s < segs.length; s++) {
    const seg = segs[s];
    const i = seg.membres.findIndex((w) => w.id === activeId);
    if (i === -1) continue;
    const debut = xs[s] + (seg.id === null ? 0 : 6 + largeurEtiquette(seg.nom) + 2);
    return seg.id !== null && replis.has(seg.id) ? debut + DECALAGE_PILE : debut + i * geometrieAvatars(taille).pas;
  }
  return null;
}

/** Fond du segment d'un groupe (#1d1e22 : dock + voile blanc à 4 %), en composantes. */
const FOND_SEGMENT: readonly [number, number, number] = [29, 30, 34];

/**
 * Fond OPAQUE d'un avatar de groupe : sa couleur à `part` sur le fond du segment. Un fond
 * translucide laisserait voir les voisins à travers une pile d'avatars superposés.
 * `couleur` en #rrggbb (lib/couleurEspace).
 */
export function melangeOpaque(couleur: string, part: number, fond: readonly [number, number, number] = FOND_SEGMENT): string {
  const c = [1, 3, 5].map((i, k) => Math.round(fond[k] + (parseInt(couleur.slice(i, i + 2), 16) - fond[k]) * part));
  return `rgb(${c.join(",")})`;
}

/** Largeur de la zone, au bord de la bande qui défile, où un glisser la fait défiler. */
export const ZONE_DEFILEMENT = 40;
/** Pas maximal de ce défilement, en px par image (au ras du bord). */
const PAS_DEFILEMENT_MAX = 14;

/**
 * Défilement automatique de la bande pendant un glisser : px à ajouter à `scrollLeft` à
 * chaque image, négatif vers la gauche, 0 hors des zones de bord. Proportionnel à
 * l'enfoncement dans la zone, et maximal au-delà du bord (pointeur sorti de la bande).
 */
export function pasDefilementBord(x: number, gauche: number, droite: number, zone: number = ZONE_DEFILEMENT): number {
  if (droite - gauche <= 2 * zone) return 0; // bande trop étroite : les zones se chevaucheraient
  const enfoncement = (d: number) => Math.min(1, Math.max(0, (zone - d) / zone));
  if (x < gauche + zone) return -Math.ceil(enfoncement(x - gauche) * PAS_DEFILEMENT_MAX);
  if (x > droite - zone) return Math.ceil(enfoncement(droite - x) * PAS_DEFILEMENT_MAX);
  return 0;
}
