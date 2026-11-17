import { create } from "zustand";
import type { FluxSuperviseur, OutilId } from "../lib/outilsProtocole";
import type { NiveauAutonomie } from "../lib/reglages";

/**
 * État du superviseur côté interface (maquette Superviseur) : fil horodaté, appels
 * d'outils, demandes « À valider », échanges routés entre sessions, sessions bloquées sur
 * une demande d'autorisation, état du moteur, panneau et bulle. Jamais persisté : un
 * relancement repart d'un fil vide (le moteur, lui, garde sa conversation côté claude).
 *
 * Ses réglages (actif, nom, niveau, pause, paires) sont dans `store/reglages`. Le
 * garde-fou (`lib/gardeFou`) lit les deux ; ce store ne décide de rien, il enregistre.
 * Sélecteurs ciblés uniquement.
 */

/** Interlocuteur d'un échange : l'id d'un espace, ou le superviseur lui-même. */
export type Interlocuteur = string;
export const SUPERVISEUR: Interlocuteur = "superviseur";

/** Plafond du fil : au-delà, les plus anciennes entrées tombent. */
export const MAX_FIL = 400;

export type StatutOutil = "en_cours" | "fait" | "en_attente" | "refuse" | "erreur";

/** Bouton d'action posé dans le fil (« Y aller », « Reprendre », « Passer en Agir »…). */
export type ActionFil =
  | { type: "aller"; wsId: string }
  | { type: "reprendre" }
  | { type: "niveau"; niveau: NiveauAutonomie }
  /** Ouvre la liste des échanges toujours autorisés. */
  | { type: "paires" };

/** État d'un espace dans un tableau « où en sont mes agents » (instantané). */
export type EtatLigne = "attente" | "relais" | "travail" | "termine" | "repos";
export interface LigneEtat {
  wsId: string;
  etat: EtatLigne;
  phrase: string;
}

export type PartieFil =
  /** `tete` : nom d'espace en gras devant le texte ; `ton` discret : 12 px, gris. */
  | { type: "texte"; texte: string; ton?: "discret"; tete?: string }
  /** Appel d'outil : `appelId` = id de la requête socket (null : action locale). */
  | { type: "outil"; appelId: number | null; outil: OutilId; args: string; statut: StatutOutil; detail?: string }
  | { type: "etats"; lignes: LigneEtat[] }
  /** Avatars cliquables des espaces concernés. */
  | { type: "refs"; wsIds: string[] }
  | { type: "action"; libelle: string; action: ActionFil };

export type GenreEntree =
  /** Message de l'utilisateur (❯). */
  | "utilisateur"
  /** Le superviseur parle ou agit (`vers` : à qui il écrit). */
  | "superviseur"
  /** Message routé d'une session à une autre (question, réponse). */
  | "message"
  /** Ce que le superviseur a vu dans un espace (agent qui finit, qui attend). */
  | "observation";

export interface EntreeFil {
  id: string;
  /** Epoch ms. */
  a: number;
  genre: GenreEntree;
  de?: Interlocuteur;
  vers?: Interlocuteur;
  /** Espace observé (genre « observation »). */
  wsId?: string;
  parties: PartieFil[];
}

export type StatutDemande = "ouverte" | "autorisee" | "refusee" | "annulee";

/** Écriture dans une session qui attend la validation de l'utilisateur. */
export interface DemandeValidation {
  id: string;
  /** Requête socket d'origine (déjà répondue « en attente »), pour le fil. */
  appelId: number | null;
  outil: "terminal.ecrire" | "session.demander" | "session.repondre";
  /** Où le texte sera écrit. */
  cible: { wsId: string; tabId: string };
  /** Bout de départ de la route affichée (espace ou superviseur) ; null : aucun. */
  de: Interlocuteur | null;
  echangeId: string | null;
  /** « Transmettre la question à api-paiements », « Répondre à api-paiements ». */
  titre: string;
  /** Texte EXACT qui sera écrit. */
  texte: string;
  /** Relais entre espaces : le texte de l'échange seul, sans l'en-tête ni la consigne
      ajoutés au texte écrit (lib/superviseurLibelles, texteTransmis). */
  brut?: string;
  /** Suivi d'Entrée. */
  entree: boolean;
  /** Raison donnée par le superviseur. */
  pourquoi: string;
  /** Dernières lignes du terminal visé (demande d'autorisation en cours), à montrer. */
  apercu?: string[];
  /** Bouts proposés pour « Toujours autoriser » (dossiers ou `PAIRE_SUPERVISEUR`). */
  paire: [string, string] | null;
  /** La session visée attend une réponse à une demande d'autorisation. */
  bloquee: boolean;
  depuis: number;
  statut: StatutDemande;
  /** Case « Toujours autoriser les échanges entre … » cochée. */
  toujours: boolean;
}

