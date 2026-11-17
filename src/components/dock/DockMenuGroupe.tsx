import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type FocusEvent,
  type KeyboardEvent,
  type MouseEvent,
  type RefObject,
} from "react";
import { useWorkspaceStore, type Group } from "../../store/workspace";
import { useUiStore } from "../../store/ui";
import { SIDEBAR_COLORS, nomCouleur } from "../../lib/palette";
import { couleurGroupe, teinteLisible } from "../../lib/couleurEspace";
import { placerAuDessus, selecteurAncre, type Placement } from "../../lib/ancrage";
import { pluriel } from "../../lib/pluriel";
import { IconeCrayon, IconeFermer, IconePlus } from "../ui/icons";

/**
 * Menu d'un groupe (clic droit sur son étiquette ou sa pile), dans le langage du menu
 * d'espace de la maquette Création : en-tête, actions, couleurs, suppression. Popover
 * ancré au-dessus du dock, pointe sous l'étiquette ; voile transparent qui le ferme au
 * clic, Échap au clavier. Le focus y reste tant qu'il est ouvert : un clic sur une zone
 * inerte du panneau ne le perd pas, et le quitter (Tab au-delà du dernier bouton, focus
 * pris ailleurs) ferme le menu, qui ne reste jamais ouvert sans répondre à Échap.
 *
 * Rendu HORS du dock par Dock.tsx : le `backdrop-filter` du dock ferait de lui le bloc
 * conteneur d'un `position: fixed`, et le menu serait placé par rapport au dock.
 */

const LARGEUR = 300;

/** Chevron replier / déplier (absent des icônes partagées). */
function IconeReplier({ replie }: { replie: boolean }) {
  return (
    <svg aria-hidden="true" width={14} height={14} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
      {replie ? <path d="M5 6.5L8 9.5l3-3" /> : <path d="M5 9.5L8 6.5l3 3" />}
    </svg>
  );
}

export interface DockMenuGroupeProps {
  groupe: Group;
  nbMembres: number;
  /** Replié tel qu'affiché (à la main ou faute de place). */
  replie: boolean;
  navRef: RefObject<HTMLElement | null>;
  onBasculer: () => void;
  /** `rendreFocus` : le menu se ferme sans ouvrir d'autre calque, le terminal reprend la main. */
  onFermer: (rendreFocus: boolean) => void;
}

