/**
 * Décalage horizontal d'une infobulle centrée sur son hôte pour qu'elle reste entière dans
 * la zone visible d'un conteneur qui la rogne (bande du dock qui défile, fenêtre étroite :
 * la bande est en `overflow-x: auto` et ses bords s'estompent sur `marge` px).
 *
 * `bulle` : position et largeur de l'infobulle SANS décalage ; `zone` : bords visibles du
 * conteneur. Renvoie le décalage en px (0 si elle tient déjà). Trop large pour la zone :
 * collée au bord gauche, où commence la lecture.
 */
export function decalageInfobulle(
  bulle: { gauche: number; largeur: number },
  zone: { gauche: number; droite: number },
  marge = 0,
): number {
  const min = zone.gauche + marge;
  const max = zone.droite - marge;
  if (bulle.largeur >= max - min) return Math.round(min - bulle.gauche);
  if (bulle.gauche < min) return Math.round(min - bulle.gauche);
  if (bulle.gauche + bulle.largeur > max) return Math.round(max - (bulle.gauche + bulle.largeur));
  return 0;
}
