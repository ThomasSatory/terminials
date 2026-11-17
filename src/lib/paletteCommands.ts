import { titreParDefaut } from "./titreParDefaut";
import { classerFlou } from "./fuzzy";
import { couleurEspace } from "./couleurEspace";
import { monogramme } from "./monogram";
import { messageTermine, type EtatAgent } from "./etatAgent";
import { libelleRaccourci, type ShortcutAction } from "./shortcuts";
import { nomSection, type ReglageCherchable } from "./reglagesIndex";
import type { SectionParametres } from "../store/ui";

/**
 * Contenu de la palette de commandes (Ctrl K), en logique pure : à partir d'un instantané
 * des espaces et de la requête, les sections et lignes à afficher. Aucun store, aucun DOM :
 * le composant lit les stores, appelle `construireSections`, puis exécute la `cible` de la
 * ligne choisie.
 */

export type SectionId = "attendent" | "superviseur" | "espaces" | "reprendre" | "onglets" | "actions" | "reglages";

/** Ce qu'une ligne fait quand on la choisit. */
export type CiblePalette =
  | { type: "espace"; wsId: string }
  | { type: "onglet"; wsId: string; tabId: string }
  /** Même chemin que le clavier : `dispatchShortcut(action)`. */
  | { type: "raccourci"; action: ShortcutAction }
  /** Action sans raccourci, portée par le store. */
  | { type: "dupliquer"; wsId: string }
  /** Ouvre le panneau du superviseur ; avec `demande`, la lui envoie aussi. */
  | { type: "superviseur"; demande?: string }
  /** Rouvre un espace récemment fermé (même nom, même dossier). */
  | { type: "reprendre"; cwd: string; nom: string }
  /** Ouvre les Paramètres sur la section, la rangée `ligne` en surbrillance. */
  | { type: "reglage"; section: SectionParametres; ligne: string };

export type VisuelEntree =
  | { genre: "espace"; monogramme: string; couleur: string; etat: EtatAgent; actif: boolean }
  | { genre: "onglet"; etat: EtatAgent; actif: boolean }
  | { genre: "action" }
  /** Carré à l'accent : le superviseur, un réglage (maquettes Superviseur, Parametres). */
  | { genre: "accent" };

export interface EntreePalette {
  /** Unique dans toute la palette (un espace en attente apparaît dans deux sections). */
  id: string;
  section: SectionId;
  libelle: string;
  /** Texte discret à droite du libellé (branche, état de l'agent, nom de l'espace). */
  indice: string;
  tonIndice: "discret" | "travail" | "attente" | "termine";
  /** Raccourci affiché tel que l'app le nomme (« Ctrl+Maj+N »). */
  raccourci?: string;
  cible: CiblePalette;
  visuel: VisuelEntree;
  /** Positions des lettres trouvées dans `libelle`, à surligner. */
  indices: number[];
}

export interface SectionPalette {
  id: SectionId;
  titre: string;
  entrees: EntreePalette[];
}

/** Ce qu'il faut savoir d'un espace (instantané du store, plus l'état d'agent déjà calculé). */
export interface EspacePalette {
  id: string;
  name: string;
  cwd: string;
  color?: string;
  branch?: string;
  tabs: { id: string; title?: string; etat: EtatAgent }[];
  activeTabId: string | null;
  etat: EtatAgent;
  /** Libellé de l'agent au travail (statut posé par les hooks), s'il y en a un. */
  statut?: string;
  /** Dernière notification (ce qui fait attendre l'agent), s'il y en a une. */
  notification?: string;
  /** Sujet du tour que l'agent vient de finir (titre de l'onglet « terminé »). */
  sujetTermine?: string;
  /** Nom du groupe de l'espace : préfixe de l'indice, et cherchable (maquette Groupes). */
  groupe?: string;
}

/** Espace récemment fermé, à reprendre (maquette Accueil/03). */
export interface RecentPalette {
  nom: string;
  cwd: string;
  couleur: string;
  /** « session Claude à reprendre », sinon le dossier abrégé. */
  indice: string;
  /** Ancienneté (« hier », « il y a 3 j »), à la place du raccourci. */
  quand: string;
}