export type EtatEchange = "ouvert" | "transmis" | "repondu" | "refuse";

/** Question posée par une session (`terminials demander`) et son cheminement. */
export interface Echange {
  id: string;
  /** Espace qui demande. */
  de: string;
  /** Onglet qui demande (où rendre la réponse). */
  deTabId: string | null;
  /** Espace interrogé, ou le superviseur. */
  vers: Interlocuteur;
  /** Onglet où la question a été transmise. */
  versTabId: string | null;
  question: string;
  reponse: string | null;
  etat: EtatEchange;
  depuis: number;
}

export interface EtatMoteurFront {
  /** Un tour de `claude` est en cours. */
  enCours: boolean;
  dernierTour: number | null;
  derniereErreur: string | null;
}

export type ModeSuperviseur = "observe" | "parle" | "agit" | "pause";

export type NouvelleEntree = Omit<EntreeFil, "id" | "a"> & { a?: number };
export type NouvelleDemande = Omit<DemandeValidation, "id" | "statut" | "toujours" | "depuis"> & { depuis?: number };
export type NouvelEchange = Omit<Echange, "id" | "etat" | "reponse" | "versTabId" | "depuis"> & { depuis?: number };

export interface SuperviseurState {
  fil: EntreeFil[];
  demandes: DemandeValidation[];
  /** Carte affichée en tête de pile (null : la plus ancienne ouverte). */
  demandeFocus: string | null;
  echanges: Echange[];
  /** tabId → message de la demande d'autorisation en cours. */
  sessionsBloquees: Record<string, string>;
  moteur: EtatMoteurFront;
  /** Entrée du tour en cours, qui reçoit les textes du moteur. */
  entreeTour: string | null;
  panneauOuvert: boolean;
  /** Entrées arrivées panneau fermé. */
  nonLus: number;
  /** Signature de la situation dont la bulle a été écartée (elle ne revient qu'à la suivante). */
  bulleEcartee: string | null;
  /** Ce qui s'est passé pendant la pause, résumé à la reprise. */
  manques: string[];

  ouvrirPanneau: () => void;
  fermerPanneau: () => void;
  basculerPanneau: () => void;

  ajouterEntree: (e: NouvelleEntree) => string;
  ajouterPartie: (entreeId: string, partie: PartieFil) => void;
  /** Met à jour la partie « outil » de l'appel `appelId` (la plus récente). */
  majOutil: (appelId: number, patch: { statut: StatutOutil; detail?: string }) => void;

  ajouterDemande: (d: NouvelleDemande) => string;
  deciderDemande: (id: string, statut: Exclude<StatutDemande, "ouverte">) => void;
  basculerToujours: (id: string) => void;
  focaliserDemande: (id: string | null) => void;

  ouvrirEchange: (e: NouvelEchange) => string;
  majEchange: (id: string, patch: Partial<Omit<Echange, "id">>) => void;
  /** Superviseur désactivé : les échanges encore ouverts sont clos (refusés), aucun espace
      ne reste « en relais » sans personne pour lui répondre. */
  cloreEchangesEnCours: () => void;

  bloquerSession: (tabId: string, message: string) => void;
  debloquerSession: (tabId: string) => void;

  /** Événement `superviseur-flux` du moteur. */
  appliquerFlux: (f: FluxSuperviseur, a?: number) => void;

  noterManque: (texte: string) => void;
  /** Rend et vide les manques (à la reprise). */
  viderManques: () => string[];
  ecarterBulle: (signature: string | null) => void;

  reset: () => void;
}

let compteur = 0;
const nouvelId = (prefixe: string) => `${prefixe}:${++compteur}`;

const ETAT_INITIAL = {
  fil: [] as EntreeFil[],
  demandes: [] as DemandeValidation[],
  demandeFocus: null as string | null,
  echanges: [] as Echange[],
  sessionsBloquees: {} as Record<string, string>,
  moteur: { enCours: false, dernierTour: null, derniereErreur: null } as EtatMoteurFront,
  entreeTour: null as string | null,
  panneauOuvert: false,
  nonLus: 0,
  bulleEcartee: null as string | null,
  manques: [] as string[],
};

