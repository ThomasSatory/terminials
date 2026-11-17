import { resolveDraft, type ResolvedDraft } from "./workspaceDraft";

/**
 * Logique pure des calques de création (popover d'espace, menu d'espace, formulaire de
 * groupe) : validation du formulaire et navigation au clavier entre leurs boutons.
 */

export type Verdict = { ok: true; resolu: ResolvedDraft } | { ok: false; message: string };

/**
 * Vérifie les champs nom + dossier avant d'écrire dans le store : dossier requis, chemin
 * absolu déterminable (resolveDraft). L'existence du dossier se contrôle ensuite côté Rust.
 * Messages repris de la maquette.
 */
export function verifierFormulaire(d: { name: string; folder: string }, home: string): Verdict {
  const dossier = d.folder.trim();
  if (!dossier) return { ok: false, message: "Dossier requis : tapez un chemin ou Parcourir…" };
  const resolu = resolveDraft(d, home);
  if (resolu) return { ok: true, resolu };
  if (dossier.startsWith("~") && !home) {
    return { ok: false, message: "Dossier personnel pas encore résolu, réessayez" };
  }
  return { ok: false, message: "Chemin absolu attendu (ex. ~/dev/app)" };
}

/** Éléments focalisables d'un panneau, dans l'ordre du DOM. */
const FOCALISABLES = "button:not(:disabled), input:not(:disabled)";

/**
 * Cible d'une touche de navigation dans un panneau de boutons (menu d'espace) : ↑/↓
 * parcourent tout dans l'ordre (en bouclant), ←/→ se déplacent dans le groupe courant
 * (`data-cr-groupe` : nuancier, puces), ↑/↓ y sautent d'une ligne quand le groupe est une
 * grille (`data-colonnes`), Début/Fin vont aux extrémités. null = touche sans effet ici.
 */
export function voisinClavier(panneau: HTMLElement, courant: HTMLElement, touche: string): HTMLElement | null {
  const tous = Array.from(panneau.querySelectorAll<HTMLElement>(FOCALISABLES));
  if (tous.length === 0) return null;
  const idx = tous.indexOf(courant);
  if (touche === "Home") return tous[0];
  if (touche === "End") return tous[tous.length - 1];
  const groupe = courant.closest<HTMLElement>("[data-cr-groupe]");
  const locaux = groupe ? Array.from(groupe.querySelectorAll<HTMLElement>(FOCALISABLES)) : [];
  const lieu = locaux.indexOf(courant);
  if (groupe && (touche === "ArrowLeft" || touche === "ArrowRight")) {
    const pas = touche === "ArrowRight" ? 1 : -1;
    return locaux[(lieu + pas + locaux.length) % locaux.length];
  }
  if (touche !== "ArrowDown" && touche !== "ArrowUp") return null;
  const bas = touche === "ArrowDown";
  const colonnes = Number(groupe?.dataset.colonnes ?? 0);
  if (groupe && colonnes > 0) {
    const cible = locaux[lieu + (bas ? colonnes : -colonnes)];
    if (cible) return cible;
  }
  // On sort du groupe par son bord (premier/dernier bouton), pas depuis la case courante.
  const depart = groupe ? tous.indexOf(bas ? locaux[locaux.length - 1] : locaux[0]) : idx;
  return tous[(depart + (bas ? 1 : -1) + tous.length) % tous.length];
}

/** Index de l'unique arrêt de tabulation d'un groupe de boutons (nuancier, puces) : le
    choisi, sinon le premier. */
export function arretTabulation(choisi: number): number {
  return choisi >= 0 ? choisi : 0;
}