export interface ContextePalette {
  /** Dans l'ordre du dock (hors-groupe, puis groupes). */
  espaces: EspacePalette[];
  /** Ids dans l'ordre de Ctrl 1…9 (groupes repliés exclus). */
  ordreNavigable: string[];
  actifId: string | null;
  /** L'espace actif a-t-il un groupe ? (replier/déplier n'a de sens que là). */
  actifDansGroupe: boolean;
  dockVisible: boolean;
  requete: string;
  /** Superviseur actif : son nom et sa ligne d'état. Absent ou null : la palette ne le
      propose pas (maquette Parametres : « désactivé, la palette ne le propose plus »). */
  superviseur?: { nom: string; etat: string } | null;
  /** Réglages cherchables (lib/reglagesIndex), proposés seulement pendant une recherche. */
  reglages?: readonly ReglageCherchable[];
  /** Espaces récents NON ouverts, du plus récent au plus ancien. */
  reprendre?: readonly RecentPalette[];
}

/** Réglages proposés au plus pendant une recherche (maquette Parametres). */
export const MAX_REGLAGES_PALETTE = 5;

const TITRES: Record<SectionId, string> = {
  attendent: "Vous attendent",
  superviseur: "Superviseur",
  espaces: "Espaces",
  reprendre: "Reprendre",
  onglets: "Onglets",
  actions: "Actions",
  reglages: "Réglages",
};

/** Nom affiché d'un onglet : le titre du terminal, sinon son rang. */
export function titreOnglet(tab: { title?: string; numero?: number }, index: number): string {
  const t = tab.title?.trim();
  return t ? t : titreParDefaut(tab, index);
}

/** Texte discret d'un espace : ce que fait l'agent, ce qu'il attend, sinon la branche
    (« hors dépôt » sans branche) ; précédé du nom de son groupe (« produit · … »). */
export function indiceEspace(e: EspacePalette): { texte: string; ton: EntreePalette["tonIndice"] } {
  const { texte, ton } = indiceSansGroupe(e);
  return { texte: e.groupe ? `${e.groupe} · ${texte}` : texte, ton };
}

function indiceSansGroupe(e: EspacePalette): { texte: string; ton: EntreePalette["tonIndice"] } {
  if (e.etat === "attente") return { texte: e.notification?.trim() || "Vous attend", ton: "attente" };
  if (e.etat === "travail") return { texte: e.statut?.trim() || "Un agent travaille", ton: "travail" };
  if (e.etat === "termine") return { texte: messageTermine(e.sujetTermine), ton: "termine" };
  return { texte: e.branch?.trim() || "hors dépôt", ton: "discret" };
}

interface ActionDef {
  id: string;
  libelle: string;
  /** Mots qui la retrouvent sans être dans son libellé (« récap » → tableau d'activité). */
  motsCles: string;
  raccourci?: string;
  cible: CiblePalette;
  /** Texte discret à droite (vide par défaut). */
  indice?: string;
  /** Carré à l'accent au lieu du gris des actions. */
  accent?: boolean;
}

/** Cible d'une action clavier et son raccourci affiché, lu dans la table des raccourcis
    (lib/shortcuts) : la palette ne peut pas annoncer une touche qui n'existe plus. */
const viaRaccourci = (action: ShortcutAction): Pick<ActionDef, "raccourci" | "cible"> => ({
  raccourci: libelleRaccourci(action),
  cible: { type: "raccourci", action },
});

