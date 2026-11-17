import { useEffect, useRef, useState } from "react";
import { useUiStore } from "../store/ui";
import { rouvrir, useRecents } from "../store/recents";
import { dispatchShortcut } from "../lib/shortcutDispatch";
import { monogramme } from "../lib/monogram";
import { metaRecent, quandRelatif } from "../lib/espacesRecents";
import { useHome } from "../hooks/useHome";
import { Avatar } from "./ui/Avatar";
import { IconePlus, IconeRafraichir } from "./ui/icons";
import "../styles/accueil.css";

/**
 * Accueil plein écran quand aucun espace n'est ouvert : identité, actions (nouvel
 * espace, ouvrir un dossier), reprise des espaces récemment fermés et rappel des
 * raccourcis. Le menu du « + » du dock vit à part (MenuAjout) : il sert aussi quand des
 * espaces sont ouverts.
 *
 * Monté par App dans le calque des vues plein écran (au-dessus de la barre du haut,
 * sous le dock) uniquement quand il n'y a aucun espace.
 */

/**
 * Instant courant, rafraîchi chaque minute tant que `actif` : sans cela « à l'instant »
 * resterait figé si l'accueil reste affiché.
 */
export function useMaintenant(actif: boolean): number {
  const [maintenant, setMaintenant] = useState(() => Date.now());
  useEffect(() => {
    if (!actif) return;
    setMaintenant(Date.now());
    const t = setInterval(() => setMaintenant(Date.now()), 60_000);
    return () => clearInterval(t);
  }, [actif]);
  return maintenant;
}

/**
 * Vrai quand le focus est déjà tenu par un calque ou un champ (menu, palette, saisie) :
 * l'accueil qui s'affiche ne doit pas le lui voler. Le terminal caché ne compte pas.
 */
function focusDejaPris(): boolean {
  const actif = document.activeElement;
  if (!(actif instanceof HTMLElement) || actif === document.body) return false;
  if (actif.closest(".xterm")) return false;
  return actif.closest('[role="dialog"], [role="menu"], [role="listbox"], input, textarea, select') !== null;
}

export const IconeDossierAccueil = ({ taille, epaisseur = 1.4 }: { taille: number; epaisseur?: number }) => (
  <svg
    aria-hidden="true"
    focusable="false"
    width={taille}
    height={taille}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={epaisseur}
    strokeLinejoin="round"
  >
    <path d="M2 4.5c0-.6.4-1 1-1h3l1.5 1.6H13c.6 0 1 .4 1 1V12c0 .6-.4 1-1 1H3c-.6 0-1-.4-1-1z" />
  </svg>
);

const RACCOURCIS_RAPPEL: { touches: string; libelle: string }[] = [
  { touches: "Ctrl K", libelle: "palette" },
  { touches: "Ctrl 1–9", libelle: "aller à un espace" },
  { touches: "Ctrl+Maj+G", libelle: "nouveau groupe" },
  { touches: "Ctrl+Maj+H", libelle: "activité" },
];

export function Accueil() {
  const liste = useRecents();
  const home = useHome() ?? undefined;
  const maintenant = useMaintenant(liste.length > 0);
  const racine = useRef<HTMLElement>(null);

  // Une vue qui s'ouvre prend le focus : après la fermeture du dernier onglet du dernier
  // espace, le terminal est caché et le clavier resterait sinon perdu dans le body.
  useEffect(() => {
    // Dernier espace fermé depuis la mosaïque : l'espace rouvert ensuite s'ouvre sur son
    // terminal, pas sur une mosaïque d'une tuile.
    if (useUiStore.getState().vue !== "terminal") useUiStore.getState().setVue("terminal");
    if (useUiStore.getState().menuAjout || focusDejaPris()) return;
    racine.current?.focus({ preventScroll: true });
  }, []);

  return (
    <>
      <main ref={racine} className="accueil" tabIndex={-1}>
        <div className="acc-colonne">
          <div className="acc-marque">
            <span className="acc-logo" aria-hidden="true">
              <span className="acc-logo-chevron">&gt;</span>
              <span className="acc-logo-curseur">_</span>
            </span>
            <div className="acc-titres">
              <h1 className="acc-titre">terminials</h1>
              <span className="acc-sous-titre">Aucun espace ouvert</span>
            </div>
          </div>

          <div className="acc-actions">
            <button type="button" className="acc-prim" onClick={() => dispatchShortcut({ type: "new-workspace" })}>
              <IconePlus taille={16} epaisseur={1.6} />
              <span className="acc-action-libelle">Nouvel espace</span>
              <span className="acc-touche acc-touche-accent">Ctrl+Maj+N</span>
            </button>
            <button type="button" className="acc-sec" onClick={() => dispatchShortcut({ type: "open-folder" })}>
              <IconeDossierAccueil taille={16} />
              <span className="acc-action-libelle">Ouvrir un dossier</span>
              <span className="acc-touche">Ctrl+Maj+O</span>
            </button>
          </div>

          {liste.length > 0 && (
            <section className="acc-reprendre" aria-label="Reprendre">
              <div className="acc-intertitre acc-intertitre-liste">Reprendre</div>
              {liste.map((e) => (
                <button type="button" key={`${e.cwd}\u0000${e.nom}`} className="pi acc-ligne" onClick={() => rouvrir(e)}>
                  <Avatar monogramme={monogramme(e.nom)} couleur={e.couleur} taille={32} sautille={false} />
                  <span className="acc-ligne-texte">
                    <span className="acc-ligne-nom">{e.nom}</span>
                    <span className="acc-ligne-meta">{metaRecent(e, home)}</span>
                  </span>
                  {e.sessions && (
                    <span className="acc-session">
                      <IconeRafraichir taille={12} />
                      session Claude à reprendre
                    </span>
                  )}
                  <span className="acc-ligne-quand">{quandRelatif(e.ferme, maintenant)}</span>
                </button>
              ))}
            </section>
          )}

          <div className="acc-rappel">
            {RACCOURCIS_RAPPEL.map((k) => (
              <span key={k.touches} className="acc-rappel-item">
                <span className="acc-touche acc-touche-rappel">{k.touches}</span>
                {k.libelle}
              </span>
            ))}
          </div>
        </div>
      </main>
    </>
  );
}
