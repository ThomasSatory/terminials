import type { CSSProperties } from "react";
import { etatVisuelAvatar, type EtatAgent } from "../../lib/etatAgent";
import { taillePastilleAvatar, taillePoliceAvatar } from "../../lib/avatar";
import "../../styles/ui.css";

/**
 * Avatar rond d'un espace : monogramme en JetBrains Mono sur la couleur de l'espace à
 * 18 (repos) ou 38 (actif, avec un liseré plein), arc cyan qui tourne quand un agent
 * travaille, pastille accent + halo et petit saut quand un agent vous attend.
 *
 * Purement visuel (aucun store) : l'appelant fournit couleur (`couleurEspace`),
 * monogramme (`monogramme`) et état (`useEtatEspace`). Décoratif pour les lecteurs
 * d'écran : le nom de l'espace va sur le bouton qui le porte.
 */
export interface AvatarProps {
  /** Deux lettres (lib/monogram). */
  monogramme: string;
  /** Hex #rrggbb d'affichage (lib/couleurEspace) : un canal alpha y est accolé. */
  couleur: string;
  etat?: EtatAgent;
  /** Espace actif : fond plus dense et liseré de sa couleur. */
  actif?: boolean;
  /** Diamètre en px (40 dans le dock). */
  taille?: number;
  /** Saut « vous attend » (dock) ; à couper là où l'avatar ne doit pas bouger. */
  sautille?: boolean;
  /** L'agent attend la réponse à une question posée à une autre session (superviseur) :
      anneau pointillé qui tourne lentement, sauf si l'arc « au travail » est déjà là. */
  relais?: boolean;
  /** Classe ajoutée au disque (ex. survol du dock qui le grossit). */
  className?: string;
  style?: CSSProperties;
}

export function Avatar({
  monogramme,
  couleur,
  etat = "repos",
  actif = false,
  taille = 40,
  sautille = true,
  relais = false,
  className,
  style,
}: AvatarProps) {
  // « terminé » se dessine comme le repos (la coche verte est réservée à la mosaïque).
  const visuel = etatVisuelAvatar(etat);
  const pastille = taillePastilleAvatar(taille);
  return (
    <span className="ui-avatar-saut" data-sautille={visuel === "attente" && sautille} aria-hidden="true">
      <span
        className={className ? `ui-avatar ${className}` : "ui-avatar"}
        data-etat={visuel}
        style={{
          width: taille,
          height: taille,
          fontSize: taillePoliceAvatar(taille),
          background: couleur + (actif ? "38" : "18"),
          color: couleur,
          boxShadow: `inset 0 0 0 1.5px ${actif ? couleur : "transparent"}`,
          ...style,
        }}
      >
        {monogramme}
        {visuel === "travail" && (
          <span
            className="ui-avatar-arc"
            style={{ "--avatar-arc-ecart": `${taille >= 32 ? 4 : 3}px` } as CSSProperties}
          />
        )}
        {relais && visuel !== "travail" && (
          <span
            className="ui-avatar-relais"
            style={{ "--avatar-arc-ecart": `${taille >= 32 ? 4 : 3}px` } as CSSProperties}
          />
        )}
        {visuel === "attente" && <span className="ui-avatar-pastille" style={{ width: pastille, height: pastille }} />}
      </span>
    </span>
  );
}
