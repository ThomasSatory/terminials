import { useReglagesStore } from "../../store/reglages";
import { useSuperviseurStore } from "../../store/superviseur";
import { useUiStore } from "../../store/ui";
import { useEtatAffiche } from "../../hooks/useEtatSuperviseur";
import { Kbd } from "../ui/Kbd";
import { CLE_BULLE_SUPERVISEUR, Viseur } from "./elements";
import "../../styles/superviseur.css";

/**
 * Marque du superviseur, à l'extrême gauche du dock (maquette Superviseur) : carré aux
 * coins arrondis (taille des avatars du dock, rayon 12), viseur au trait dont le centre
 * dit le mode (observe, a quelque chose à dire, agit, en pause), pastille accent quand il
 * a quelque chose à dire, infobulle avec son nom, Ctrl+Maj+Espace et sa ligne d'état,
 * soulignement quand le panneau est ouvert, puis un séparateur. Rien quand le superviseur
 * est désactivé. Pose `data-dock-superviseur` : l'ancre de la bulle du superviseur.
 *
 * Rendue DANS le <nav> du dock (Dock.tsx), avant la bande des espaces : la largeur du
 * dock et l'indicateur d'espace actif en tiennent compte d'eux-mêmes (mesures du DOM).
 */
export function MarqueSuperviseur() {
  const actif = useReglagesStore((s) => s.reglages.superviseur.actif);
  const nom = useReglagesStore((s) => s.reglages.superviseur.nom);
  const ouvert = useSuperviseurStore((s) => s.panneauOuvert);
  // Bulle posée au-dessus : l'infobulle se tait, elles se chevaucheraient.
  const bulle = useUiStore((s) => s.bulleEspace === CLE_BULLE_SUPERVISEUR);
  const { mode, ligne, ton } = useEtatAffiche();
  if (!actif) return null;
  return (
    <>
      <div className="sup-marque-hote">
        <button
          type="button"
          className="sup-marque"
          data-dock-superviseur=""
          data-mode={mode}
          data-ouvert={ouvert}
          aria-label={`${nom}, superviseur, ${ligne} (Ctrl+Maj+Espace)`}
          aria-expanded={ouvert}
          onClick={() => useSuperviseurStore.getState().basculerPanneau()}
        >
          <span className="sup-marque-carre">
            <Viseur mode={mode} taille="dock" />
            {mode === "parle" && <span className="sup-marque-pastille" aria-hidden="true" />}
          </span>
          {!bulle && (
            <span className="ui-tip sup-marque-tip" aria-hidden="true">
              <span className="ui-tip-titre">
                {nom}
                <Kbd>Ctrl+Maj+Espace</Kbd>
              </span>
              <span className="sup-ligne-etat" data-ton={ton}>
                {ligne}
              </span>
            </span>
          )}
          <span className="sup-marque-souligne" aria-hidden="true" />
        </button>
      </div>
      <span className="dock-sep" aria-hidden="true" />
    </>
  );
}
