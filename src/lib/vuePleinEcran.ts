/**
 * Vue plein écran affichée au-dessus du dock (une seule à la fois), par priorité :
 * le récap (global, ouvert par-dessus tout), le poste de suivi du superviseur (ouverture
 * explicite : il prime sur l'accueil et montre alors un état vide), les Paramètres
 * (atteignables même sans espace), l'accueil (aucun espace ouvert), les fichiers modifiés de l'espace actif,
 * puis la mosaïque. null = le terminal.
 *
 * Pendant la restauration du démarrage, ni accueil ni mosaïque : la liste d'espaces
 * n'est pas encore connue, l'accueil y flasherait une fraction de seconde.
 */
export type VuePleinEcran = "recap" | "superviseur" | "parametres" | "accueil" | "diff" | "mosaique" | null;

export interface EntreesVue {
  demarrage: boolean;
  nbEspaces: number;
  recapOuvert: boolean;
  /** Fichiers modifiés ouverts sur l'espace ACTIF. */
  diffOuvert: boolean;
  vue: "terminal" | "mosaique";
  /** Vue Paramètres ouverte (Ctrl+Maj+,). */
  parametresOuverts?: boolean;
  /** Poste de suivi du superviseur ouvert (Ctrl+Maj+Espace). */
  superviseurOuvert?: boolean;
}

export function vuePleinEcran(e: EntreesVue): VuePleinEcran {
  if (e.recapOuvert) return "recap";
  if (e.demarrage) return null;
  if (e.superviseurOuvert) return "superviseur";
  if (e.parametresOuverts) return "parametres";
  if (e.nbEspaces === 0) return "accueil";
  if (e.diffOuvert) return "diff";
  if (e.vue === "mosaique") return "mosaique";
  return null;
}
