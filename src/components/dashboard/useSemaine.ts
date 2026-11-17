import { useEffect, useRef, useState } from "react";
import { activityApi, type ActivityEvent } from "../../lib/activityApi";
import { weekRange } from "../../lib/dashboardDay";
import { useDashboardStore } from "../../store/dashboard";

/**
 * Événements de la semaine ouvrée du jour affiché (week-end compris), pour le
 * sélecteur de jours : chaque bouton porte la durée et la répartition par espace de
 * sa journée. Requête à part de `useActivityData`, qui ne charge en mode jour que la
 * journée. Rechargée au changement de semaine et à chaque collecte (`refreshTick`).
 */
export function useSemaine(): ActivityEvent[] {
  const day = useDashboardStore((s) => s.day);
  const refreshTick = useDashboardStore((s) => s.refreshTick);
  const [events, setEvents] = useState<ActivityEvent[]>([]);
  const requete = useRef(0);
  // Clé de la semaine : changer de jour dans la même semaine ne relance rien.
  const lundi = weekRange(day).days[0];

  useEffect(() => {
    const id = ++requete.current;
    const { from } = weekRange(lundi);
    // Jusqu'au lundi suivant : un jour de week-end affiché a lui aussi sa barre.
    activityApi
      .query(from, from + 7 * 86400 + 3600)
      .then((ev) => {
        if (id === requete.current) setEvents(ev);
      })
      .catch(() => {
        if (id === requete.current) setEvents([]);
      });
  }, [lundi, refreshTick]);

  return events;
}
