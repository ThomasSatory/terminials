import type { EtatLigne, ModeSuperviseur } from "../store/superviseur";
import type { OutilId } from "./outilsProtocole";
import type { NiveauAutonomie } from "./reglages";
import { pluriel } from "./pluriel";

/**
 * Libellés du superviseur partagés par la marque du dock, l'en-tête du panneau, la bulle,
 * le fil et la palette (maquette Superviseur), en logique pure.
 *
 * Propriétaire : agent (c) « front du superviseur ».
 */

/** Noms affichés des outils (le fil montre `espace.renommer`, `session.répondre`…). */
export const NOMS_OUTILS: Readonly<Record<OutilId, string>> = {
  "espaces.etat": "espaces.état",
  "terminal.lire": "terminal.lire",
  notifier: "prévenir",
  demander: "demander",
  "espace.creer": "espace.créer",
  "espace.renommer": "espace.renommer",
  "espace.deplacer": "espace.déplacer",
  "espace.fermer": "espace.fermer",
  "groupe.creer": "groupe.créer",
  "onglet.ouvrir": "onglet.ouvrir",
  "espace.focus": "espace.focus",
  "terminal.ecrire": "terminal.écrire",
  "session.demander": "session.demander",
  "session.repondre": "session.répondre",
};

/** Ligne d'état sous le nom (« observe 8 espaces · 1 vous attend », « agit · terminal.lire »). */
export function ligneEtatSuperviseur(e: {
  mode: ModeSuperviseur;
  nbEspaces: number;
  nbAttente: number;
  nbEchanges: number;
  outil: OutilId | null;
}): string {
  if (e.mode === "pause") return "en pause · n’observe plus";
  if (e.mode === "agit") return `agit · ${e.outil ? NOMS_OUTILS[e.outil] : "réflexion"}`;
  let t = `observe ${pluriel(e.nbEspaces, "espace", "espaces")}`;
  if (e.nbAttente) t += ` · ${pluriel(e.nbAttente, "vous attend", "vous attendent")}`;
  if (e.nbEchanges) t += ` · ${pluriel(e.nbEchanges, "échange", "échanges")} en cours`;
  return t;
}

/** Ton de la ligne d'état : discret, au travail (cyan), ou ce qui vous réclame (accent). */
export function tonLigneEtat(mode: ModeSuperviseur, reclame: boolean): "discret" | "travail" | "attente" {
  if (mode === "pause") return "discret";
  if (mode === "agit") return "travail";
  return reclame ? "attente" : "discret";
}

export const LIBELLES_NIVEAU: Readonly<Record<NiveauAutonomie, string>> = {
  observer: "Observer",
  reorganiser: "Réorganiser",
  agir: "Agir",
};

export const NIVEAUX: readonly NiveauAutonomie[] = ["observer", "reorganiser", "agir"];

/** Phrase sous le sélecteur d'autonomie (maquette). */
export function descriptionNiveau(niveau: NiveauAutonomie, nom: string): string {
  switch (niveau) {
    case "observer":
      return `${nom} regarde et vous prévient. Il ne crée, ne range, ne relaie et n’écrit rien.`;
    case "reorganiser":
      return `${nom} crée, renomme, range et ferme des espaces. Il n’écrit jamais dans une session, même pour relayer.`;
    case "agir":
      return `${nom} réorganise librement. Écrire dans une session, y compris relayer, passe par votre accord.`;
  }
}

/** Ce que le superviseur écrit au fil quand on change son autonomie (maquette). */
export function texteNiveau(niveau: NiveauAutonomie): string {
  switch (niveau) {
    case "observer":
      return "Autonomie : Observer. Je regarde et je préviens, je ne touche à rien.";
    case "reorganiser":
      return "Autonomie : Réorganiser. Je range vos espaces, je n’écris dans aucune session.";
    case "agir":
      return "Autonomie : Agir. J’écris dans une session seulement après votre accord, ou pour un échange que vous avez autorisé.";
  }
}

/**
 * « de » + nom d'espace, élidé en « d’ » devant une voyelle ou un h (« réponse d’api-paiements ») :
 * les noms d'espace sont libres, la règle se décide donc à l'affichage. Le h est traité comme
 * muet, cas le plus fréquent pour des noms de dossier.
 */
export function deNom(nom: string): string {
  const premiere = nom.trim().charAt(0).normalize("NFD").charAt(0).toLowerCase();
  return "aeiouyh".includes(premiere) && premiere !== "" ? `d’${nom}` : `de ${nom}`;
}

/**
 * Texte écrit dans la session lors d'un relais entre espaces (maquette Superviseur, carte
 * « Texte exact ») : qui pose la question ou répond, par qui elle passe, et pour une
 * question comment répondre. La première ligne est l'en-tête, la dernière (question)
 * la consigne ; le texte brut de l'échange est entre les deux.
 */
export function texteTransmis(
  outil: "session.demander" | "session.repondre",
  o: { auteur: string; superviseur: string; texte: string; parSuperviseur?: boolean },
): string {
  if (outil === "session.demander") {
    return `Question ${deNom(o.auteur)}, transmise par ${o.superviseur} :\n${o.texte}\nRéponds en quelques lignes, sans modifier de fichier.`;
  }
  if (o.parSuperviseur) return `Réponse ${deNom(o.superviseur)} :\n${o.texte}`;
  return `Réponse ${deNom(o.auteur)}, transmise par ${o.superviseur} :\n${o.texte}`;
}

