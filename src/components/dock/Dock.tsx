import { decalageInfobulle } from "../../lib/infobulleBord";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type MouseEvent,
} from "react";
import { useWorkspaceStore, navigableOrder, type Workspace } from "../../store/workspace";
import { useUiStore, calqueAncreOuvert } from "../../store/ui";
import { useDashboardStore } from "../../store/dashboard";
import { couleurGroupe } from "../../lib/couleurEspace";
import { etatVisuelAvatar, type EtatAgent, type SourcesTravail } from "../../lib/etatAgent";
import { dispatchShortcut } from "../../lib/shortcutDispatch";
import { focusTab } from "../../lib/tabFocus";
import {
  segmentsDock,
  replisAutomatiques,
  consulterGroupe,
  pileGroupe,
  placeMembre,
  abscisseIndicateur,
  largeurEtiquette,
  largeurMembres,
  geometrieAvatars,
} from "../../lib/dockLayout";
import { TAILLE_AVATAR_DOCK } from "../../lib/reglages";
import { useReglagesStore } from "../../store/reglages";
import {
  cleEtatsEspaces,
  detailEspace,
  infoPile,
  libelleEtiquette,
  lireCleEtats,
  raccourciEspace,
} from "../../lib/dockInfo";
import { espacesDisparus } from "../../lib/espacesRecents";
import { mouvementReduit } from "../../lib/mouvement";
import {
  DUREE_DISPARITION_MS,
  abscisseIndicateurNav,
  indicateurDansBande,
  avecFantomes,
  cibleIndicateur,
  type GeometrieDock,
} from "../../lib/dockFantomes";
import { IconButton } from "../ui/IconButton";
import { IconeActivite, IconeMosaique, IconePlus, IconeRecherche } from "../ui/icons";
import { DockAvatar } from "./DockAvatar";
import { DockMenuGroupe } from "./DockMenuGroupe";
import { MarqueSuperviseur } from "../superviseur/MarqueSuperviseur";
import { POIGNEE_INERTE, clePoignee, useGlisserDock } from "./useGlisserDock";
import { useRappelStable } from "./useRappelStable";
import "../../styles/dock.css";

/**
 * Dock flottant du bas : la navigation de l'app (maquettes Dock et Groupes).
 *
 * Avatars d'espaces (hors groupe d'abord, puis chaque groupe derrière son étiquette),
 * indicateur d'accent qui glisse sous l'espace ouvert — ou sous « Mosaïque » et
 * « Activité » quand leur vue est affichée (maquettes Mosaique et Recap) —, puis « + »,
 * mosaïque, activité et palette. Un espace fermé s'efface sur place (maquette Creation)
 * avant que ses voisins ne glissent. Un groupe se replie (clic sur son étiquette) en pile d'avatars superposés qui
 * remonte l'état de ses membres ; quand la largeur manque, les groupes les moins
 * récemment consultés se replient d'eux-mêmes, et en dernier recours la bande défile,
 * bords estompés.
 *
 * Le dock pose les ancres des calques (data-ws-id, data-dock-add, data-dock-group) mais ne
 * les rend pas : ils vivent au niveau d'App. Seul le menu d'un groupe est rendu ici, en
 * frère du dock (jamais dedans, cf. DockMenuGroupe).
 */

/** Marge de la fenêtre que le dock laisse de chaque côté (max-width: calc(100% - 24px)). */
const MARGE_FENETRE = 24;
/** Place réservée au-dessus des avatars quand la bande défile : un conteneur qui défile
    rogne aussi verticalement, et les infobulles doivent tenir dedans. */
const RESERVE_INFOBULLE = 140;
/** Durée de l'entrée d'un nouvel espace (keyframes dock-apparition, 0,55 s, et
    dock-chute, 0,56 s). */
const DUREE_APPARITION = 560;

const GEOMETRIE_VIDE: GeometrieDock = { bande: 0, defile: 0, largeur: 0, mosaique: 0, activite: 0 };

/** Fantômes en cours : la liste du store reçue au dernier rendu, la liste affichée (avec
    les espaces fermés qui s'effacent encore) et les ids de ces fantômes. */
interface Affichage {
  source: Workspace[];
  affiche: Workspace[];
  fantomes: ReadonlySet<string>;
}

