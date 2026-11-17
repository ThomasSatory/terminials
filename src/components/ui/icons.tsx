import type { ReactNode, SVGProps } from "react";

/**
 * Icônes au trait des maquettes (grille 16 × 16, `currentColor`) : elles prennent la
 * couleur du bouton qui les porte et suivent son survol. Toujours décoratives
 * (`aria-hidden`) : le libellé est sur le bouton (aria-label), jamais sur l'icône.
 *
 * `taille` règle largeur et hauteur (16 par défaut) ; `epaisseur` le trait, que les
 * maquettes font varier de 1.4 à 1.9 selon la taille et le contexte.
 */
export interface IconeProps extends Omit<SVGProps<SVGSVGElement>, "ref"> {
  taille?: number;
  epaisseur?: number;
}

function Icone({
  taille = 16,
  epaisseur = 1.5,
  children,
  ...reste
}: IconeProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      width={taille}
      height={taille}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={epaisseur}
      strokeLinecap="round"
      strokeLinejoin="round"
      focusable="false"
      {...reste}
    >
      {children}
    </svg>
  );
}

/** « + » : nouvel espace, nouvel onglet. */
export const IconePlus = (p: IconeProps) => (
  <Icone {...p}>
    <path d="M8 3v10M3 8h10" />
  </Icone>
);

/** Barres : activité de la journée (récap). */
export const IconeActivite = (p: IconeProps) => (
  <Icone {...p}>
    <path d="M3 13V9M6.5 13V4M10 13V7M13.5 13V10" />
  </Icone>
);

/** Loupe : palette de commandes, recherche. */
export const IconeRecherche = (p: IconeProps) => (
  <Icone {...p}>
    <circle cx="7" cy="7" r="4.2" />
    <path d="M10.2 10.2L13.5 13.5" />
  </Icone>
);

/** Croix : fermer (trait 1.6 dans les maquettes). */
export const IconeFermer = ({ epaisseur = 1.6, ...p }: IconeProps) => (
  <Icone epaisseur={epaisseur} {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icone>
);

/** Quatre tuiles : mosaïque des agents. */
export const IconeMosaique = (p: IconeProps) => (
  <Icone {...p}>
    <rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="2.5" width="4.5" height="4.5" rx="1" />
    <rect x="2.5" y="9" width="4.5" height="4.5" rx="1" />
    <rect x="9" y="9" width="4.5" height="4.5" rx="1" />
  </Icone>
);

/** Dossier : ouvrir un dossier, chemin d'un espace. */
export const IconeDossier = (p: IconeProps) => (
  <Icone {...p}>
    <path d="M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v5.5a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z" />
  </Icone>
);

/** Coche : validé, copié. */
export const IconeCoche = ({ epaisseur = 1.8, ...p }: IconeProps) => (
  <Icone epaisseur={epaisseur} {...p}>
    <path d="M3.5 8.5l3 3 6-7" />
  </Icone>
);

/** Flèche vers la droite : aller à, ouvrir. */
export const IconeFleche = ({ epaisseur = 1.8, ...p }: IconeProps) => (
  <Icone epaisseur={epaisseur} {...p}>
    <path d="M3.5 8h9M9 4.5L12.5 8 9 11.5" />
  </Icone>
);

/** Chevron droit (rotation au déplié : 90°). */
export const IconeChevronDroit = ({ epaisseur = 1.6, ...p }: IconeProps) => (
  <Icone epaisseur={epaisseur} {...p}>
    <path d="M6 3.5L10.5 8 6 12.5" />
  </Icone>
);

/** Chevron gauche : jour précédent, retour. */
export const IconeChevronGauche = ({ epaisseur = 1.6, ...p }: IconeProps) => (
  <Icone epaisseur={epaisseur} {...p}>
    <path d="M10 3.5L5.5 8l4.5 4.5" />
  </Icone>
);

/** Flèche circulaire : rafraîchir, régénérer. */
export const IconeRafraichir = ({ epaisseur = 1.6, ...p }: IconeProps) => (
  <Icone epaisseur={epaisseur} {...p}>
    <path d="M13 8a5 5 0 1 1-1.6-3.7" />
    <path d="M13 2.5v3h-3" />
  </Icone>
);

/** Deux feuilles : copier, dupliquer. */
export const IconeCopier = (p: IconeProps) => (
  <Icone {...p}>
    <rect x="5.5" y="5.5" width="7" height="7" rx="1.5" />
    <path d="M3.5 10V4.5a1 1 0 0 1 1-1H10" />
  </Icone>
);

/** Crayon : modifier, renommer. */
export const IconeCrayon = (p: IconeProps) => (
  <Icone {...p}>
    <path d="M10.5 3.5l2 2L6 12H4v-2z" />
  </Icone>
);

/** Invite de commande : onglet terminal, lancer une commande. */
export const IconeTerminal = (p: IconeProps) => (
  <Icone {...p}>
    <path d="M3 4.5l3 3-3 3M8 11.5h5" />
  </Icone>
);

/** Branche git. */
export const IconeBranche = (p: IconeProps) => (
  <Icone {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-6.2 4.4" />
  </Icone>
);

/** Branche barrée : dossier hors dépôt git. */
export const IconeHorsDepot = (p: IconeProps) => (
  <Icone {...p}>
    <circle cx="4.5" cy="3.5" r="1.5" />
    <circle cx="4.5" cy="12.5" r="1.5" />
    <circle cx="11.5" cy="5.5" r="1.5" />
    <path d="M4.5 5v6M11.5 7c0 2.5-3 2.5-6.2 4.4" />
    <path d="M2 14L14 2" />
  </Icone>
);

/** Calendrier : réunions, jour. */
export const IconeCalendrier = (p: IconeProps) => (
  <Icone {...p}>
    <rect x="2.5" y="3.5" width="11" height="10" rx="2" />
    <path d="M2.5 7h11M5.5 2v3M10.5 2v3" />
  </Icone>
);

/** Cercle barré : rien à afficher, interdit. */
export const IconeInterdit = (p: IconeProps) => (
  <Icone {...p}>
    <circle cx="8" cy="8" r="4.5" />
    <path d="M4.8 11.2l6.4-6.4" />
  </Icone>
);
