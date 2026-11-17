import type { TicketRef } from "../../lib/activityApi";
import { entreesRestantes, etatLigne, type TempsSaisie as Temps } from "../../lib/tempsSaisie";
import type { SaisieTemps } from "../../hooks/useSaisieTemps";
import { IconeCoche } from "../ui/icons";
import { Ticket } from "./Ticket";
import { duree, heure } from "../../lib/recapModele";

interface Ligne {
  id: string;
  ticket: TicketRef | null;
  nom: string;
  sous: string;
  propose: number;
}

/**
 * Bouton d'une ligne (colonne de 64 px) : « Saisir », le reste après une saisie
 * partielle, « saisi » coché quand le suivi du temps a tout. Une erreur garde le
 * bouton pour réessayer, avec le message en infobulle.
 */
function Action({ ligne, temps, saisie }: { ligne: Ligne; temps: Temps; saisie: SaisieTemps }) {
  const deja = saisie.saisies[ligne.id] ?? 0;
  const etat = etatLigne(ligne.propose, deja, saisie.enCours.has(ligne.id));
  if (etat === "en-cours") return <span className="rc-saisie-encours">Saisie…</span>;
  const entrees = entreesRestantes(temps, saisie.saisies, ligne.id);
  if (etat === "saisi" || entrees.length === 0) {
    return (
      <span className="rc-saisi" title="Saisi dans le suivi du temps">
        <IconeCoche taille={13} epaisseur={1.9} />
        saisi
      </span>
    );
  }
  const erreur = saisie.erreurs[ligne.id];
  const plages = entrees.map((e) => `${e.debut.slice(11)} ${duree(e.minutes)}`).join(", ");
  return (
    <button
      type="button"
      className="rc-saisir hov"
      data-erreur={erreur !== undefined}
      title={erreur ?? `Créer l’entrée de temps dans le suivi du temps : ${plages}`}
      onClick={() => saisie.saisir(entrees)}
    >
      {etat === "partiel" ? `+${duree(ligne.propose - deja)}` : "Saisir"}
    </button>
  );
}

/**
 * « Temps à saisir » : la cible de la journée répartie par tâche au prorata du temps
 * mesuré, au quart d'heure, avec la barre de progression de ce qui est déjà saisi.
 * Avec `saisie` (vue jour, suivi des tâches actif), chaque ligne a son bouton et
 * « Tout saisir » envoie le reste en un seul appel ; sans, la liste est en lecture.
 */
export function TempsSaisie({
  temps,
  saisie,
  note,
  onOpen,
}: {
  temps: Temps;
  saisie: SaisieTemps | null;
  /** Comment la cible est calculée (sous la liste). */
  note: string;
  onOpen: (url: string) => void;
}) {
  const lignes: Ligne[] = temps.us.map((l) => ({
    id: l.ticket.id,
    ticket: l.ticket,
    nom: l.ticket.name ?? "nom pas encore récupéré",
    sous:
      l.projets.length > 0
        ? `${l.projets.join(", ")} · mesuré ${duree(Math.round(l.minutes / 5) * 5)}`
        : "aucune tâche travaillée : réparti sur les tâches ouvertes",
    propose: l.saisie,
  }));
  const { reunion } = temps;
  if (reunion.saisie > 0) {
    lignes.push({
      id: reunion.ticket?.id ?? "",
      ticket: reunion.ticket,
      nom: reunion.ticket ? (reunion.ticket.name ?? "Réunions") : "Tâche de réunion introuvable : à renseigner dans les réglages",
      sous:
        reunion.reunions.length > 0
          ? reunion.reunions.map((r) => `${r.titre} ${heure(r.debut)}–${heure(r.fin)}`).join(", ")
          : "temps sans tâche",
      propose: reunion.saisie,
    });
  }

  const deja = (l: Ligne) => Math.min(l.propose, saisie?.saisies[l.id] ?? 0);
  const saisi = lignes.reduce((s, l) => s + deja(l), 0);
  const toutSaisi = saisie !== null && lignes.length > 0 && lignes.every((l) => deja(l) >= l.propose);
  const restantes = saisie ? entreesRestantes(temps, saisie.saisies).filter((e) => !saisie.enCours.has(e.taskId)) : [];
  const pourcent = temps.total > 0 ? Math.min(100, (saisi / temps.total) * 100) : 0;

  return (
    <section aria-label="Temps à saisir" className="rc-panneau rc-carte">
      <div className="rc-carte-tete">
        <h2 className="rc-intertitre">Temps à saisir</h2>
        <span className="rc-carte-total">
          {saisie ? (
            <>
              <span data-succes={toutSaisi} className="rc-saisi-total">
                {duree(saisi)}
              </span>{" "}
              / {duree(temps.total)}
            </>
          ) : (
            duree(temps.total)
          )}
        </span>
      </div>
      {saisie && (
        <div aria-hidden="true" className="rc-progression">
          <div style={{ width: `${pourcent.toFixed(1)}%` }} />
        </div>
      )}
      {temps.jours === 0 ? (
        <p className="rc-vide rc-vide-carte">Aucune activité à saisir.</p>
      ) : (
        <ul className="rc-saisie-liste">
          {lignes.map((l) => (
            <li key={l.id || "reunion"} className="rc-saisie-ligne">
              <div className="rc-saisie-texte">
                <div className="rc-saisie-haut">
                  {l.ticket ? (
                    <Ticket id={l.ticket.id} url={l.ticket.url} titre={l.ticket.name} onOpen={onOpen} />
                  ) : (
                    <span className="rc-tk">?</span>
                  )}
                  <span className="rc-saisie-nom">{l.nom}</span>
                </div>
                <span className="rc-saisie-sous">{l.sous}</span>
              </div>
              <span className="rc-saisie-duree">{duree(l.propose)}</span>
              {saisie && (
                <span className="rc-saisie-action">
                  {l.ticket && <Action ligne={l} temps={temps} saisie={saisie} />}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      <div className="rc-saisie-pied">
        <span className="rc-saisie-note">{note}</span>
        {saisie && !toutSaisi && restantes.length > 0 && (
          <button type="button" className="rc-tout-saisir hov" onClick={() => saisie.saisir(restantes)}>
            Tout saisir
          </button>
        )}
        {toutSaisi && <span className="rc-journee-saisie">Journée saisie</span>}
      </div>
    </section>
  );
}
