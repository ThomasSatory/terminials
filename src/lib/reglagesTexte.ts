/**
 * Champs texte de la vue Paramètres (parametres/RangeesActivite) : listes saisies
 * en une ligne ou une par ligne, heures décimales. Purs, testés sans rendu.
 */

/** Liste → texte du champ, avec son séparateur (« , » ou retour à la ligne). */
export function listToText(items: string[], sep: string): string {
  return items.join(sep);
}

/** Texte du champ → liste : éléments rognés, vides écartés. */
export function textToList(text: string, sep: RegExp): string[] {
  return text
    .split(sep)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

/** « 7.5 » (heures, champ numérique) → 450 minutes, au quart d'heure ; vide ou invalide → 0. */
export function heuresEnMinutes(texte: string): number {
  const h = Number(texte.replace(",", "."));
  return Number.isFinite(h) && h > 0 ? Math.round((h * 60) / 15) * 15 : 0;
}