export const useSuperviseurStore = create<SuperviseurState>((set, get) => {
  const ajouterEntree = (e: NouvelleEntree): string => {
    const id = nouvelId("fil");
    const { a, ...reste } = e;
    const entree: EntreeFil = { ...reste, id, a: a ?? Date.now() };
    set((s) => ({
      fil: s.fil.length >= MAX_FIL ? [...s.fil.slice(s.fil.length - MAX_FIL + 1), entree] : [...s.fil, entree],
      // Ce que l'utilisateur écrit lui-même n'est pas « non lu ».
      nonLus: s.panneauOuvert || e.genre === "utilisateur" ? s.nonLus : s.nonLus + 1,
    }));
    return id;
  };

  return {
    ...ETAT_INITIAL,

    ouvrirPanneau: () => set({ panneauOuvert: true, nonLus: 0 }),
    fermerPanneau: () => set({ panneauOuvert: false }),
    basculerPanneau: () => set((s) => (s.panneauOuvert ? { panneauOuvert: false } : { panneauOuvert: true, nonLus: 0 })),

    ajouterEntree,
    ajouterPartie: (entreeId, partie) =>
      set((s) => ({ fil: s.fil.map((e) => (e.id === entreeId ? { ...e, parties: [...e.parties, partie] } : e)) })),
    majOutil: (appelId, patch) =>
      set((s) => {
        for (let i = s.fil.length - 1; i >= 0; i--) {
          const e = s.fil[i];
          const j = e.parties.findIndex((p) => p.type === "outil" && p.appelId === appelId);
          if (j === -1) continue;
          const parties = e.parties.map((p, k) => (k === j && p.type === "outil" ? { ...p, ...patch } : p));
          const fil = [...s.fil];
          fil[i] = { ...e, parties };
          return { fil };
        }
        return s;
      }),

    ajouterDemande: (d) => {
      const id = nouvelId("demande");
      const { depuis, ...reste } = d;
      set((s) => ({
        demandes: [...s.demandes, { ...reste, id, depuis: depuis ?? Date.now(), statut: "ouverte", toujours: false }],
      }));
      return id;
    },
    deciderDemande: (id, statut) =>
      set((s) => ({
        demandes: s.demandes.map((d) => (d.id === id && d.statut === "ouverte" ? { ...d, statut } : d)),
        demandeFocus: s.demandeFocus === id ? null : s.demandeFocus,
      })),
    basculerToujours: (id) =>
      set((s) => ({ demandes: s.demandes.map((d) => (d.id === id ? { ...d, toujours: !d.toujours } : d)) })),
    focaliserDemande: (id) => set({ demandeFocus: id }),

    ouvrirEchange: (e) => {
      const id = nouvelId("echange");
      const { depuis, ...reste } = e;
      set((s) => ({
        echanges: [
          ...s.echanges,
          { ...reste, id, depuis: depuis ?? Date.now(), etat: "ouvert", reponse: null, versTabId: null },
        ],
      }));
      return id;
    },
    majEchange: (id, patch) =>
      set((s) => ({ echanges: s.echanges.map((x) => (x.id === id ? { ...x, ...patch } : x)) })),
    cloreEchangesEnCours: () =>
      set((s) =>
        s.echanges.some((x) => x.etat === "ouvert" || x.etat === "transmis")
          ? {
              echanges: s.echanges.map((x) =>
                x.etat === "ouvert" || x.etat === "transmis" ? { ...x, etat: "refuse" as const } : x,
              ),
            }
          : s,
      ),

    bloquerSession: (tabId, message) =>
      set((s) => (s.sessionsBloquees[tabId] === message ? s : { sessionsBloquees: { ...s.sessionsBloquees, [tabId]: message } })),
    debloquerSession: (tabId) =>
      set((s) => {
        if (!(tabId in s.sessionsBloquees)) return s;
        const { [tabId]: _fini, ...reste } = s.sessionsBloquees;
        return { sessionsBloquees: reste };
      }),

    appliquerFlux: (f, a) => {
      const maintenant = a ?? Date.now();
      switch (f.type) {
        case "tour-debut":
          set((s) => ({ moteur: { ...s.moteur, enCours: true }, entreeTour: null }));
          return;
        case "texte": {
          const texte = f.texte.trim();
          if (!texte) return;
          const tour = get().entreeTour;
          if (tour && get().fil.some((e) => e.id === tour)) {
            get().ajouterPartie(tour, { type: "texte", texte });
            // Un nouveau texte du même tour, panneau fermé, est une nouvelle chose à lire.
            if (!get().panneauOuvert) set((s) => ({ nonLus: s.nonLus + 1 }));
            return;
          }
          const id = ajouterEntree({ genre: "superviseur", a: maintenant, parties: [{ type: "texte", texte }] });
          set({ entreeTour: id });
          return;
        }
        case "tour-fin":
          set({
            moteur: { enCours: false, dernierTour: maintenant, derniereErreur: f.ok ? null : (f.erreur ?? "tour en échec") },
            entreeTour: null,
          });
          return;
        case "arret":
          set((s) => ({ moteur: { ...s.moteur, enCours: false }, entreeTour: null }));
          return;
      }
    },

    noterManque: (texte) => set((s) => ({ manques: [...s.manques, texte] })),
    viderManques: () => {
      const m = get().manques;
      set({ manques: [] });
      return m;
    },
    ecarterBulle: (signature) => set({ bulleEcartee: signature }),

    reset: () => {
      compteur = 0;
      set({ ...ETAT_INITIAL, sessionsBloquees: {}, fil: [], demandes: [], echanges: [], manques: [] });
    },
  };
});