/** Sélecteur des états d'agent de tous les espaces, rendu en CHAÎNE : le dock ne se
    re-rend que quand un état change, pas à chaque tour des sondes. */
function cleEtats(s: SourcesTravail & { workspaces: Workspace[] }): string {
  return cleEtatsEspaces(s.workspaces, s);
}

/** Rend la saisie au terminal de l'espace actif (fermeture d'un calque). */
function rendreFocusTerminal() {
  const s = useWorkspaceStore.getState();
  const w = s.workspaces.find((x) => x.id === s.activeId);
  if (w?.activeTabId) focusTab(w.activeTabId);
}

/** Largeur des bords estompés de la bande qui défile (dock.css, `mask-image`). */
const FONDU_BANDE = 28;

/**
 * Recadre l'infobulle de l'avatar (ou de la pile) survolé ou focalisé dans la bande :
 * `--tip-dx` (ui.css) la décale pour qu'elle reste dans la partie visible de la bande quand
 * celle-ci défile ; remis à zéro sinon. Mesure faite décalage retiré.
 */
function recadrerInfobulle(cible: EventTarget, bande: HTMLElement | null, defile: boolean): void {
  if (!bande || !(cible instanceof Element)) return;
  const hote = cible.closest(".dock-btn, .dock-pile");
  const bulle = hote?.querySelector<HTMLElement>(":scope > .ui-tip");
  if (!bulle) return;
  bulle.style.removeProperty("--tip-dx");
  if (!defile) return;
  const r = bulle.getBoundingClientRect();
  const z = bande.getBoundingClientRect();
  const dx = decalageInfobulle({ gauche: r.left, largeur: r.width }, { gauche: z.left, droite: z.right }, FONDU_BANDE);
  if (dx !== 0) bulle.style.setProperty("--tip-dx", `${dx}px`);
}

