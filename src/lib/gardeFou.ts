import type { ClasseOutil, Origine, OutilId } from "./outilsProtocole";
import { paireAutorisee, type NiveauAutonomie, type PaireAutorisee } from "./reglages";

/**
 * Garde-fou du superviseur : décide, POUR CHAQUE APPEL D'OUTIL, s'il est exécuté, mis en
 * attente de la validation de l'utilisateur (carte « À valider ») ou refusé. C'est ce
 * code, et non la consigne donnée au modèle, qui fait respecter le niveau d'autonomie :
 * le modèle peut demander n'importe quoi, seul passe ce que ces règles laissent passer.
 *
 * Règles :
 * - chaque outil a une classe (observer, réorganiser, écrire), même table que
 *   `Outil::classe` côté Rust ;
 * - le superviseur désactivé ou en pause n'agit pas du tout ;
 * - Observer : observer seulement ; Réorganiser : + réorganiser ; Agir : + écrire, mais
 *   TOUTE écriture dans une session passe par une carte « À valider » (texte exact), sauf
 *   l'échange (question transmise, réponse rendue) entre deux bouts d'une paire que
 *   l'utilisateur a autorisée ;
 * - jamais d'écriture sans validation dans une session bloquée sur une demande
 *   d'autorisation, paire autorisée ou non ;
 * - fermer un espace où un agent travaille ou attend : refusé ;
 * - depuis le terminal d'un espace (un agent, ou l'utilisateur), seuls les outils
 *   d'observation et `demander` sont permis ; réorganiser et écrire sont réservés au
 *   superviseur.
 *
 * Pur : l'appelant fournit l'état (réglages, session bloquée, agent occupé).
 */

export const CLASSES: Readonly<Record<OutilId, ClasseOutil>> = {
  "espaces.etat": "observer",
  "terminal.lire": "observer",
  notifier: "observer",
  demander: "observer",
  "espace.creer": "reorganiser",
  "espace.renommer": "reorganiser",
  "espace.deplacer": "reorganiser",
  "espace.fermer": "reorganiser",
  "groupe.creer": "reorganiser",
  "onglet.ouvrir": "reorganiser",
  "espace.focus": "reorganiser",
  "terminal.ecrire": "ecrire",
  "session.demander": "ecrire",
  "session.repondre": "ecrire",
};

export function classeOutil(outil: OutilId): ClasseOutil {
  return CLASSES[outil];
}

/** Outils d'échange : les seuls qu'une paire autorisée dispense de validation. */
const OUTILS_ECHANGE: ReadonlySet<OutilId> = new Set(["session.demander", "session.repondre"]);

export type Decision =
  | { type: "executer" }
  /** Carte « À valider » ; `raison` dit pourquoi la validation est requise. */
  | { type: "valider"; raison: string }
  | { type: "refuser"; raison: string };

/** Réglages du superviseur utiles au garde-fou. */
export interface ContexteGardeFou {
  actif: boolean;
  pause: boolean;
  niveau: NiveauAutonomie;
  paires: readonly PaireAutorisee[];
}

export interface AppelGarde {
  outil: OutilId;
  origine: Origine;
  /** Écriture d'un échange : les deux bouts (dossier d'espace, ou `PAIRE_SUPERVISEUR`).
      null hors échange. */
  paire: readonly [string, string] | null;
  /** La session visée attend la réponse à une demande d'autorisation. */
  cibleBloquee: boolean;
  /** Pour `espace.fermer` : un agent travaille ou attend dans l'espace visé. */
  cibleOccupee: boolean;
}

const REFUS_NIVEAU_REORGANISER = "Niveau Observer : je regarde et je préviens, je ne crée et ne range rien.";
const REFUS_NIVEAU_ECRIRE: Record<NiveauAutonomie, string> = {
  observer: "Niveau Observer : je n'écris dans aucune session.",
  reorganiser: "Niveau Réorganiser : je n'écris jamais dans une session, même pour relayer.",
  agir: "",
};

export function decider(appel: AppelGarde, ctx: ContexteGardeFou): Decision {
  const classe = classeOutil(appel.outil);

  if (appel.origine.type !== "superviseur") {
    if (appel.outil === "demander") {
      if (appel.origine.type !== "espace") {
        return { type: "refuser", raison: "« demander » s'utilise depuis le terminal d'un espace." };
      }
      if (!ctx.actif) return { type: "refuser", raison: "Le superviseur est désactivé : la question n'est pas transmise." };
      if (ctx.pause) return { type: "refuser", raison: "Le superviseur est en pause : la question n'est pas transmise." };
      return { type: "executer" };
    }
    if (classe === "observer") return { type: "executer" };
    return { type: "refuser", raison: "Réservé au superviseur." };
  }

  if (!ctx.actif) return { type: "refuser", raison: "Le superviseur est désactivé." };
  if (ctx.pause) return { type: "refuser", raison: "En pause : je n'observe plus, je ne relaie plus et je n'agis plus." };

  if (appel.outil === "demander") {
    return { type: "refuser", raison: "Le superviseur transmet une question avec session.demander." };
  }
  if (classe === "observer") return { type: "executer" };

  if (classe === "reorganiser") {
    if (ctx.niveau === "observer") return { type: "refuser", raison: REFUS_NIVEAU_REORGANISER };
    if (appel.outil === "espace.fermer" && appel.cibleOccupee) {
      return { type: "refuser", raison: "Un agent travaille ou attend dans cet espace : je ne le ferme pas." };
    }
    return { type: "executer" };
  }

  // Écrire dans une session.
  if (ctx.niveau !== "agir") return { type: "refuser", raison: REFUS_NIVEAU_ECRIRE[ctx.niveau] };
  if (appel.cibleBloquee) {
    return {
      type: "valider",
      raison: "Cette session attend une réponse à une demande d'autorisation : rien ne lui est écrit sans votre accord.",
    };
  }
  if (OUTILS_ECHANGE.has(appel.outil) && appel.paire && paireAutorisee(ctx.paires, appel.paire[0], appel.paire[1])) {
    return { type: "executer" };
  }
  return { type: "valider", raison: "Écrire dans une session passe par votre accord." };
}

/** L'utilisateur peut-il autoriser une carte « À valider » maintenant ? Il faut le niveau
    Agir et pas de pause (sinon les cartes restent en attente, masquées). */
export function peutValider(ctx: ContexteGardeFou): { ok: true } | { ok: false; raison: string } {
  if (!ctx.actif) return { ok: false, raison: "Le superviseur est désactivé." };
  if (ctx.pause) return { ok: false, raison: "En pause : les écritures attendent votre reprise." };
  if (ctx.niveau !== "agir") return { ok: false, raison: "Écrire dans une session demande le niveau Agir." };
  return { ok: true };
}
