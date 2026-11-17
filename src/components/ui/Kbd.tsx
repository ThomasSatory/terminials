import type { ReactNode } from "react";
import "../../styles/ui.css";

/**
 * Raccourci clavier affiché (jamais câblé ici) : JetBrains Mono 10.5 px, discret.
 * - `nu` : texte seul (lignes de palette, infobulles) ;
 * - `puce` : petite pastille grise (boutons de la barre du haut) ;
 * - `sur-accent` : posé sur un bouton plein accent (« Aller »).
 * Écrire les touches comme l'app les nomme : « Ctrl+Maj+N », « Ctrl K », « Échap ».
 */
export function Kbd({
  children,
  variante = "nu",
}: {
  children: ReactNode;
  variante?: "nu" | "puce" | "sur-accent";
}) {
  return (
    <kbd className="ui-kbd" data-variante={variante}>
      {children}
    </kbd>
  );
}
