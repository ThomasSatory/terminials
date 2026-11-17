/**
 * Monogramme d'un espace : ses deux premiers caractères alphanumériques, en minuscules
 * (« site-vitrine » → « si », « api-paiements » → « ap »). Les lettres accentuées
 * comptent (« écrits » → « éc ») ; un nom sans aucune lettre ni chiffre (« ~ », l'espace
 * ouvert sur le dossier personnel) donne « ·· » plutôt qu'un avatar vide.
 */
export function monogramme(nom: string): string {
  // Array.from découpe par point de code : une lettre hors BMP n'est jamais coupée en deux.
  const lettres = Array.from(nom.replace(/[^\p{L}\p{N}]/gu, ""));
  return lettres.length ? lettres.slice(0, 2).join("").toLowerCase() : "··";
}
