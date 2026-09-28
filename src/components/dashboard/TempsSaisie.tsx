import { formatDuration } from "../../lib/dashboardDay";
import type { TicketRef } from "../../lib/activityApi";
import { debutEntree, entreesRestantes, type TempsSaisie as Temps } from "../../lib/tempsSaisie";
import type { SaisieTemps } from "../../hooks/useSaisieTemps";
import { StatutClickup } from "./StatutClickup";

function IdUs({ ticket, onOpen }: { ticket: TicketRef; onOpen: (url: string) => void }) {
  return (
    <a
      className="dash-task-id"
      href={ticket.url}
      onClick={(e) => {
        e.preventDefault();
        onOpen(ticket.url);
      }}
    >
      {ticket.id}
    </a>
  );
}

/**
 * Bouton de saisie d'une ligne : « Saisir », « +15 min » s'il en reste après une
 * première saisie, « ✓ » quand ClickUp a déjà tout. L'erreur éventuelle est
 * dans l'infobulle et le bouton reste là pour réessayer.
 */
function BoutonSaisir({
  id,
  propose,
  debut,
  saisie,
}: {
  id: string;
  propose: number;
  debut: number;
  saisie: SaisieTemps;
}) {
  const deja = saisie.saisies[id] ?? 0;
  const reste = propose - deja;
  if (saisie.enCours.has(id)) {
    return <span className="dash-saisir dash-saisir-encours">saisie…</span>;
  }
  if (reste <= 0) {
    return (
      <span className="dash-saisir dash-saisir-ok" data-tip={`${formatDuration(deja)} saisies dans ClickUp`}>
        ✓
      </span>
    );
  }
  const erreur = saisie.erreurs[id];
  return (
    <button
      type="button"
      className={erreur ? "dash-saisir dash-saisir-erreur" : "dash-saisir"}
      data-tip={erreur ?? `saisir ${formatDuration(reste)} dans ClickUp`}
      onClick={() => saisie.saisir([{ taskId: id, debut: debutEntree(debut), minutes: reste }])}
    >
      {deja > 0 ? `+${formatDuration(reste)}` : "Saisir"}
    </button>
  );
}

/** « terminials 30 min, chat 15 min » : l'activité sans US versée à la réunion. */
function detailHorsUs(horsUs: Temps["reunion"]["horsUs"]): string {
  const parts = horsUs.map((h) => `${h.projet} ${formatDuration(Math.round(h.minutes))}`);
  return parts.length > 0 ? `sans US : ${parts.join(", ")} · + temps non tracé` : "temps non tracé";
}

/**
 * « Temps à saisir » : la cible du jour (7 h 30, 7 h le vendredi) répartie par
 * US d'après l'activité mesurée, arrondie au quart d'heure ; ce que rien ne
 * rattache à une US va sur l'US de réunion du sprint. Survoler une durée donne
 * le temps mesuré.
 *
 * Avec `saisie` (vue Jour, ClickUp actif), chaque ligne a son bouton pour
 * créer l'entrée de temps dans ClickUp, et « Tout saisir » envoie le reste en
 * un seul appel. Sans (vue Semaine), la liste est en lecture seule.
 */
export function TempsSaisie({
  temps,
  onOpen,
  saisie,
}: {
  temps: Temps;
  onOpen: (url: string) => void;
  saisie?: SaisieTemps | null;
}) {
  if (temps.jours === 0) {
    return <p className="dash-tasks-empty">Aucune activité à saisir</p>;
  }
  const { reunion } = temps;
  return (
    <>
      <ul className="dash-temps">
        {temps.us.map((l) => (
          <li key={l.cle} className="dash-temps-ligne">
            <IdUs ticket={l.ticket} onOpen={onOpen} />
            <span className="dash-temps-nom">{l.ticket.name ?? "nom pas encore récupéré de ClickUp"}</span>
            <StatutClickup status={l.ticket.status} />
            <span
              className="dash-temps-duree"
              data-tip={`mesuré : ${formatDuration(Math.round(l.minutes))} · ${l.projets.join(", ")}`}
            >
              {formatDuration(l.saisie)}
            </span>
            {saisie && <BoutonSaisir id={l.ticket.id} propose={l.saisie} debut={l.debut} saisie={saisie} />}
          </li>
        ))}
        {reunion.saisie > 0 && (
          <li className="dash-temps-ligne dash-temps-reunion">
            {reunion.ticket ? (
              <IdUs ticket={reunion.ticket} onOpen={onOpen} />
            ) : (
              <span className="dash-task-id dash-task-id-absent">?</span>
            )}
            <span className="dash-temps-nom">
              {reunion.ticket
                ? (reunion.ticket.name ?? "Réunions")
                : "US de réunion introuvable — à renseigner dans les réglages"}
            </span>
            <span className="dash-temps-duree" data-tip={detailHorsUs(reunion.horsUs)}>
              {formatDuration(reunion.saisie)}
            </span>
            {saisie && reunion.ticket && (
              <BoutonSaisir id={reunion.ticket.id} propose={reunion.saisie} debut={reunion.debut} saisie={saisie} />
            )}
          </li>
        )}
      </ul>
      <p className="dash-temps-total">
        Total{temps.jours > 1 ? ` sur ${temps.jours} jours` : ""} <span>{formatDuration(temps.total)}</span>
        {saisie && <ToutSaisir temps={temps} saisie={saisie} />}
      </p>
    </>
  );
}

/** « Tout saisir » : le reste de chaque ligne, en un seul appel. */
function ToutSaisir({ temps, saisie }: { temps: Temps; saisie: SaisieTemps }) {
  const entrees = entreesRestantes(temps, saisie.saisies).filter((e) => !saisie.enCours.has(e.taskId));
  if (entrees.length === 0) return <span className="dash-saisir dash-saisir-place" />;
  return (
    <button type="button" className="dash-saisir" onClick={() => saisie.saisir(entrees)}>
      Tout saisir
    </button>
  );
}
