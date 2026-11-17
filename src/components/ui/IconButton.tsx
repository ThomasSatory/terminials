import type { ComponentProps, ReactNode } from "react";
import "../../styles/ui.css";

/**
 * Bouton à icône seule : vrai <button>, aria-label obligatoire (c'est son seul nom
 * accessible), fond discret au survol et quand il est enfoncé ou déplié (aria-pressed,
 * aria-expanded). Rond de 40 px dans le dock, carré arrondi de 28 px dans les barres.
 * Les autres props (onClick, data-*, aria-*, ref) passent telles quelles au bouton.
 */
export interface IconButtonProps extends Omit<ComponentProps<"button">, "aria-label" | "children"> {
  label: string;
  children: ReactNode;
  /** Côté en px. */
  taille?: number;
  forme?: "rond" | "carre";
}

export function IconButton({
  label,
  children,
  taille = 40,
  forme = "rond",
  type = "button",
  className,
  style,
  ...reste
}: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      className={className ? `ui-icone-btn ${className}` : "ui-icone-btn"}
      data-forme={forme}
      style={{ width: taille, height: taille, ...style }}
      {...reste}
    >
      {children}
    </button>
  );
}
