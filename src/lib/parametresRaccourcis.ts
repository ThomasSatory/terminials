import { matchShortcut, type ShortcutAction } from "./shortcuts";

/**
 * Table des raccourcis de Paramètres › Raccourcis, DÉDUITE de `lib/shortcuts` : on
 * présente chaque touche physique candidate, sous chaque combinaison de modificateurs, à
 * `matchShortcut` (le matcher même que le clavier) et on regroupe ce qu'il répond. Une
 * touche ajoutée, retirée ou déplacée dans la table change cette page d'elle-même ; seuls
 * les libellés sont écrits ici, et `LIBELLES` est indexé par TOUS les types d'action :
 * une action nouvelle sans libellé ne compile pas.
 */

export type GroupeRaccourcis = "Espaces" | "Onglets" | "Vues" | "Terminal";

/** Ordre des blocs de la section (maquette Parametres). */
export const GROUPES_RACCOURCIS: readonly GroupeRaccourcis[] = ["Espaces", "Onglets", "Vues", "Terminal"];

interface Libelle {
  groupe: GroupeRaccourcis;
  /** Plusieurs actions de même libellé (précédent / suivant…) partagent une rangée. */
  libelle: string;
  /** Mots qui la retrouvent sans être dans son libellé (sans accents). */
  motsCles?: string;
}

/** Libellé de chaque type d'action, dans l'ordre d'affichage de la page. */
const LIBELLES: { [K in ShortcutAction["type"]]: Libelle } = {
  "new-workspace": { groupe: "Espaces", libelle: "Nouvel espace" },
  "new-home-workspace": { groupe: "Espaces", libelle: "Nouvel espace dans le dossier de départ", motsCles: "home" },
  "open-folder": { groupe: "Espaces", libelle: "Ouvrir un dossier" },
  "rename-workspace": { groupe: "Espaces", libelle: "Renommer l’espace" },
  "close-workspace": { groupe: "Espaces", libelle: "Fermer l’espace" },
  "select-workspace": { groupe: "Espaces", libelle: "Aller à l’espace 1 à 9" },
  "prev-workspace": { groupe: "Espaces", libelle: "Espace précédent, suivant" },
  "next-workspace": { groupe: "Espaces", libelle: "Espace précédent, suivant" },
  "move-workspace": { groupe: "Espaces", libelle: "Monter, descendre l’espace", motsCles: "deplacer" },
  "new-group": { groupe: "Espaces", libelle: "Nouveau groupe" },
  "toggle-group": { groupe: "Espaces", libelle: "Replier ou déplier le groupe" },
  "new-tab": { groupe: "Onglets", libelle: "Nouvel onglet" },
  "close-tab": { groupe: "Onglets", libelle: "Fermer l’onglet" },
  "prev-tab": { groupe: "Onglets", libelle: "Onglet précédent, suivant" },
  "next-tab": { groupe: "Onglets", libelle: "Onglet précédent, suivant" },
  "move-tab": { groupe: "Onglets", libelle: "Déplacer l’onglet" },
  "toggle-palette": { groupe: "Vues", libelle: "Palette de commandes" },
  "toggle-diff": { groupe: "Vues", libelle: "Fichiers modifiés", motsCles: "diff" },
  "toggle-dashboard": { groupe: "Vues", libelle: "Activité de la journée", motsCles: "recap" },
  "toggle-mosaique": { groupe: "Vues", libelle: "Mosaïque des agents" },
  "toggle-dock": { groupe: "Vues", libelle: "Masquer ou afficher le dock" },
  "toggle-parametres": { groupe: "Vues", libelle: "Paramètres", motsCles: "reglages" },
  "toggle-superviseur": { groupe: "Vues", libelle: "Poste de suivi du superviseur", motsCles: "superviseur" },
};

/** Copier et coller appartiennent au terminal (xterm), pas à la table de l'app : elle les
    laisse passer exprès (cf. `CTRL_SHIFT` de lib/shortcuts). */
const RACCOURCIS_TERMINAL: readonly { libelle: string; combos: string[][] }[] = [
  { libelle: "Copier", combos: [["Ctrl", "Maj", "C"]] },
  { libelle: "Coller", combos: [["Ctrl", "Maj", "V"]] },
];

/** Touches physiques présentées au matcher (`KeyboardEvent.code`). */
export const CODES_CANDIDATS: readonly string[] = [
  ..."ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((l) => `Key${l}`),
  ..."0123456789".split("").map((d) => `Digit${d}`),
  "Enter",
  "NumpadEnter",
  "Space",
  "Tab",
  "Escape",
  "Backspace",
  "Delete",
  "Home",
  "End",
  "PageUp",
  "PageDown",
  "ArrowUp",
  "ArrowDown",
  "ArrowLeft",
  "ArrowRight",
  "Comma",
  "Period",
  "Semicolon",
  "Slash",
  "Backslash",
  "Minus",
  "Equal",
  "Quote",
  "Backquote",
  "BracketLeft",
  "BracketRight",
  ...Array.from({ length: 12 }, (_, i) => `F${i + 1}`),
];

