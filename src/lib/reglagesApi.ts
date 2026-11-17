import { invoke } from "@tauri-apps/api/core";
import type { ReglagesApp } from "./reglages";

/**
 * Accès backend des réglages de l'application (src-tauri/src/reglages.rs) et des hooks
 * (src-tauri/src/hooks.rs). Isolé ici pour que les stores se testent avec un simple
 * `vi.mock("../lib/reglagesApi")`.
 */

/** Ce que « À propos » affiche, et le shell de la session. */
export interface InfosApp {
  version: string;
  fichierReglages: string;
  dossierConfig: string;
  /** Dossier des données (base d'activité, session du superviseur) ; absent d'un backend ancien. */
  dossierDonnees?: string;
  shellSession: string;
  /** Shells installés (`/etc/shells`, un chemin par nom) ; absent d'un backend ancien. */
  shellsDisponibles?: string[];
}

/** État des hooks Claude Code (crates/core/src/hooks.rs). */
export interface EtatHooks {
  scriptAJour: boolean;
  cheminScript: string;
  evenementsDeclares: string[];
  installes: boolean;
}

export const reglagesApi = {
  lire: () => invoke<unknown>("reglages_lire"),
  /** Normalise, enregistre, rend les réglages tels qu'écrits. */
  ecrire: (reglages: ReglagesApp) => invoke<unknown>("reglages_ecrire", { reglages }),
  infos: () => invoke<InfosApp>("reglages_infos"),
  hooksEtat: () => invoke<EtatHooks>("hooks_etat"),
  hooksInstaller: () => invoke<EtatHooks>("hooks_installer"),
};
