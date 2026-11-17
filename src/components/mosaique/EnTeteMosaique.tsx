import type { FiltreMosaique } from "../../lib/mosaique";
import { IconeMosaique } from "../ui/icons";

/**
 * Barre du haut de la mosaïque : titre et résumé, filtre « Tous » / par groupe (chaque
 * groupe signale une attente ou un agent au travail), bascule « En attente d'abord ».
 */
export function EnTeteMosaique({
  resume,
  filtres,
  onFiltre,
  attenteDabord,
  onAttenteDabord,
}: {
  resume: string;
  filtres: FiltreMosaique[];
  onFiltre: (id: string) => void;
  attenteDabord: boolean;
  onAttenteDabord: () => void;
}) {
  return (
    <div className="mos-barre">
      <div className="mos-titre">
        <IconeMosaique taille={15} className="mos-titre-icone" />
        <h1 className="mos-titre-texte">Mosaïque</h1>
        <span className="mos-resume">{resume}</span>
      </div>
      <div role="group" aria-label="Filtrer par groupe" className="mos-filtres">
        {filtres.map((f) => (
          <button
            key={f.id}
            type="button"
            className="mos-filtre"
            aria-pressed={f.presse}
            aria-label={f.aria}
            onClick={() => onFiltre(f.id)}
          >
            {f.couleur && <span aria-hidden="true" className="mos-carre" style={{ background: f.couleur }} />}
            <span>{f.libelle}</span>
            <span className="mos-filtre-nombre">{f.nombre}</span>
            {f.indicateur === "attente" && <span aria-hidden="true" className="mos-filtre-attente" />}
            {f.indicateur === "travail" && <span aria-hidden="true" className="mos-filtre-travail" />}
          </button>
        ))}
      </div>
      <span className="mos-espaceur" />
      <button
        type="button"
        role="switch"
        aria-checked={attenteDabord}
        className="mos-bascule"
        onClick={onAttenteDabord}
      >
        <span aria-hidden="true" className="mos-bascule-piste">
          <span className="mos-bascule-bouton" />
        </span>
        En attente d’abord
      </button>
    </div>
  );
}
