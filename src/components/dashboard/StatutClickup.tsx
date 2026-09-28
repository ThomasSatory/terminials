import { tonStatut } from "../../lib/clickupStatut";

/** Pastille de l'état ClickUp d'une US, teintée par famille (bloqué, revue, test…). */
export function StatutClickup({ status }: { status: string | null | undefined }) {
  if (!status) return null;
  return (
    <span className="dash-statut" data-ton={tonStatut(status)}>
      {status}
    </span>
  );
}
