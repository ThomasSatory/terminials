import type { SectionParametres } from "../store/ui";
import type { ClickupSource } from "./activityApi";
import { INDEX_REGLAGES, SECTIONS_PARAMETRES } from "./reglagesIndex";
import { GROUPES_RACCOURCIS, type RangeeRaccourci } from "./parametresRaccourcis";
import { basename } from "./palette";
import { pluriel } from "./pluriel";
import { PAIRE_SUPERVISEUR, type PaireAutorisee } from "./reglages";

/**
 * Modèle de la vue Paramètres (maquette Parametres), en logique pure : sections → blocs →
 * rangées, selon l'état des réglages (une rangée n'existe que si l'app peut l'honorer,
 * ou si l'interrupteur dont elle dépend est ouvert), et la recherche qui traverse toutes
 * les sections. Le composant rend chaque rangée d'après son `id` ; la recherche, la
 * navigation et les compteurs ne dépendent que d'ici.
 *
 * Les mots-clés d'une rangée viennent de `INDEX_REGLAGES` (même source que la palette) :
 * une rangée et son entrée de palette ne peuvent pas diverger.
 */

export interface RangeeParametre {
  id: string;
  libelle: string;
  /** Explication sous le libellé ; vide : aucune. */
  desc: string;
  motsCles: string;
  /** Rangée de la section Raccourcis : combinaisons affichées en touches. */
  combos?: string[][];
}

export interface BlocParametres {
  /** Intertitre ; vide : aucun. */
  titre: string;
  note?: string;
  rangees: RangeeParametre[];
}

export interface SectionModele {
  id: SectionParametres;
  nom: string;
  intro: string;
  /** Tracé SVG (viewBox 16, au trait) de l'icône de navigation. */
  icone: string;
  blocs: BlocParametres[];
}

/** Ce dont dépend la forme de la page. */
export interface ContexteModele {
  supActif: boolean;
  /** Nom affiché du superviseur (« Ce que Vigie peut faire »). */
  supNom: string;
  /** Réglages d'activité : null tant qu'ils ne sont pas lus (ou illisibles). */
  activite: { source: ClickupSource; integrationShell: boolean } | null;
  /** Message de la section Activité quand ses réglages manquent (chargement, erreur). */
  noteActivite?: string;
  raccourcis: readonly RangeeRaccourci[];
}

const INTROS: Record<SectionParametres, { intro: string; icone: string }> = {
  apparence: {
    intro: "Couleur, taille du texte et mouvement de l’interface.",
    icone: "M8 2.5a5.5 5.5 0 1 0 0 11a5.5 5.5 0 0 0 0-11zM8 2.5v11M8 5.5h4.8M8 8h5.5M8 10.5h4.8",
  },
  terminal: {
    intro: "Ce que lance un nouveau terminal, et comment il se comporte.",
    icone: "M2.5 3.5h11v9h-11zM5 6.5l2 1.5-2 1.5M8.5 10H11",
  },
  agents: {
    intro: "Comment l’app sait qu’un agent travaille ou vous attend, et comment elle vous prévient.",
    icone: "M4.5 11V7.5a3.5 3.5 0 0 1 7 0V11l1 1.5h-9zM6.8 14h2.4",
  },
  superviseur: {
    intro: "L’agent global qui veille sur tous vos espaces, à la place que vous lui donnez.",
    icone:
      "M2.5 6V4a1.5 1.5 0 0 1 1.5-1.5h2M10 2.5h2A1.5 1.5 0 0 1 13.5 4v2M13.5 10v2a1.5 1.5 0 0 1-1.5 1.5h-2M6 13.5H4A1.5 1.5 0 0 1 2.5 12v-2M7.6 8h.8",
  },
  activite: {
    intro: "Ce que le récap relève dans la journée, et quand il rédige le bilan.",
    icone: "M3 13V9M6.5 13V4M10 13V7M13.5 13V10",
  },
  raccourcis: {
    intro: "Tous les raccourcis de l’app, lus par position physique : identiques en AZERTY et en QWERTY.",
    icone: "M2 4.5h12v7H2zM4.5 7h1M7.5 7h1M10.5 7h1M5 9.5h6",
  },
  apropos: {
    intro: "Version, fichiers de configuration et retour aux réglages d’origine.",
    icone: "M8 2.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 0 1 0-11zM8 7.5v3.5M8 5.2v.3",
  },
};

/** Rangée d'un réglage de l'index : libellé, mots-clés et section en viennent. */
function r(id: string, libelle: string, desc: string): RangeeParametre {
  const entree = INDEX_REGLAGES.find((e) => e.id === id);
  return { id, libelle, desc, motsCles: entree?.motsCles ?? "" };
}