export const TEXTE_PAUSE = "En pause : je n’observe plus, je ne relaie plus et je n’agis plus.";
export const TEXTE_EN_PAUSE_MESSAGE = "Je suis en pause : je ne regarde rien et je n’agis pas.";

/** Texte de la reprise, avec ce qui s'est passé pendant la pause. */
export function texteReprise(manques: readonly string[]): string {
  return manques.length
    ? `Reprise. Pendant la pause : ${manques.join(" ; ")}.`
    : "Reprise. Rien de nouveau pendant la pause.";
}

export function texteNouveauNom(nom: string): string {
  return `Je m’appelle désormais ${nom}.`;
}

/** Heure d'une entrée du fil (« 14:04 »), heure locale. */
export function heureFil(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** « depuis 12 s », « depuis 4 min », « depuis 2 h ». */
export function depuisLibelle(depuis: number, maintenant: number): string {
  const s = Math.max(1, Math.floor((maintenant - depuis) / 1000));
  if (s < 60) return `depuis ${s} s`;
  const min = Math.floor(s / 60);
  if (min < 60) return `depuis ${min} min`;
  return `depuis ${Math.floor(min / 60)} h`;
}

/** Libellé et ton d'une ligne du tableau « où en sont mes agents ». */
export const LIBELLES_ETAT_LIGNE: Readonly<Record<EtatLigne, string>> = {
  attente: "vous attend",
  relais: "attend une réponse",
  travail: "au travail",
  termine: "terminé",
  repos: "au repos",
};

/** En-tête du tableau : « 1 vous attend · 2 au travail · 3 au repos ». */
export function comptesEtats(etats: readonly EtatLigne[]): { etat: EtatLigne; texte: string }[] {
  const n = (e: EtatLigne) => etats.filter((x) => x === e).length;
  const sortie: { etat: EtatLigne; texte: string }[] = [];
  if (n("attente")) sortie.push({ etat: "attente", texte: pluriel(n("attente"), "vous attend", "vous attendent") });
  if (n("relais")) sortie.push({ etat: "relais", texte: pluriel(n("relais"), "échange en cours", "échanges en cours") });
  if (n("travail")) sortie.push({ etat: "travail", texte: `${n("travail")} au travail` });
  if (n("termine")) sortie.push({ etat: "termine", texte: pluriel(n("termine"), "terminé", "terminés") });
  if (n("repos")) sortie.push({ etat: "repos", texte: `${n("repos")} au repos` });
  return sortie;
}

/** Bandeau des écritures masquées (niveau trop bas, pause). */
export function texteMasque(nb: number, pause: boolean): string {
  if (pause) return `${pluriel(nb, "écriture attend", "écritures attendent")} votre reprise.`;
  return nb === 1
    ? "Une écriture dans une session est prête ; elle demande le niveau Agir."
    : `${nb} écritures dans des sessions sont prêtes ; elles demandent le niveau Agir.`;
}

/** Titre et note de la bulle du superviseur. */
export function texteBulle(nbAttente: number, nbCartes: number): { titre: string; note: string; accent: boolean } {
  return {
    titre: nbAttente
      ? pluriel(nbAttente, "agent vous attend", "agents vous attendent")
      : pluriel(nbCartes, "écriture à valider", "écritures à valider"),
    // « dont N écritures » sous un titre qui les annonce déjà se répétait (et « dont » n'a
    // de sens qu'à côté d'agents qui attendent) : seules, les cartes disent où décider.
    note: !nbCartes
      ? "clic sur un espace pour y aller"
      : nbAttente
        ? `dont ${pluriel(nbCartes, "écriture à valider", "écritures à valider")}`
        : "à autoriser dans le panneau",
    accent: nbCartes > 0,
  };
}

/** Signature d'une situation de la bulle : elle ne revient qu'à la suivante. */
export function signatureBulle(attente: readonly string[], cartes: readonly string[]): string {
  return `${attente.join(",")}|${cartes.join(",")}`;
}

/**
 * Suggestions sous le fil (trois au plus), tirées de la situation réelle : relayer une
 * question en souffrance, le point sur les agents, ranger quand rien n'est rangé,
 * regarder l'espace qui attend (sinon celui qu'on a sous les yeux).
 */
export function suggestionsSuperviseur(c: {
  echange: { de: string; vers: string } | null;
  nbEspaces: number;
  nbGroupes: number;
  attente: string | null;
  actif: string | null;
}): string[] {
  const s: string[] = [];
  if (c.echange) s.push(`Fais répondre ${c.echange.vers} à ${c.echange.de}`);
  s.push("Où en sont mes agents ?");
  if (c.nbGroupes === 0 && c.nbEspaces >= 4) s.push("Range les espaces par groupe");
  const cible = c.attente ?? c.actif;
  if (cible) s.push(`Que fait ${cible} ?`);
  return s.slice(0, 3);
}
