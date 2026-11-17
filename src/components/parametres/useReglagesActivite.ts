import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { activityApi, type ActivitySettings } from "../../lib/activityApi";
import { useDashboardStore } from "../../store/dashboard";

/**
 * Réglages du récap (section Activité) : lus par `activity_get_settings`, réécrits par
 * `activity_set_settings`, la même paire de commandes qu'avant la refonte. Comme les
 * autres réglages de la page, chaque changement s'applique et s'enregistre seul :
 * l'écriture est regroupée (`DELAI_ECRITURE_ACTIVITE_MS`), puis le récap se rafraîchit
 * pour montrer les nouvelles données. Une écriture en attente part quand on quitte la
 * vue : rien n'est perdu.
 */

export const DELAI_ECRITURE_ACTIVITE_MS = 400;

export interface ReglagesActivite {
  reglages: ActivitySettings | null;
  /** Lecture ou écriture en échec (message), null sinon. */
  erreur: string | null;
  modifier: (f: (s: ActivitySettings) => ActivitySettings) => void;
  /** Âges des dernières collectes, par source (epoch s). */
  derniereCollecte: Record<string, number> | null;
  collecteEnCours: boolean;
  /** Relève tout de suite (git, Claude Code, tâches). Rend les erreurs de la collecte. */
  collecter: () => Promise<string[]>;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function useReglagesActivite(): ReglagesActivite {
  const [reglages, setReglages] = useState<ActivitySettings | null>(null);
  const [erreur, setErreur] = useState<string | null>(null);
  const [derniereCollecte, setDerniereCollecte] = useState<Record<string, number> | null>(null);
  const [collecteEnCours, setCollecteEnCours] = useState(false);
  const aEcrire = useRef<ActivitySettings | null>(null);
  const minuterie = useRef<number | undefined>(undefined);

  const ecrire = useCallback(async () => {
    window.clearTimeout(minuterie.current);
    minuterie.current = undefined;
    const s = aEcrire.current;
    if (!s) return;
    aEcrire.current = null;
    try {
      await activityApi.setSettings(s);
      setErreur(null);
      useDashboardStore.getState().bumpRefresh();
    } catch (e) {
      setErreur(`réglages d’activité non enregistrés : ${message(e)}`);
    }
  }, []);

  useEffect(() => {
    let annule = false;
    activityApi
      .getSettings()
      .then((s) => {
        if (!annule) setReglages(s);
      })
      .catch((e: unknown) => {
        if (!annule) setErreur(`réglages d’activité illisibles : ${message(e)}`);
      });
    activityApi
      .status()
      .then((st) => {
        if (!annule) setDerniereCollecte(st.lastCollect);
      })
      .catch(() => {});
    return () => {
      annule = true;
      void ecrire();
    };
  }, [ecrire]);

  const modifier = useCallback(
    (f: (s: ActivitySettings) => ActivitySettings) => {
      setReglages((cur) => {
        if (!cur) return cur;
        const suivant = f(cur);
        aEcrire.current = suivant;
        return suivant;
      });
      window.clearTimeout(minuterie.current);
      minuterie.current = window.setTimeout(() => void ecrire(), DELAI_ECRITURE_ACTIVITE_MS);
    },
    [ecrire],
  );

  const collecter = useCallback(async () => {
    setCollecteEnCours(true);
    try {
      // Les réglages en attente d'abord : la collecte doit les prendre en compte.
      await ecrire();
      const rapport = await activityApi.collectNow();
      const st = await activityApi.status().catch(() => null);
      if (st) setDerniereCollecte(st.lastCollect);
      useDashboardStore.getState().bumpRefresh();
      return rapport.errors;
    } catch (e) {
      return [message(e)];
    } finally {
      setCollecteEnCours(false);
    }
  }, [ecrire]);

  return { reglages, erreur, modifier, derniereCollecte, collecteEnCours, collecter };
}

export const ContexteActivite = createContext<ReglagesActivite | null>(null);
export const useActivite = () => useContext(ContexteActivite);
