/**
 * Contrat front ↔ backend du superviseur et de ses outils : miroir TypeScript des types
 * Rust de `crates/protocol` (outils, origine, requête/réponse) et de
 * `crates/core/src/superviseur` (événements, flux, état du moteur). Les formes JSON
 * sont identiques ; tout changement se fait des deux côtés.
 */

/** Ce qu'un outil a le droit de faire (comparé au niveau d'autonomie par le garde-fou). */
export type ClasseOutil = "observer" | "reorganiser" | "ecrire";

export type OutilId =
  | "espaces.etat"
  | "terminal.lire"
  | "notifier"
  | "demander"
  | "espace.resumer"
  | "espace.creer"
  | "espace.renommer"
  | "espace.deplacer"
  | "espace.fermer"
  | "groupe.creer"
  | "onglet.ouvrir"
  | "espace.focus"
  | "terminal.ecrire"
  | "session.demander"
  | "session.repondre";

/** Qui appelle l'outil, déterminé par le backend (jeton, variables d'environnement). */
export type Origine =
  | { type: "superviseur" }
  | { type: "espace"; workspaceId: string; ptyId?: number }
  | { type: "externe" };

/** Charge de l'événement `outil-requete` (backend → front). */
export interface RequeteOutil {
  id: number;
  outil: OutilId;
  args: unknown;
  origine: Origine;
}

/** Réponse du front (commande `outil_repondre`). */
export interface ReponseOutil {
  ok: boolean;
  data?: unknown;
  erreur?: string;
}

/** Arguments des outils (`crates/protocol` › `args`). Un `espace` : id, nom, ou préfixe
    unique du nom ; un `onglet` : id, titre ou rang (1…). */
export interface ArgsOutils {
  "espaces.etat": { espace?: string };
  "terminal.lire": { espace: string; onglet?: string; lignes?: number };
  notifier: { texte: string; titre?: string; espace?: string };
  demander: { espace?: string; question: string };
  "espace.resumer": { espace: string; texte: string };
  "espace.creer": { dossier: string; nom?: string; groupe?: string; couleur?: string };
  "espace.renommer": { espace: string; nom: string };
  /** `groupe: ""` : hors groupe ; absent : groupe inchangé. */
  "espace.deplacer": { espace: string; groupe?: string; position?: number };
  "espace.fermer": { espace: string };
  "groupe.creer": { nom: string; couleur?: string; espaces?: string[] };
  "onglet.ouvrir": { espace: string; dossier?: string };
  "espace.focus": { espace: string; onglet?: string };
  "terminal.ecrire": { espace: string; onglet?: string; texte: string; entree: boolean; pourquoi: string };
  "session.demander": { echange: string; texte: string; pourquoi: string };
  "session.repondre": { echange: string; texte: string; pourquoi: string };
}

/** Réponse d'une écriture qui attend la validation de l'utilisateur. */
export interface ReponseEnAttente {
  statut: "en_attente";
  /** Id de la carte « À valider ». */
  demande: string;
  message: string;
}

// --- Moteur du superviseur (crates/core/src/superviseur) ---

export type GenreEvenement = "message" | "attente" | "termine" | "question" | "validation" | "reprise";

/** Ce qui réveille le superviseur (commande `superviseur_signaler`). */
export interface EvenementSuperviseur {
  genre: GenreEvenement;
  /** Phrase prête pour l'invite, rédigée par le front. */
  texte: string;
  wsId?: string;
}

/** Événement `superviseur-flux` (backend → front). */
export type FluxSuperviseur =
  | { type: "tour-debut"; nbEvenements: number }
  | { type: "texte"; texte: string }
  | { type: "tour-fin"; ok: boolean; erreur?: string; coutUsd?: number }
  | { type: "arret"; raison: string };

/** Réponse de `superviseur_etat`. */
export interface EtatMoteur {
  actif: boolean;
  enCours: boolean;
  enFile: number;
  sessionId?: string;
  dernierTour?: number;
  derniereErreur?: string;
  toursHeure: number;
}

/** Noms des événements Tauri émis par le backend. */
export const EVENEMENT_OUTIL_REQUETE = "outil-requete";
export const EVENEMENT_FLUX_SUPERVISEUR = "superviseur-flux";
