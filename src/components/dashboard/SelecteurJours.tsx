import type { CSSProperties } from "react";
import { IconeChevronDroit, IconeChevronGauche } from "../ui/icons";
import { duree, type JourSelecteur } from "../../lib/recapModele";

/** Largeur d'un bouton de jour : le surligneur glisse de cette valeur par jour. */
const LARGEUR_JOUR = 78;

/**
 * Sélecteur des jours de la semaine : chevrons (jour ouvré précédent / suivant,
 * jamais au-delà d'aujourd'hui), puis un bouton par jour avec sa barre de
 * répartition par espace et sa durée active. Le surligneur glisse sous le jour
 * choisi ; en mode semaine, aucun jour n'est choisi et un clic ouvre la journée.
 */
export function SelecteurJours({
  jours,
  selection,
  precedent,
  suivant,
  onJour,
  onNaviguer,
  onAujourdhui,
  semaine,
}: {
  jours: JourSelecteur[];
  /** Jour surligné, null en mode semaine. */
  selection: string | null;
  precedent: string | null;
  suivant: string | null;
  onJour: (day: string) => void;
  /** Chevrons : jour voisin (ou semaine voisine en mode semaine). */
  onNaviguer: (day: string) => void;
  /** Présent quand aujourd'hui n'est pas dans la semaine affichée. */
  onAujourdhui: (() => void) | null;
  semaine: boolean;
}) {
  const unite = semaine ? "Semaine" : "Jour";
  const index = jours.findIndex((j) => j.day === selection);
  return (
    <div className="rc-jours">
      {onAujourdhui && (
        <button type="button" className="rc-aujourdhui hov" onClick={onAujourdhui}>
          Aujourd’hui
        </button>
      )}
      <button
        type="button"
        className="rc-chevron hov"
        aria-label={`${unite} précédent${semaine ? "e" : ""}`}
        aria-disabled={precedent === null}
        title={semaine ? "Semaine précédente" : "Jour précédent ( [ )"}
        onClick={() => precedent && onNaviguer(precedent)}
      >
        <IconeChevronGauche taille={14} />
      </button>
      <div role="group" aria-label="Jour de la semaine" className="rc-jours-liste">
        <span
          aria-hidden="true"
          className="rc-jours-surligneur"
          style={{
            transform: `translateX(${Math.max(0, index) * LARGEUR_JOUR}px)`,
            opacity: index === -1 ? 0 : 1,
          }}
        />
        {jours.map((j) => {
          const choisi = j.day === selection;
          return (
            <button
              key={j.day}
              type="button"
              className="rc-jour"
              aria-pressed={choisi}
              aria-disabled={j.future}
              aria-label={`${j.long}, ${j.future ? "à venir" : `${duree(j.minutes)} d’activité`}`}
              data-etat={choisi ? "choisi" : j.future ? "futur" : "passe"}
              onClick={() => !j.future && onJour(j.day)}
            >
              <span className="rc-jour-haut">
                {j.label}
                {j.aujourdhui && <span aria-hidden="true" className="rc-jour-auj" />}
              </span>
              <span aria-hidden="true" className="rc-jour-barre">
                {j.barre.map((b) => (
                  <span key={b.dir} style={{ flex: b.minutes, background: b.couleur } as CSSProperties} />
                ))}
              </span>
              <span className="rc-jour-duree">{j.future ? "à venir" : duree(j.minutes)}</span>
            </button>
          );
        })}
      </div>
      <button
        type="button"
        className="rc-chevron hov"
        aria-label={`${unite} suivant${semaine ? "e" : ""}`}
        aria-disabled={suivant === null}
        title={semaine ? "Semaine suivante" : "Jour suivant ( ] )"}
        onClick={() => suivant && onNaviguer(suivant)}
      >
        <IconeChevronDroit taille={14} />
      </button>
    </div>
  );
}
