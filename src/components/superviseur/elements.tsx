import type { CSSProperties, ReactNode } from "react";
import type { ModeSuperviseur } from "../../store/superviseur";

/**
 * Éléments visuels du superviseur (maquette Superviseur) : viseur au trait dont le centre
 * dit le mode, viseur pointé (le superviseur comme interlocuteur), mini-avatars d'espace,
 * icônes au trait propres au poste de suivi. Toutes les icônes sont décoratives (`aria-hidden`) :
 * le libellé est porté par le bouton.
 */

/** Valeur de `useUiStore.bulleEspace` tant que la bulle du superviseur est posée : la
    coquille réserve alors la marge basse de la zone terminal, comme pour une bulle
    d'agent, et l'infobulle de la marque se tait. */
export const CLE_BULLE_SUPERVISEUR = "superviseur";

/** Les quatre coins du viseur (grille 20 × 20). */
const COINS = "M3 7.5V5a2 2 0 0 1 2-2h2.5M12.5 3H15a2 2 0 0 1 2 2v2.5M17 12.5V15a2 2 0 0 1-2 2h-2.5M7.5 17H5a2 2 0 0 1-2-2v-2.5";

/**
 * Viseur dont le centre dit le mode : point (observe), point plus gros (a quelque chose à
 * dire), deux barres (en pause). Quand il agit, ce sont les coins qui bougent : le carré
 * pivote en losange en se contractant puis reprend sa forme (« diaphragme »), autour d'un
 * point qui respire. Coins et point sont dans le même SVG, centrés en (10, 10) : un élément
 * HTML posé au centre tombait sur un demi-pixel et tournait décentré. `taille` : « dock »
 * (22 px, marque) ou « tete » (18 px, en-tête du poste de suivi). Le centre rejoue son
 * apparition (`sup-mk`) à chaque changement de mode.
 */
export function Viseur({ mode, taille }: { mode: ModeSuperviseur; taille: "dock" | "tete" }) {
  const px = taille === "dock" ? 22 : 18;
  return (
    <span className="sup-viseur" data-taille={taille} aria-hidden="true">
      <svg width={px} height={px} viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth={taille === "dock" ? 1.5 : 1.6} strokeLinecap="round">
        {mode === "agit" ? (
          <>
            <path className="sup-viseur-diaph" d={COINS} />
            <circle className="sup-viseur-diaph-point" cx="10" cy="10" r="2.3" fill="currentColor" stroke="none" />
          </>
        ) : (
          <path d={COINS} />
        )}
      </svg>
      {mode !== "agit" && (
        <span className="sup-viseur-centre">
          <span key={mode} className="sup-mk" data-mode={mode}>
            {mode === "pause" ? (
              <>
                <span className="sup-viseur-barre" />
                <span className="sup-viseur-barre" />
              </>
            ) : (
              <span className="sup-viseur-point" />
            )}
          </span>
        </span>
      )}
    </span>
  );
}

/** Le superviseur comme interlocuteur (route d'une carte, échanges autorisés, fil). */
export function ViseurPoint({
  taille = 14,
  couleur = "var(--texte)",
  epaisseur = 1.8,
  rayonPoint = 1.8,
}: {
  taille?: number;
  couleur?: string;
  epaisseur?: number;
  /** Le signe d'entrée du fil a un point un peu plus fin (1.6) que les autres emplois. */
  rayonPoint?: number;
}) {
  return (
    <svg aria-hidden="true" width={taille} height={taille} viewBox="0 0 20 20" fill="none" stroke={couleur} strokeWidth={epaisseur} strokeLinecap="round" style={{ flexShrink: 0 }}>
      <path d={COINS} />
      <circle cx="10" cy="10" r={rayonPoint} fill={couleur} stroke="none" />
    </svg>
  );
}

/**
 * Corps du monogramme par taille d'avatar, relevé dans la maquette : il n'est pas
 * proportionnel (le 28 px de la route d'une carte reste à 10,5 px), d'où une table plutôt
 * qu'un coefficient.
 */
const CORPS_MONOGRAMME: Readonly<Record<number, number>> = { 16: 7.5, 18: 8, 20: 8.5, 22: 9, 28: 10.5 };

