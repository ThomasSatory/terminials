import { useState } from "react";
import { useWorkspaceStore, type Group } from "../../store/workspace";
import { useUiStore, type FormulaireGroupe } from "../../store/ui";
import { defaultGroupColor, libelleCouleur } from "../../lib/palette";
import { teinteLisible } from "../../lib/couleurEspace";
import { monogramme } from "../../lib/monogram";
import {
  Calque,
  EnteteCalque,
  EtiquetteChamp,
  Nuancier,
  PiedCalque,
  useAutreCalque,
  useNumeroOuverture,
  useSortieAnimee,
} from "./SpacePopover";
import "../../styles/creation.css";

/**
 * Formulaire de groupe ancré au dock : création (`{ mode: "creer" }`, ancré au « + »
 * [data-dock-add]) ou modification (`{ mode: "modifier", groupId }`, ancré à l'étiquette
 * [data-dock-group]). Nom et couleur, dans le langage du popover d'espace. Lit et ferme
 * `useUiStore.formulaireGroupe`. Toujours monté par App ; rend null quand fermé.
 */

const LARGEUR_GROUPE = 352;

export function GroupPopover() {
  const formulaire = useUiStore((s) => s.formulaireGroupe);
  const autre = useAutreCalque("groupe");
  // Rouvert pendant sa sortie, le formulaire repart vierge (voir useNumeroOuverture).
  const numero = useNumeroOuverture(formulaire !== null);
  const { affiche, sortie } = useSortieAnimee<FormulaireGroupe>(formulaire, autre);
  if (!affiche) return null;
  return affiche.mode === "creer" ? (
    <FormulaireGroupeUi key={`${numero}:creer`} mode="creer" sortie={sortie} />
  ) : (
    <ModifierGroupe key={`${numero}:modifier:${affiche.groupId}`} groupId={affiche.groupId} sortie={sortie} />
  );
}

function ModifierGroupe({ groupId, sortie }: { groupId: string; sortie: boolean }) {
  const groupe = useWorkspaceStore((s) => s.groups.find((g) => g.id === groupId));
  if (!groupe) return null;
  return <FormulaireGroupeUi mode="modifier" groupe={groupe} sortie={sortie} />;
}

type Props =
  | { mode: "creer"; groupe?: undefined; sortie: boolean }
  | { mode: "modifier"; groupe: Group; sortie: boolean };

function FormulaireGroupeUi({ mode, groupe, sortie }: Props) {
  const fermer = useUiStore((s) => s.fermerFormulaireGroupe);
  // Teinte proposée à la création : la même que celle qu'attribuerait le store (pas de 5
  // sur 16), pour que deux groupes créés à la suite ne reçoivent pas deux teintes voisines.
  const [couleur, setCouleur] = useState<string>(
    () => groupe?.color ?? defaultGroupColor(useWorkspaceStore.getState().groups.length),
  );
  const [nom, setNom] = useState(groupe?.name ?? "");
  const creation = mode === "creer";

  const valider = () => {
    const st = useWorkspaceStore.getState();
    if (groupe) {
      st.renameGroup(groupe.id, nom);
      st.setGroupColor(groupe.id, couleur);
    } else {
      st.addGroup(nom, couleur);
    }
    fermer();
  };

  const affiche = nom.trim() || groupe?.name || "groupe";
  const teinte = teinteLisible(couleur) ?? couleur;

  return (
    <Calque
      ancre={groupe ? { type: "groupe", groupId: groupe.id } : { type: "ajout" }}
      largeur={LARGEUR_GROUPE}
      label={creation ? "Nouveau groupe" : `Modifier le groupe ${groupe.name}`}
      sortie={sortie}
      onFermer={fermer}
      onEntree={valider}
    >
      <EnteteCalque
        pastille={
          <span
            aria-hidden="true"
            className="cr-carre"
            style={{ background: `${teinte}38`, color: teinte, boxShadow: `inset 0 0 0 1.5px ${teinte}` }}
          >
            {monogramme(affiche)}
          </span>
        }
        titre={creation ? "Nouveau groupe" : "Modifier le groupe"}
        sousTitre={creation ? affiche : groupe.name}
        raccourci={creation ? "Ctrl+Maj+G" : undefined}
      />
      <div className="cr-corps">
        <div className="cr-champ">
          <EtiquetteChamp indication={creation ? "vide : « Groupe »" : undefined}>Nom</EtiquetteChamp>
          <input
            className="cr-saisie"
            data-cr-focus
            aria-label="Nom du groupe"
            placeholder="nom du groupe"
            autoComplete="off"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
          />
        </div>
        <div className="cr-champ" data-nuancier>
          <EtiquetteChamp valeur={libelleCouleur(couleur)}>Couleur</EtiquetteChamp>
          <Nuancier
            choisie={couleur}
            colonnes={8}
            label="Couleur du groupe"
            onChoisir={(hex) => hex && setCouleur(hex)}
          />
        </div>
      </div>
      <PiedCalque libelle={creation ? "Créer le groupe" : "Enregistrer"} onAnnuler={fermer} onValider={valider} />
    </Calque>
  );
}
