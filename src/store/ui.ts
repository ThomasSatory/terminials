import { create } from "zustand";

/**
 * État d'interface de l'UI « Dock » : quelle vue est affichée, quel calque est ouvert.
 * Jamais persisté (un redémarrage repart du terminal, tout fermé) et sans aucune donnée
 * métier : les espaces, groupes et onglets restent dans le store workspace.
 *
 * Les calques légers (palette, popover, menu d'espace, menu de groupe, formulaire de
 * groupe, menu du « + »)
 * s'excluent : en ouvrir un ferme les autres, deux panneaux ancrés au dock ne se
 * chevauchent jamais. Les ouvrir rend aussi le dock visible, puisqu'ils s'y ancrent.
 */

/** Vue principale au-dessus du dock (les vues récap et diff ont leur propre état). */
export type VuePrincipale = "terminal" | "mosaique";

/** Popover d'espace ancré au dock : création (sur le « + ») ou modification (sur l'avatar). */
export type PopoverEspace =
  /** `groupId` : groupe présélectionné (création depuis une étiquette de groupe). */
  | { mode: "creer"; groupId?: string | null }
  | { mode: "modifier"; wsId: string };

/** Formulaire de groupe ancré au dock : création (sur le « + ») ou modification (étiquette). */
export type FormulaireGroupe = { mode: "creer" } | { mode: "modifier"; groupId: string };

/** Sections de la vue Paramètres (maquette Parametres, dans l'ordre de sa navigation). */
export type SectionParametres =
  | "apparence"
  | "terminal"
  | "agents"
  | "superviseur"
  | "activite"
  | "raccourcis"
  | "apropos";

/** Vue Paramètres ouverte : section affichée, et réglages à faire clignoter (choisis depuis
    la palette ou la recherche ; ids de rangées propres à la vue). */
export interface OuvertureParametres {
  section: SectionParametres;
  surbrillance: string[];
}

export interface UiState {
  vue: VuePrincipale;
  paletteOuverte: boolean;
  popoverEspace: PopoverEspace | null;
  /** Espace dont le menu contextuel est ouvert (ancré à son avatar). */
  menuEspace: string | null;
  /** Groupe dont le menu contextuel est ouvert (ancré à son étiquette). */
  menuGroupe: string | null;
  formulaireGroupe: FormulaireGroupe | null;
  /** Menu du « + » quand aucun espace n'est ouvert (accueil). */
  menuAjout: boolean;
  /** Dock affiché (Ctrl+Maj+B le masque). */
  dockVisible: boolean;
  /** Espace au-dessus duquel une bulle d'agent est posée (null : aucune). L'infobulle de
      cet avatar se tait sous la bulle ; la zone terminal, elle, ne bouge pas. */
  bulleEspace: string | null;
  /** Espace ouvert depuis la mosaïque : la barre du haut en montre la variante « retour »
      et Échap y ramène, jusqu'à la première saisie (lib/retourMosaique). */
  retourMosaique: string | null;
  /** Vue plein écran Paramètres (Ctrl+Maj+,), au-dessus du terminal, sous la barre du haut. */
  parametres: OuvertureParametres | null;
  /** Dernière section consultée : Ctrl+Maj+, y rouvre. */
  derniereSectionParametres: SectionParametres;

  setVue: (vue: VuePrincipale) => void;
  basculerMosaique: () => void;
  ouvrirPalette: () => void;
  fermerPalette: () => void;
  basculerPalette: () => void;
  ouvrirPopoverEspace: (p: PopoverEspace) => void;
  fermerPopoverEspace: () => void;
  ouvrirMenuEspace: (wsId: string) => void;
  fermerMenuEspace: () => void;
  ouvrirMenuGroupe: (groupId: string) => void;
  fermerMenuGroupe: () => void;
  ouvrirFormulaireGroupe: (f: FormulaireGroupe) => void;
  fermerFormulaireGroupe: () => void;
  basculerMenuAjout: () => void;
  fermerMenuAjout: () => void;
  /** Ferme tous les calques légers (Échap global, changement de vue). */
  fermerCalques: () => void;
  basculerDock: () => void;
  setBulleEspace: (wsId: string | null) => void;
  armerRetourMosaique: (wsId: string) => void;
  desarmerRetourMosaique: () => void;
  /** Ouvre les Paramètres (section donnée, sinon la dernière consultée) ; les calques
      légers se referment. */
  ouvrirParametres: (section?: SectionParametres, surbrillance?: string[]) => void;
  fermerParametres: () => void;
  basculerParametres: () => void;
  /** Un espace vient d'être fermé : les calques qui le visaient se referment. */
  oublierEspace: (wsId: string) => void;
  /** Un groupe vient d'être supprimé : son menu et son formulaire de modification se referment. */
  oublierGroupe: (groupId: string) => void;
  reset: () => void;
}

/** État initial, exporté pour réinitialiser le store entre les tests. */
export const initialUiState: Pick<
  UiState,
  | "vue"
  | "paletteOuverte"
  | "popoverEspace"
  | "menuEspace"
  | "menuGroupe"
  | "formulaireGroupe"
  | "menuAjout"
  | "dockVisible"
  | "bulleEspace"
  | "retourMosaique"
  | "parametres"
  | "derniereSectionParametres"