export function Dock({ accueil = false }: { accueil?: boolean }) {
  const visible = useUiStore((s) => s.dockVisible);
  const vue = useUiStore((s) => s.vue);
  const calqueAncre = useUiStore(calqueAncreOuvert);
  const paletteOuverte = useUiStore((s) => s.paletteOuverte);
  const menuEspace = useUiStore((s) => s.menuEspace);
  // Espace en cours de modification : la fiche ouverte depuis son menu en est la suite,
  // l'avatar reste « déplié » (aria-expanded) tant qu'elle est affichée.
  const modifieId = useUiStore((s) => (s.popoverEspace?.mode === "modifier" ? s.popoverEspace.wsId : null));
  const creationOuverte = useUiStore((s) => s.popoverEspace?.mode === "creer");
  const menuAjout = useUiStore((s) => s.menuAjout);
  const menuGroupe = useUiStore((s) => s.menuGroupe);
  // Avatar sous la bulle « vous attend » : son infobulle se tait (la bulle la remplace).
  const bulleEspace = useUiStore((s) => s.bulleEspace);

  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const groups = useWorkspaceStore((s) => s.groups);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const cle = useWorkspaceStore(cleEtats);

  // Densité du dock (Paramètres › Apparence) : taille des avatars, et avec elle toutes les
  // mesures de la bande (lib/dockLayout) ; la feuille suit par --dock-avatar.
  const taille = useReglagesStore((s) => TAILLE_AVATAR_DOCK[s.reglages.apparence.densite]);
  const geoAvatars = geometrieAvatars(taille);

  const recapOuvert = useDashboardStore((s) => s.open);
  const resumeNonLu = useDashboardStore((s) => s.unreadSummary);

  const enveloppeRef = useRef<HTMLDivElement>(null);
  const navRef = useRef<HTMLElement>(null);
  const bandeRef = useRef<HTMLDivElement>(null);

  const glisser = useGlisserDock(bandeRef);

  // --- Disparition des espaces fermés (fantômes) ---
  // État dérivé, recalculé PENDANT le rendu où le store retire l'espace : l'avatar ne
  // manque jamais une image avant de s'effacer. Le store, lui, a déjà fermé les PTY.
  const [affichage, setAffichage] = useState<Affichage>(() => ({
    source: workspaces,
    affiche: workspaces,
    fantomes: new Set(),
  }));
  let { affiche, fantomes } = affichage;
  if (affichage.source !== workspaces) {
    const presents = new Set(workspaces.map((w) => w.id));
    const suite = new Set([...fantomes].filter((id) => !presents.has(id)));
    if (!mouvementReduit()) for (const w of espacesDisparus(affichage.source, workspaces)) suite.add(w.id);
    affiche = suite.size ? avecFantomes(workspaces, affichage.affiche, suite) : workspaces;
    // Mêmes fantômes (une sonde a seulement réalloué la liste) : même Set, sinon la
    // minuterie d'effacement repartirait de zéro à chaque tour des sondes.
    const inchange = suite.size === fantomes.size && [...suite].every((id) => fantomes.has(id));
    if (!inchange) fantomes = suite;
    setAffichage({ source: workspaces, affiche, fantomes });
  }
  useEffect(() => {
    if (fantomes.size === 0) return;
    const h = window.setTimeout(
      () => setAffichage((a) => ({ source: a.source, affiche: a.source, fantomes: new Set() })),
      DUREE_DISPARITION_MS,
    );
    return () => window.clearTimeout(h);
  }, [fantomes]);

  // Poignées de glisser des espaces et groupes disparus : oubliées.
  const purger = glisser.purger;
  useEffect(() => {
    purger(
      new Set([
        ...workspaces.map((w) => clePoignee(w.id, "ws")),
        ...groups.map((g) => clePoignee(g.id, "group")),
      ]),
    );
  }, [workspaces, groups, purger]);

  // --- États d'agent ---
  const etats = useMemo(() => lireCleEtats(cle), [cle]);
  const etatDe = (id: string): EtatAgent => etats.get(id) ?? "repos";
  // États tels qu'une pile les dessine : « terminé » y compte comme le repos.
  const etatsPile = useMemo(() => {
    const m = new Map<string, "travail" | "attente" | "repos">();
    for (const [id, e] of etats) m.set(id, etatVisuelAvatar(e));
    return m;
  }, [etats]);

  // --- Groupes récemment consultés (repli automatique : les moins récents cèdent) ---
  const [recents, setRecents] = useState<string[]>([]);
  const consulter = useCallback((gid: string) => setRecents((r) => consulterGroupe(r, gid)), []);

  // Arriver sur un espace (dock, palette, Ctrl+1…9) consulte son groupe ; s'il était replié
  // à la main, il se déplie : l'espace ouvert doit se voir dans le dock. Pas au démarrage
  // (première activation) : un repli choisi lors de la session précédente est respecté.
  const actifPrecedent = useRef<string | null>(null);
  useEffect(() => {
    const avant = actifPrecedent.current;
    actifPrecedent.current = activeId;
    if (!activeId || activeId === avant) return;
    const s = useWorkspaceStore.getState();
    const gid = s.workspaces.find((w) => w.id === activeId)?.groupId;
    if (!gid) return;
    consulter(gid);
    if (avant !== null && s.groups.find((g) => g.id === gid)?.collapsed) s.toggleGroupCollapsed(gid);
  }, [activeId, consulter]);

  // --- Place disponible pour la bande ---
  // Tout le reste du dock (marges, « + », mosaïque, activité, palette) a une largeur fixe :
  // largeur du dock moins largeur de la bande. La bande, elle, est estimée au pixel près
  // (lib/dockLayout), ce qui évite toute boucle mesure → repli → mesure.
  const [disponible, setDisponible] = useState(Infinity);
  // Repères de l'indicateur dans le <nav> : bord de la bande, boutons Mosaïque et Activité.
  // Ces boutons suivent la largeur de la bande (repli d'un groupe) : relus à chaque
  // redimensionnement du <nav>, image par image pendant la transition.
  const [geo, setGeo] = useState<GeometrieDock>(GEOMETRIE_VIDE);
  const mesurer = useCallback(() => {
    const env = enveloppeRef.current;
    const nav = navRef.current;
    if (!env || !nav) return;
    const bande = bandeRef.current;
    const suivant: GeometrieDock = {
      bande: bande?.offsetLeft ?? 0,
      defile: bande?.scrollLeft ?? 0,
      largeur: bande?.clientWidth ?? 0,
      mosaique: nav.querySelector<HTMLElement>(".dock-mosaique")?.offsetLeft ?? 0,
      activite: nav.querySelector<HTMLElement>(".dock-activite")?.offsetLeft ?? 0,
    };
    setGeo((g) =>
      g.bande === suivant.bande &&
      g.defile === suivant.defile &&
      g.largeur === suivant.largeur &&
      g.mosaique === suivant.mosaique &&
      g.activite === suivant.activite
        ? g
        : suivant,
    );
    if (!bande) return;
    const reste = nav.getBoundingClientRect().width - bande.getBoundingClientRect().width;
    const dispo = Math.floor(env.clientWidth - MARGE_FENETRE - reste);
    setDisponible((d) => (d === dispo ? d : dispo));
  }, []);
  const avecBande = visible && workspaces.length > 0;
  useLayoutEffect(() => {
    if (!visible) return;
    mesurer();
    const ro = new ResizeObserver(mesurer);
    if (enveloppeRef.current) ro.observe(enveloppeRef.current);
    if (navRef.current) ro.observe(navRef.current);
    return () => ro.disconnect();
  }, [visible, avecBande, mesurer]);

  // --- Disposition ---
  // Segments de la liste AFFICHÉE : un espace fermé y garde sa place le temps de s'effacer.
  const segments = useMemo(() => segmentsDock(affiche, groups), [affiche, groups]);
  const groupeActif = workspaces.find((w) => w.id === activeId)?.groupId ?? null;
  const replisManuels = useMemo(() => new Set(groups.filter((g) => g.collapsed).map((g) => g.id)), [groups]);
  const repli = useMemo(
    () => replisAutomatiques({ segments, replisManuels, recents, groupeActif, disponible, taille }),
    [segments, replisManuels, recents, groupeActif, disponible, taille],
  );
  const navigables = useMemo(() => navigableOrder(workspaces, groups).map((w) => w.id), [workspaces, groups]);

  // Espace « ouvert » : son terminal est affiché. Dans la mosaïque et le récap, aucun
  // avatar n'est marqué ouvert (maquettes) : l'indicateur glisse alors sous le bouton de
  // la vue affichée (Mosaïque, Activité).
  const ouvertId = vue === "terminal" && !recapOuvert ? activeId : null;
  const indicateur = abscisseIndicateur(segments, repli.replis, ouvertId, taille);
  const cibleTrait = cibleIndicateur(recapOuvert, vue);
  const xIndicateur = abscisseIndicateurNav(cibleTrait, indicateur, geo);
  // Avatar ouvert sorti de la bande qui défile : le trait s'efface au lieu de tomber hors
  // du dock.
  const indicateurVisible = xIndicateur !== null && indicateurDansBande(cibleTrait, xIndicateur, taille, geo);
  // Effacé (aucun espace ouvert), l'indicateur reste où il était : il réapparaît sur
  // place au lieu de glisser depuis le bord.
  const derniereX = useRef(0);
  useEffect(() => {
    if (xIndicateur !== null) derniereX.current = xIndicateur;
  }, [xIndicateur]);

  // --- Défilement de la bande (dernier recours) ---
  const [bords, setBords] = useState({ gauche: false, droite: false });
  const lireBords = useCallback(() => {
    const b = bandeRef.current;
    if (!b) return;
    // L'indicateur suit le défilement de la bande sans transition (cf. dockFantomes).
    setGeo((g) => (g.defile === b.scrollLeft ? g : { ...g, defile: b.scrollLeft }));
    const gauche = b.scrollLeft > 2;
    const droite = b.scrollLeft + b.clientWidth < b.scrollWidth - 2;
    setBords((p) => (p.gauche === gauche && p.droite === droite ? p : { gauche, droite }));
  }, []);
  useLayoutEffect(lireBords, [lireBords, repli.defile, disponible, segments]);

  // L'espace ouvert reste visible quand la bande défile.
  const bouton = geoAvatars.bouton;
  useEffect(() => {
    const b = bandeRef.current;
    if (!b || !repli.defile || indicateur === null) return;
    const marge = 28;
    let cible: number | null = null;
    if (indicateur < b.scrollLeft + marge) cible = indicateur - marge;
    else if (indicateur + bouton > b.scrollLeft + b.clientWidth - marge) cible = indicateur + bouton - b.clientWidth + marge;
    if (cible === null) return;
    const doux = !mouvementReduit();
    b.scrollTo({ left: Math.max(0, cible), behavior: doux ? "smooth" : "auto" });
  }, [indicateur, repli.defile, bouton]);

  // --- Apparition des nouveaux espaces (pas au premier rendu : rien n'est « nouveau ») ---
  const connus = useRef<Set<string> | null>(null);
  const minuterie = useRef<number | undefined>(undefined);
  const [nouveaux, setNouveaux] = useState<ReadonlySet<string>>(new Set());
  // Premier espace ouvert depuis l'accueil (maquette Accueil) : sa place s'ouvre dans le dock
  // et il y tombe d'en haut (slot + drop), au lieu de jaillir d'en bas comme les suivants
  // (maquette Creation). Pas au démarrage : la restauration ne passe pas par l'accueil.
  const [chute, setChute] = useState(false);
  const accueilAvant = useRef(accueil);
  useEffect(() => {
    const ids = workspaces.map((w) => w.id);
    const avant = connus.current;
    connus.current = new Set(ids);
    if (!avant) return;
    const neufs = ids.filter((id) => !avant.has(id));
    if (!neufs.length) return;
    setNouveaux(new Set(neufs));
    setChute(avant.size === 0 && accueilAvant.current);
    // Minuterie hors des dépendances : les sondes (branche, ports) réallouent `workspaces`
    // bien avant la fin du rebond, et ne doivent pas l'annuler.
    window.clearTimeout(minuterie.current);
    minuterie.current = window.setTimeout(() => {
      setNouveaux(new Set());
      setChute(false);
    }, DUREE_APPARITION);
  }, [workspaces]);
  // Déclaré APRÈS l'effet ci-dessus : il y lit encore la valeur du rendu précédent (accueil
  // affiché juste avant que le premier espace n'arrive).
  useEffect(() => {
    accueilAvant.current = accueil;
  }, [accueil]);
  useEffect(() => () => window.clearTimeout(minuterie.current), []);

  // --- Menu de groupe : calque du store ui, exclusif avec les autres (ouvrir l'un
  // ferme les autres, masquer le dock le referme, un groupe supprimé l'oublie). ---
  const groupeDuMenu = menuGroupe ? groups.find((g) => g.id === menuGroupe) : undefined;

  const ouvrirMenuGroupe = (e: MouseEvent, gid: string) => {
    e.preventDefault();
    e.stopPropagation();
    useUiStore.getState().ouvrirMenuGroupe(gid);
  };
  const fermerMenuGroupe = (rendreFocus: boolean) => {
    useUiStore.getState().fermerMenuGroupe();
    if (rendreFocus) rendreFocusTerminal();
  };

  // Rappels des avatars : stables d'un rendu à l'autre (useRappelStable), sinon chaque
  // rendu du dock re-rendrait tous les avatars mémoïsés.
  const choisirEspace = useRappelStable((wsId: string) => {
    if (glisser.clicAvale()) return;
    const ui = useUiStore.getState();
    if (wsId === ouvertId) {
      // L'espace déjà ouvert : son menu (même chemin que le clic droit). Un second clic
      // referme ce qui est déplié, menu ou fiche de modification de ce même espace, au lieu
      // de rebasculer de la fiche vers le menu.
      const p = ui.popoverEspace;
      if (ui.menuEspace === wsId) ui.fermerMenuEspace();
      else if (p?.mode === "modifier" && p.wsId === wsId) ui.fermerPopoverEspace();
      else ui.ouvrirMenuEspace(wsId);
      return;
    }
    // Choisir un espace, c'est vouloir son terminal : récap et mosaïque s'effacent. Seule
    // la vue des fichiers modifiés reste ouverte et passe à l'espace choisi (maquette Diff/09).
    useDashboardStore.getState().close();
    ui.fermerCalques();
    if (ui.vue !== "terminal") ui.setVue("terminal");
    useWorkspaceStore.getState().setActive(wsId, { garderDiff: true });
  });

  const menuAvatar = useRappelStable((e: MouseEvent, wsId: string) => {
    e.preventDefault();
    e.stopPropagation();
    useUiStore.getState().ouvrirMenuEspace(wsId);
  });

  if (!visible) return null;

  // --- Actions ---
  const basculerGroupe = (gid: string) => {
    const s = useWorkspaceStore.getState();
    const g = s.groups.find((x) => x.id === gid);
    if (!g) return;
    const replieAffiche = repli.replis.has(gid);
    if (!replieAffiche) {
      if (!g.collapsed) s.toggleGroupCollapsed(gid);
      return;
    }
    // Déplier : il devient le dernier consulté, donc protégé du repli automatique (un
    // autre groupe cédera sa place s'il le faut).
    if (g.collapsed) s.toggleGroupCollapsed(gid);
    consulter(gid);
  };

  const plus = () => {
    const ui = useUiStore.getState();
    // Sans espace (accueil), le « + » ouvre le menu d'ajout (nouvel espace, dossier,
    // reprendre : maquette Accueil/05). Dès qu'un espace existe, il mène droit au
    // formulaire de création et devient × (maquette Creation/04) ; les espaces à
    // reprendre restent proposés par la palette et l'accueil.
    if (workspaces.length === 0 || ui.menuAjout) {
      ui.basculerMenuAjout();
      return;
    }
    if (ui.popoverEspace?.mode === "creer") ui.fermerPopoverEspace();
    else ui.ouvrirPopoverEspace({ mode: "creer" });
  };

  // --- Rendu ---
  const avecGroupes = groups.length > 0;
  const enMosaique = vue === "mosaique";
  const eleve = calqueAncre;
  // Infobulles tues pendant un calque ancré ou un glissement : elles masqueraient le
  // popover, ou suivraient le pointeur d'avatar en avatar.
  const calme = eleve || glisser.glisseId !== null;
  const cible = glisser.visee?.cible;

  return (
    <>
      <div
        ref={enveloppeRef}
        className="dock-enveloppe"
        data-eleve={eleve || undefined}
      >
        <nav
          ref={navRef}
          aria-label="Espaces de travail"
          className="dock-nav"
          data-calme={calme || undefined}
          // Le dock reste cliquable au-dessus du voile du menu de groupe : un clic ailleurs
          // dans le dock le referme, comme un clic sur le voile.
          onClickCapture={() => {
            if (menuGroupe) useUiStore.getState().fermerMenuGroupe();
          }}
        >
          {/* Marque du superviseur (maquette Superviseur) : à l'extrême gauche, suivie de
              son séparateur ; rien quand il est désactivé. Ses mesures entrent d'elles-mêmes
              dans `reste` (largeur du nav hors bande) et dans le bord de la bande. */}
          <MarqueSuperviseur />

          {workspaces.length > 0 && (
            <div
              ref={bandeRef}
              className="dock-bande"
              data-defile={repli.defile || undefined}
              onScroll={lireBords}
              // Infobulle d'un avatar collé au bord d'une bande qui défile : décalée pour
              // rester entière et hors des bords estompés (sinon rognée, maquette Groupes).
              onPointerOver={(e) => recadrerInfobulle(e.target, bandeRef.current, repli.defile)}
              onFocus={(e) => recadrerInfobulle(e.target, bandeRef.current, repli.defile)}
              onWheel={(e) => {
                // Molette verticale → défilement horizontal de la bande.
                const b = bandeRef.current;
                if (!b || !repli.defile || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
                b.scrollLeft += e.deltaY;
              }}
              style={
                {
                  "--dock-fondu-g": repli.defile && bords.gauche ? "transparent" : "#000",
                  "--dock-fondu-d": repli.defile && bords.droite ? "transparent" : "#000",
                } as CSSProperties
              }
            >
              {segments.map((seg, si) => {
                const estGroupe = seg.id !== null;
                const groupe = estGroupe ? groups.find((g) => g.id === seg.id) : undefined;
                const replie = estGroupe && repli.replis.has(seg.id!);
                const ids = seg.membres.map((w) => w.id);
                const pile = pileGroupe(ids, etatsPile, activeId);
                const enTete = avecGroupes
                  ? { nom: seg.nom, couleur: groupe ? couleurGroupe(groupe) : "var(--texte-discret)" }
                  : null;
                const cibleIci = cible?.kind === "into-group" && cible.groupId === seg.id;
                const nbMembres = seg.membres.length;

                // Infobulle de la pile : qui réclame, sinon pourquoi c'est replié.
                const attente = seg.membres.find((w) => etatDe(w.id) === "attente");
                const travail = seg.membres.find((w) => etatDe(w.id) === "travail");
                const info = replie
                  ? infoPile({
                      nomGroupe: seg.nom,
                      nbMembres,
                      attente: attente ? { nom: attente.name, texte: detailEspace(attente, "attente").texte } : null,
                      travail: travail ? { nom: travail.name, texte: detailEspace(travail, "travail").texte } : null,
                      auto: repli.auto.has(seg.id!),
                    })
                  : null;

                return [
                  <div
                    key={seg.id ?? "hors-groupe"}
                    role="group"
                    aria-label={estGroupe ? `Groupe ${seg.nom}` : "Hors groupe"}
                    className="dock-segment"
                    data-dock-segment=""
                    data-groupe={estGroupe || undefined}
                    data-cible={cibleIci || undefined}
                    // Replié, tout le segment (étiquette + pile) reçoit un espace déposé.
                    data-dock-row={replie ? "group" : undefined}
                    data-group-id={replie ? seg.id! : undefined}
                    onContextMenu={estGroupe ? (e) => ouvrirMenuGroupe(e, seg.id!) : undefined}
                  >
                    {estGroupe && groupe && (
                      <button
                        type="button"
                        className="hov dock-etiquette"
                        data-dock-group={seg.id!}
                        data-dock-row={replie ? undefined : "group"}
                        data-group-id={replie ? undefined : seg.id!}
                        data-glisse={glisser.glisseId === seg.id || undefined}
                        aria-expanded={!replie}
                        aria-label={libelleEtiquette(seg.nom, nbMembres, replie)}
                        style={{ width: largeurEtiquette(seg.nom) }}
                        onClick={() => {
                          if (glisser.clicAvale()) return;
                          basculerGroupe(seg.id!);
                        }}
                        onMouseDown={(e) => {
                          if (e.button === 0) e.preventDefault();
                        }}
                        {...glisser.poignee(seg.id!, "group")}
                      >
                        <span className="dock-carre" aria-hidden="true" style={{ background: couleurGroupe(groupe) }} />
                        <span className="dock-etiquette-nom">{seg.nom}</span>
                      </button>
                    )}
                    <div
                      className="dock-membres"
                      data-sautille={(replie && pile.etat === "attente") || undefined}
                      data-place={chute || undefined}
                      style={{ width: largeurMembres(nbMembres, replie, taille) }}
                    >
                      {/* Un groupe vide replié n'a pas de pile (0 px de large) : pas de bouton
                          invisible dans l'ordre de tabulation, son étiquette suffit à déplier. */}
                      {replie && info && nbMembres > 0 && (
                        <button
                          type="button"
                          className="dock-pile"
                          aria-label={info.libelle}
                          onClick={() => basculerGroupe(seg.id!)}
                          onMouseDown={(e) => {
                            if (e.button === 0) e.preventDefault();
                          }}
                        >
                          <span className="ui-tip" aria-hidden="true" style={{ bottom: geoAvatars.infobulle }}>
                            <span className="ui-tip-titre">
                              <span className="dock-tip-nom-groupe">
                                <span className="dock-carre" style={{ background: enTete?.couleur }} />
                                {seg.nom}
                              </span>
                              <span className="ui-kbd">{info.compte}</span>
                            </span>
                            <span className="ui-tip-detail dock-tip-ligne" data-ton={info.ton}>
                              {info.sousTitre}
                            </span>
                          </span>
                        </button>
                      )}
                      {seg.membres.map((w, i) => {
                        const rangPile = pile.ordre.indexOf(w.id);
                        const place = placeMembre(i, rangPile, replie, taille);
                        const ouvert = w.id === ouvertId;
                        const fantome = fantomes.has(w.id);
                        // Dans une pile, seul le représentant porte l'état du groupe ; hors
                        // pile, l'avatar lit lui-même l'état de son agent.
                        const etatPile: EtatAgent | null = replie
                          ? w.id === pile.representant
                            ? pile.etat
                            : "repos"
                          : null;
                        return (
                          <DockAvatar
                            key={w.id}
                            wsId={w.id}
                            taille={taille}
                            fantome={fantome ? w : undefined}
                            etatPile={etatPile}
                            ouvert={ouvert}
                            menuOuvert={menuEspace === w.id || modifieId === w.id}
                            sousBulle={bulleEspace === w.id}
                            dansGroupe={estGroupe}
                            replie={replie}
                            x={place.x}
                            z={place.z}
                            visible={place.visible}
                            groupeNom={enTete?.nom ?? null}
                            groupeCouleur={enTete?.couleur ?? null}
                            raccourci={raccourciEspace(navigables, w.id)}
                            glisse={glisser.glisseId === w.id}
                            apparition={nouveaux.has(w.id) ? (chute ? "chute" : "rebond") : null}
                            onChoisir={choisirEspace}
                            onMenu={menuAvatar}
                            poignee={fantome ? POIGNEE_INERTE : glisser.poignee(w.id, "ws")}
                          />
                        );
                      })}
                      {estGroupe && nbMembres > 0 && (
                        <span
                          className="dock-compte"
                          aria-hidden="true"
                          data-visible={replie || undefined}
                          style={{ left: geoAvatars.compteur }}
                        >
                          {nbMembres}
                        </span>
                      )}
                    </div>
                  </div>,
                  // Filet entre le hors-groupe et les groupes.
                  !estGroupe && si < segments.length - 1 ? (
                    <span key="sep-hors-groupe" className="dock-sep" aria-hidden="true" />
                  ) : null,
                ];
              })}

              {glisser.visee?.trait != null && (
                <span
                  aria-hidden="true"
                  className="dock-trait"
                  style={{
                    left: glisser.visee.trait,
                    top: (repli.defile ? RESERVE_INFOBULLE : 0) + (geoAvatars.bouton - geoAvatars.filet) / 2,
                  }}
                />
              )}
            </div>
          )}

          {/* Indicateur d'accent, au niveau du <nav> : il glisse d'un avatar de la bande aux
              boutons Mosaïque et Activité. La boîte extérieure suit le défilement de la
              bande sans transition, l'intérieure glisse d'une cible à l'autre. */}
          <span
            aria-hidden="true"
            className="dock-indicateur"
            style={{ transform: `translateX(${-geo.defile}px)`, opacity: indicateurVisible ? 1 : 0 }}
          >
            <span
              className="dock-indicateur-glisse"
              style={{ transform: `translateX(${xIndicateur ?? derniereX.current}px)` }}
            >
              <span />
            </span>
          </span>

          {workspaces.length > 0 && <span className="dock-sep" aria-hidden="true" />}

          <IconButton
            label="Nouvel espace (Ctrl+Maj+N)"
            taille={taille}
            className="dock-plus"
            data-dock-add=""
            aria-haspopup="dialog"
            aria-expanded={creationOuverte || menuAjout}
            data-rotation={creationOuverte || undefined}
            onClick={plus}
          >
            <IconePlus />
          </IconButton>

          {/* Dock de l'accueil (aucun espace) : « + », Activité et Ctrl K seulement, comme la
              maquette Accueil ; une mosaïque vide n'aurait rien à montrer. */}
          {workspaces.length > 0 && (
            <IconButton
              label="Mosaïque des agents (Ctrl+Maj+M)"
              taille={taille}
              className="dock-mosaique"
              aria-pressed={enMosaique}
              onClick={() => dispatchShortcut({ type: "toggle-mosaique" })}
            >
              <IconeMosaique />
            </IconButton>
          )}

          <IconButton
            label={resumeNonLu ? "Activité de la journée (Ctrl+Maj+H), nouveau résumé" : "Activité de la journée (Ctrl+Maj+H)"}
            title="Activité de la journée (Ctrl+Maj+H)"
            taille={taille}
            className="dock-activite"
            aria-pressed={recapOuvert}
            onClick={() => dispatchShortcut({ type: "toggle-dashboard" })}
          >
            <IconeActivite />
            {/* Résumé de la journée prêt et pas encore lu (ex-pastille de la barre latérale). */}
            {resumeNonLu && !recapOuvert && <span className="dock-non-lu" aria-hidden="true" />}
          </IconButton>

          <button
            type="button"
            className="hov dock-palette"
            aria-label="Palette de commandes (Ctrl K)"
            aria-haspopup="dialog"
            aria-expanded={paletteOuverte}
            onClick={() => useUiStore.getState().basculerPalette()}
          >
            <IconeRecherche taille={14} />
            <span className="dock-palette-touche">Ctrl K</span>
          </button>
        </nav>
      </div>

      {groupeDuMenu && (
        <DockMenuGroupe
          groupe={groupeDuMenu}
          nbMembres={workspaces.filter((w) => w.groupId === groupeDuMenu.id).length}
          replie={repli.replis.has(groupeDuMenu.id)}
          navRef={navRef}
          onBasculer={() => basculerGroupe(groupeDuMenu.id)}
          onFermer={fermerMenuGroupe}
        />
      )}
    </>
  );
}