/**
 * Mini-avatar d'espace (rond, monogramme JetBrains Mono, fond couleur + 24) : bouton qui
 * mène à l'espace quand `onClick` est donné, simple pastille sinon.
 */
export function MiniAvatar({
  mono,
  couleur,
  taille,
  fond = "24",
  label,
  onClick,
  className,
}: {
  mono: string;
  couleur: string;
  taille: number;
  /** Opacité hexadécimale du fond (24 dans le fil, 38 sur la route d'une carte). */
  fond?: string;
  label?: string;
  onClick?: () => void;
  className?: string;
}) {
  const style: CSSProperties = {
    width: taille,
    height: taille,
    background: `${couleur}${fond}`,
    color: couleur,
    fontSize: CORPS_MONOGRAMME[taille] ?? Math.round(taille * 0.4 * 2) / 2,
  };
  if (onClick) {
    return (
      <button type="button" className={`sup-mini sup-mini-btn ${className ?? ""}`} style={style} aria-label={label} title={label} onClick={onClick}>
        {mono}
      </button>
    );
  }
  return (
    <span className={`sup-mini ${className ?? ""}`} style={style} aria-hidden="true">
      {mono}
    </span>
  );
}

function Trait({ taille, epaisseur = 1.5, vue = 16, children, style }: { taille: number; epaisseur?: number; vue?: number; children: ReactNode; style?: CSSProperties }) {
  return (
    <svg aria-hidden="true" width={taille} height={taille} viewBox={`0 0 ${vue} ${vue}`} fill="none" stroke="currentColor" strokeWidth={epaisseur} strokeLinecap="round" strokeLinejoin="round" style={style}>
      {children}
    </svg>
  );
}

/** Curseurs : réglage des échanges toujours autorisés. */
export const IconeCurseurs = () => (
  <Trait taille={15}>
    <path d="M2.5 4.5h4M9.5 4.5h4M2.5 11.5h7M12.5 11.5h1" />
    <circle cx="8" cy="4.5" r="1.5" />
    <circle cx="11" cy="11.5" r="1.5" />
  </Trait>
);

/** Bouclier : ce que le niveau d'autonomie permet. */
export const IconeBouclier = () => (
  <Trait taille={12} style={{ flexShrink: 0, marginTop: 2 }}>
    <path d="M8 1.8l5 2v4c0 3-2.2 5.2-5 6.4-2.8-1.2-5-3.4-5-6.4v-4z" />
  </Trait>
);

/** Flèche de route (expéditeur → destinataire), grille 14 × 10. */
export const IconeRoute = () => (
  <svg aria-hidden="true" width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M1 5h11M8.5 1.5L12 5 8.5 8.5" />
  </svg>
);

/** Double flèche : paire autorisée dans les deux sens. */
export const IconeEchange = () => (
  <svg aria-hidden="true" width="14" height="10" viewBox="0 0 14 10" fill="none" stroke="var(--texte-discret)" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}>
    <path d="M4 1.5L1 5l3 3.5M10 1.5L13 5l-3 3.5M1.5 5h11" />
  </svg>
);

export const IconeCoche = ({ taille = 12, couleur = "currentColor", epaisseur = 1.9 }: { taille?: number; couleur?: string; epaisseur?: number }) => (
  <svg aria-hidden="true" width={taille} height={taille} viewBox="0 0 16 16" fill="none" stroke={couleur} strokeWidth={epaisseur} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3.5 8.5l3 3 6-7" />
  </svg>
);

export const IconeCroix = ({ taille = 12 }: { taille?: number }) => (
  <Trait taille={taille} epaisseur={1.6}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Trait>
);

export const IconePlume = () => (
  <svg className="sup-plume" aria-hidden="true" width="11" height="11" viewBox="0 0 16 16" fill="none" stroke="var(--texte-discret)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M10.5 2.5l3 3L6 13H3v-3z" />
  </svg>
);

export const IconeMonter = () => (
  <Trait taille={12} epaisseur={1.6}>
    <path d="M4 10l4-4 4 4" />
  </Trait>
);

export const IconeEnvoyer = () => (
  <Trait taille={14} epaisseur={1.8}>
    <path d="M8 13V3.5M4 7l4-4 4 4" />
  </Trait>
);
