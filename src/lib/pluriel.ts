/**
 * Accord en nombre à la française, partagé par toutes les vues : 0 et 1 au singulier
 * (« 0 fichier », « 1 espace »), au-delà le pluriel (« 3 fichiers »). Le pluriel par
 * défaut ajoute un « s » ; les pluriels irréguliers se passent en troisième argument.
 */
export function pluriel(n: number, mot: string, plusieurs: string = `${mot}s`): string {
  return `${n} ${n > 1 ? plusieurs : mot}`;
}
