import { useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  EVENEMENT_FLUX_SUPERVISEUR,
  EVENEMENT_OUTIL_REQUETE,
  type FluxSuperviseur,
  type RequeteOutil,
} from "../lib/outilsProtocole";
import { traiterRequete } from "../lib/executeurSuperviseur";
import { useSuperviseurStore } from "../store/superviseur";
import { useReglagesStore } from "../store/reglages";

/**
 * Exécuteur front des outils : écoute `outil-requete` (EVENEMENT_OUTIL_REQUETE) et confie
 * chaque appel à `lib/executeurSuperviseur.traiterRequete` (résolution, garde-fou,
 * exécution ou carte « À valider », réponse TOUJOURS rendue). Écoute aussi le flux du
 * moteur (`superviseur-flux`) : textes du tour, début et fin de tour.
 * Monté une fois par la coquille, même superviseur désactivé (les outils d'observation
 * restent ouverts aux agents des espaces ; le garde-fou refuse le reste).
 */
export function useOutilsSuperviseur(): void {
  useEffect(() => {
    let fini = false;
    const desabonnements: UnlistenFn[] = [];
    const garder = (p: Promise<UnlistenFn>) =>
      p
        .then((u) => (fini ? u() : desabonnements.push(u)))
        .catch(() => {
          // Hors de Tauri (tests, aperçu) : pas d'événements, rien à écouter.
        });

    garder(listen<RequeteOutil>(EVENEMENT_OUTIL_REQUETE, (e) => void traiterRequete(e.payload)));
    garder(listen<FluxSuperviseur>(EVENEMENT_FLUX_SUPERVISEUR, (e) => appliquerFluxFront(e.payload)));

    return () => {
      fini = true;
      for (const u of desabonnements) u();
    };
  }, []);
}

/** Flux du moteur → store ; un tour en échec laisse une trace discrète au fil. */
export function appliquerFluxFront(f: FluxSuperviseur): void {
  const sup = useSuperviseurStore.getState();
  sup.appliquerFlux(f);
  if (f.type === "tour-fin" && !f.ok && useReglagesStore.getState().reglages.superviseur.actif) {
    sup.ajouterEntree({
      genre: "superviseur",
      parties: [{ type: "texte", ton: "discret", texte: `Tour interrompu : ${f.erreur ?? "erreur inconnue"}.` }],
    });
  }
}