/** Les actions utilisables dans le contexte courant, dans l'ordre d'affichage. */
export function actionsDisponibles(ctx: ContextePalette): ActionDef[] {
  const actif = ctx.espaces.find((e) => e.id === ctx.actifId) ?? null;
  const plusieurs = ctx.espaces.length > 1;
  const out: ActionDef[] = [];
  // Mosaïque en tête, à l'accent, avec l'état des agents (maquette Mosaique). Sans espace,
  // l'accueil prime : rien à y montrer, elle n'est pas proposée.
  if (ctx.espaces.length > 0) {
    const auTravail = ctx.espaces.filter((e) => e.etat === "travail").length;
    const enAttente = ctx.espaces.filter((e) => e.etat === "attente").length;
    out.push({
      id: "toggle-mosaique",
      libelle: "Mosaïque des agents",
      motsCles: "vue ensemble grille tuiles",
      indice: `${auTravail} au travail · ${enAttente} en attente`,
      accent: true,
      ...viaRaccourci({ type: "toggle-mosaique" }),
    });
  }
  out.push(
    { id: "new-workspace", libelle: "Nouvel espace", motsCles: "creer ajouter workspace projet", ...viaRaccourci({ type: "new-workspace" }) },
    { id: "new-home-workspace", libelle: "Nouvel espace dans le dossier personnel", motsCles: "home accueil direct", ...viaRaccourci({ type: "new-home-workspace" }) },
    { id: "open-folder", libelle: "Ouvrir un dossier", motsCles: "projet repertoire", ...viaRaccourci({ type: "open-folder" }) },
    { id: "new-group", libelle: "Nouveau groupe", motsCles: "dossier regrouper etiquette", ...viaRaccourci({ type: "new-group" }) },
  );
  if (actif) {
    out.push({ id: "new-tab", libelle: "Nouvel onglet", motsCles: "terminal shell", ...viaRaccourci({ type: "new-tab" }) });
    if (actif.cwd) {
      out.push({ id: "toggle-diff", libelle: "Voir les fichiers modifiés", motsCles: "diff git changements", ...viaRaccourci({ type: "toggle-diff" }) });
    }
  }
  out.push(
    { id: "toggle-dashboard", libelle: "Tableau d’activité", motsCles: "recap bilan journee temps", ...viaRaccourci({ type: "toggle-dashboard" }) },
    { id: "toggle-parametres", libelle: "Paramètres", motsCles: "reglages preferences options configuration", ...viaRaccourci({ type: "toggle-parametres" }) },
  );
  if (actif) {
    out.push(
      { id: "rename-workspace", libelle: "Renommer l’espace", motsCles: "modifier nom couleur dossier groupe", ...viaRaccourci({ type: "rename-workspace" }) },
      { id: "duplicate-workspace", libelle: "Dupliquer l’espace", motsCles: "copier cloner", cible: { type: "dupliquer", wsId: actif.id } },
    );
    if (ctx.actifDansGroupe) {
      out.push({ id: "toggle-group", libelle: "Replier ou déplier le groupe", motsCles: "ranger", ...viaRaccourci({ type: "toggle-group" }) });
    }
    if (actif.tabs.length > 1) {
      out.push(
        { id: "next-tab", libelle: "Onglet suivant", motsCles: "droite", ...viaRaccourci({ type: "next-tab" }) },
        { id: "prev-tab", libelle: "Onglet précédent", motsCles: "gauche", ...viaRaccourci({ type: "prev-tab" }) },
      );
    }
    if (plusieurs) {
      out.push(
        { id: "next-workspace", libelle: "Espace suivant", motsCles: "workspace", ...viaRaccourci({ type: "next-workspace" }) },
        { id: "prev-workspace", libelle: "Espace précédent", motsCles: "workspace", ...viaRaccourci({ type: "prev-workspace" }) },
      );
    }
  }
  out.push({
    id: "toggle-dock",
    libelle: ctx.dockVisible ? "Masquer le dock" : "Afficher le dock",
    motsCles: "barre espaces cacher",
    ...viaRaccourci({ type: "toggle-dock" }),
  });
  if (actif) {
    out.push(
      { id: "close-tab", libelle: "Fermer l’onglet", motsCles: "terminal", ...viaRaccourci({ type: "close-tab" }) },
      { id: "close-workspace", libelle: "Fermer l’espace", motsCles: "supprimer quitter workspace", ...viaRaccourci({ type: "close-workspace" }) },
    );
  }
  return out;
}

function entreeEspace(
  e: EspacePalette,
  ctx: ContextePalette,
  section: "attendent" | "espaces",
  indices: number[],
): EntreePalette {
  const rang = ctx.ordreNavigable.indexOf(e.id);
  const { texte, ton } = indiceEspace(e);
  return {
    id: `${section}:${e.id}`,
    section,
    libelle: e.name,
    indice: texte,
    tonIndice: ton,
    // Seuls les neuf premiers espaces visibles ont un accès direct.
    raccourci: rang >= 0 ? libelleRaccourci({ type: "select-workspace", index: rang }) : undefined,
    cible: { type: "espace", wsId: e.id },
    visuel: {
      genre: "espace",
      monogramme: monogramme(e.name),
      couleur: couleurEspace(e),
      etat: e.etat,
      actif: e.id === ctx.actifId,
    },
    indices,
  };
}

