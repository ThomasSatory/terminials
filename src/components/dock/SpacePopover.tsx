import { useEffect, useLayoutEffect, useRef, useState } from "react";
import type { KeyboardEvent as ClavierReact, ReactNode } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import {
  useWorkspaceStore,
  getLastFolder,
  setLastFolder,
  type Workspace,
} from "../../store/workspace";
import { useDashboardStore } from "../../store/dashboard";
import { calqueAncreOuvert, useUiStore, type PopoverEspace } from "../../store/ui";
import { resolveDraft } from "../../lib/workspaceDraft";
import { arretTabulation, verifierFormulaire, voisinClavier } from "../../lib/formulaireEspace";
import { abbreviateHome, stripTrailingSlash } from "../../lib/paths";
import { basename, libelleCouleur, SIDEBAR_COLORS } from "../../lib/palette";
import { couleurAuto, couleurEspace, teinteLisible } from "../../lib/couleurEspace";
import { monogramme } from "../../lib/monogram";
import { placerAuDessus, trouverAncre, type Ancre, type Placement } from "../../lib/ancrage";
import { placerSurDock } from "../../lib/placementDock";
import { focusTab } from "../../lib/tabFocus";
import { Avatar } from "../ui/Avatar";
import { Kbd } from "../ui/Kbd";
import { IconeDossier } from "../ui/icons";
import "../../styles/creation.css";

/**
 * Popover de création d'espace (`popoverEspace` en mode « creer »), ancré au « + »
 * [data-dock-add]. Toujours monté par App : il rend null quand rien n'est ouvert et garde
 * son panneau 170 ms pour animer sa sortie. La modification d'un espace partage le panneau
 * du menu d'espace (SpaceMenu) : menu ⇄ modification ne fait que fondre le contenu.
 *
 * Ce fichier porte aussi les briques communes aux calques de création (menu d'espace,
 * formulaire de groupe) : panneau ancré, nuancier, puces de groupe, champ dossier,
 * formulaire de modification, navigation au clavier.
 */

// ---------------------------------------------------------------------------------
// Logique pure
// ---------------------------------------------------------------------------------

// Validation et navigation au clavier : lib/formulaireEspace ; noms des couleurs : lib/palette ;
// placement au-dessus du dock : lib/placementDock.

/** Le dossier existe-t-il ? Une erreur d'appel compte comme « non » : mieux vaut refuser
    que créer un espace dont les shells échoueraient au lancement. */
async function dossierExiste(chemin: string): Promise<boolean> {
  return invoke<boolean>("dir_exists", { path: chemin }).catch(() => false);
}

// ---------------------------------------------------------------------------------
// Crochets communs
// ---------------------------------------------------------------------------------

let homeMemo = "";

/** $HOME résolu par Tauri (vide tant que l'appel n'a pas répondu ; mémorisé ensuite). */
export function useHome(): string {
  const [home, setHome] = useState(homeMemo);
  useEffect(() => {
    if (homeMemo) return;
    let vivant = true;
    homeDir()
      .then((h) => {
        homeMemo = stripTrailingSlash(h);
        if (vivant) setHome(homeMemo);
      })
      .catch(() => {});
    return () => {
      vivant = false;
    };
  }, []);
  return home;
}

const DUREE_SORTIE_MS = 170;

/**
 * Garde un calque affiché pendant son animation de sortie. `valeur` null = fermé ; le
 * dernier contenu reste rendu 170 ms avec `sortie` vrai. `immediat` coupe l'animation
 * quand un autre calque prend aussitôt la place (création → menu, palette…).
 * `valeur` doit garder son identité d'un rendu à l'autre (objet du store, chaîne).
 */