/** Modificateurs essayés, et leurs noms affichés. */
const MODIFICATEURS: readonly { ctrlKey: boolean; shiftKey: boolean; altKey: boolean; noms: string[] }[] = [
  { ctrlKey: true, shiftKey: false, altKey: false, noms: ["Ctrl"] },
  { ctrlKey: true, shiftKey: true, altKey: false, noms: ["Ctrl", "Maj"] },
  { ctrlKey: false, shiftKey: false, altKey: true, noms: ["Alt"] },
  { ctrlKey: false, shiftKey: true, altKey: true, noms: ["Alt", "Maj"] },
  { ctrlKey: true, shiftKey: false, altKey: true, noms: ["Ctrl", "Alt"] },
];

/** Nom affiché d'une touche physique, en français (« Entrée », « PgSuiv », « , »). */
export function nomToucheAffiche(code: string): string {
  const noms: Record<string, string> = {
    Enter: "Entrée",
    NumpadEnter: "Entrée",
    Space: "Espace",
    Tab: "Tab",
    Escape: "Échap",
    Backspace: "Retour",
    Delete: "Suppr",
    Home: "Début",
    End: "Fin",
    PageUp: "PgPréc",
    PageDown: "PgSuiv",
    ArrowUp: "↑",
    ArrowDown: "↓",
    ArrowLeft: "←",
    ArrowRight: "→",
    Comma: ",",
    Period: ".",
    Semicolon: ";",
    Slash: "/",
    Backslash: "\\",
    Minus: "-",
    Equal: "=",
    Quote: "'",
    Backquote: "`",
    BracketLeft: "[",
    BracketRight: "]",
  };
  return noms[code] ?? /^(?:Key|Digit)(.)$/.exec(code)?.[1] ?? code;
}

export interface RangeeRaccourci {
  /** Unique dans la page : « k- » + libellé. */
  id: string;
  groupe: GroupeRaccourcis;
  libelle: string;
  /** Une combinaison = suite de touches (« Ctrl », « Maj », « N ») ; plusieurs : « / ». */
  combos: string[][];
  motsCles: string;
}

/**
 * Rangées de la section Raccourcis, groupe par groupe dans l'ordre de `LIBELLES`.
 * Ctrl+1…9 se résume en une combinaison « Ctrl 1…9 » ; deux touches qui s'affichent
 * pareil (Entrée et Entrée du pavé) n'en font qu'une.
 */
export function rangeesRaccourcis(
  matcher: (e: { code: string; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }) => ShortcutAction | null = matchShortcut,
): RangeeRaccourci[] {
  const parLibelle = new Map<string, { combos: string[][]; chiffres: Set<string> }>();
  for (const m of MODIFICATEURS) {
    for (const code of CODES_CANDIDATS) {
      const action = matcher({ code, ctrlKey: m.ctrlKey, shiftKey: m.shiftKey, altKey: m.altKey });
      if (!action) continue;
      const { libelle } = LIBELLES[action.type];
      const entree = parLibelle.get(libelle) ?? { combos: [], chiffres: new Set<string>() };
      parLibelle.set(libelle, entree);
      if (action.type === "select-workspace") {
        entree.chiffres.add(m.noms.join("+"));
        continue;
      }
      const combo = [...m.noms, nomToucheAffiche(code)];
      if (!entree.combos.some((c) => c.join("\u0000") === combo.join("\u0000"))) entree.combos.push(combo);
    }
  }

  const rangees: RangeeRaccourci[] = [];
  const vus = new Set<string>();
  for (const groupe of GROUPES_RACCOURCIS) {
    for (const def of Object.values(LIBELLES)) {
      if (def.groupe !== groupe || vus.has(def.libelle)) continue;
      vus.add(def.libelle);
      const entree = parLibelle.get(def.libelle);
      if (!entree) continue; // action sans touche dans la table : rien à afficher
      const combos = [...entree.combos, ...[...entree.chiffres].map((mods) => [...mods.split("+"), "1…9"])];
      rangees.push(ranger(groupe, def.libelle, combos, def.motsCles));
    }
    if (groupe === "Terminal") {
      for (const r of RACCOURCIS_TERMINAL) rangees.push(ranger(groupe, r.libelle, r.combos));
    }
  }
  return rangees;
}

function ranger(groupe: GroupeRaccourcis, libelle: string, combos: string[][], motsCles = ""): RangeeRaccourci {
  return {
    id: `k-${libelle}`,
    groupe,
    libelle,
    combos,
    // « Maj+D » se retrouve en tapant « maj d » ou « maj+d » (le « + » vaut un espace).
    motsCles: [motsCles, ...combos.map((c) => c.join(" "))].filter(Boolean).join(" "),
  };
}
