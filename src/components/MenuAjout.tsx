import { useLayoutEffect, useRef, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { useUiStore } from "../store/ui";
import { useWorkspaceStore } from "../store/workspace";
import { rouvrir, useRecents } from "../store/recents";
import { dispatchShortcut } from "../lib/shortcutDispatch";
import { monogramme } from "../lib/monogram";
import { trouverAncre } from "../lib/ancrage";
import { cheminCourt, estOuvert, quandRelatif } from "../lib/espacesRecents";
import { usePlacementAncre } from "../hooks/usePlacementAncre";
import { useHome } from "../hooks/useHome";
import { IconeDossierAccueil, useMaintenant } from "./Accueil";
import { Avatar } from "./ui/Avatar";
import { Kbd } from "./ui/Kbd";
import { IconePlus } from "./ui/icons";

/**
 * Menu du « + » du dock (maquette Accueil/05) : nouvel espace, ouvrir un dossier, puis les
 * espaces récents, ceux déjà ouverts marqués « ouvert » à l'accent. Le dock l'ouvre sans
 * espace, ou quand un espace fermé peut être repris ; sinon le + mène directement au
 * formulaire de création (maquette Creation/01).
 *
 * Toujours monté par App, rendu dans `.app` (unique contexte d'empilement des calques)
 * pour passer au-dessus du voile et du dock.
 */
export function MenuAjout() {
  const ouvert = useUiStore((s) => s.menuAjout);
  return ouvert ? <MenuAjoutOuvert /> : null;
}

function MenuAjoutOuvert() {
  const liste = useRecents();
  const home = useHome() ?? undefined;
  const maintenant = useMaintenant(true);
  const ouverts = useWorkspaceStore((s) => s.workspaces);
  const dockVisible = useUiStore((s) => s.dockVisible);
  const place = usePlacementAncre({ type: "ajout" }, 320, 18, dockVisible);
  const racine = useRef<HTMLDivElement>(null);

  // Le menu prend le focus à l'ouverture (première action).
  const affiche = place !== null;
  useLayoutEffect(() => {
    if (affiche) racine.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [affiche]);

  const cadre = document.querySelector(".app") ?? document.body;
  const fermer = () => useUiStore.getState().fermerMenuAjout();
  const choisir = (action: () => void) => {
    fermer();
    action();
  };

  return createPortal(
    <>
      <button type="button" className="acc-voile" aria-label="Fermer le menu" tabIndex={-1} onClick={fermer} />
      {place && (
        <div
          ref={racine}
          role="dialog"
          aria-modal="true"
          aria-label="Nouvel espace"
          className="acc-menu"
          style={{ left: place.left, bottom: place.bottom, width: place.largeur }}
          // Échap se gère ici (focus dans le menu) et jamais sur window : dans un terminal il appartient à l'agent.
          onKeyDown={(e) => {
            if (e.key === "Tab") {
              // Le voile rend le reste inerte : Tab tourne dans le menu au lieu d'en sortir.
              const boutons = Array.from(e.currentTarget.querySelectorAll<HTMLButtonElement>("button"));
              const premier = boutons[0];
              const dernier = boutons[boutons.length - 1];
              const ici = document.activeElement;
              if (e.shiftKey && (ici === premier || !e.currentTarget.contains(ici))) {
                e.preventDefault();
                dernier?.focus();
              } else if (!e.shiftKey && ici === dernier) {
                e.preventDefault();
                premier?.focus();
              }
              return;
            }
            if (e.key !== "Escape") return;
            e.stopPropagation();
            fermer();
            trouverAncre({ type: "ajout" })?.focus();
          }}
        >
          <div className="acc-menu-actions">
            <LigneMenu icone={<IconePlus taille={14} epaisseur={1.6} />} touches="Ctrl+Maj+N" onClick={() => choisir(() => dispatchShortcut({ type: "new-workspace" }))}>
              Nouvel espace
            </LigneMenu>
            <LigneMenu icone={<IconeDossierAccueil taille={14} />} touches="Ctrl+Maj+O" onClick={() => choisir(() => dispatchShortcut({ type: "open-folder" }))}>
              Ouvrir un dossier
            </LigneMenu>
          </div>
          {liste.length > 0 && (
            <>
              <div className="acc-menu-filet" />
              <div className="acc-menu-reprendre">
                <div className="acc-intertitre acc-intertitre-menu">Reprendre</div>
                {liste.map((e) => {
                  const dejaOuvert = estOuvert(e, ouverts);
                  return (
                    <button
                      type="button"
                      key={`${e.cwd}\u0000${e.nom}`}
                      className="pi acc-menu-ligne acc-menu-recent"
                      onClick={() => choisir(() => rouvrir(e))}
                    >
                      <Avatar monogramme={monogramme(e.nom)} couleur={e.couleur} taille={22} sautille={false} />
                      <span className="acc-menu-recent-nom">{e.nom}</span>
                      <span className="acc-menu-recent-indice">
                        {e.sessions ? "session Claude à reprendre" : cheminCourt(e.cwd, home)}
                      </span>
                      <span className="acc-menu-recent-etat" data-ouvert={dejaOuvert || undefined}>
                        {dejaOuvert ? "ouvert" : quandRelatif(e.ferme, maintenant)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </div>
      )}
    </>,
    cadre,
  );
}

function LigneMenu({
  icone,
  touches,
  onClick,
  children,
}: {
  icone: ReactNode;
  touches: string;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button type="button" className="pi acc-menu-ligne acc-menu-action" onClick={onClick}>
      <span className="acc-menu-icone">{icone}</span>
      <span className="acc-menu-action-libelle">{children}</span>
      <Kbd>{touches}</Kbd>
    </button>
  );
}
