import { useState } from "react";
import { Markdown } from "./Markdown";
import { splitSummary } from "../../lib/summaryFold";

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

/**
 * Texte de synthèse replié : seule la tête est visible, le reste se déplie sur
 * demande (cf. `splitSummary`). Quand il n'y a rien à replier, le bouton
 * n'apparaît pas — un bilan d'une phrase ne doit pas se lire en deux gestes.
 *
 * Replié à chaque montage : l'overlay se rouvre sur le même premier coup d'œil.
 */
export function FoldedMarkdown({
  text,
  onOpenLink,
  className,
}: {
  text: string;
  onOpenLink: (href: string) => void;
  className: string;
}) {
  const [open, setOpen] = useState(false);
  const { head, rest } = splitSummary(text);
  return (
    <>
      <div className={className}>
        <Markdown text={open && rest ? `${head}\n\n${rest}` : head} onOpenLink={onOpenLink} />
      </div>
      {rest !== "" && <FoldButton open={open} reste={null} onToggle={() => setOpen(!open)} />}
    </>
  );
}