// --- Lectures pures ---

type Lisible = Pick<SuperviseurState, "demandes" | "echanges" | "moteur" | "fil" | "nonLus" | "demandeFocus">;

/** Demandes encore ouvertes, de la plus ancienne à la plus récente. */
export function demandesOuvertes(s: Pick<SuperviseurState, "demandes">): DemandeValidation[] {
  return s.demandes.filter((d) => d.statut === "ouverte");
}

/** Carte en tête de pile : celle qu'on a choisie, sinon la plus ancienne ouverte. */
export function demandeEnTete(s: Pick<SuperviseurState, "demandes" | "demandeFocus">): DemandeValidation | null {
  const ouvertes = demandesOuvertes(s);
  return ouvertes.find((d) => d.id === s.demandeFocus) ?? ouvertes[0] ?? null;
}

/** L'espace attend la réponse à une question qu'il a posée (anneau pointillé du dock). */
export function espaceEnRelais(s: Pick<SuperviseurState, "echanges">, wsId: string): boolean {
  return s.echanges.some((e) => e.de === wsId && (e.etat === "ouvert" || e.etat === "transmis"));
}

/** Interlocuteur dont l'espace en relais attend la réponse (id d'espace ou SUPERVISEUR),
    null s'il n'attend personne. Le plus récent échange en cours l'emporte. */
export function interlocuteurRelais(s: Pick<SuperviseurState, "echanges">, wsId: string): Interlocuteur | null {
  for (let i = s.echanges.length - 1; i >= 0; i--) {
    const e = s.echanges[i];
    if (e.de === wsId && (e.etat === "ouvert" || e.etat === "transmis")) return e.vers;
  }
  return null;
}

/** Un outil du superviseur est en cours d'exécution (le plus récent), ou null. */
export function outilEnCours(s: Pick<SuperviseurState, "fil">): OutilId | null {
  for (let i = s.fil.length - 1; i >= 0; i--) {
    for (const p of s.fil[i].parties) if (p.type === "outil" && p.statut === "en_cours") return p.outil;
  }
  return null;
}

/**
 * Mode affiché par la marque du dock et l'en-tête du panneau : en pause ; agit (un tour
 * ou un outil en cours) ; parle (quelque chose vous attend : carte ouverte, agent en
 * attente, message non lu) ; observe sinon.
 */
export function modeSuperviseur(s: Lisible, pause: boolean, nbEspacesEnAttente: number): ModeSuperviseur {
  return modeDepuis({
    pause,
    enCours: s.moteur.enCours,
    outil: outilEnCours(s),
    nbDemandes: demandesOuvertes(s).length,
    nbAttente: nbEspacesEnAttente,
    nonLus: s.nonLus,
  });
}

/** Même règle, à partir de valeurs déjà lues (sélecteurs ciblés d'un composant). */
export function modeDepuis(e: {
  pause: boolean;
  enCours: boolean;
  outil: OutilId | null;
  nbDemandes: number;
  nbAttente: number;
  nonLus: number;
}): ModeSuperviseur {
  if (e.pause) return "pause";
  if (e.enCours || e.outil !== null) return "agit";
  if (e.nbDemandes > 0 || e.nbAttente > 0 || e.nonLus > 0) return "parle";
  return "observe";
}

/** Échanges en cours (question posée, réponse pas encore rendue). */
export function nbEchangesEnCours(s: Pick<SuperviseurState, "echanges">): number {
  return s.echanges.filter((e) => e.etat === "ouvert" || e.etat === "transmis").length;
}
