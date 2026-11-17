import type { SectionParametres } from "../store/ui";

/**
 * Index des réglages cherchables (maquette Parametres) : la recherche de la vue et la
 * section « Réglages » de la palette s'en servent. `id` est celui de la rangée de la
 * vue Paramètres (surbrillance quand on y arrive depuis la palette).
 *
 * Propriétaire : agent (d) « front des paramètres » — il garde les ids alignés sur ses
 * rangées.
 */
export interface ReglageCherchable {
  id: string;
  libelle: string;
  section: SectionParametres;
  /** Mots qui le retrouvent sans être dans son libellé (sans accents). */
  motsCles: string;
}

/** Noms des sections, dans l'ordre de la navigation de la vue. */
export const SECTIONS_PARAMETRES: readonly { id: SectionParametres; nom: string }[] = [
  { id: "apparence", nom: "Apparence" },
  { id: "terminal", nom: "Terminal" },
  { id: "agents", nom: "Agents et notifications" },
  { id: "superviseur", nom: "Superviseur" },
  { id: "activite", nom: "Activité" },
  { id: "raccourcis", nom: "Raccourcis" },
  { id: "apropos", nom: "À propos" },
];

export function nomSection(id: SectionParametres): string {
  return SECTIONS_PARAMETRES.find((s) => s.id === id)?.nom ?? id;
}

export const INDEX_REGLAGES: readonly ReglageCherchable[] = [
  { id: "accent", libelle: "Couleur d’accent", section: "apparence", motsCles: "theme couleur teinte" },
  { id: "densite", libelle: "Densité du dock", section: "apparence", motsCles: "avatars taille dock compact" },
  { id: "reduire", libelle: "Réduire les animations", section: "apparence", motsCles: "mouvement animation accessibilite" },
  { id: "taillePolice", libelle: "Taille de police du terminal", section: "apparence", motsCles: "police taille zoom texte lisibilite" },
  { id: "shell", libelle: "Shell par défaut", section: "terminal", motsCles: "bash zsh fish shell" },
  { id: "dossierDepart", libelle: "Dossier de départ", section: "terminal", motsCles: "repertoire dossier home chemin nouvel espace" },
  { id: "police", libelle: "Police", section: "terminal", motsCles: "police fonte typo" },
  { id: "defilement", libelle: "Défilement", section: "terminal", motsCles: "scrollback historique lignes memoire" },
  { id: "copierSelection", libelle: "Copier à la sélection", section: "terminal", motsCles: "presse-papier copier coller selection" },
  { id: "reprendreSessions", libelle: "Reprendre les sessions Claude", section: "terminal", motsCles: "reprise relancement session claude resume" },
  { id: "hooks", libelle: "Hooks Claude Code", section: "agents", motsCles: "hooks claude pastille arc au travail vous attend installer" },
  { id: "notifSysteme", libelle: "Notifications système", section: "agents", motsCles: "notification bureau alerte" },
  { id: "bulle", libelle: "Bulle au-dessus du dock", section: "agents", motsCles: "bulle dock annonce" },
  { id: "son", libelle: "Son", section: "agents", motsCles: "son bip audio sonore" },
  { id: "supActif", libelle: "Superviseur activé", section: "superviseur", motsCles: "superviseur agent global activer" },
  { id: "supNom", libelle: "Nom du superviseur", section: "superviseur", motsCles: "nom renommer superviseur" },
  { id: "supPause", libelle: "En pause", section: "superviseur", motsCles: "pause suspendre superviseur" },
  { id: "supNiveau", libelle: "Autonomie du superviseur", section: "superviseur", motsCles: "autonomie observer reorganiser agir niveau droits" },
  { id: "supPaires", libelle: "Paires autorisées", section: "superviseur", motsCles: "paires echange espaces autoriser revoquer contexte" },
  { id: "heure", libelle: "Heure de rédaction", section: "activite", motsCles: "heure bilan generation planification" },
  { id: "joursOuvres", libelle: "Jours ouvrés seulement", section: "activite", motsCles: "jours ouvres semaine week-end" },
  { id: "taches", libelle: "Tâches", section: "activite", motsCles: "taches tickets gestionnaire source sprint" },
  { id: "listes", libelle: "Listes suivies", section: "activite", motsCles: "listes sprint suivies taches" },
  { id: "cle", libelle: "Clé personnelle", section: "activite", motsCles: "cle jeton token taches" },
  { id: "reunions", libelle: "Réunions de l’agenda", section: "activite", motsCles: "reunions agenda calendrier" },
  { id: "commandesShell", libelle: "Commandes du shell", section: "activite", motsCles: "shell commandes integration" },
  { id: "commandesIgnorees", libelle: "Commandes ignorées", section: "activite", motsCles: "ignorer commandes ls cd shell" },
  { id: "adresseCommits", libelle: "Adresse des commits", section: "activite", motsCles: "git email adresse auteur commits" },
  { id: "motifs", libelle: "Motifs de tickets", section: "activite", motsCles: "motifs tickets regex expression" },
  { id: "objectif", libelle: "Objectif journalier", section: "activite", motsCles: "heures objectif temps saisie journee vendredi" },
  { id: "tacheReunions", libelle: "Tâche des réunions", section: "activite", motsCles: "reunion tache temps saisie" },
  { id: "collecte", libelle: "Relever maintenant", section: "activite", motsCles: "collecte relever actualiser" },
  { id: "raccourcis", libelle: "Raccourcis clavier", section: "raccourcis", motsCles: "touches clavier azerty qwerty" },
  { id: "version", libelle: "Version", section: "apropos", motsCles: "version numero" },
  { id: "fichier", libelle: "Fichier de réglages", section: "apropos", motsCles: "fichier json configuration chemin settings" },
  { id: "dossierConfig", libelle: "Dossier de configuration", section: "apropos", motsCles: "dossier configuration ouvrir gestionnaire fichiers" },
  { id: "reinitialiser", libelle: "Revenir aux réglages d’origine", section: "apropos", motsCles: "reinitialiser defaut origine remise a zero" },
];

/** Réglages qui n'existent qu'avec le superviseur activé (la vue ne montre alors que
    l'interrupteur) : ni la palette ni la recherche ne les proposent tant qu'il est éteint. */
const REGLAGES_SUPERVISEUR_ACTIF: ReadonlySet<string> = new Set(["supNom", "supPause", "supNiveau", "supPaires"]);

/** Réglages que la palette peut proposer : sans superviseur, seul son interrupteur reste. */
export function reglagesCherchables(supActif: boolean): readonly ReglageCherchable[] {
  return supActif ? INDEX_REGLAGES : INDEX_REGLAGES.filter((e) => !REGLAGES_SUPERVISEUR_ACTIF.has(e.id));
}