export function useSortieAnimee<T>(
  valeur: T | null,
  immediat: boolean,
): { affiche: T | null; sortie: boolean } {
  const [retenu, setRetenu] = useState<T | null>(valeur);
  const [enSortie, setEnSortie] = useState(false);
  useEffect(() => {
    if (valeur !== null) {
      setRetenu(valeur);
      setEnSortie(false);
      return;
    }
    if (immediat) {
      setRetenu(null);
      setEnSortie(false);
      return;
    }
    setEnSortie(true);
    const t = setTimeout(() => {
      setRetenu(null);
      setEnSortie(false);
    }, DUREE_SORTIE_MS);
    return () => clearTimeout(t);
    // `immediat` n'est lu qu'à la fermeture : le suivre rejouerait la sortie.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [valeur]);
  const affiche = valeur ?? (immediat ? null : retenu);
  return { affiche, sortie: valeur === null && affiche !== null && enSortie };
}

/**
 * Numéro d'ouverture : augmente à chaque passage de fermé à ouvert. Sert de clé au calque :
 * rouvert pendant ses 170 ms de sortie, il est remonté (formulaire vierge, focus rejoué,
 * animation d'entrée) au lieu de reprendre la saisie de la fois précédente.
 */
export function useNumeroOuverture(ouvert: boolean): number {
  const [etat, setEtat] = useState({ ouvert, n: 0 });
  if (etat.ouvert !== ouvert) {
    // État dérivé, mis à jour pendant le rendu (motif React documenté) : la clé change
    // dès le rendu de réouverture, sans passer par un rendu intermédiaire.
    const suivant = { ouvert, n: ouvert ? etat.n + 1 : etat.n };
    setEtat(suivant);
    return suivant.n;
  }
  return etat.n;
}

/**
 * Vrai quand un autre calque que celui de l'appelant est ouvert : il prend alors la place
 * sans attendre l'animation de sortie. « creation » : popover du « + » ; « espace » : menu
 * et modification d'un espace (un seul panneau) ; « groupe » : formulaire de groupe.
 */
export function useAutreCalque(exclu: "creation" | "espace" | "groupe"): boolean {
  return useUiStore((s) => {
    const p = s.popoverEspace;
    return (
      s.paletteOuverte ||
      s.menuAjout ||
      s.menuGroupe !== null ||
      (exclu !== "creation" && p?.mode === "creer") ||
      (exclu !== "espace" && (s.menuEspace !== null || p?.mode === "modifier")) ||
      (exclu !== "groupe" && s.formulaireGroupe !== null)
    );
  });
}

const SELECTEUR_DOCK = 'nav[aria-label="Espaces de travail"]';

/** Placement d'après les rectangles de l'ancre et du dock : 14 px au-dessus du `<nav>`,
    borné au dock comme la maquette (lib/placementDock). */
function mesurer(ancre: Ancre, largeur: number): Placement {
  const fenetre = { largeur: window.innerWidth, hauteur: window.innerHeight };
  const re = trouverAncre(ancre)?.getBoundingClientRect();
  const rn = document.querySelector(SELECTEUR_DOCK)?.getBoundingClientRect();
  if (!rn) {
    // Dock absent (ne devrait pas arriver : ouvrir un calque ancré le réaffiche).
    const centreX = re ? re.left + re.width / 2 : window.innerWidth / 2;
    return placerAuDessus({ centreX, haut: window.innerHeight - 90 }, largeur, fenetre);
  }
  const ancreX = re ? re.left + re.width / 2 : rn.left + rn.width / 2;
  return placerSurDock(ancreX, { left: rn.left, top: rn.top, largeur: rn.width }, largeur, fenetre);
}

/** Suit l'ancre : recalculé au redimensionnement de la fenêtre, de l'ancre et du dock. */
function usePlacement(ancre: Ancre, largeur: number): Placement {
  const [placement, setPlacement] = useState(() => mesurer(ancre, largeur));
  const cle = JSON.stringify(ancre);
  useLayoutEffect(() => {
    const maj = () => setPlacement(mesurer(ancre, largeur));
    maj();
    window.addEventListener("resize", maj);
    const obs = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(maj);
    const dock = document.querySelector(SELECTEUR_DOCK);
    if (dock) obs?.observe(dock);
    const el = trouverAncre(ancre);
    if (el) obs?.observe(el);
    return () => {
      window.removeEventListener("resize", maj);
      obs?.disconnect();
    };
    // `ancre` est décrite par `cle` : l'objet change à chaque rendu de l'appelant.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cle, largeur]);
  return placement;
}

// ---------------------------------------------------------------------------------
// Panneau ancré
// ---------------------------------------------------------------------------------

/** Éléments que les flèches et la tabulation peuvent atteindre dans un panneau. */
const FOCALISABLES = "button:not(:disabled), input:not(:disabled)";

/**
 * Rend le focus au terminal actif quand un calque se ferme, s'il est resté dans le panneau
 * (ou tombé sur le body) et qu'aucun autre calque, ni la palette, ni une vue ne le réclame.
 */
function rendreFocusAuTerminal(panneau: HTMLElement | null): void {
  const a = document.activeElement;
  if (a && a !== document.body && !(panneau && panneau.contains(a))) return;
  const ui = useUiStore.getState();
  if (ui.vue !== "terminal" || ui.paletteOuverte || calqueAncreOuvert(ui)) return;
  const ws = useWorkspaceStore.getState();
  const actif = ws.workspaces.find((w) => w.id === ws.activeId);
  if (actif?.activeTabId) focusTab(actif.activeTabId);
}

/**
 * Racine d'un calque : voile transparent (clic dehors = fermer) + panneau `fixed` posé
 * au-dessus de son ancre, pointe sous l'ancre. Échap ferme depuis le panneau (jamais sur
 * window : Échap appartient à l'agent dans le terminal), Entrée dans un champ valide.
 *
 * Le panneau est focalisable (tabIndex -1) : un clic sur un texte ou une zone vide y garde
 * le focus, donc Échap et les flèches. Tab y tourne en boucle (dialogue modal). Il prend
 * le focus à l'ouverture et à chaque changement de contenu (premier `[data-cr-focus]`,
 * sinon premier bouton), et le rend au terminal actif dès le début de sa sortie : le
 * panneau, inerte, ne capte plus les frappes destinées à l'agent pendant ses 170 ms.
 *
 * `cleContenu` : le panneau reste en place (pas de rebond) quand elle change ; seul le
 * contenu fond, et la largeur glisse (menu d'espace ⇄ modification, comme la maquette).
 */
export function Calque({
  ancre,
  largeur,
  label,
  sortie,
  onFermer,
  onEntree,
  fleches = false,
  cleContenu = "",
  children,
}: {
  ancre: Ancre;
  largeur: number;
  label: string;
  sortie: boolean;
  /** Échap, clic sur le voile, bouton Annuler. */
  onFermer: () => void;
  onEntree?: () => void;
  /** Navigation aux flèches entre tous les boutons (menu). Sans elle, les flèches ne
      servent que dans les nuanciers et puces ([data-cr-groupe]). */
  fleches?: boolean;
  cleContenu?: string;
  children: ReactNode;
}) {
  const panneau = useRef<HTMLDivElement>(null);
  const l = Math.min(largeur, Math.max(240, window.innerWidth - 24));
  const place = usePlacement(ancre, l);

  // Focus à l'ouverture et à chaque changement de contenu (l'ancien élément focalisé a
  // disparu avec lui).
  useEffect(() => {
    const p = panneau.current;
    if (!p) return;
    const cible = p.querySelector<HTMLElement>("[data-cr-focus]") ?? p.querySelector<HTMLElement>("button");
    (cible ?? p).focus({ preventScroll: true });
    if (cible instanceof HTMLInputElement) cible.select();
  }, [cleContenu]);

  // Sortie animée : le focus rejoint le terminal tout de suite, pas au démontage.
  useEffect(() => {
    if (sortie) rendreFocusAuTerminal(panneau.current);
  }, [sortie]);

  // Démontage sans sortie (un autre calque a pris la place, l'espace a disparu).
  useEffect(() => {
    const p = panneau.current;
    return () => rendreFocusAuTerminal(p);
  }, []);

  const surTouche = (e: ClavierReact<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      onFermer();
      return;
    }
    if (e.key === "Enter" && onEntree && e.target instanceof HTMLInputElement) {
      if (e.nativeEvent.isComposing) return;
      e.preventDefault();
      onEntree();
      return;
    }
    const p = panneau.current;
    const ici = e.target;
    if (!p || !(ici instanceof HTMLElement) || !p.contains(ici)) return;
    const tous = Array.from(p.querySelectorAll<HTMLElement>(FOCALISABLES));
    if (tous.length === 0) return;

    if (e.key === "Tab") {
      // Piège de focus : un seul arrêt par nuancier ou rangée de puces (tabindex itinérant),
      // et le dernier arrêt renvoie au premier.
      const arrets = tous.filter((el) => el.tabIndex >= 0);
      const premier = arrets[0];
      const dernier = arrets[arrets.length - 1];
      if (!premier) return;
      if (e.shiftKey && (ici === premier || ici === p)) {
        e.preventDefault();
        dernier.focus();
      } else if (!e.shiftKey && (ici === dernier || ici === p)) {
        e.preventDefault();
        premier.focus();
      }
      return;
    }

    if (ici === p) {
      // Focus sur le panneau lui-même (clic dans une zone vide) : les flèches du menu
      // repartent d'une extrémité.
      if (!fleches) return;
      const cible =
        e.key === "ArrowDown" || e.key === "Home"
          ? tous[0]
          : e.key === "ArrowUp" || e.key === "End"
            ? tous[tous.length - 1]
            : null;
      if (cible) {
        e.preventDefault();
        cible.focus();
      }
      return;
    }
    // Dans un champ, les flèches déplacent le curseur.
    if (ici instanceof HTMLInputElement) return;
    const dansGroupe = ici.closest("[data-cr-groupe]") !== null;
    if (!fleches && !(dansGroupe && e.key.startsWith("Arrow"))) return;
    const cible = voisinClavier(p, ici, e.key);
    if (cible) {
      e.preventDefault();
      cible.focus();
    }
  };

  return (
    <div className="cr-racine" data-sortie={sortie} onKeyDown={surTouche}>
      <button
        type="button"
        className="cr-voile"
        tabIndex={-1}
        aria-label="Fermer le panneau"
        onClick={onFermer}
      />
      <div
        ref={panneau}
        role="dialog"
        aria-modal="true"
        aria-label={label}
        tabIndex={-1}
        inert={sortie}
        data-sortie={sortie}
        className="cr-panneau"
        style={
          {
            left: place.left,
            bottom: place.bottom,
            width: l,
            transformOrigin: `${place.pointe}px 100%`,
            // Hauteur disponible au-dessus de la ligne de base, moins la marge haute.
            "--cr-hauteur-max": `${Math.max(160, window.innerHeight - place.bottom - 12)}px`,
          } as React.CSSProperties
        }
      >
        <span aria-hidden="true" className="cr-pointe" style={{ left: place.pointe - 6 }} />
        {/* La clé rejoue le fondu d'entrée (inA) du contenu seul. */}
        <div key={cleContenu} className="cr-contenu">
          {children}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Briques de formulaire
// ---------------------------------------------------------------------------------

/** En-tête : pastille (avatar ou carré), titre, sous-titre mono, raccourci à droite. */
export function EnteteCalque({
  pastille,
  titre,
  sousTitre,
  raccourci,
}: {
  pastille: ReactNode;
  titre: string;
  sousTitre: string;
  raccourci?: string;
}) {
  return (
    <div className="cr-entete">
      {pastille}
      <div className="cr-entete-texte">
        <span className="cr-titre">{titre}</span>
        <span className="cr-sous-titre">{sousTitre}</span>
      </div>
      {raccourci && <Kbd>{raccourci}</Kbd>}
    </div>
  );
}

/** Intertitre de champ, avec une indication ou une valeur optionnelle à droite. */
export function EtiquetteChamp({
  children,
  indication,
  valeur,
}: {
  children: ReactNode;
  indication?: string;
  valeur?: string;
}) {
  return (
    <div className="cr-etiquette-ligne">
      <span className="cr-etiquette">{children}</span>
      {indication && <span className="cr-indication">{indication}</span>}
      {valeur && <span className="cr-valeur">{valeur}</span>}
    </div>
  );
}

/**
 * Grille de pastilles de couleur : les 16 couleurs nommées, éclaircies pour rester
 * lisibles, et en tête (si `auto`) la pastille « A » de la couleur automatique.
 * `choisie` null = automatique. Un seul arrêt de tabulation (la pastille choisie) ; les
 * flèches parcourent la grille.
 */
export function Nuancier({
  choisie,
  onChoisir,
  auto,
  colonnes,
  label = "Couleur de l’espace",
}: {
  choisie: string | null;
  onChoisir: (hex: string | null) => void;
  /** Teinte automatique à afficher dans la pastille « A » ; absent = pas de pastille auto. */
  auto?: string;
  colonnes: number;
  label?: string;
}) {
  const decalage = auto ? 1 : 0;
  const idxCouleur = SIDEBAR_COLORS.findIndex((c) => c.hex.toLowerCase() === choisie?.toLowerCase());
  const arret = arretTabulation(
    idxCouleur >= 0 ? idxCouleur + decalage : auto && choisie === null ? 0 : -1,
  );
  return (
    <div
      role="group"
      aria-label={label}
      className="cr-nuancier"
      data-cr-groupe
      data-colonnes={colonnes}
      style={{ "--cr-colonnes": colonnes } as React.CSSProperties}
    >
      {auto && (
        <button
          type="button"
          className="cr-pastille"
          aria-label="Automatique"
          aria-pressed={choisie === null}
          tabIndex={arret === 0 ? 0 : -1}
          title="Automatique : couleur attribuée à la création"
          style={{ "--cr-fond": auto } as React.CSSProperties}
          onClick={() => onChoisir(null)}
        >
          A
        </button>
      )}
      {SIDEBAR_COLORS.map((c, i) => (
        <button
          key={c.hex}
          type="button"
          className="cr-pastille"
          aria-label={c.nom}
          aria-pressed={i === idxCouleur}
          tabIndex={arret === i + decalage ? 0 : -1}
          title={`${c.nom} · ${c.hex}`}
          style={{ "--cr-fond": teinteLisible(c.hex) ?? c.hex } as React.CSSProperties}
          onClick={() => onChoisir(c.hex)}
        />
      ))}
    </div>
  );
}

/** Puces « Aucun » + un chip par groupe, avec le nombre d'espaces de chacun. Un seul arrêt
    de tabulation (la puce choisie) ; les flèches parcourent la rangée. */
export function PucesGroupe({
  courant,
  onChoisir,
}: {
  courant: string | null;
  onChoisir: (groupId: string | null) => void;
}) {
  const groupes = useWorkspaceStore((s) => s.groups);
  const espaces = useWorkspaceStore((s) => s.workspaces);
  const puces = [
    { id: null as string | null, nom: "Aucun" },
    ...groupes.map((g) => ({ id: g.id as string | null, nom: g.name })),
  ];
  const arret = arretTabulation(puces.findIndex((p) => p.id === courant));
  return (
    <div role="group" aria-label="Groupe de l’espace" className="cr-puces" data-cr-groupe>
      {puces.map((p, i) => (
        <button
          key={p.id ?? "aucun"}
          type="button"
          className="cr-puce"
          aria-pressed={p.id === courant}
          tabIndex={i === arret ? 0 : -1}
          onClick={() => onChoisir(p.id)}
        >
          {p.nom}
          <span className="cr-puce-nombre">{espaces.filter((w) => w.groupId === p.id).length}</span>
        </button>
      ))}
    </div>
  );
}

/** Pied de formulaire : Annuler (Échap) et l'action principale (Entrée). */
export function PiedCalque({
  libelle,
  occupe = false,
  onAnnuler,
  onValider,
}: {
  libelle: string;
  occupe?: boolean;
  onAnnuler: () => void;
  onValider: () => void;
}) {
  return (
    <div className="cr-pied">
      <button type="button" className="cr-annuler hov" onClick={onAnnuler}>
        Annuler
        <span className="cr-annuler-touche">Échap</span>
      </button>
      <button type="button" className="cr-valider" aria-busy={occupe} onClick={onValider}>
        {libelle}
        <span className="cr-valider-touche">Entrée</span>
      </button>
    </div>
  );
}

/** Champ dossier : saisie en chemin abrégé (`~/…`), bouton « Parcourir… » (dialogue natif),
    message d'erreur annoncé. */
function ChampDossier({
  valeur,
  erreur,
  onChange,
  home,
}: {
  valeur: string;
  erreur: string;
  onChange: (v: string) => void;
  home: string;
}) {
  const saisie = useRef<HTMLInputElement>(null);
  // Le dialogue GTK est modal et asynchrone : ce garde évite d'en empiler deux.
  const dialogue = useRef(false);

  const parcourir = async () => {
    if (dialogue.current) return;
    dialogue.current = true;
    try {
      const chemin = await open({ directory: true, defaultPath: getLastFolder() });
      if (typeof chemin !== "string") return; // annulation
      onChange(abbreviateHome(chemin, home));
      setLastFolder(chemin);
      saisie.current?.focus();
    } finally {
      dialogue.current = false;
    }
  };

  return (
    <div className="cr-champ">
      <EtiquetteChamp>Dossier</EtiquetteChamp>
      <div className="cr-ligne-dossier">
        <input
          ref={saisie}
          className="cr-saisie"
          data-chemin
          aria-label="Dossier de l’espace"
          aria-invalid={erreur !== ""}
          placeholder="~/dev/projet"
          spellCheck={false}
          autoComplete="off"
          value={valeur}
          onChange={(e) => onChange(e.target.value)}
        />
        <button
          type="button"
          className="cr-parcourir hov"
          title="Choisir un dossier"
          onClick={() => void parcourir()}
        >
          <IconeDossier taille={14} />
          Parcourir…
        </button>
      </div>
      {erreur && (
        <span role="alert" className="cr-erreur">
          {erreur}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------
// Popover de création
// ---------------------------------------------------------------------------------

const LARGEUR_CREATION = 372;

type PopoverCreation = Extract<PopoverEspace, { mode: "creer" }>;

export function SpacePopover() {
  const popover = useUiStore((s) => s.popoverEspace);
  const creation: PopoverCreation | null = popover?.mode === "creer" ? popover : null;
  const autre = useAutreCalque("creation");
  const numero = useNumeroOuverture(creation !== null);
  const { affiche, sortie } = useSortieAnimee<PopoverCreation>(creation, autre);
  const fermer = useUiStore((s) => s.fermerPopoverEspace);
  if (!affiche) return null;
  return <CreerEspace key={numero} groupeInitial={affiche.groupId} sortie={sortie} onFermer={fermer} />;
}

function CreerEspace({
  groupeInitial,
  sortie,
  onFermer,
}: {
  groupeInitial: string | null | undefined;
  sortie: boolean;
  onFermer: () => void;
}) {
  const home = useHome();
  // Sans groupe imposé, l'espace naît dans celui de l'espace actif (comme addWorkspace).
  const groupeActif = useWorkspaceStore(
    (s) => s.workspaces.find((w) => w.id === s.activeId)?.groupId ?? null,
  );
  const [nom, setNom] = useState("");
  const [dossier, setDossier] = useState("");
  const [couleur, setCouleur] = useState<string | null>(null);
  const [choix, setGroupe] = useState<string | null>(
    groupeInitial !== undefined ? groupeInitial : groupeActif,
  );
  // Un groupe supprimé pendant la saisie retombe sur « Aucun ».
  const nomGroupe = useWorkspaceStore((s) => s.groups.find((g) => g.id === choix)?.name);
  const groupe = nomGroupe === undefined ? null : choix;
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  const enCours = useRef(false);

  const cwdApercu = dossier.trim() ? resolveDraft({ name: "", folder: dossier }, home)?.cwd : undefined;
  const auto = couleurAuto(cwdApercu ?? "");
  const base = basename(stripTrailingSlash(dossier.trim()) || "");
  const affiche = nom.trim() || (dossier.trim() ? base : "") || "nouvel espace";
  const teinte = (couleur && teinteLisible(couleur)) || auto;

  const valider = async () => {
    if (enCours.current) return;
    enCours.current = true;
    setOccupe(true);
    try {
      const v = verifierFormulaire({ name: nom, folder: dossier }, home || (await homeDir().catch(() => "")));
      if (!v.ok) return setErreur(v.message);
      if (!(await dossierExiste(v.resolu.cwd))) return setErreur(`Dossier introuvable : ${v.resolu.cwd}`);
      // Créer un espace, c'est vouloir le voir : le récap et la mosaïque s'effacent.
      useDashboardStore.getState().close();
      const ui = useUiStore.getState();
      ui.setVue("terminal");
      const st = useWorkspaceStore.getState();
      const id = st.addWorkspace(v.resolu.cwd, v.resolu.name, groupe);
      if (couleur) st.setWorkspaceColor(id, couleur);
      ui.fermerPopoverEspace();
    } finally {
      enCours.current = false;
      setOccupe(false);
    }
  };

  return (
    <Calque
      ancre={{ type: "ajout" }}
      largeur={LARGEUR_CREATION}
      label="Nouvel espace"
      sortie={sortie}
      onFermer={onFermer}
      onEntree={() => void valider()}
    >
      <EnteteCalque
        pastille={<Avatar monogramme={monogramme(affiche)} couleur={teinte} actif taille={34} />}
        titre="Nouvel espace"
        sousTitre={`${affiche} · ${groupe ? `groupe ${nomGroupe ?? ""}`.trim() : "hors groupe"}`}
        raccourci="Ctrl+Maj+N"
      />
      <div className="cr-corps">
        <div className="cr-champ">
          <EtiquetteChamp indication="vide : nom du dossier">Nom</EtiquetteChamp>
          <input
            className="cr-saisie"
            data-cr-focus
            aria-label="Nom de l’espace"
            placeholder={base || "nom"}
            autoComplete="off"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
          />
        </div>
        <ChampDossier
          valeur={dossier}
          erreur={erreur}
          home={home}
          onChange={(v) => {
            setDossier(v);
            setErreur("");
          }}
        />
        <div className="cr-champ" data-nuancier>
          <EtiquetteChamp valeur={libelleCouleur(couleur)}>Couleur</EtiquetteChamp>
          <Nuancier choisie={couleur} onChoisir={setCouleur} auto={auto} colonnes={9} />
        </div>
        <div className="cr-champ" data-puces>
          <EtiquetteChamp>Groupe</EtiquetteChamp>
          <PucesGroupe courant={groupe} onChoisir={setGroupe} />
        </div>
      </div>
      <PiedCalque libelle="Créer l’espace" occupe={occupe} onAnnuler={onFermer} onValider={() => void valider()} />
    </Calque>
  );
}

// ---------------------------------------------------------------------------------
// Formulaire de modification (contenu du panneau d'espace, voir SpaceMenu)
// ---------------------------------------------------------------------------------

/**
 * Contenu « Modifier l’espace » : nom et dossier. Rendu dans le même panneau que le menu
 * d'espace, qui gère Échap (retour au menu ou fermeture) ; Entrée dans un champ valide ici.
 */
export function ContenuModification({
  ws,
  onAnnuler,
  onFini,
}: {
  ws: Workspace;
  /** Bouton Annuler (même effet qu'Échap). */
  onAnnuler: () => void;
  /** Enregistrement réussi : ferme le panneau. */
  onFini: () => void;
}) {
  const home = useHome();
  const [nom, setNom] = useState(ws.name);
  // Tant que l'utilisateur n'a rien tapé, le dossier suit $HOME (résolu après l'ouverture).
  const [saisie, setSaisie] = useState<string | null>(null);
  const dossier = saisie ?? abbreviateHome(ws.cwd, home);
  const [erreur, setErreur] = useState("");
  const [occupe, setOccupe] = useState(false);
  const enCours = useRef(false);

  const base = basename(stripTrailingSlash(dossier.trim()) || "");
  const affiche = nom.trim() || base || ws.name;

  const valider = async () => {
    if (enCours.current) return;
    enCours.current = true;
    setOccupe(true);
    try {
      const v = verifierFormulaire({ name: nom, folder: dossier }, home || (await homeDir().catch(() => "")));
      if (!v.ok) return setErreur(v.message);
      const change = v.resolu.cwd !== ws.cwd;
      if (change && !(await dossierExiste(v.resolu.cwd))) {
        return setErreur(`Dossier introuvable : ${v.resolu.cwd}`);
      }
      const st = useWorkspaceStore.getState();
      // Le dossier d'abord : le repli « nom vide → nom du dossier » de renameWorkspace
      // doit porter sur le NOUVEAU dossier. Changer le cwd relance les onglets.
      if (change) {
        st.setCwd(ws.id, v.resolu.cwd);
        st.showToast("dossier changé — terminaux relancés");
      }
      st.renameWorkspace(ws.id, v.resolu.name ?? "");
      onFini();
    } finally {
      enCours.current = false;
      setOccupe(false);
    }
  };

  // Entrée dans un champ : enregistrer. Le panneau partagé avec le menu n'a pas d'action
  // d'Entrée propre, d'où cette enveloppe (sans boîte, voir .cr-forme).
  const surTouche = (e: ClavierReact<HTMLDivElement>) => {
    if (e.key !== "Enter" || !(e.target instanceof HTMLInputElement) || e.nativeEvent.isComposing) return;
    e.preventDefault();
    e.stopPropagation();
    void valider();
  };

  return (
    <div className="cr-forme" onKeyDown={surTouche}>
      <EnteteCalque
        pastille={<Avatar monogramme={monogramme(affiche)} couleur={couleurEspace(ws)} actif taille={34} />}
        titre="Modifier l’espace"
        sousTitre={ws.name}
        raccourci="Ctrl+Maj+R"
      />
      <div className="cr-corps">
        <div className="cr-champ">
          <EtiquetteChamp>Nom</EtiquetteChamp>
          <input
            className="cr-saisie"
            data-cr-focus
            aria-label="Nouveau nom de l’espace"
            placeholder={base || "nom"}
            autoComplete="off"
            value={nom}
            onChange={(e) => setNom(e.target.value)}
          />
        </div>
        <ChampDossier
          valeur={dossier}
          erreur={erreur}
          home={home}
          onChange={(v) => {
            setSaisie(v);
            setErreur("");
          }}
        />
      </div>
      <PiedCalque libelle="Enregistrer" occupe={occupe} onAnnuler={onAnnuler} onValider={() => void valider()} />
    </div>
  );
}
