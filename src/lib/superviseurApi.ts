import { invoke } from "@tauri-apps/api/core";
import { useSuperviseurStore } from "../store/superviseur";
import { useReglagesStore } from "../store/reglages";
import type { EtatMoteur, EvenementSuperviseur, ReponseOutil } from "./outilsProtocole";
import { TEXTE_EN_PAUSE_MESSAGE } from "./superviseurLibelles";
import { lignesEtatsCourantes } from "./etatEspacesSuperviseur";

/**
 * Accès backend du superviseur (src-tauri/src/superviseur.rs, pont.rs). Isolé ici pour
 * que le reste se teste avec `vi.mock("../lib/superviseurApi")`.
 *
 * Propriétaire : agent (c) « front du superviseur ».
 */
export const superviseurApi = {
  /** Réveille le moteur (ignoré par lui s'il est inactif ou en pause). */
  signaler: (evenement: EvenementSuperviseur) => invoke<void>("superviseur_signaler", { evenement }),
  etat: () => invoke<EtatMoteur>("superviseur_etat"),
  interrompre: () => invoke<void>("superviseur_interrompre"),
  nouvelleSession: () => invoke<void>("superviseur_nouvelle_session"),
  /** Notification du bureau (outil `notifier`) : le backend la tait si la fenêtre a le
      focus ou si le réglage « Notifications système » est coupé. */
  notifierSysteme: (titre: string, texte: string) => invoke<void>("notifier_systeme", { titre, texte }),
  /** Réponse à un `outil-requete`. */
  repondreOutil: (id: number, reponse: ReponseOutil) => invoke<void>("outil_repondre", { id, reponse }),
};

/** La question toute faite des suggestions et de la palette, quelle que soit sa casse. */
export function estQuestionEtatAgents(texte: string): boolean {
  return /^o[uù] en sont mes agents\s*\??$/i.test(texte.trim());
}

/**
 * L'utilisateur écrit au superviseur (panneau, palette, suggestion) : son message entre
 * au fil et réveille le moteur aussitôt.
 * - En pause, le moteur ignore tout réveil : la réponse vient d'ici, tout de suite, avec
 *   de quoi reprendre (sinon le message resterait sans suite).
 * - « Où en sont mes agents ? » : le tableau de l'état réel (cliquable) est posé sans
 *   attendre le modèle, qui peut le commenter ensuite.
 */
export function envoyerAuSuperviseur(texte: string): void {
  const t = texte.trim();
  if (!t) return;
  const sup = useSuperviseurStore.getState();
  sup.ajouterEntree({ genre: "utilisateur", parties: [{ type: "texte", texte: t }] });
  if (useReglagesStore.getState().reglages.superviseur.pause) {
    sup.ajouterEntree({
      genre: "superviseur",
      parties: [
        { type: "texte", ton: "discret", texte: TEXTE_EN_PAUSE_MESSAGE },
        { type: "action", libelle: "Reprendre", action: { type: "reprendre" } },
      ],
    });
    return;
  }
  if (estQuestionEtatAgents(t)) {
    const lignes = lignesEtatsCourantes();
    if (lignes.length) sup.ajouterEntree({ genre: "superviseur", parties: [{ type: "etats", lignes }] });
  }
  void superviseurApi.signaler({ genre: "message", texte: t }).catch(() => {});
}
