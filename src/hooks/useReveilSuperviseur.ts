import { useEffect } from "react";
import { useWorkspaceStore } from "../store/workspace";
import { useSuperviseurStore } from "../store/superviseur";
import { useReglagesStore } from "../store/reglages";
import { etatEspace } from "../lib/etatAgent";
import { texteNotification } from "../lib/dockInfo";
import { titreSansGlyphe } from "../lib/mosaique";
import { superviseurApi } from "../lib/superviseurApi";
import { annulerDemandesOrphelines } from "../lib/executeurSuperviseur";
import {
  finDePhrase,
  indexer,
  phraseManque,
  phraseReveil,
  reveilsEntre,
  type InstantaneEspace,
  type Reveil,
} from "../lib/reveilSuperviseur";
import { TEXTE_PAUSE, texteNiveau, texteNouveauNom, texteReprise } from "../lib/superviseurLibelles";

/**
 * Réveils du superviseur nés de l'état des agents : un agent passe en attente (fin de
 * tour, demande d'autorisation) ou termine → une observation au fil et
 * `superviseurApi.signaler(…)` avec une phrase prête pour l'invite ; en pause, la même
 * phrase va dans `useSuperviseurStore.noterManque`, et la reprise envoie un événement
 * « reprise » qui les résume. Les changements de niveau, de pause et de nom s'écrivent au
 * fil, comme la maquette. Ne signale rien si le superviseur est désactivé. Monté une fois
 * par la coquille.
 */

/** Regroupement des changements : la notification et le blocage d'un même hook arrivent
    l'un après l'autre, dans deux stores. */
const REGROUPEMENT_MS = 60;
/** Le nom se tape lettre à lettre dans les Paramètres : on n'annonce que le nom posé. */
const DELAI_NOM_MS = 900;

function instantane(): InstantaneEspace[] {
  const w = useWorkspaceStore.getState();
  const bloquees = useSuperviseurStore.getState().sessionsBloquees;
  const travail = { tabPtys: w.tabPtys, busyPtys: w.busyPtys, tabsTermines: w.tabsTermines };
  return w.workspaces.map((ws) => {
    const bloque = ws.tabs.map((t) => bloquees[t.id]).find((m) => m !== undefined) ?? null;
    const fini = ws.tabs.find((t) => t.id in w.tabsTermines);
    return {
      id: ws.id,
      nom: ws.name,
      etat: etatEspace(ws, travail),
      bloque,
      notification: texteNotification(ws.lastNotification) || null,
      sujet: titreSansGlyphe(fini?.title) || null,
    };
  });
}

function annoncer(r: Reveil): void {
  const reg = useReglagesStore.getState().reglages.superviseur;
  const sup = useSuperviseurStore.getState();
  if (reg.pause) {
    sup.noterManque(phraseManque(r));
    return;
  }
  sup.ajouterEntree({ genre: "observation", wsId: r.wsId, parties: [{ type: "texte", tete: r.nom, texte: ` ${finDePhrase(r.suite)}` }] });
  void superviseurApi.signaler({ genre: r.genre, texte: phraseReveil(r), wsId: r.wsId }).catch(() => {});
}

function discret(texte: string): void {
  useSuperviseurStore.getState().ajouterEntree({ genre: "superviseur", parties: [{ type: "texte", ton: "discret", texte }] });
}

export function useReveilSuperviseur(): void {
  // Transitions d'état des agents.
  useEffect(() => {
    let reference = indexer(instantane());
    let minuterie: ReturnType<typeof setTimeout> | undefined;
    let vusEspaces: unknown = null;
    let vusOccupes: unknown = null;
    let vusTermines: unknown = null;
    let vusBloques: unknown = null;

    const evaluer = () => {
      minuterie = undefined;
      const maintenant = instantane();
      const actif = useReglagesStore.getState().reglages.superviseur.actif;
      // Désactivé : on suit quand même l'état, pour qu'une activation ne réveille pas le
      // moteur sur une situation déjà ancienne.
      if (actif) for (const r of reveilsEntre(reference, maintenant)) annoncer(r);
      reference = indexer(maintenant);
      annulerDemandesOrphelines();
    };
    const planifier = () => {
      const w = useWorkspaceStore.getState();
      const b = useSuperviseurStore.getState().sessionsBloquees;
      // Seuls les espaces, l'occupation et les blocages comptent (pas les ports, le toast…).
      if (w.workspaces === vusEspaces && w.busyPtys === vusOccupes && w.tabsTermines === vusTermines && b === vusBloques) return;
      vusEspaces = w.workspaces;
      vusOccupes = w.busyPtys;
      vusTermines = w.tabsTermines;
      vusBloques = b;
      if (minuterie === undefined) minuterie = setTimeout(evaluer, REGROUPEMENT_MS);
    };
    planifier();
    const a = useWorkspaceStore.subscribe(planifier);
    const b = useSuperviseurStore.subscribe(planifier);
    return () => {
      a();
      b();
      clearTimeout(minuterie);
    };
  }, []);

  // Réglages : niveau, pause, nom (d'où qu'ils changent : panneau, Paramètres).
  useEffect(() => {
    let avant = useReglagesStore.getState().reglages.superviseur;
    let nomAnnonce = avant.nom;
    let minuterieNom: ReturnType<typeof setTimeout> | undefined;

    const desabonner = useReglagesStore.subscribe((s) => {
      const r = s.reglages.superviseur;
      if (r === avant) return;
      const p = avant;
      avant = r;
      // Le moteur filtre les signaux sur SES réglages, écrits 250 ms plus tard : activer
      // ou reprendre s'écrit tout de suite, sinon la reprise (et toute question arrivée
      // entre-temps) partait vers un moteur encore « en pause » et s'y perdait. Microtâche :
      // ce rappel tourne pendant le `set` du store, avant que l'écriture soit en attente.
      const ecrit =
        r.actif !== p.actif || r.pause !== p.pause
          ? Promise.resolve().then(() => useReglagesStore.getState().enregistrerMaintenant())
          : Promise.resolve();
      if (!r.actif) {
        clearTimeout(minuterieNom);
        nomAnnonce = r.nom;
        // Désactivé : plus personne ne relaiera de réponse, les échanges ouverts se closent
        // (sinon l'anneau de relais restait sur l'espace qui attendait).
        if (p.actif) useSuperviseurStore.getState().cloreEchangesEnCours();
        return;
      }
      // Activation : l'état courant devient la référence, rien à annoncer.
      if (!p.actif) {
        nomAnnonce = r.nom;
        return;
      }
      if (r.niveau !== p.niveau) discret(texteNiveau(r.niveau));
      if (r.pause && !p.pause) {
        useSuperviseurStore.getState().viderManques();
        discret(TEXTE_PAUSE);
      } else if (!r.pause && p.pause) {
        const texte = texteReprise(useSuperviseurStore.getState().viderManques());
        discret(texte);
        void ecrit.then(() => superviseurApi.signaler({ genre: "reprise", texte })).catch(() => {});
      }
      if (r.nom !== p.nom) {
        clearTimeout(minuterieNom);
        minuterieNom = setTimeout(() => {
          const nom = useReglagesStore.getState().reglages.superviseur.nom;
          if (nom !== nomAnnonce && useReglagesStore.getState().reglages.superviseur.actif) {
            nomAnnonce = nom;
            discret(texteNouveauNom(nom));
          }
        }, DELAI_NOM_MS);
      }
    });
    return () => {
      desabonner();
      clearTimeout(minuterieNom);
    };
  }, []);
}
