import { useCallback, useEffect, useState } from "react";
import { activityApi } from "../lib/activityApi";
import type { EntreeTemps } from "../lib/tempsSaisie";

export interface SaisieTemps {
  /** Déjà saisi ce jour-là, par id d'US. */
  saisies: Record<string, number>;
  /** US dont une saisie est en cours. */
  enCours: Set<string>;
  /** Dernière erreur par id d'US. */
  erreurs: Record<string, string>;
  saisir(entrees: EntreeTemps[]): void;
}

/**
 * État de la saisie des temps d'un jour : ce qui est déjà dans ClickUp (noté par
 * le backend à chaque saisie réussie) et les saisies en cours. Plusieurs lignes
 * peuvent partir en même temps, chacune avec son `claude -p`.
 */
export function useSaisieTemps(day: string): SaisieTemps {
  const [saisies, setSaisies] = useState<Record<string, number>>({});
  const [enCours, setEnCours] = useState<Set<string>>(new Set());
  const [erreurs, setErreurs] = useState<Record<string, string>>({});

  const recharger = useCallback(() => {
    activityApi
      .saisies(day)
      .then(setSaisies)
      .catch(() => {});
  }, [day]);

  useEffect(() => {
    setSaisies({});
    setErreurs({});
    recharger();
  }, [recharger]);

  const saisir = useCallback(
    (entrees: EntreeTemps[]) => {
      const ids = entrees.map((e) => e.taskId);
      setEnCours((prev) => new Set([...prev, ...ids]));
      setErreurs((prev) => {
        const next = { ...prev };
        for (const id of ids) delete next[id];
        return next;
      });
      activityApi
        .saisirTemps(day, entrees)
        .then((resultats) => {
          const ko: Record<string, string> = {};
          for (const r of resultats) if (!r.ok) ko[r.taskId] = r.erreur ?? "échec de la saisie";
          setErreurs((prev) => ({ ...prev, ...ko }));
        })
        .catch((err: unknown) => {
          setErreurs((prev) => ({ ...prev, ...Object.fromEntries(ids.map((id) => [id, String(err)])) }));
        })
        .finally(() => {
          setEnCours((prev) => new Set([...prev].filter((id) => !ids.includes(id))));
          recharger();
        });
    },
    [day, recharger],
  );

  return { saisies, enCours, erreurs, saisir };
}