/**
 * Sections à afficher, vides omises. Sans requête : « Vous attendent » (les espaces dont
 * un agent attend, en tête), puis tous les espaces, les onglets de l'espace actif et les
 * actions dans leur ordre naturel. Avec une requête : « Vous attendent » disparaît (les
 * mêmes espaces sont dans « Espaces »), chaque section est filtrée et classée, et les
 * onglets de TOUS les espaces deviennent cherchables.
 */
export function construireSections(ctx: ContextePalette): SectionPalette[] {
  const cherche = ctx.requete.trim() !== "";
  const sections: SectionPalette[] = [];
  const ajouter = (id: SectionId, entrees: EntreePalette[]) => {
    if (entrees.length > 0) sections.push({ id, titre: TITRES[id], entrees });
  };

  if (!cherche) {
    ajouter(
      "attendent",
      ctx.espaces.filter((e) => e.etat === "attente").map((e) => entreeEspace(e, ctx, "attendent", [])),
    );
  }

  if (ctx.superviseur) {
    const { nom, etat } = ctx.superviseur;
    const lignes: { id: string; libelle: string; indice: string; raccourci?: string; cible: CiblePalette }[] = [
      { id: "ouvrir", libelle: nom, indice: etat, raccourci: libelleRaccourci({ type: "toggle-superviseur" }), cible: { type: "superviseur" } },
      { id: "etat", libelle: "Où en sont mes agents ?", indice: `demander à ${nom}`, cible: { type: "superviseur", demande: "Où en sont mes agents ?" } },
      { id: "ranger", libelle: "Ranger les espaces par groupe", indice: `demander à ${nom}`, cible: { type: "superviseur", demande: "Range les espaces par groupe" } },
    ];
    ajouter(
      "superviseur",
      classerFlou(lignes, ctx.requete, (l) => [{ texte: l.libelle }, { texte: "superviseur agent global", poids: 0.4 }]).map(
        (r) =>
          ({
            id: `superviseur:${r.item.id}`,
            section: "superviseur",
            libelle: r.item.libelle,
            indice: r.item.indice,
            tonIndice: "discret",
            raccourci: r.item.raccourci,
            cible: r.item.cible,
            visuel: { genre: "accent" },
            indices: r.indices,
          }) satisfies EntreePalette,
      ),
    );
  }

  // Sur le nom et le groupe seulement (maquette Dock/09) : la branche ou le dossier
  // feraient remonter des espaces qui ne correspondent que par « main » ou le chemin.
  // Comme la maquette, les noms (ou groupes) qui CONTIENNENT la requête passent seuls ;
  // la recherche floue ne sert que si aucun ne la contient (faute de frappe, initiales).
  const classesEspaces = classerFlou(ctx.espaces, ctx.requete, (e) => [
    { texte: e.name },
    { texte: e.groupe ?? "", poids: 0.5 },
  ]);
  const q = ctx.requete.trim().toLowerCase();
  const contient = (e: EspacePalette) => e.name.toLowerCase().includes(q) || (e.groupe ?? "").toLowerCase().includes(q);
  const exacts = cherche ? classesEspaces.filter((r) => contient(r.item)) : classesEspaces;
  ajouter(
    "espaces",
    (exacts.length > 0 ? exacts : classesEspaces).map((r) => entreeEspace(r.item, ctx, "espaces", r.indices)),
  );

  ajouter(
    "reprendre",
    classerFlou([...(ctx.reprendre ?? [])], ctx.requete, (e) => [{ texte: e.nom }]).map(
      (r) =>
        ({
          id: `reprendre:${r.item.cwd}\u0000${r.item.nom}`,
          section: "reprendre",
          libelle: r.item.nom,
          indice: r.item.indice,
          tonIndice: "discret",
          raccourci: r.item.quand,
          cible: { type: "reprendre", cwd: r.item.cwd, nom: r.item.nom },
          visuel: { genre: "espace", monogramme: monogramme(r.item.nom), couleur: r.item.couleur, etat: "repos", actif: false },
          indices: r.indices,
        }) satisfies EntreePalette,
    ),
  );

  interface LigneOnglet {
    espace: EspacePalette;
    tabId: string;
    titre: string;
    etat: EtatAgent;
  }
  const onglets: LigneOnglet[] = [];
  for (const espace of ctx.espaces) {
    // Sans requête, seulement l'espace actif (et seulement s'il a de quoi choisir) :
    // lister tous les terminaux de tous les espaces noierait la liste.
    if (!cherche && (espace.id !== ctx.actifId || espace.tabs.length < 2)) continue;
    espace.tabs.forEach((t, i) => onglets.push({ espace, tabId: t.id, titre: titreOnglet(t, i), etat: t.etat }));
  }
  ajouter(
    "onglets",
    classerFlou(onglets, ctx.requete, (o) => [
      { texte: o.titre },
      { texte: o.espace.name, poids: 0.4 },
    ]).map((r) => {
      const { espace, tabId, titre, etat } = r.item;
      const actif = espace.id === ctx.actifId && espace.activeTabId === tabId;
      return {
        id: `onglet:${tabId}`,
        section: "onglets",
        libelle: titre,
        indice: espace.name,
        tonIndice: "discret",
        cible: { type: "onglet", wsId: espace.id, tabId },
        visuel: { genre: "onglet", etat, actif },
        indices: r.indices,
      } satisfies EntreePalette;
    }),
  );

  ajouter(
    "actions",
    classerFlou(actionsDisponibles(ctx), ctx.requete, (a) => [
      { texte: a.libelle },
      { texte: a.motsCles, poids: 0.6 },
    ]).map(
      (r) =>
        ({
          id: `action:${r.item.id}`,
          section: "actions",
          libelle: r.item.libelle,
          indice: r.item.indice ?? "",
          tonIndice: "discret",
          raccourci: r.item.raccourci,
          cible: r.item.cible,
          visuel: { genre: r.item.accent ? "accent" : "action" },
          indices: r.indices,
        }) satisfies EntreePalette,
    ),
  );

  if (cherche && ctx.reglages?.length) {
    ajouter(
      "reglages",
      classerFlou([...ctx.reglages], ctx.requete, (g) => [{ texte: g.libelle }, { texte: g.motsCles, poids: 0.6 }])
        .slice(0, MAX_REGLAGES_PALETTE)
        .map(
          (r) =>
            ({
              id: `reglage:${r.item.id}`,
              section: "reglages",
              libelle: r.item.libelle,
              indice: `Paramètres › ${nomSection(r.item.section)}`,
              tonIndice: "discret",
              cible: { type: "reglage", section: r.item.section, ligne: r.item.id },
              visuel: { genre: "accent" },
              indices: r.indices,
            }) satisfies EntreePalette,
        ),
    );
  }

  return sections;
}

