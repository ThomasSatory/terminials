/**
 * Séparation d'une synthèse « titre + puces » (prompt v3, cf.
 * `summaries.rs`) : la première ligne est le titre de la journée, le reste les
 * puces (une par projet, cf. `friseBilan.ts`). Fonction pure, tolérante aux
 * écarts du LLM : un `#` en tête est retiré, une réponse qui commence
 * directement par une liste n'a pas de titre, et les puces au-delà de
 * `maxItems` sont coupées — le prompt en demande cinq au plus, on en tolère six.
 */

const TITRE_MD_RE = /^#{1,3}\s+/;
const ITEM_RE = /^(?:[-*•]\s+|\d+[.)]\s+)/;

export interface SummarySplit {
  /** Titre court, sans markdown ; vide si la réponse n'en a pas. */
  title: string;
  /** Le reste, en markdown, puces limitées. */
  body: string;
}

/** Retire `**gras**`, `_italique_`, backticks et ponctuation finale d'un titre. */
function nettoyerTitre(ligne: string): string {
  return ligne
    .replace(TITRE_MD_RE, "")
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/[*_`]/g, "")
    .replace(/[.:;!]+$/, "")
    .trim();
}

/** Coupe une suite de lignes-items à `max` items, en gardant tout le reste. */
function limiterPuces(lignes: string[], max: number): string[] {
  const out: string[] = [];
  let items = 0;
  for (const l of lignes) {
    if (ITEM_RE.test(l.trim())) {
      items += 1;
      if (items > max) continue;
    }
    out.push(l);
  }
  return out;
}

export function splitTitle(text: string, maxItems = 6): SummarySplit {
  const lignes = text.replace(/\r\n?/g, "\n").split("\n");
  let i = 0;
  while (i < lignes.length && lignes[i].trim() === "") i += 1;
  if (i >= lignes.length) return { title: "", body: "" };

  const premiere = lignes[i].trim();
  if (ITEM_RE.test(premiere)) {
    return { title: "", body: limiterPuces(lignes.slice(i), maxItems).join("\n").trim() };
  }
  const title = nettoyerTitre(premiere);
  const reste = limiterPuces(lignes.slice(i + 1), maxItems).join("\n").trim();
  return { title, body: reste };
}
