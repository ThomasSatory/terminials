import { createContext, useContext, type ReactNode } from "react";
import type { RangeeParametre } from "../../lib/parametresModele";
import { Coche } from "./controles";

/**
 * Contexte de la vue Paramètres : la confirmation discrète « Enregistré » (une rangée à
 * la fois, qui s'efface seule) et la surbrillance des rangées où l'on arrive depuis la
 * palette ou la recherche.
 */

export interface RetourEnregistre {
  id: string;
  texte: string;
  /** Vrai pendant le fondu de sortie. */
  sortie: boolean;
  /** Change à chaque signalement : rejoue l'apparition. */
  cle: number;
}

export interface ValeurParametres {
  retour: RetourEnregistre | null;
  flash: { ids: ReadonlySet<string>; cle: number };
  /** « ✓ <texte> » à côté de la rangée `id`, et annonce au lecteur d'écran. */
  signaler: (id: string, texte?: string) => void;
}

export const ContexteParametres = createContext<ValeurParametres>({
  retour: null,
  flash: { ids: new Set(), cle: 0 },
  signaler: () => {},
});

export const useParametres = () => useContext(ContexteParametres);

/**
 * Une rangée de réglage : libellé, confirmation, explication, contrôle à droite, et
 * éventuellement un contenu large dessous (aperçu, zone de texte, hooks, autonomie,
 * paires). `data-rangee` porte l'id : la vue y fait défiler la surbrillance.
 */
export function Rangee({
  rangee,
  desc = rangee.desc,
  controle,
  large,
}: {
  rangee: RangeeParametre;
  desc?: string;
  controle?: ReactNode;
  large?: ReactNode;
}) {
  const { retour, flash } = useParametres();
  const enregistre = retour?.id === rangee.id ? retour : null;
  return (
    <div className="par-rangee" data-rangee={rangee.id} data-touches={rangee.combos ? "" : undefined}>
      {flash.ids.has(rangee.id) && <span key={flash.cle} className="par-flash" aria-hidden="true" />}
      <div className="par-rangee-texte">
        <div className="par-rangee-tete">
          <span className="par-libelle">{rangee.libelle}</span>
          {enregistre && (
            <span key={enregistre.cle} className="par-enregistre" data-sortie={enregistre.sortie || undefined} aria-hidden="true">
              <Coche taille={11} epaisseur={2} />
              {enregistre.texte}
            </span>
          )}
        </div>
        {desc && <div className="par-desc">{desc}</div>}
      </div>
      {controle !== undefined && <div className="par-controle">{controle}</div>}
      {large !== undefined && <div className="par-large">{large}</div>}
    </div>
  );
}
