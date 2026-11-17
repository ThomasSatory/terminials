/**
 * Variante « retour » de la barre du haut (maquette Mosaique) : quand on vient d'ouvrir un
 * terminal depuis la mosaïque (tuile, « Aller », Échap), la barre commence par un bouton
 * « Mosaïque » marqué Échap, et Échap y ramène.
 *
 * Choix, d'après la maquette : elle n'écoute aucune touche — sa puce « Échap » décrit le
 * coup d'œil qu'on jette à un terminal depuis la mosaïque, avant d'y travailler. On la suit
 * à la lettre sans voler Échap au shell : le retour n'est ARMÉ que pour l'espace ouvert
 * depuis la mosaïque, et seulement jusqu'à la première vraie saisie envoyée à son terminal
 * (frappe, collage), un changement d'onglet ou d'espace, ou une autre vue. Désarmé, la barre
 * reprend sa forme ordinaire et Échap repart à l'agent (interrompre Claude Code, quitter un
 * mode de vim…), comme partout ailleurs. C'est la couche clavier du terminal qui consulte
 * ce drapeau (TerminalPane) ; la barre du haut ne relaie Échap que si le focus n'est pas
 * dans le terminal (TopBar), tant que le retour est armé.
 */

/** Ce qu'il faut de l'état d'interface pour décider. */
export interface EtatRetour {
  /** Espace ouvert depuis la mosaïque, tant que le retour est armé. */
  retourMosaique: string | null;
  vue: "terminal" | "mosaique";
  paletteOuverte: boolean;
}

/** La variante « retour » s'affiche (et Échap ramène à la mosaïque) pour cet espace. */
export function retourArme(
  ui: EtatRetour,
  wsId: string | null,
  vues: { recapOuvert: boolean; diffOuvert: boolean },
): boolean {
  return (
    wsId !== null &&
    ui.retourMosaique === wsId &&
    ui.vue === "terminal" &&
    !ui.paletteOuverte &&
    !vues.recapOuvert &&
    !vues.diffOuvert
  );
}

/** Échap seul (sans modificateur), à l'enfoncement. */
export function estEchapSeul(e: {
  type: string;
  key: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  metaKey: boolean;
}): boolean {
  return e.type === "keydown" && e.key === "Escape" && !e.ctrlKey && !e.shiftKey && !e.altKey && !e.metaKey;
}

/**
 * Données envoyées au PTY qui viennent de l'utilisateur. Le terminal émet aussi de
 * lui-même les rapports de focus (`ESC [ I` / `ESC [ O`, que Claude Code demande) et de
 * souris : ils ne désarment pas le retour, sinon la simple arrivée sur le terminal le
 * ferait.
 */
export function saisieReelle(data: string): boolean {
  if (data === "\x1b[I" || data === "\x1b[O") return false;
  if (data.startsWith("\x1b[M") || data.startsWith("\x1b[<")) return false;
  return data.length > 0;
}