/** Explication de la rangée « Tâches » : la cadence réelle de chaque source (activity.rs). */
function descTaches(source: ClickupSource): string {
  if (source === "claude_mcp") return "Le gestionnaire de tâches est interrogé une fois par heure, en 1 à 2 minutes.";
  if (source === "api") return "Le gestionnaire de tâches est interrogé toutes les 15 minutes.";
  return "Aucune tâche relevée : le bilan s’appuie sur les commits et les prompts.";
}

export function construireSections(ctx: ContexteModele): SectionModele[] {
  const nom = ctx.supNom.trim() || "Superviseur";
  const blocs: Record<SectionParametres, BlocParametres[]> = {
    apparence: [
      {
        titre: "Interface",
        rangees: [
          r("accent", "Couleur d’accent", "Sélection et « un agent vous attend ». Le cyan reste réservé à « au travail »."),
          r("densite", "Densité du dock", "Taille des avatars : 32, 40 ou 48 px. Le dock se met à jour en bas de l’écran."),
          r(
            "reduire",
            "Réduire les animations",
            "Coupe les sauts du dock, les arcs qui tournent et les glissements. Activé d’office si le système le demande.",
          ),
        ],
      },
      { titre: "Texte du terminal", rangees: [r("taillePolice", "Taille de police du terminal", "Appliquée à tous les terminaux ouverts.")] },
    ],
    terminal: [
      {
        titre: "Nouveaux terminaux",
        rangees: [
          r("shell", "Shell par défaut", "Par défaut, le shell de votre session."),
          r("dossierDepart", "Dossier de départ", "Où s’ouvre un nouvel espace créé par Ctrl+Maj+Entrée."),
          r("police", "Police", "JetBrains Mono est intégrée à l’app, avec ses ligatures désactivées."),
        ],
      },
      {
        titre: "Comportement",
        rangees: [
          r("defilement", "Défilement", "Lignes conservées par terminal. Au-delà, les plus anciennes sont effacées."),
          r("copierSelection", "Copier à la sélection", "Ctrl+Maj+C et Ctrl+Maj+V restent toujours actifs."),
          r(
            "reprendreSessions",
            "Reprendre les sessions Claude",
            "Au relancement de l’app, chaque onglet retrouve sa conversation (claude --resume).",
          ),
        ],
      },
    ],
    agents: [
      {
        titre: "Détection des agents",
        rangees: [
          r(
            "hooks",
            "Hooks Claude Code",
            "Six hooks préviennent l’app à chaque étape d’un agent : prompt envoyé, outil lancé, fin de tour, autorisation demandée, début et fin de session.",
          ),
        ],
      },
      {
        titre: "Vous prévenir",
        rangees: [
          r("notifSysteme", "Notifications système", "Quand un agent vous attend et que la fenêtre n’a pas le focus."),
          r("bulle", "Bulle au-dessus du dock", "Une ligne qui annonce l’agent qui vient de finir ou qui demande une autorisation."),
          r("son", "Son", "Un son bref quand un agent passe en attente."),
        ],
      },
    ],
    superviseur: [
      {
        titre: "",
        rangees: [
          r("supActif", "Superviseur activé", "Un agent global qui observe tous les espaces. Désactivé, il ne tourne pas du tout."),
          ...(ctx.supActif
            ? [
                r("supNom", "Nom", "Il signe ses messages de ce nom, et la palette le propose sous ce nom."),
                r("supPause", "En pause", "Il n’observe plus et n’agit plus ; à la reprise, il résume ce qu’il a manqué."),
              ]
            : []),
        ],
      },
      ...(ctx.supActif
        ? [
            { titre: "Autonomie", rangees: [r("supNiveau", `Ce que ${nom} peut faire`, "")] },
            {
              titre: "Échanges entre espaces",
              note: `Deux espaces d’une paire peuvent se passer du contexte par ${nom}. Révoquer coupe l’échange tout de suite.`,
              rangees: [r("supPaires", "Paires autorisées", "")],
            },
          ]
        : [
            {
              titre: "",
              note: "Désactivé : rien ne tourne en arrière-plan, la palette et la bulle ne le proposent plus.",
              rangees: [],
            },
          ]),
    ],
    activite: ctx.activite
      ? [
          {
            titre: "Bilan",
            note: "Rédigé en local par Claude Code (claude -p), à partir des commits, des prompts et des commandes relevés.",
            rangees: [
              r("heure", "Heure de rédaction", "Le bilan est rédigé chaque jour à cette heure."),
              r("joursOuvres", "Jours ouvrés seulement", "Pas de bilan le samedi ni le dimanche."),
            ],
          },
          {
            titre: "Sources",
            rangees: [
              r("taches", "Tâches", descTaches(ctx.activite.source)),
              ...(ctx.activite.source === "claude_mcp"
                ? [r("listes", "Listes suivies", "Vide : les listes de sprint dont la période contient le jour.")]
                : []),
              ...(ctx.activite.source === "api"
                ? [r("cle", "Clé personnelle", "Gardée dans le fichier de réglages, lisible par vous seul.")]
                : []),
              r("reunions", "Réunions de l’agenda", "Relevées par Claude Code pour pré-remplir le temps à saisir."),
              r("commandesShell", "Commandes du shell", "Intégration shell : relève les commandes lancées dans les terminaux."),
              ...(ctx.activite.integrationShell ? [r("commandesIgnorees", "Commandes ignorées", "Séparées par des virgules.")] : []),
              r("adresseCommits", "Adresse des commits", "Vide : l’adresse de git config."),
              r("motifs", "Motifs de tickets", "Un motif par ligne, reconnu dans les branches, les commits et les prompts."),
            ],
          },
          {
            titre: "Temps à saisir",
            rangees: [
              r("objectif", "Objectif journalier", "Au quart d’heure près."),
              r("tacheReunions", "Tâche des réunions", "Reçoit le temps sans tâche. Vide : la tâche « Réunion » du sprint en cours."),
            ],
          },
          { titre: "Collecte", rangees: [r("collecte", "Relever maintenant", "")] },
        ]
      : [{ titre: "", note: ctx.noteActivite ?? "Lecture des réglages d’activité…", rangees: [] }],
    raccourcis: GROUPES_RACCOURCIS.map((groupe, i) => ({
      titre: groupe,
      note: i === 0 ? "Lecture seule : les raccourcis ne se personnalisent pas encore." : undefined,
      rangees: ctx.raccourcis
        .filter((k) => k.groupe === groupe)
        .map((k) => ({ id: k.id, libelle: k.libelle, desc: "", motsCles: k.motsCles, combos: k.combos })),
    })).filter((b) => b.rangees.length > 0),
    apropos: [
      {
        titre: "terminials",
        rangees: [
          r("version", "Version", "Multiplexeur de terminaux pour agents de code."),
          r("fichier", "Fichier de réglages", "Réécrit à chaque changement, lisible par vous seul (0600)."),
          // Écart voulu avec la maquette (« Réglages, données d’activité et sessions à
          // reprendre ») : ce texte y serait faux. Le dossier ouvert ici (parent de
          // settings.json, sous $XDG_CONFIG_HOME) ne contient que les réglages ; la base
          // d'activité et la session du superviseur sont dans le dossier des données, dont
          // la rangée affiche le vrai chemin (lu au backend, $XDG_DATA_HOME respecté).
          r("dossierConfig", "Dossier de configuration", "Réglages de l’app et du récap."),
        ],
      },
      { titre: "Réinitialiser", rangees: [r("reinitialiser", "Revenir aux réglages d’origine", "")] },
    ],
  };
  return SECTIONS_PARAMETRES.map((s) => ({ id: s.id, nom: s.nom, ...INTROS[s.id], blocs: blocs[s.id] }));
}

