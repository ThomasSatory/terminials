/**
 * Libellé du bouton de dépliage. `reste` est le nombre d'éléments cachés, ou
 * `null` quand on ne les compte pas (un texte). Pur, testé sans rendu.
 */
export function foldLabel(open: boolean, reste: number | null): string {
  if (open) return "Replier";
  if (reste === null) return "Déplier";
  return reste === 1 ? "+ 1 autre" : `+ ${reste} autres`;
}

/**
 * Bouton de dépliage d'une section du dashboard : un chevron et un libellé,
 * discret, sur la même ligne de base que le contenu qu'il prolonge.
 */
export function FoldButton({
  open,
  reste,
  onToggle,
}: {
  open: boolean;
  reste: number | null;
  onToggle: () => void;
}) {
  return (
    <button type="button" className="dash-fold" aria-expanded={open} onClick={onToggle}>
      <span aria-hidden="true">{open ? "▾" : "▸"}</span>
      {foldLabel(open, reste)}
    </button>
  );
}
