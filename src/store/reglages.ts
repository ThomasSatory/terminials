import { create } from "zustand";
import { reglagesApi, type InfosApp } from "../lib/reglagesApi";
import {
  REGLAGES_DEFAUT,
  avecPaire,
  compterEchange,
  normaliserReglages,
  reglagesReinitialises,
  sansPaire,
  type NiveauAutonomie,
  type ReglagesApp,
} from "../lib/reglages";

/**
 * Réglages de l'application (vue Paramètres), tels qu'appliqués en direct.
 *
 * Source de vérité : le fichier de réglages côté Rust. Le store le lit au démarrage
 * (`charger`, attendu par la coquille avant de lancer les terminaux), puis chaque
 * changement s'applique AUSSITÔT ici (l'interface suit sans attendre le disque) et part
 * à l'écriture, regroupé sur `DELAI_ECRITURE_MS` : taper un nom n'écrit pas le fichier à
 * chaque lettre. La réponse du backend (réglages normalisés) n'écrase pas l'état : une
 * frappe a pu suivre ; la normalisation est de toute façon la même des deux côtés.
 *
 * Sélecteurs ciblés uniquement : `useReglagesStore((s) => s.reglages.apparence.accent)`.
 */

/** Regroupement des écritures. */
export const DELAI_ECRITURE_MS = 250;

export interface ReglagesState {
  reglages: ReglagesApp;
  /** Faux jusqu'à la première lecture du backend (réussie ou non). */
  charges: boolean;
  infos: InfosApp | null;
  /** Dernière erreur de lecture ou d'écriture, null si tout va bien. */
  erreur: string | null;

  /** Lit réglages et infos du backend. Sans effet après la première fois. */
  charger: () => Promise<void>;
  /** Applique un changement (normalisé) et programme son écriture. */
  modifier: (f: (r: ReglagesApp) => ReglagesApp) => void;
  /** Écrit tout de suite ce qui attend (sinon rien). */
  enregistrerMaintenant: () => Promise<void>;
  /** « Revenir aux réglages d'origine » (les paires autorisées sont gardées). */
  reinitialiser: () => void;

  // --- Raccourcis du superviseur (panneau et Paramètres) ---
  setNiveau: (n: NiveauAutonomie) => void;
  basculerPause: () => void;
  setPause: (pause: boolean) => void;
  setNomSuperviseur: (nom: string) => void;
  setSuperviseurActif: (actif: boolean) => void;
  /** Paire d'espaces (dossiers) ou espace + `PAIRE_SUPERVISEUR`. */
  autoriserPaire: (a: string, b: string) => void;
  revoquerPaire: (a: string, b: string) => void;
  /** Un échange vient de passer sans validation par cette paire. */
  compterEchange: (a: string, b: string) => void;

  /** Tests : retour à l'état initial, écriture en attente annulée. */
  reset: () => void;
}

let minuterie: ReturnType<typeof setTimeout> | undefined;
let enAttente = false;
let chargement: Promise<void> | null = null;

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useReglagesStore = create<ReglagesState>((set, get) => {
  const ecrire = async () => {
    clearTimeout(minuterie);
    minuterie = undefined;
    if (!enAttente) return;
    enAttente = false;
    try {
      await reglagesApi.ecrire(get().reglages);
      if (get().erreur) set({ erreur: null });
    } catch (e) {
      set({ erreur: `réglages non enregistrés : ${message(e)}` });
    }
  };

  const modifier = (f: (r: ReglagesApp) => ReglagesApp) => {
    const suivants = normaliserReglages(f(get().reglages));
    set({ reglages: suivants });
    enAttente = true;
    clearTimeout(minuterie);
    minuterie = setTimeout(() => void ecrire(), DELAI_ECRITURE_MS);
  };

  const superviseur = (f: (s: ReglagesApp["superviseur"]) => Partial<ReglagesApp["superviseur"]>) =>
    modifier((r) => ({ ...r, superviseur: { ...r.superviseur, ...f(r.superviseur) } }));

  return {
    reglages: REGLAGES_DEFAUT,
    charges: false,
    infos: null,
    erreur: null,

    charger: () => {
      if (!chargement) {
        chargement = (async () => {
          const [lus, infos] = await Promise.allSettled([reglagesApi.lire(), reglagesApi.infos()]);
          set({
            // Un changement fait pendant la lecture (rare : avant même le premier rendu)
            // l'emporte sur le fichier.
            reglages: enAttente ? get().reglages : lus.status === "fulfilled" ? normaliserReglages(lus.value) : get().reglages,
            infos: infos.status === "fulfilled" ? infos.value : null,
            charges: true,
            erreur: lus.status === "rejected" ? `réglages illisibles : ${message(lus.reason)}` : null,
          });
        })();
      }
      return chargement;
    },
    modifier,
    enregistrerMaintenant: ecrire,
    reinitialiser: () => modifier(reglagesReinitialises),

    setNiveau: (niveau) => superviseur(() => ({ niveau })),
    basculerPause: () => superviseur((s) => ({ pause: !s.pause })),
    setPause: (pause) => superviseur(() => ({ pause })),
    setNomSuperviseur: (nom) => superviseur(() => ({ nom })),
    setSuperviseurActif: (actif) => superviseur(() => ({ actif })),
    autoriserPaire: (a, b) => superviseur((s) => ({ paires: avecPaire(s.paires, a, b, Date.now()) })),
    revoquerPaire: (a, b) => superviseur((s) => ({ paires: sansPaire(s.paires, a, b) })),
    compterEchange: (a, b) => superviseur((s) => ({ paires: compterEchange(s.paires, a, b) })),

    reset: () => {
      clearTimeout(minuterie);
      minuterie = undefined;
      enAttente = false;
      chargement = null;
      set({ reglages: REGLAGES_DEFAUT, charges: false, infos: null, erreur: null });
    },
  };
});
