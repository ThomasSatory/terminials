import { pluriel } from "./pluriel";

/**
 * Textes de la barre du haut de l'espace actif (TopBar). Purs : la barre leur passe ce
 * que les sondes ont posé dans le store (branche, dirty, ports, nombre de fichiers).
 */

/** Ligne git/ports de l'espace, comme la maquette : `branche •` (point = modifications
    non commitées), ports en suffixe ; « hors dépôt » sans branche, une fois la sonde git
    passée (`gitConnu`) — avant, rien : un dépôt n'affiche pas « hors dépôt » le temps de
    son ouverture. */
export function ligneBranche(
  branche: string | undefined,
  modifie: boolean | undefined,
  ports: number[],
  gitConnu = true,
): string {
  if (!branche && !gitConnu) return ports.length > 0 ? `:${ports.join(",")}` : "";
  const base = branche ? (modifie ? `${branche} •` : branche) : "hors dépôt";
  return ports.length > 0 ? `${base} · :${ports.join(",")}` : base;
}

/** Texte visible du bouton ± : le nombre de fichiers s'il est connu, sinon « modifiés ». */
export function texteBoutonDiff(nbFichiers: number | null): string {
  return nbFichiers === null ? "modifiés" : pluriel(nbFichiers, "fichier");
}

/** Nom accessible du bouton ± (« 3 fichiers modifiés », « 1 fichier modifié »). */
export function libelleBoutonDiff(nbFichiers: number | null): string {
  if (nbFichiers === null) return "Fichiers modifiés";
  return `${pluriel(nbFichiers, "fichier")} ${nbFichiers > 1 ? "modifiés" : "modifié"}`;
}
