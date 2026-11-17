import type { EtatAgent } from "./etatAgent";
import { messageTermine } from "./etatAgent";
import { titreSansGlyphe } from "./mosaique";
import { deNom } from "./superviseurLibelles";
import type { DemandeValidation, EntreeFil, ResumeEspace } from "../store/superviseur";

/**
 * Le « poste de suivi » du superviseur : une vue plein écran où les espaces sont rangés
 * par état (« Vous attendent », « Au travail », « Au repos »), avec le fil et un prompt
 * fixe à côté. Ce module en porte la logique pure (groupes, cartes par espace, filtre du
 * fil, résumés, libellés), sans React ni store, pour la tester seule.
 *
 * Aucune écriture dans une session ici : les cartes « À valider » viennent du garde-fou
 * (`lib/gardeFou`) et leur décision passe par `lib/executeurSuperviseur`.
 */

export type { ResumeEspace };

export type GroupePoste = "attendent" | "travail" | "repos";

/** Longueur maximale (en caractères) d'un résumé posé par le superviseur. */
export const MAX_RESUME = 160;

/** Groupe d'un espace : une demande à vous (état attente ou carte ouverte) prime, puis
    le travail (ou l'attente d'une réponse en relais), sinon le repos. */
export function groupeDuPoste(etat: EtatAgent, relais: boolean, nbCartes: number): GroupePoste {
  if (etat === "attente" || nbCartes > 0) return "attendent";
  if (etat === "travail" || relais) return "travail";
  return "repos";
}

// Séquences ANSI (CSI, OSC) puis caractères de contrôle C0/C1 restants.
// eslint-disable-next-line no-control-regex
const ANSI = /\u001b\[[0-?]*[ -/]*[@-~]|\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)?|\u001b[@-Z\\-_]/g;
// eslint-disable-next-line no-control-regex
const CONTROLE = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g;

/** Résumé prêt à afficher : sans caractères de contrôle ni retours à la ligne, blancs
    compactés, borné à MAX_RESUME caractères (points de code) avec « … ». */
export function nettoyerResume(texte: string): string {
  const propre = texte
    .replace(ANSI, "")
    .replace(/[\t\n\r\f\v]/g, " ")
    .replace(CONTROLE, "")
    .replace(/\s+/g, " ")
    .trim();
  const points = Array.from(propre);
  if (points.length <= MAX_RESUME) return propre;
  return `${points.slice(0, MAX_RESUME - 1).join("").trimEnd()}…`;
}

/** Cartes « À valider » ouvertes, rangées par espace ÉCRIT (`cible.wsId`, jamais `de`),
    de la plus ancienne à la plus récente. */
export function cartesParEspace(demandes: readonly DemandeValidation[]): Map<string, DemandeValidation[]> {
  const m = new Map<string, DemandeValidation[]>();
  for (const d of demandes) {
    if (d.statut !== "ouverte") continue;
    const l = m.get(d.cible.wsId);
    if (l) l.push(d);
    else m.set(d.cible.wsId, [d]);
  }
  return m;
}

/** Carte validée par Ctrl+Entrée : la plus ancienne de l'espace filtré s'il en a une,
    sinon la plus ancienne ouverte. */
export function demandeAuClavier(demandes: readonly DemandeValidation[], filtre: string | null): DemandeValidation | null {
  const ouvertes = demandes.filter((d) => d.statut === "ouverte");
  if (filtre) {
    const deLEspace = ouvertes.find((d) => d.cible.wsId === filtre);
    if (deLEspace) return deLEspace;
  }
  return ouvertes[0] ?? null;
}

/**
 * Fil restreint à un espace (null : tout, même tableau). Une entrée est gardée si elle
 * porte l'espace (`wsId`, `de`, `vers`) ou le cite (partie « refs »). Un texte du
 * superviseur sans aucun de ces champs (texte de tour, ligne d'outil) suit le dernier
 * message de l'utilisateur (ou à la dernière observation) qui le précède, s'il portait un espace.
 */
export function filtrerFil(fil: readonly EntreeFil[], wsId: string | null): EntreeFil[] {
  if (wsId === null) return fil as EntreeFil[];
  const gardees: EntreeFil[] = [];
  let aPropos: string | null = null;
  for (const e of fil) {
    if (e.genre === "utilisateur" || e.genre === "observation") aPropos = e.wsId ?? null;
    const porte =
      e.wsId === wsId ||
      e.de === wsId ||
      e.vers === wsId ||
      e.parties.some((p) => p.type === "refs" && p.wsIds.includes(wsId));
    const rattachee =
      e.genre === "superviseur" && e.wsId === undefined && e.de === undefined && e.vers === undefined && aPropos === wsId;
    if (porte || rattachee) gardees.push(e);
  }
  return gardees;
}

/** Résumé du superviseur s'il est encore valable (même groupe), sinon le repli calculé. */
export function resumeAffiche(
  resume: ResumeEspace | undefined,
  groupeCourant: GroupePoste,
  repli: string,
): { texte: string; source: "superviseur" | "repli" } {
  if (resume && resume.groupe === groupeCourant) return { texte: resume.texte, source: "superviseur" };
  return { texte: repli, source: "repli" };
}

/** Phrase déduite de ce que l'application sait déjà, quand le superviseur n'a rien posé. */
export function repliResume(e: {
  etat: EtatAgent;
  relaisVers: string | null;
  titreTravail?: string;
  sujetTermine?: string;
  notification?: string;
  bloque?: string | null;
}): string {
  if (e.relaisVers !== null) return `Attend la réponse ${deNom(e.relaisVers)}`;
  switch (e.etat) {
    case "attente":
      return (e.bloque && nettoyerResume(e.bloque)) || (e.notification && nettoyerResume(e.notification)) || "Vous attend";
    case "travail":
      return titreSansGlyphe(e.titreTravail) || "Au travail";
    case "termine":
      return messageTermine(e.sujetTermine);
    default:
      return "Au repos";
  }
}

/** Compteurs de l'en-tête : « 1 vous attend », « 2 au travail », « 0 au repos ». */
export function libellesCompteurs(c: { attendent: number; travail: number; repos: number }): {
  attendent: string;
  travail: string;
  repos: string;
} {
  return {
    attendent: `${c.attendent} ${c.attendent > 1 ? "vous attendent" : "vous attend"}`,
    travail: `${c.travail} au travail`,
    repos: `${c.repos} au repos`,
  };
}

/** Libellé court en tête d'une carte d'espace en attente. */
export function typeAttente(cartes: readonly DemandeValidation[], bloque: string | null): string {
  const premiere = cartes[0];
  if (premiere) {
    if (premiere.outil === "terminal.ecrire") return "Écriture à valider";
    if (premiere.outil === "session.demander") return "Question à transmettre";
    return "Réponse à rendre";
  }
  return bloque ? "Autorisation" : "Vous attend";
}