/** Texte comparable : minuscules, sans accents, « + » compté comme une espace. */
export function normaliserRecherche(t: string): string {
  return t
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[’']/g, " ")
    .replace(/\+/g, " ")
    .replace(/\s+/g, " ");
}

export function correspond(rangee: RangeeParametre, requete: string): boolean {
  const q = normaliserRecherche(requete).trim();
  if (!q) return true;
  return normaliserRecherche(`${rangee.libelle} ${rangee.desc} ${rangee.motsCles}`).includes(q);
}

export interface ResultatRecherche {
  section: SectionModele;
  rangees: RangeeParametre[];
}

/** Rangées trouvées, section par section (sections sans résultat omises). */
export function rechercher(sections: readonly SectionModele[], requete: string): ResultatRecherche[] {
  return sections
    .map((section) => ({
      section,
      rangees: section.blocs.flatMap((b) => b.rangees.filter((x) => correspond(x, requete))),
    }))
    .filter((res) => res.rangees.length > 0);
}

/** Intro de la page pendant une recherche. */
export function introRecherche(total: number, requete: string): string {
  return total
    ? `${pluriel(total, "réglage")} pour « ${requete.trim()} », dans toutes les sections.`
    : "Rien ne correspond, dans aucune section.";
}

/** Blocs de la section Raccourcis filtrés (champ « Filtrer »), blocs vides retirés. */
export function filtrerRaccourcis(blocs: readonly BlocParametres[], filtre: string): BlocParametres[] {
  const q = normaliserRecherche(filtre).trim();
  if (!q) return [...blocs];
  return blocs
    .map((b) => ({
      ...b,
      rangees: b.rangees.filter((x) => normaliserRecherche(`${x.libelle} ${x.motsCles}`).includes(q)),
    }))
    .filter((b) => b.rangees.length > 0);
}

// ---------------------------------------------------------------------------
// Libellés
// ---------------------------------------------------------------------------

/** « ~/.config/terminials/settings.json » : le dossier personnel abrégé. */
export function cheminAbrege(chemin: string, home: string | null): string {
  if (!home) return chemin;
  const h = home.replace(/\/+$/, "");
  if (!h) return chemin;
  if (chemin === h) return "~";
  return chemin.startsWith(`${h}/`) ? `~${chemin.slice(h.length)}` : chemin;
}

/** « autorisée le 12 nov. · 6 échanges » ; sans date connue, seulement le compte. */
export function sousTitrePaire(p: Pick<PaireAutorisee, "depuis" | "echanges">): string {
  const echanges = pluriel(p.echanges, "échange");
  if (!p.depuis) return `autorisée · ${echanges}`;
  const date = new Date(p.depuis).toLocaleDateString("fr-FR", { day: "numeric", month: "short" });
  return `autorisée le ${date} · ${echanges}`;
}

/** Membre d'une paire tel que la page l'affiche : l'espace ouvert sur ce dossier, sinon
    le nom du dossier ; le superviseur sous son nom. */
export interface MembrePaire {
  nom: string;
  /** Espace ouvert sur ce dossier (pour son avatar), null sinon. */
  wsId: string | null;
  superviseur: boolean;
}

export function membrePaire(
  cle: string,
  espaces: readonly { id: string; cwd: string; name: string }[],
  nomSuperviseur: string,
): MembrePaire {
  if (cle === PAIRE_SUPERVISEUR) return { nom: nomSuperviseur, wsId: null, superviseur: true };
  const w = espaces.find((x) => x.cwd === cle);
  return { nom: w?.name ?? basename(cle), wsId: w?.id ?? null, superviseur: false };
}

/** Option du choix du shell : valeur enregistrée ("" : celui de la session) et libellé. */
export interface OptionShell {
  valeur: string;
  libelle: string;
}

/**
 * Shells proposés : celui de la session (« $SHELL · zsh »), puis chaque autre shell
 * installé (un par nom), puis la valeur enregistrée si elle n'est dans aucun (fichier
 * édité à la main) : le choix courant reste toujours visible.
 */
export function optionsShell(shellSession: string | null, installes: readonly string[], courant: string): OptionShell[] {
  const session = shellSession ? basename(shellSession) : "";
  const options: OptionShell[] = [{ valeur: "", libelle: session ? `$SHELL · ${session}` : "$SHELL" }];
  const noms = new Set([session]);
  for (const chemin of installes) {
    const nom = basename(chemin);
    if (!nom || noms.has(nom)) continue;
    noms.add(nom);
    options.push({ valeur: chemin, libelle: nom });
  }
  if (courant && !options.some((o) => o.valeur === courant)) {
    // Même nom qu'une option (autre chemin du même shell) : c'est elle qu'on remplace.
    const i = options.findIndex((o, k) => k > 0 && o.libelle === basename(courant));
    if (i > 0) options[i] = { valeur: courant, libelle: basename(courant) };
    else options.push({ valeur: courant, libelle: basename(courant) });
  }
  return options;
}

/** Description de « Relever maintenant » : âge de la dernière collecte (epoch s). */
export function descCollecte(lastCollect: Record<string, number> | null, maintenantS: number, enCours: boolean): string {
  const auto = "Automatique toutes les 5 minutes.";
  if (enCours) return `Collecte en cours… ${auto}`;
  const valeurs = Object.values(lastCollect ?? {});
  if (!valeurs.length) return `Aucune collecte pour l’instant. ${auto}`;
  const minutes = Math.max(0, Math.floor((maintenantS - Math.max(...valeurs)) / 60));
  const age = minutes === 0 ? "à l’instant" : minutes < 60 ? `il y a ${minutes} min` : `il y a ${pluriel(Math.floor(minutes / 60), "heure")}`;
  return `Dernière collecte ${age}. ${auto}`;
}

/** « 07:00 » ⇄ heure et minute du bilan. */
export function heureEnTexte(heure: number, minute: number): string {
  const p = (n: number) => String(Math.max(0, Math.trunc(n))).padStart(2, "0");
  return `${p(heure)}:${p(minute)}`;
}

export function texteEnHeure(t: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(t.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  return hour < 24 && minute < 60 ? { hour, minute } : null;
}

/** Minutes → « 7.5 » pour un champ d'heures décimales. */
export function minutesEnHeures(minutes: number): string {
  return String(Math.round((minutes / 60) * 100) / 100);
}
