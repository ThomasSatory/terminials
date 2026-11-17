import { useReglagesStore } from "../../store/reglages";
import { useUiStore } from "../../store/ui";
import { IconeCroix, Viseur } from "./elements";

/**
 * Superviseur désactivé (réglage par défaut) : ce qu'il ferait, ce que l'activer
 * implique — un agent Claude Code qui consomme des jetons à chaque réveil, jamais
 * d'écriture sans votre accord —, et le bouton pour l'activer. Rien ne tourne tant qu'on
 * ne l'a pas activé.
 */
export function SuperviseurDesactive({ fermer }: { fermer: () => void }) {
  const nom = useReglagesStore((s) => s.reglages.superviseur.nom);
  return (
    <div className="sup-desactive">
      <div className="sup-tete-ligne sup-desactive-tete">
        <span className="sup-tete-viseur" data-mode="pause" aria-hidden="true">
          <Viseur mode="pause" taille="tete" />
        </span>
        <span className="sup-tete-identite">
          <span className="sup-desactive-nom">{nom}</span>
          <span className="sup-ligne-etat" data-ton="discret">
            désactivé · rien ne tourne
          </span>
        </span>
        <button type="button" className="hov sup-tete-fermer" aria-label="Fermer le poste de suivi (Échap)" title="Fermer (Échap)" onClick={fermer}>
          <IconeCroix taille={12} />
        </button>
      </div>
      <div className="sup-desactive-corps sup-ent">
        <p className="sup-desactive-intro">
          Un agent qui veille sur tous vos espaces : il vous dit où en sont vos agents, range vos espaces et fait passer une
          question d’une session à l’autre.
        </p>
        <ul className="sup-desactive-liste">
          <li>
            Il s’appuie sur Claude Code : chaque réveil (un agent qui vous attend ou termine, un message de votre part)
            consomme des jetons de votre compte.
          </li>
          <li>Il démarre au niveau Observer : il regarde et vous prévient, sans rien toucher.</li>
          <li>Écrire dans une session passe toujours par votre accord, sauf entre deux espaces que vous autorisez.</li>
          <li>Pause ou désactivation à tout moment ; désactivé, aucun processus ne tourne.</li>
        </ul>
        <div className="sup-desactive-actions">
          <button
            type="button"
            className="sup-prim sup-activer"
            onClick={() => useReglagesStore.getState().setSuperviseurActif(true)}
          >
            Activer {nom}
          </button>
          <button
            type="button"
            className="sup-ghost"
            onClick={() => {
              fermer();
              useUiStore.getState().ouvrirParametres("superviseur");
            }}
          >
            Réglages
          </button>
        </div>
      </div>
    </div>
  );
}
