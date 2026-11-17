/** Proportions de l'avatar d'un espace (ui/Avatar), du dock (40 px) aux listes (22 px). */

/** Corps du monogramme selon le diamètre : 12 px à 40, 10 px à 26, 9.5 px à 22. */
export function taillePoliceAvatar(taille: number): number {
  return Math.max(9.5, Math.round((6.8 + taille * 0.13) * 2) / 2);
}

/** Pastille « vous attend » : 11 px sur l'avatar de 40, proportionnelle en dessous,
    jamais sous 8 px. */
export function taillePastilleAvatar(taille: number): number {
  return Math.max(8, Math.round(taille * 0.275));
}
