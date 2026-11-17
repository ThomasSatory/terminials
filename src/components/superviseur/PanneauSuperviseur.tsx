import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useReglagesStore } from "../../store/reglages";
import { useSuperviseurStore, demandeEnTete } from "../../store/superviseur";
import { useWorkspaceStore } from "../../store/workspace";
import { autoriserDemande } from "../../lib/executeurSuperviseur";
import { fermerPanneauSuperviseur } from "../../lib/shortcutDispatch";
import { texteMasque } from "../../lib/superviseurLibelles";
import { useEspacesSuperviseur, useEtatAffiche } from "../../hooks/useEtatSuperviseur";
import { EnTeteSuperviseur } from "./EnTeteSuperviseur";
import { FilSuperviseur } from "./FilSuperviseur";
import { PileValidation } from "./PileValidation";
import { SaisieSuperviseur } from "./SaisieSuperviseur";
import { SuperviseurDesactive } from "./SuperviseurDesactive";
import "../../styles/superviseur.css";

/**
 * Panneau latéral flottant du superviseur (maquette Superviseur), à droite, au-dessus du
 * terminal (`--z-panneau`), le dock libre dessous : en-tête (nom renommable, état,
 * échanges autorisés, pause, fermer), niveau d'autonomie, fil horodaté, pile des cartes
 * « À valider », bandeau des écritures masquées, suggestions et saisie. Ouvert/fermé par
 * Ctrl+Maj+Espace (`useSuperviseurStore.panneauOuvert`) ; la coquille réserve alors
 * `--reserve-panneau` à droite de la zone terminal (xterm se réajuste).
 *
 * Clavier, par `onKeyDown` sur la racine (jamais sur window : Échap appartient à Claude
 * Code dans le terminal) : Échap ferme et rend le focus au terminal, Ctrl+Entrée
 * autorise la carte en tête de pile.
 */

const SORTIE_MS = 200;

export function PanneauSuperviseur() {
  const actif = useReglagesStore((s) => s.reglages.superviseur.actif);
  const ouvert = useSuperviseurStore((s) => s.panneauOuvert);
  // Présent le temps de l'animation de sortie (panOut) après la fermeture.
  const [present, setPresent] = useState(ouvert);
  useEffect(() => {
    if (ouvert) {
      setPresent(true);
      return;
    }
    const t = setTimeout(() => setPresent(false), SORTIE_MS);
    return () => clearTimeout(t);
  }, [ouvert]);

  if (!ouvert && !present) return null;
  return <Panneau actif={actif} sortant={!ouvert} />;
}

/** Ferme le panneau et rend la saisie à ce qui est affiché dessous. */
const fermerEtRendre = fermerPanneauSuperviseur;

function Panneau({ actif, sortant }: { actif: boolean; sortant: boolean }) {
  const nom = useReglagesStore((s) => s.reglages.superviseur.nom);
  const niveau = useReglagesStore((s) => s.reglages.superviseur.niveau);
  const pause = useReglagesStore((s) => s.reglages.superviseur.pause);
  const nbOuvertes = useSuperviseurStore((s) => s.demandes.filter((d) => d.statut === "ouverte").length);
  const etat = useEtatAffiche();
  const espaces = useEspacesSuperviseur();
  const [pairesOuvertes, setPairesOuvertes] = useState(false);
  const racine = useRef<HTMLElement>(null);
  const champ = useRef<HTMLInputElement>(null);

  // Le panneau qui s'ouvre prend le focus : la saisie (ou le panneau lui-même, désactivé).
  useEffect(() => {
    if (sortant) return;
    (champ.current ?? racine.current)?.focus();
  }, [sortant, actif]);

  const cartesVisibles = nbOuvertes > 0 && niveau === "agir" && !pause;
  const masquees = nbOuvertes > 0 && !cartesVisibles;

  const surClavier = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      fermerEtRendre();
      return;
    }
    if (e.key === "Enter" && e.ctrlKey && cartesVisibles) {
      e.preventDefault();
      const tete = demandeEnTete(useSuperviseurStore.getState());
      const raison = tete ? autoriserDemande(tete.id) : null;
      if (raison) useWorkspaceStore.getState().showToast(raison);
    }
  };

  return (
    <aside
      ref={racine}
      className="sup-panneau"
      data-sortant={sortant || undefined}
      aria-label={`${nom}, superviseur`}
      tabIndex={-1}
      onKeyDown={surClavier}
    >
      {!actif ? (
        <SuperviseurDesactive fermer={fermerEtRendre} />
      ) : (
        <>
          <EnTeteSuperviseur
            etat={etat}
            pairesOuvertes={pairesOuvertes}
            basculerPaires={() => setPairesOuvertes((o) => !o)}
            fermer={fermerEtRendre}
          />
          <FilSuperviseur espaces={espaces} ouvrirPaires={() => setPairesOuvertes(true)} />
          {cartesVisibles && <PileValidation espaces={espaces} nom={nom} />}
          {masquees && (
            <div className="sup-masque-hote">
              <div className="sup-masque sup-ent">
                <span className="sup-masque-point" aria-hidden="true" />
                <span className="sup-masque-texte">{texteMasque(nbOuvertes, pause)}</span>
                <button
                  type="button"
                  className="sup-chip sup-masque-action"
                  onClick={() =>
                    pause ? useReglagesStore.getState().setPause(false) : useReglagesStore.getState().setNiveau("agir")
                  }
                >
                  {pause ? "Reprendre" : "Passer en Agir"}
                </button>
              </div>
            </div>
          )}
          <SaisieSuperviseur champRef={champ} />
        </>
      )}
    </aside>
  );
}