> = {
  vue: "terminal",
  paletteOuverte: false,
  popoverEspace: null,
  menuEspace: null,
  menuGroupe: null,
  formulaireGroupe: null,
  menuAjout: false,
  dockVisible: true,
  bulleEspace: null,
  retourMosaique: null,
  parametres: null,
  derniereSectionParametres: "apparence",
};

/** Tous les calques légers fermés. */
const SANS_CALQUE = {
  paletteOuverte: false,
  popoverEspace: null,
  menuEspace: null,
  menuGroupe: null,
  formulaireGroupe: null,
  menuAjout: false,
} as const;

export const useUiStore = create<UiState>((set) => ({
  ...initialUiState,
  // Toute autre vue que le terminal désarme le retour vers la mosaïque.
  setVue: (vue) => set((s) => ({ vue, retourMosaique: vue === "terminal" ? s.retourMosaique : null })),
  basculerMosaique: () =>
    set((s) => ({ ...SANS_CALQUE, vue: s.vue === "mosaique" ? "terminal" : "mosaique", retourMosaique: null })),
  // La palette est centrée, pas ancrée au dock : elle ne force pas son affichage.
  ouvrirPalette: () => set({ ...SANS_CALQUE, paletteOuverte: true }),
  fermerPalette: () => set({ paletteOuverte: false }),
  basculerPalette: () => set((s) => ({ ...SANS_CALQUE, paletteOuverte: !s.paletteOuverte })),
  ouvrirPopoverEspace: (p) => set({ ...SANS_CALQUE, popoverEspace: p, dockVisible: true }),
  fermerPopoverEspace: () => set({ popoverEspace: null }),
  ouvrirMenuEspace: (wsId) => set({ ...SANS_CALQUE, menuEspace: wsId, dockVisible: true }),
  fermerMenuEspace: () => set({ menuEspace: null }),
  ouvrirMenuGroupe: (groupId) => set({ ...SANS_CALQUE, menuGroupe: groupId, dockVisible: true }),
  fermerMenuGroupe: () => set({ menuGroupe: null }),
  ouvrirFormulaireGroupe: (f) => set({ ...SANS_CALQUE, formulaireGroupe: f, dockVisible: true }),
  fermerFormulaireGroupe: () => set({ formulaireGroupe: null }),
  basculerMenuAjout: () =>
    set((s) => (s.menuAjout ? { menuAjout: false } : { ...SANS_CALQUE, menuAjout: true, dockVisible: true })),
  fermerMenuAjout: () => set({ menuAjout: false }),
  fermerCalques: () => set(SANS_CALQUE),
  // Masquer le dock referme ce qui s'y ancre : un popover flottant sans son ancre
  // resterait suspendu dans le vide.
  basculerDock: () =>
    set((s) =>
      s.dockVisible
        ? { ...SANS_CALQUE, dockVisible: false, paletteOuverte: s.paletteOuverte }
        : { dockVisible: true },
    ),
  setBulleEspace: (wsId) => set((s) => (s.bulleEspace === wsId ? s : { bulleEspace: wsId })),
  ouvrirParametres: (section, surbrillance = []) =>
    set((s) => {
      const cible = section ?? s.derniereSectionParametres;
      // Les Paramètres sont une autre vue : ils désarment le retour vers la mosaïque, qui
      // réapparaissait sinon dans la barre au-dessus d'eux.
      return {
        ...SANS_CALQUE,
        parametres: { section: cible, surbrillance },
        derniereSectionParametres: cible,
        retourMosaique: null,
      };
    }),
  fermerParametres: () => set((s) => (s.parametres === null ? s : { parametres: null })),
  basculerParametres: () =>
    set((s) =>
      s.parametres
        ? { parametres: null }
        : {
            ...SANS_CALQUE,
            parametres: { section: s.derniereSectionParametres, surbrillance: [] },
            retourMosaique: null,
          },
    ),
  armerRetourMosaique: (wsId) => set({ retourMosaique: wsId }),
  desarmerRetourMosaique: () => set((s) => (s.retourMosaique === null ? s : { retourMosaique: null })),
  oublierEspace: (wsId) =>
    set((s) => ({
      retourMosaique: s.retourMosaique === wsId ? null : s.retourMosaique,
      menuEspace: s.menuEspace === wsId ? null : s.menuEspace,
      popoverEspace:
        s.popoverEspace?.mode === "modifier" && s.popoverEspace.wsId === wsId ? null : s.popoverEspace,
    })),
  oublierGroupe: (groupId) =>
    set((s) => {
      const f = s.formulaireGroupe;
      const p = s.popoverEspace;
      return {
        formulaireGroupe: f?.mode === "modifier" && f.groupId === groupId ? null : f,
        menuGroupe: s.menuGroupe === groupId ? null : s.menuGroupe,
        // Une création qui visait ce groupe retombe hors groupe plutôt que de se fermer.
        popoverEspace: p?.mode === "creer" && p.groupId === groupId ? { mode: "creer", groupId: null } : p,
      };
    }),
  reset: () => set(initialUiState),
}));

/** Vrai si un calque ancré au dock est ouvert : le dock passe alors au-dessus du voile. */
export function calqueAncreOuvert(
  s: Pick<UiState, "popoverEspace" | "menuEspace" | "menuGroupe" | "formulaireGroupe" | "menuAjout">,
): boolean {
  return (
    s.popoverEspace !== null ||
    s.menuEspace !== null ||
    s.menuGroupe !== null ||
    s.formulaireGroupe !== null ||
    s.menuAjout
  );
}