/** Lignes dans l'ordre d'affichage : l'ordre de navigation aux flèches. */
export function aplatir(sections: SectionPalette[]): EntreePalette[] {
  return sections.flatMap((s) => s.entrees);
}

/** Indice de sélection après une flèche, avec rebouclage (Haut sur la première = dernière). */
export function deplacerSelection(courant: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return (((courant + delta) % total) + total) % total;
}

/**
 * Indice affiché de la ligne choisie, retrouvée par son id : la liste se recalcule quand
 * un agent change d'état (une section « Vous attendent » peut apparaître en tête), et un
 * indice conservé désignerait alors une autre ligne que celle choisie. Id absent ou
 * disparu → première ligne.
 */
export function indiceSelection(lignes: readonly { id: string }[], selId: string | null): number {
  if (selId === null) return 0;
  const i = lignes.findIndex((l) => l.id === selId);
  return i < 0 ? 0 : i;
}

/**
 * Découpe un libellé en morceaux alternant texte ordinaire et lettres trouvées, pour
 * surligner la recherche sans innerHTML. `indices` : positions triées (cf. fuzzy).
 */
export function segmenterSurlignage(texte: string, indices: readonly number[]): { texte: string; trouve: boolean }[] {
  if (indices.length === 0) return [{ texte, trouve: false }];
  const trouves = new Set(indices);
  const out: { texte: string; trouve: boolean }[] = [];
  for (let i = 0; i < texte.length; i++) {
    const trouve = trouves.has(i);
    const dernier = out[out.length - 1];
    if (dernier && dernier.trouve === trouve) dernier.texte += texte[i];
    else out.push({ texte: texte[i], trouve });
  }
  return out;
}
