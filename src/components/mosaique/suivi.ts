import { useRef, useSyncExternalStore } from "react";
import { useWorkspaceStore } from "../../store/workspace";
import { etatEspace } from "../../lib/etatAgent";
import { alignerCles, majSuivi, type SuiviEtat } from "../../lib/mosaique";

/**
 * Sources vivantes de la mosaïque, hors React : depuis quand chaque espace est dans son
 * état (pour « depuis 0:42 », « 4:12 », « il y a 3 min ») et une horloge partagée.
 */

// ---------- Suivi des changements d'état ----------

let suivi = new Map<string, SuiviEtat>();
const abonnesSuivi = new Set<() => void>();
let suiviDemarre = false;

/**
 * Démarre le suivi des changements d'état, une fois pour toute la session. Il tourne
 * aussi mosaïque fermée : c'est en la rouvrant qu'on veut savoir depuis quand un agent
 * attend. Pour rester gratuit vue fermée, il ne recalcule que si l'une de ses sources a
 * changé de référence (espaces, PTY des onglets, PTY occupés, onglets terminés) : un toast, un changement
 * d'espace actif ou une sonde qui ne touche qu'à autre chose passent sans calcul.
 */
export function demarrerSuiviEtats(): void {
  if (suiviDemarre) return;
  suiviDemarre = true;
  let sources: unknown[] = [];
  const lire = () => {
    const s = useWorkspaceStore.getState();
    const suivantes = [s.workspaces, s.tabPtys, s.busyPtys, s.tabsTermines];
    if (suivantes.every((v, i) => v === sources[i])) return;
    sources = suivantes;
    const suivant = majSuivi(
      suivi,
      s.workspaces.map((w) => [w.id, etatEspace(w, s)]),
      Date.now(),
    );
    if (suivant === suivi) return;
    suivi = suivant;
    for (const a of abonnesSuivi) a();
  };
  lire();
  useWorkspaceStore.subscribe(lire);
}

function abonnerSuivi(cb: () => void): () => void {
  abonnesSuivi.add(cb);
  return () => abonnesSuivi.delete(cb);
}

/** Dernier changement d'état observé de l'espace (référence stable tant qu'il ne change pas). */
export function useSuiviEtat(wsId: string): SuiviEtat | undefined {
  const lire = () => suivi.get(wsId);
  return useSyncExternalStore(abonnerSuivi, lire, lire);
}

// ---------- Horloge ----------

let maintenant = Date.now();
const abonnesHorloge = new Set<() => void>();
let minuterie: ReturnType<typeof setInterval> | undefined;

function abonnerHorloge(cb: () => void): () => void {
  abonnesHorloge.add(cb);
  if (minuterie === undefined) {
    maintenant = Date.now();
    minuterie = setInterval(() => {
      maintenant = Date.now();
      for (const a of abonnesHorloge) a();
    }, 1000);
  }
  return () => {
    abonnesHorloge.delete(cb);
    // Plus aucune tuile affichée : l'horloge s'arrête, rien ne tourne mosaïque fermée.
    if (abonnesHorloge.size === 0) {
      clearInterval(minuterie);
      minuterie = undefined;
    }
  };
}

/** Heure courante, rafraîchie chaque seconde par une seule minuterie partagée. */
export function useMaintenant(): number {
  const lire = () => maintenant;
  return useSyncExternalStore(abonnerHorloge, lire, lire);
}

// ---------- Clés des lignes ----------

/** Clés stables des lignes d'un mini-terminal (cf. `alignerCles`) : seule une ligne
    vraiment nouvelle reçoit une clé neuve, donc rejoue son entrée. Idempotent : un
    second calcul sur les mêmes lignes rend les mêmes clés. */
export function useClesLignes(lignes: string[]): number[] {
  const memo = useRef<{ lignes: string[]; cles: number[]; prochaine: number }>({
    lignes: [],
    cles: [],
    prochaine: 0,
  });
  if (memo.current.lignes !== lignes) {
    const r = alignerCles(memo.current.lignes, memo.current.cles, lignes, memo.current.prochaine);
    memo.current = { lignes, cles: r.cles, prochaine: r.prochaineCle };
  }
  return memo.current.cles;
}
