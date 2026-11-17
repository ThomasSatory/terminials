import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { useWorkspaceStore, type Tab } from "../store/workspace";
import { titreParDefaut } from "../lib/titreParDefaut";
import { useEtatOnglet } from "../hooks/useEtatAgent";
import { couleurEspace } from "../lib/couleurEspace";
import { closePty } from "../lib/pty";
import { focusTab } from "../lib/tabFocus";
import { dispatchShortcut, fermerTousLesEspaces } from "../lib/shortcutDispatch";
import { dropBoundary, finalIndex, type RowRect } from "../lib/reorder";
import { ligneBranche, libelleBoutonDiff, texteBoutonDiff } from "../lib/barreEspace";
import { IconButton } from "./ui/IconButton";
import { IconeFermer, IconeMosaique, IconePlus } from "./ui/icons";
import { Kbd } from "./ui/Kbd";
import { useUiStore } from "../store/ui";
import { useDashboardStore } from "../store/dashboard";
import { estEchapSeul, retourArme } from "../lib/retourMosaique";
import { idOnglet, idPanneau } from "./TabbedTerminals";
import "../styles/topbar.css";

/** Déplacement horizontal minimal avant qu'un appui devienne un glisser d'onglet ; en
    dessous, l'appui reste un clic de sélection. */
const SEUIL_GLISSER = 4;

/** Retrait du soulignement sous l'onglet (padding horizontal du bouton, maquette). */
const RETRAIT_SOULIGNEMENT = 10;

/**
 * Barre du haut (46 px) de l'espace actif, d'après Dock.dc.html (première rangée) :
 * pastille de couleur, nom, branche ; onglets (sélection, état d'agent, fermeture,
 * réordonnancement par glisser, « + ») avec un soulignement qui glisse de l'un à
 * l'autre ; bouton ± des fichiers modifiés (Ctrl+Maj+D) ; « Tout fermer » (maquette
 * Accueil) ; icône des Paramètres (maquette Parametres).
 *
 * Rien sans espace actif (l'accueil couvre alors la fenêtre). Le récap, l'accueil et la
 * mosaïque la recouvrent (App la rend alors inerte) ; seule la vue des fichiers modifiés
 * s'ouvre dessous. Les terminaux, eux, sont dans TabbedTerminals (keep-alive) : la barre
 * ne monte ni ne démonte aucun terminal.
 */
export function TopBar() {
  // Sélecteur ciblé qui rend une chaîne : l'enveloppe ne se re-rend qu'au changement
  // d'espace actif ; la barre elle-même lit son espace (BarreEspace).
  const wsId = useWorkspaceStore((s) =>
    s.workspaces.some((w) => w.id === s.activeId) ? s.activeId : null,
  );
  // Espace actif du rendu précédent : la barre n'entre en fondu (maquette Accueil) que
  // quand elle apparaît, pas à chaque changement d'espace.
  const precedent = useRef<string | null>(null);
  const entree = precedent.current === null;
  useEffect(() => {
    precedent.current = wsId;
  }, [wsId]);
  if (!wsId) return null;
  // Clé = espace : changer d'espace repart d'une barre neuve (soulignement posé d'emblée
  // sous le bon onglet, sans glisser depuis la position de l'espace précédent).
  return <BarreEspace key={wsId} wsId={wsId} entree={entree} />;
}

