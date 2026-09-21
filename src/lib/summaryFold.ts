/**
 * Découpe d'un texte de synthèse en une tête courte et un reste repliable.
 *
 * Le dashboard affiche la tête, et ne déplie le reste que sur demande : un
 * bilan de LLM fait facilement une douzaine de lignes, alors qu'on y cherche
 * d'abord le premier coup d'œil.
 *
 * Fonction pure, sans rendu : `head` et `rest` sont du markdown, rendus tels
 * quels par le composant `Markdown`.
 */

const TITRE_RE = /^#{1,3}\s+/;
const ITEM_RE = /^(?:[-*]\s+|\d+\.\s+)/;

/** Un bloc de markdown : des lignes non vides consécutives. */
function blocs(texte: string): string[] {
  return texte
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b !== "");
}

/** Vrai si toutes les lignes du bloc sont des items de liste. */
function estListe(bloc: string): boolean {
  const lignes = bloc.split("\n");
  return lignes.length > 0 && lignes.every((l) => ITEM_RE.test(l.trim()));
}

/**
 * Sépare `texte` en `head` (ce qui reste visible replié) et `rest` (le reste).
 *
 * La tête est le premier bloc — ou les deux premiers quand le premier n'est
 * qu'un titre, qui à lui seul n'apprendrait rien. Une liste de plus de
 * `maxItems` items est coupée à `maxItems`, les items suivants passant en tête
 * du reste. `rest` vaut `""` quand il n'y a rien à déplier.
 */
export function splitSummary(texte: string, maxItems = 3): { head: string; rest: string } {
  const bs = blocs(texte);
  if (bs.length === 0) return { head: "", rest: "" };

  // Un titre seul ne dit rien : il emmène le bloc suivant avec lui.
  const visibles = TITRE_RE.test(bs[0]) && bs.length > 1 ? 2 : 1;
  const tete = bs.slice(0, visibles);
  const suite = bs.slice(visibles);

  const dernier = tete[tete.length - 1];
  if (estListe(dernier)) {
    const items = dernier.split("\n");
    if (items.length > maxItems) {
      tete[tete.length - 1] = items.slice(0, maxItems).join("\n");
      suite.unshift(items.slice(maxItems).join("\n"));
    }
  }

  return { head: tete.join("\n\n"), rest: suite.join("\n\n") };
}