export function DockMenuGroupe({ groupe, nbMembres, replie, navRef, onBasculer, onFermer }: DockMenuGroupeProps) {
  const panneauRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<Placement | null>(null);

  // Ancrage : centre de l'étiquette, au-dessus du haut du dock ; recalculé quand la
  // fenêtre ou le dock changent de taille (repli automatique, espace ajouté).
  useLayoutEffect(() => {
    const placer = () => {
      const ancre = document.querySelector<HTMLElement>(selecteurAncre({ type: "groupe", groupId: groupe.id }));
      const nav = navRef.current;
      if (!ancre || !nav) return;
      const a = ancre.getBoundingClientRect();
      const p = placerAuDessus(
        { centreX: a.left + a.width / 2, haut: nav.getBoundingClientRect().top },
        LARGEUR,
        { largeur: window.innerWidth, hauteur: window.innerHeight },
      );
      setPlace((q) => (q && q.left === p.left && q.bottom === p.bottom && q.pointe === p.pointe ? q : p));
    };
    placer();
    window.addEventListener("resize", placer);
    const ro = new ResizeObserver(placer);
    if (navRef.current) ro.observe(navRef.current);
    return () => {
      window.removeEventListener("resize", placer);
      ro.disconnect();
    };
  }, [groupe.id, navRef]);

  // Le menu prend le focus à l'ouverture (premier élément), une fois placé : tant qu'il
  // n'a pas de position il est en `visibility: hidden`, et le navigateur y refuse le focus
  // (il restait alors sur l'étiquette, hors de portée d'Échap).
  const estPlace = place !== null;
  const focalise = useRef(false);
  useEffect(() => {
    if (!estPlace || focalise.current) return;
    focalise.current = true;
    panneauRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [estPlace]);

  const s = useWorkspaceStore.getState;
  const ui = useUiStore.getState;
  const couleur = couleurGroupe(groupe);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onFermer(true);
      return;
    }
    // Flèches : d'une action à l'autre, comme dans un menu.
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      const items = [...(panneauRef.current?.querySelectorAll<HTMLElement>(".dock-mg-item") ?? [])];
      if (!items.length) return;
      e.preventDefault();
      const i = items.indexOf(document.activeElement as HTMLElement);
      const pas = e.key === "ArrowDown" ? 1 : -1;
      items[(i + pas + items.length) % items.length].focus();
    }
  };

  // Clic sur une zone inerte (en-tête, filet, intertitre) : le focus ne part pas au body,
  // où Échap n'atteindrait plus le panneau.
  const onMouseDown = (e: MouseEvent<HTMLDivElement>) => {
    if (!(e.target as HTMLElement).closest("button")) e.preventDefault();
  };

  // Focus parti hors du panneau vers un autre élément : le menu se ferme sans reprendre
  // le focus (il est déjà ailleurs). Sans `relatedTarget` (fenêtre quittée, élément
  // retiré), on ne fait rien : revenir dans l'app doit retrouver le menu tel quel.
  const onBlur = (e: FocusEvent<HTMLDivElement>) => {
    const vers = e.relatedTarget as Node | null;
    if (vers && !e.currentTarget.contains(vers)) onFermer(false);
  };

  return (
    <>
      <button type="button" className="dock-mg-voile" aria-label="Fermer le menu" tabIndex={-1} onClick={() => onFermer(true)} />
      <div
        ref={panneauRef}
        role="dialog"
        aria-label={`Actions du groupe ${groupe.name}`}
        className="dock-mg"
        tabIndex={-1}
        onKeyDown={onKeyDown}
        onMouseDown={onMouseDown}
        onBlur={onBlur}
        style={{
          width: LARGEUR,
          left: place?.left ?? 0,
          bottom: place?.bottom ?? 0,
          visibility: place ? undefined : "hidden",
          transformOrigin: `${place?.pointe ?? LARGEUR / 2}px 100%`,
        }}
      >
        <span className="dock-mg-pointe" aria-hidden="true" style={{ left: (place?.pointe ?? LARGEUR / 2) - 6 }} />
        <div className="dock-mg-tete">
          <span className="dock-carre" aria-hidden="true" style={{ width: 12, height: 12, borderRadius: 3, background: couleur }} />
          <div className="dock-mg-titres">
            <span className="dock-mg-nom">{groupe.name}</span>
            <span className="dock-mg-sous">{pluriel(nbMembres, "espace")}</span>
          </div>
        </div>

        <div className="dock-mg-bloc">
          <button
            type="button"
            className="pi dock-mg-item"
            onClick={() => {
              // Un groupe replié cacherait l'espace qu'on va y créer.
              if (groupe.collapsed) s().toggleGroupCollapsed(groupe.id);
              onFermer(false);
              ui().ouvrirPopoverEspace({ mode: "creer", groupId: groupe.id });
            }}
          >
            <IconePlus taille={14} className="dock-mg-icone" />
            <span className="dock-mg-libelle">Nouvel espace dans le groupe</span>
          </button>
          <button
            type="button"
            className="pi dock-mg-item"
            onClick={() => {
              onFermer(false);
              ui().ouvrirFormulaireGroupe({ mode: "modifier", groupId: groupe.id });
            }}
          >
            <IconeCrayon taille={14} className="dock-mg-icone" />
            <span className="dock-mg-libelle">Renommer…</span>
          </button>
          <button
            type="button"
            className="pi dock-mg-item"
            onClick={() => {
              onBasculer();
              onFermer(true);
            }}
          >
            <span className="dock-mg-icone">
              <IconeReplier replie={replie} />
            </span>
            <span className="dock-mg-libelle">{replie ? "Déplier le groupe" : "Replier le groupe"}</span>
          </button>
        </div>

        <div className="dock-mg-filet" />

        <div className="dock-mg-couleurs">
          <div className="dock-mg-entete">
            <span className="dock-intertitre">Couleur</span>
            <span className="dock-mg-valeur">{nomCouleur(groupe.color)}</span>
          </div>
          <div role="group" aria-label="Couleur du groupe" className="dock-mg-nuancier">
            {SIDEBAR_COLORS.map((c) => {
              const choisie = c.hex.toLowerCase() === groupe.color.toLowerCase();
              const nom = nomCouleur(c.hex);
              return (
                <button
                  key={c.hex}
                  type="button"
                  className="dock-mg-nuance"
                  aria-label={nom}
                  aria-pressed={choisie}
                  title={`${nom} · ${c.hex}`}
                  onClick={() => s().setGroupColor(groupe.id, c.hex)}
                  style={{
                    background: teinteLisible(c.hex) ?? c.hex,
                    boxShadow: `0 0 0 2px var(--fond-panneau), 0 0 0 3.5px ${choisie ? "var(--texte-fort)" : "transparent"}`,
                  }}
                />
              );
            })}
          </div>
        </div>

        <div className="dock-mg-filet" style={{ marginTop: 6 }} />

        <div className="dock-mg-bloc">
          <button
            type="button"
            className="pi dock-mg-item"
            data-danger="true"
            onClick={() => {
              // Supprimer le groupe ne ferme aucun terminal : ses espaces passent hors groupe.
              s().removeGroup(groupe.id);
              onFermer(true);
            }}
          >
            <IconeFermer taille={14} epaisseur={1.5} />
            <span className="dock-mg-libelle">Supprimer le groupe</span>
            <span className="dock-mg-indice">{nbMembres ? "garde ses espaces" : "vide"}</span>
          </button>
        </div>
      </div>
    </>
  );
}