function BarreEspace({ wsId, entree: entreeProp }: { wsId: string; entree: boolean }) {
  // Figé au montage : TopBar se re-rend avec App (entree retombe alors à faux), et retirer
  // l'attribut couperait le fondu en cours.
  const [entree] = useState(entreeProp);
  const ws = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === wsId));
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const moveTab = useWorkspaceStore((s) => s.moveTab);
  const toggleDiff = useWorkspaceStore((s) => s.toggleDiff);

  // Groupe de l'espace, préfixé au nom (« produit / ● terminials »), maquettes Groupes et
  // Mosaique. Chaîne : la barre ne se re-rend pas au moindre changement des groupes.
  const groupe = useWorkspaceStore((s) => {
    const gid = s.workspaces.find((w) => w.id === wsId)?.groupId;
    return gid ? (s.groups.find((g) => g.id === gid)?.name ?? null) : null;
  });
  // Variante « retour » (maquette Mosaique) : on vient d'ouvrir ce terminal depuis la
  // mosaïque ; le bouton y ramène, Échap aussi tant qu'on n'a rien tapé (lib/retourMosaique).
  const recapOuvert = useDashboardStore((s) => s.open);
  const retour = useUiStore((s) =>
    retourArme(s, wsId, { recapOuvert, diffOuvert: ws?.diffOpen === true }),
  );

  // Échap quand le focus n'est pas dans le terminal (perdu avec la tuile cliquée, posé
  // sur la barre) : la promesse de la puce « Échap » tient quand même. Dans le terminal,
  // sa couche clavier a déjà traité la touche (defaultPrevented) ; dans un champ, un menu
  // ou un dialogue, Échap leur appartient.
  useEffect(() => {
    if (!retour) return;
    const surTouche = (e: globalThis.KeyboardEvent) => {
      if (e.defaultPrevented || !estEchapSeul(e)) return;
      const cible = e.target instanceof Element ? e.target : null;
      if (cible?.closest('.xterm, input, textarea, select, [contenteditable], [role="dialog"], [role="menu"]')) return;
      e.preventDefault();
      dispatchShortcut({ type: "toggle-mosaique" });
    };
    window.addEventListener("keydown", surTouche);
    return () => window.removeEventListener("keydown", surTouche);
  }, [retour]);

  // Paramètres ouverts : ils couvrent le terminal, aucun onglet n'est « affiché », l'icône
  // de la barre est enfoncée (maquette Parametres).
  const parametres = useUiStore((s) => s.parametres !== null);

  const listeRef = useRef<HTMLDivElement>(null);
  // Compteur du bouton ± : lu par la sonde dirty d'App (un seul `git status`, avancé à
  // chaque fin de tour d'agent) et par la vue des fichiers modifiés à chaque lecture.
  const nbFichiers = ws?.dirty ? (ws.nbModifies ?? null) : null;

  // --- Soulignement de l'onglet actif : UN trait qui glisse d'un onglet à l'autre. ---
  const [trait, setTrait] = useState<{ x: number; largeur: number } | null>(null);
  // Pas de transition à la première pose : le trait apparaît sous l'onglet, puis glisse.
  const [traitAnime, setTraitAnime] = useState(false);

  const activeTabId = ws?.activeTabId ?? null;
  const tabs = ws?.tabs;

  useLayoutEffect(() => {
    const liste = listeRef.current;
    if (!liste) return;
    const mesurer = () => {
      const enveloppe = activeTabId
        ? liste.querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`)
        : null;
      const bouton = enveloppe?.querySelector<HTMLElement>('[role="tab"]') ?? null;
      if (!enveloppe || !bouton) {
        setTrait(null);
        return;
      }
      // Le bouton est mesuré dans son enveloppe (position relative, pour la croix), elle-même
      // mesurée dans la liste (position relative) : la somme des deux offsetLeft donne la
      // position dans la liste, défilement compris — le trait, posé dans la liste, défile
      // avec les onglets.
      const x = enveloppe.offsetLeft + bouton.offsetLeft + RETRAIT_SOULIGNEMENT;
      const largeur = Math.max(0, bouton.offsetWidth - 2 * RETRAIT_SOULIGNEMENT);
      setTrait((t) => (t && t.x === x && t.largeur === largeur ? t : { x, largeur }));
    };
    mesurer();
    // Largeurs qui bougent sans changer d'onglet (titre OSC, fenêtre redimensionnée).
    const ro = new ResizeObserver(mesurer);
    ro.observe(liste);
    for (const el of liste.querySelectorAll("[data-tab-id]")) ro.observe(el);
    return () => ro.disconnect();
  }, [activeTabId, tabs]);

  useEffect(() => {
    if (!trait || traitAnime) return;
    const r = requestAnimationFrame(() => setTraitAnime(true));
    return () => cancelAnimationFrame(r);
  }, [trait, traitAnime]);

  // L'onglet actif reste visible quand la liste déborde et défile : au changement
  // d'onglet, et quand la liste change de largeur (fenêtre redimensionnée, barre qui passe
  // à la ligne), sinon l'onglet actif peut rester rogné sous le « + ».
  useEffect(() => {
    const liste = listeRef.current;
    if (!activeTabId || !liste) return;
    const montrer = () =>
      liste
        .querySelector<HTMLElement>(`[data-tab-id="${CSS.escape(activeTabId)}"]`)
        ?.scrollIntoView({ block: "nearest", inline: "nearest" });
    montrer();
    let largeur = liste.clientWidth;
    const ro = new ResizeObserver(() => {
      if (liste.clientWidth === largeur) return;
      largeur = liste.clientWidth;
      montrer();
    });
    ro.observe(liste);
    return () => ro.disconnect();
  }, [activeTabId]);

  // --- Réordonnancement par pointer events (pas de DnD HTML5, peu fiable sous
  // WebKitGTK avec dragDropEnabled). Le geste est suivi sur window dès l'appui : un
  // mouvement vif peut quitter l'onglet avant le premier pointermove, que l'onglet seul
  // n'aurait alors jamais reçu. La capture n'est prise qu'au-delà du seuil, sinon le clic
  // partirait vers l'enveloppe et non vers le bouton de l'onglet. ---
  const ignorerClic = useRef(false);
  const [glisseId, setGlisseId] = useState<string | null>(null);
  const [frontiere, setFrontiere] = useState<number | null>(null);
  // Écouteurs du geste en cours, retirés à sa fin ou au démontage de la barre.
  const arreterGeste = useRef<(() => void) | null>(null);
  useEffect(() => () => arreterGeste.current?.(), []);

  if (!ws || !tabs) return null;

  /** Géométrie horizontale des onglets : dropBoundary raisonne en top/height, on lui
      passe left/width sous ces noms. */
  const rectsOnglets = (): RowRect[] =>
    [...(listeRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [])].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.left, height: r.width };
    });

  const finGlisser = () => {
    arreterGeste.current?.();
    setGlisseId(null);
    setFrontiere(null);
  };

  const commencerGeste = (e: PointerEvent<HTMLDivElement>, tabId: string) => {
    ignorerClic.current = false;
    if (e.button !== 0) return;
    arreterGeste.current?.();
    const el = e.currentTarget;
    const pointeur = e.pointerId;
    const departX = e.clientX;
    let actif = false;
    const bouger = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointeur) return;
      if (!actif) {
        if (Math.abs(ev.clientX - departX) < SEUIL_GLISSER) return;
        actif = true;
        // Hors de la fenêtre, seule la capture continue d'envoyer les mouvements.
        try {
          el.setPointerCapture(pointeur);
        } catch {
          /* pointeur déjà relâché : la fin du geste suit */
        }
        setGlisseId(tabId);
      }
      setFrontiere(dropBoundary(rectsOnglets(), ev.clientX));
    };
    const lacher = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId !== pointeur) return;
      if (actif) {
        ignorerClic.current = true;
        // Onglets relus au lâcher : la liste a pu changer pendant le geste.
        const onglets = useWorkspaceStore.getState().workspaces.find((w) => w.id === wsId)?.tabs ?? [];
        const de = onglets.findIndex((t) => t.id === tabId);
        if (de !== -1) moveTab(wsId, tabId, finalIndex(de, dropBoundary(rectsOnglets(), ev.clientX)));
      }
      finGlisser();
    };
    const annuler = (ev: globalThis.PointerEvent) => {
      if (ev.pointerId === pointeur) finGlisser();
    };
    window.addEventListener("pointermove", bouger);
    window.addEventListener("pointerup", lacher);
    window.addEventListener("pointercancel", annuler);
    arreterGeste.current = () => {
      window.removeEventListener("pointermove", bouger);
      window.removeEventListener("pointerup", lacher);
      window.removeEventListener("pointercancel", annuler);
      arreterGeste.current = null;
    };
  };

  // Le diff ou les Paramètres masquent le terminal : aucun onglet n'est alors « affiché ».
  const masque = ws.diffOpen || parametres;

  const choisir = (tabId: string) => {
    if (ignorerClic.current) {
      ignorerClic.current = false;
      return;
    }
    // Choisir un onglet, c'est revenir à son terminal (maquette Diff) : on referme ce
    // qui le recouvre.
    if (ws.diffOpen) toggleDiff(ws.id);
    useUiStore.getState().fermerParametres();
    setActiveTab(ws.id, tabId);
    // Onglet déjà actif : l'effet de TabbedTerminals ne se redéclenche pas, on rend le
    // focus au terminal ici.
    focusTab(tabId);
  };

  const fermer = (tabId: string) => {
    if (ws.tabs.length <= 1) {
      // Dernier onglet : l'espace se ferme ; on ferme d'abord son PTY (comme Ctrl+Maj+Q),
      // sans dépendre de l'ordre de démontage React.
      const ptyId = useWorkspaceStore.getState().tabPtys[tabId];
      if (ptyId !== undefined) closePty(ptyId);
    }
    closeTab(ws.id, tabId);
  };

  // Navigation clavier dans la liste (motif ARIA des onglets, activation manuelle) :
  // les flèches déplacent le focus, Entrée/Espace choisissent (bouton natif), Suppr
  // ferme l'onglet qui a le focus (variante « onglets supprimables » du motif) — c'est
  // le chemin clavier de la croix, qui reste hors de l'arbre d'accessibilité.
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End", "Delete"].includes(e.key)) return;
    if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;
    const boutons = [...(listeRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
    const i = boutons.indexOf(document.activeElement as HTMLElement);
    if (i === -1) return;
    e.preventDefault();
    if (e.key === "Delete") {
      const tabId = boutons[i].closest<HTMLElement>("[data-tab-id]")?.dataset.tabId;
      if (!tabId) return;
      fermer(tabId);
      // Le focus passe à l'onglet qui prend la place (ou au précédent s'il n'y en a
      // plus), une fois la liste rendue — et après l'effet de TabbedTerminals qui
      // donnerait sinon le focus au terminal.
      requestAnimationFrame(() => {
        const restants = [...(listeRef.current?.querySelectorAll<HTMLElement>('[role="tab"]') ?? [])];
        restants[Math.min(i, restants.length - 1)]?.focus();
      });
      return;
    }
    const n = boutons.length;
    const cible =
      e.key === "Home" ? 0 : e.key === "End" ? n - 1 : (i + (e.key === "ArrowRight" ? 1 : -1) + n) % n;
    boutons[cible]?.focus();
  };

  // Abscisse du trait d'insertion pendant un glisser, dans le repère de la liste.
  let xDepot: number | null = null;
  if (glisseId !== null && frontiere !== null && listeRef.current) {
    const els = [...listeRef.current.querySelectorAll<HTMLElement>("[data-tab-id]")];
    // Borné à 0 : avant le premier onglet, le trait tomberait à -3 px, rogné par la liste
    // (overflow) — on ne voyait plus où l'onglet allait se poser.
    if (frontiere < els.length) xDepot = Math.max(0, els[frontiere].offsetLeft - 3);
    else if (els.length > 0) {
      const dernier = els[els.length - 1];
      // Borné à la largeur défilable : après le dernier onglet, le trait (2 px) tombait
      // hors de la liste (overflow) et n'apparaissait pas.
      xDepot = Math.min(dernier.offsetLeft + dernier.offsetWidth + 1, listeRef.current.scrollWidth - 2);
    }
  }

  // Comme la maquette (hasDiff) : pas de bouton ± sans modification, même vue des
  // fichiers modifiés ouverte sur un espace propre ou hors dépôt (Ctrl+Maj+D la referme).
  const montrerDiff = ws.dirty === true;

  return (
    <header className="topbar" data-retour={retour || undefined} data-entree={entree || undefined}>
      {retour && (
        <button
          type="button"
          className="hov topbar-retour"
          aria-label="Mosaïque (Échap)"
          onClick={() => dispatchShortcut({ type: "toggle-mosaique" })}
        >
          <IconeMosaique taille={14} />
          Mosaïque
          <Kbd variante="puce">Échap</Kbd>
        </button>
      )}
      <div className="topbar-espace">
        {groupe !== null && (
          <span className="topbar-groupe">
            {groupe}
            <span aria-hidden="true">/</span>
          </span>
        )}
        <span className="topbar-pastille" aria-hidden="true" style={{ background: couleurEspace(ws) }} />
        <span className="topbar-nom">{ws.name}</span>
        <span className="topbar-branche">{ligneBranche(ws.branch, ws.dirty, ws.ports, ws.gitConnu === true)}</span>
      </div>

      <div className="topbar-onglets">
        <div
          ref={listeRef}
          role="tablist"
          aria-label={`Onglets de ${ws.name}`}
          className="topbar-liste"
          onKeyDown={onKeyDown}
        >
          {tabs.map((tab, i) => (
            <Onglet
              key={tab.id}
              wsId={ws.id}
              tab={tab}
              index={i}
              actif={tab.id === ws.activeTabId}
              courant={tab.id === ws.activeTabId && !masque}
              glisse={glisseId === tab.id}
              onChoisir={choisir}
              onFermer={fermer}
              onPointerDown={(e) => commencerGeste(e, tab.id)}
            />
          ))}
          {trait && (
            <span
              className="topbar-soulignement"
              aria-hidden="true"
              data-anime={traitAnime}
              data-masque={masque}
              style={{ transform: `translateX(${trait.x}px)`, width: trait.largeur }}
            >
              <span className="topbar-soulignement-trait" />
            </span>
          )}
          {xDepot !== null && (
            <span className="topbar-depot" aria-hidden="true" style={{ transform: `translateX(${xDepot}px)` }} />
          )}
        </div>
        <IconButton
          label="Nouvel onglet"
          title="Nouvel onglet (Ctrl+Maj+T)"
          forme="carre"
          taille={28}
          className="topbar-ajout"
          onClick={() => dispatchShortcut({ type: "new-tab" })}
        >
          <IconePlus taille={14} />
        </IconButton>
      </div>

      {montrerDiff && (
        <button
          type="button"
          className="topbar-diff"
          aria-pressed={ws.diffOpen}
          aria-label={libelleBoutonDiff(nbFichiers)}
          title={ws.diffOpen ? "Revenir au terminal (Ctrl+Maj+D)" : "Voir les fichiers modifiés (Ctrl+Maj+D)"}
          onClick={() => dispatchShortcut({ type: "toggle-diff" })}
        >
          <span className="topbar-diff-signe" aria-hidden="true">
            ±
          </span>
          <span aria-hidden="true">{texteBoutonDiff(nbFichiers)}</span>
        </button>
      )}

      <ToutFermer />

      {/* Icône discrète des Paramètres, à l'extrême droite (maquette Parametres). */}
      <button
        type="button"
        className="topbar-reglages"
        aria-pressed={parametres}
        aria-label="Paramètres (Ctrl+Maj+,)"
        title="Paramètres (Ctrl+Maj+,)"
        onClick={() => dispatchShortcut({ type: "toggle-parametres" })}
      >
        <svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2.5 4.5h6.5M12.5 4.5h1M2.5 11.5h1.5M7.5 11.5h6" />
          <circle cx="10.75" cy="4.5" r="1.75" />
          <circle cx="5.75" cy="11.5" r="1.75" />
        </svg>
      </button>
    </header>
  );
}

/**
 * « Tout fermer » (maquette Accueil, seule à le montrer) : bouton discret à droite de la
 * barre, présent dès qu'un espace est ouvert ; un clic ferme tous les espaces, leurs
 * terminaux compris, et ramène à l'accueil — exactement comme la maquette, sans
 * confirmation.
 */
function ToutFermer() {
  return (
    <button
      type="button"
      className="topbar-tout-fermer"
      aria-label="Tout fermer"
      title="Fermer tous les espaces et revenir à l’accueil"
      onClick={() => fermerTousLesEspaces()}
    >
      <IconeFermer taille={12} />
      {/* Masqué en fenêtre étroite (topbar.css) : l'icône seule reste, nom accessible gardé. */}
      <span className="topbar-tout-fermer-texte">Tout fermer</span>
    </button>
  );
}

interface OngletProps {
  wsId: string;
  tab: Tab;
  index: number;
  /** Onglet actif de l'espace (focus clavier, bouton de fermeture visible). */
  actif: boolean;
  /** Actif ET affiché (pas de diff par-dessus) : texte fort. */
  courant: boolean;
  glisse: boolean;
  onChoisir: (tabId: string) => void;
  onFermer: (tabId: string) => void;
  /** Début d'un geste (clic ou glisser) : la suite est suivie sur window par la barre. */
  onPointerDown: (e: PointerEvent<HTMLDivElement>) => void;
}

/** Un onglet : son état d'agent est lu par un sélecteur qui rend une chaîne (pas
    d'abonnement aux PTY occupés de toute l'app). */
function Onglet({
  wsId,
  tab,
  index,
  actif,
  courant,
  glisse,
  onChoisir,
  onFermer,
  onPointerDown,
}: OngletProps) {
  const etat = useEtatOnglet(wsId, tab.id);
  const titre = tab.title || titreParDefaut(tab, index);
  const precision =
    etat === "attente"
      ? ", un agent vous attend"
      : etat === "travail"
        ? ", un agent travaille"
        : etat === "termine"
          ? ", l’agent a terminé"
          : "";
  return (
    <div
      // Simple enveloppe (onglet + croix) : transparente pour l'arbre d'accessibilité,
      // la liste ne présente que des onglets.
      role="presentation"
      className="topbar-onglet"
      data-tab-id={tab.id}
      data-actif={actif}
      data-glisse={glisse}
      onAuxClick={(e) => {
        if (e.button === 1) onFermer(tab.id); // clic milieu
      }}
      onMouseDown={(e) => {
        if (e.button === 0) e.preventDefault(); // pas de sélection de texte pendant le glisser
      }}
      onPointerDown={onPointerDown}
    >
      <button
        type="button"
        role="tab"
        id={idOnglet(tab.id)}
        aria-selected={actif}
        aria-controls={idPanneau(tab.id)}
        aria-label={titre + precision}
        tabIndex={actif ? 0 : -1}
        title={titre}
        className="topbar-tab"
        data-courant={courant}
        onClick={() => onChoisir(tab.id)}
      >
        {etat === "attente" && <span className="topbar-attente" aria-hidden="true" />}
        {etat === "travail" && <span className="topbar-arc" aria-hidden="true" />}
        <span className="topbar-titre">{titre}</span>
      </button>
      <button
        type="button"
        className="topbar-fermer"
        title="Fermer l'onglet (Ctrl+Maj+W)"
        // Affordance de souris seulement : un tablist ne doit exposer que des onglets
        // (une croix au milieu rendrait la structure incohérente aux lecteurs d'écran).
        // Hors du focus et de l'arbre d'accessibilité ; au clavier, Suppr sur l'onglet
        // (onKeyDown de la liste) ou Ctrl+Maj+W pour l'onglet actif.
        aria-hidden="true"
        tabIndex={-1}
        onMouseDown={(e) => {
          e.stopPropagation();
          e.preventDefault();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => {
          e.stopPropagation();
          onFermer(tab.id);
        }}
      >
        <IconeFermer taille={10} />
      </button>
    </div>
  );
}
