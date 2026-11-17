/** Nom par défaut d'un onglet sans titre : « Terminal N ». N est le rang de création de
    l'onglet (`Tab.numero`) et non sa position : il le suit quand on le déplace. Sans
    numéro (onglet construit à la main), la position en tient lieu. */
export function titreParDefaut(tab: { numero?: number }, index: number): string {
  return `Terminal ${tab.numero ?? index + 1}`;
}
