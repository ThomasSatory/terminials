import type { Reunion } from "../../lib/activityApi";
import { duree, heure } from "../../lib/recapModele";

/**
 * Réunions de la période, relevées dans l'agenda : plage, titre, durée, et leur
 * total en tête. Elles sont imputées sur la tâche de réunion du sprint.
 */
export function Reunions({ reunions }: { reunions: Reunion[] }) {
  const total = reunions.reduce((s, r) => s + (r.fin - r.debut) / 60, 0);
  return (
    <section aria-label="Réunions" className="rc-panneau rc-carte">
      <div className="rc-carte-tete">
        <h2 className="rc-intertitre">Réunions</h2>
        <span className="rc-carte-total">{duree(total)}</span>
      </div>
      {reunions.length === 0 ? (
        <p className="rc-vide rc-vide-carte">Aucune réunion relevée.</p>
      ) : (
        <ul className="rc-reunions">
          {reunions.map((r) => (
            <li key={r.id} className="rc-reunion">
              <span className="rc-reunion-plage">
                {heure(r.debut)}–{heure(r.fin)}
              </span>
              <span className="rc-reunion-titre">{r.titre}</span>
              <span className="rc-reunion-duree">{duree((r.fin - r.debut) / 60)}</span>
            </li>
          ))}
        </ul>
      )}
      <p className="rc-carte-note">Relevées dans l’agenda, imputées sur la tâche de réunion du sprint.</p>
    </section>
  );
}
