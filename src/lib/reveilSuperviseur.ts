import type { EtatAgent } from "./etatAgent";
import { autorisationLisible } from "./outilsSuperviseur";

/**
 * Réveils du superviseur nés de l'état des agents (hooks/useReveilSuperviseur), en
 * logique pure : à partir de deux instantanés successifs des espaces, ce qui vient de
 * changer et mérite qu'il s'en occupe — un agent qui se met à vous attendre (question,
 * demande d'autorisation), un agent qui termine son tour.
 *
 * Le premier instantané sert de référence : au lancement de l'app (ou à l'activation du
 * superviseur), les agents déjà en attente ne déclenchent rien, sinon chaque démarrage
 * coûterait un tour de modèle pour une situation que l'utilisateur voit déjà.
 */

export interface InstantaneEspace {
  id: string;
  nom: string;
  etat: EtatAgent;
  /** Message de la demande d'autorisation en cours dans un de ses onglets, sinon null. */
  bloque: string | null;
  /** Dernière notification (la question posée), sinon null. */
  notification: string | null;
  /** Sujet de l'onglet qui vient de finir (titre poussé par Claude Code), sinon null. */
  sujet: string | null;
}

export interface Reveil {
  genre: "attente" | "termine";
  wsId: string;
  nom: string;
  /** Ce qui suit le nom (« attend une autorisation : utiliser Bash ») : la tête en gras du fil. */
  suite: string;
}

/** Phrase complète, pour l'invite du moteur et l'entrée du fil : « X attend … . » */
export function phraseReveil(r: Reveil): string {
  return `${r.nom} ${finDePhrase(r.suite)}`;
}

/** Point final, sauf après une question ou une exclamation (« … utiliser ? » et non « ?. »). */
export function finDePhrase(t: string): string {
  return /[?!…]$/.test(t) ? t : `${t}.`;
}

/** Même chose sans point final, pour la liste « pendant la pause : a ; b ». */
export function phraseManque(r: Reveil): string {
  return `${r.nom} ${r.suite}`;
}

const sansPoint = (t: string) => t.trim().replace(/[.\s]+$/, "");

export function reveilsEntre(avant: ReadonlyMap<string, InstantaneEspace>, apres: readonly InstantaneEspace[]): Reveil[] {
  const sortie: Reveil[] = [];
  for (const w of apres) {
    const p = avant.get(w.id);
    // Espace nouveau : rien à comparer (il naît au repos de toute façon).
    if (!p) continue;
    if (w.etat === "attente") {
      // L'attente commence, ou devient une demande d'autorisation (la notification et le
      // blocage arrivent l'un après l'autre).
      const devientBloque = w.bloque !== null && p.bloque === null;
      if (p.etat !== "attente" || devientBloque) {
        const suite = w.bloque
          ? `attend une ${autorisationLisible(w.bloque)}`
          : w.notification
            ? `vous attend : ${sansPoint(w.notification)}`
            : "vous attend";
        sortie.push({ genre: "attente", wsId: w.id, nom: w.nom, suite });
      }
      continue;
    }
    if (w.etat === "termine" && p.etat !== "termine") {
      sortie.push({
        genre: "termine",
        wsId: w.id,
        nom: w.nom,
        suite: w.sujet ? `a terminé : ${sansPoint(w.sujet)}` : "a terminé",
      });
    }
  }
  return sortie;
}

export function indexer(instantanes: readonly InstantaneEspace[]): Map<string, InstantaneEspace> {
  return new Map(instantanes.map((w) => [w.id, w]));
}
