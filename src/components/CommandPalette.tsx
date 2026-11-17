import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type MouseEvent,
} from "react";
import { useUiStore } from "../store/ui";
import { useWorkspaceStore, navigableOrder, sidebarOrder } from "../store/workspace";
import { useDashboardStore } from "../store/dashboard";
import { useReglagesStore } from "../store/reglages";
import {
  useSuperviseurStore,
  demandesOuvertes,
  modeDepuis,
  nbEchangesEnCours,
  outilEnCours,
} from "../store/superviseur";
import { envoyerAuSuperviseur } from "../lib/superviseurApi";
import { ligneEtatSuperviseur } from "../lib/superviseurLibelles";
import { reglagesCherchables } from "../lib/reglagesIndex";
import { dispatchShortcut } from "../lib/shortcutDispatch";
import { etatEspace, etatOnglet, type EtatAgent } from "../lib/etatAgent";
import { titreSansGlyphe } from "../lib/mosaique";
import { cheminCourt, quandRelatif } from "../lib/espacesRecents";
import { aReprendre, lireRecentsCourants, rouvrir, useRecents } from "../store/recents";
import { useHome } from "../hooks/useHome";
import {
  aplatir,
  construireSections,
  deplacerSelection,
  indiceSelection,
  segmenterSurlignage,
  type CiblePalette,
  type ContextePalette,
  type EntreePalette,
} from "../lib/paletteCommands";
import { Kbd } from "./ui/Kbd";
import { IconeRecherche, IconeTerminal } from "./ui/icons";
import "../styles/palette.css";

/**
 * Palette de commandes (Ctrl K) : aller à un espace (ceux dont un agent attend en tête),
 * à un onglet, ou lancer une action de l'app avec son raccourci. Recherche floue, ↑/↓
 * pour choisir, Entrée pour valider, Échap pour fermer ; le focus reste dans la boîte
 * tant qu'elle est ouverte et retourne au terminal quand elle se ferme.
 *
 * Toujours montée par App ; ne rend rien (et ne s'abonne à rien) quand elle est fermée :
 * la requête et la sélection repartent de zéro à chaque ouverture.
 */
export function CommandPalette() {
  const ouverte = useUiStore((s) => s.paletteOuverte);
  return ouverte ? <PaletteOuverte /> : null;
}

/** Exécute la cible d'une ligne, par les mêmes chemins que le clavier et le dock. */
function executer(cible: CiblePalette): void {
  const ws = useWorkspaceStore.getState();
  switch (cible.type) {
    case "espace":
    case "onglet": {
      // Une vue plein écran masquerait l'espace choisi : on la referme. Les fichiers
      // modifiés aussi : setActive ne les referme pas sur l'espace DÉJÀ actif.
      useDashboardStore.getState().close();
      useUiStore.getState().setVue("terminal");
      useUiStore.getState().fermerParametres();
      if (ws.workspaces.find((w) => w.id === cible.wsId)?.diffOpen) ws.toggleDiff(cible.wsId);
      ws.setActive(cible.wsId);
      // L'onglet choisi devient l'actif : la coquille lui rend le focus à la fermeture.
      if (cible.type === "onglet") ws.setActiveTab(cible.wsId, cible.tabId);
      return;
    }
    case "raccourci":
      dispatchShortcut(cible.action);
      return;
    case "dupliquer":
      ws.duplicateWorkspace(cible.wsId);
      return;
    case "reprendre": {
      const e = lireRecentsCourants().find((x) => x.cwd === cible.cwd && x.nom === cible.nom);
      if (!e) return;
      useDashboardStore.getState().close();
      useUiStore.getState().setVue("terminal");
      useUiStore.getState().fermerParametres();
      rouvrir(e);
      return;
    }
    case "superviseur":
      useSuperviseurStore.getState().ouvrirPanneau();
      if (cible.demande) envoyerAuSuperviseur(cible.demande);
      return;
    case "reglage":
      useDashboardStore.getState().close();
      useUiStore.getState().ouvrirParametres(cible.section, [cible.ligne]);
      return;
  }
}

function PaletteOuverte() {
  const fermer = useUiStore((s) => s.fermerPalette);
  const dockVisible = useUiStore((s) => s.dockVisible);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const groups = useWorkspaceStore((s) => s.groups);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const tabPtys = useWorkspaceStore((s) => s.tabPtys);
  const busyPtys = useWorkspaceStore((s) => s.busyPtys);
  const tabsTermines = useWorkspaceStore((s) => s.tabsTermines);

  // Superviseur : proposé seulement s'il est actif (maquette Parametres).
  const supActif = useReglagesStore((s) => s.reglages.superviseur.actif);
  const supNom = useReglagesStore((s) => s.reglages.superviseur.nom);
  const supPause = useReglagesStore((s) => s.reglages.superviseur.pause);
  const supEnCours = useSuperviseurStore((s) => s.moteur.enCours);
  const supOutil = useSuperviseurStore(outilEnCours);
  const supDemandes = useSuperviseurStore((s) => demandesOuvertes(s).length);
  const supNonLus = useSuperviseurStore((s) => s.nonLus);
  const supEchanges = useSuperviseurStore(nbEchangesEnCours);

  const recents = useRecents();
  const home = useHome();
  // Instant de l'ouverture : l'ancienneté des espaces récents n'a pas à bouger pendant
  // qu'on choisit.
  const [ouvertA] = useState(() => Date.now());

  const [requete, setRequete] = useState("");
  // La sélection est retenue par l'id de la ligne, pas par son rang : si un agent passe
  // en attente palette ouverte, la section « Vous attendent » s'insère en tête sans
  // déplacer le choix sous les doigts de l'utilisateur.
  const [selId, setSelId] = useState<string | null>(null);
  const idBase = useId();
  const racineRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const fermerBtnRef = useRef<HTMLButtonElement>(null);
  const listeRef = useRef<HTMLDivElement>(null);
  const surbrillanceRef = useRef<HTMLDivElement>(null);

  const sections = useMemo(() => {
    const sources = { tabPtys, busyPtys, tabsTermines };
    const actif = workspaces.find((w) => w.id === activeId);
    const ctx: ContextePalette = {
      // Dans l'ordre du dock : hors-groupe, puis chaque groupe.
      espaces: sidebarOrder(workspaces, groups).map((w) => ({
        id: w.id,
        name: w.name,
        cwd: w.cwd,
        color: w.color,
        branch: w.branch,
        tabs: w.tabs.map((t) => ({ id: t.id, title: t.title, etat: etatOnglet(w, t.id, sources) })),
        activeTabId: w.activeTabId,
        etat: etatEspace(w, sources),
        statut: w.status?.label,
        // Le corps porte la question de l'agent (« Autoriser npm run migrate ? ») ; le
        // titre n'est que l'émetteur (« Claude Code »). Même ordre que la bulle.
        notification: w.lastNotification?.body || w.lastNotification?.title,
        groupe: groups.find((g) => g.id === w.groupId)?.name,
        sujetTermine: titreSansGlyphe(w.tabs.find((t) => t.id in tabsTermines)?.title),
      })),
      ordreNavigable: navigableOrder(workspaces, groups).map((w) => w.id),
      reprendre: aReprendre(recents, workspaces).map((e) => ({
        nom: e.nom,
        cwd: e.cwd,
        couleur: e.couleur,
        indice: e.sessions ? "session Claude à reprendre" : cheminCourt(e.cwd, home ?? undefined),
        quand: quandRelatif(e.ferme, ouvertA),
      })),
      actifId: activeId,
      actifDansGroupe: !!actif?.groupId,
      dockVisible,
      requete,
      reglages: reglagesCherchables(supActif),
    };
    if (supActif) {
      const espaces = ctx.espaces;
      const nbAttente = espaces.filter((e) => e.etat === "attente").length;
      const mode = modeDepuis({
        pause: supPause,
        enCours: supEnCours,
        outil: supOutil,
        nbDemandes: supDemandes,
        nbAttente,
        nonLus: supNonLus,
      });
      ctx.superviseur = {
        nom: supNom,
        etat: ligneEtatSuperviseur({ mode, nbEspaces: espaces.length, nbAttente, nbEchanges: supEchanges, outil: supOutil }),
      };
    }
    return construireSections(ctx);
  }, [
    workspaces,
    recents,
    home,
    ouvertA,
    groups,
    activeId,
    tabPtys,
    busyPtys,
    tabsTermines,
    dockVisible,
    requete,
    supActif,
    supNom,
    supPause,
    supEnCours,
    supOutil,
    supDemandes,
    supNonLus,
    supEchanges,
  ]);

  const lignes = useMemo(() => aplatir(sections), [sections]);
  const indexDe = useMemo(() => new Map(lignes.map((l, i) => [l.id, i] as const)), [lignes]);
  const selBorne = indiceSelection(lignes, selId);

  // Épingle la ligne affichée comme choisie (première à l'ouverture et après chaque
  // frappe, ou repli si la ligne choisie a disparu) : la suite la suit par son id.
  const idAffiche = lignes[selBorne]?.id;
  useEffect(() => {
    if (idAffiche !== undefined && idAffiche !== selId) setSelId(idAffiche);
  }, [idAffiche, selId]);

  const choisirIndice = (i: number) => {
    setSelId(lignes[i]?.id ?? null);
  };

  // Anneau de focus du champ : absent au focus posé à l'ouverture (maquettes Accueil/03,
  // Dock/08), il apparaît dès que le champ est visé au clic ou à Tab (Dock/09).
  const [anneau, setAnneau] = useState(false);

  // Le champ prend le focus à l'ouverture. À la fermeture (quel que soit le chemin :
  // Échap, voile, Ctrl K, ligne choisie), c'est la coquille (App) qui rend le focus au
  // terminal actif, après les calques que l'action choisie a pu ouvrir.
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Sélection qui glisse : un seul fond, déplacé sous la ligne choisie. Mesuré dans le
  // flux de la liste (offsetTop), il défile avec elle.
  useLayoutEffect(() => {
    const liste = listeRef.current;
    const fond = surbrillanceRef.current;
    if (!liste || !fond) return;
    const ligne = liste.querySelector<HTMLElement>(`[data-pal-index="${selBorne}"]`);
    if (!ligne) {
      // Rangé en haut, sans hauteur : laissé à sa dernière place, ce fond (absolu) gardait
      // la liste défilable et une barre de défilement s'affichait sans aucun résultat.
      fond.style.opacity = "0";
      fond.style.height = "0px";
      fond.style.transform = "translateY(0px)";
      return;
    }
    fond.style.opacity = "1";
    fond.style.height = `${ligne.offsetHeight}px`;
    fond.style.transform = `translateY(${ligne.offsetTop}px)`;
    if (selBorne === 0) liste.scrollTop = 0;
    else {
      ligne.scrollIntoView({ block: "nearest" });
      // Première ligne de sa section : son intertitre reste visible au-dessus, sinon
      // en remontant aux flèches on perdrait « Espaces », « Onglets »… hors champ.
      const groupe = ligne.parentElement;
      if (groupe && groupe.querySelector("[data-pal-index]") === ligne) {
        liste.scrollTop = Math.min(liste.scrollTop, groupe.offsetTop);
      }
    }
    // Pas de glissade pour le placement initial : le fond naît déjà à sa place.
    const raf = requestAnimationFrame(() => {
      fond.dataset.pret = "1";
    });
    return () => cancelAnimationFrame(raf);
  }, [selBorne, sections]);

  const choisir = (e: EntreePalette) => {
    fermer();
    executer(e.cible);
  };

  const surClavier = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.nativeEvent.isComposing) return;
    switch (e.key) {
      case "Escape":
        // Échap appartient à Claude Code dans le terminal : on ne l'intercepte que
        // depuis la palette (focus dedans), jamais sur window.
        e.preventDefault();
        e.stopPropagation();
        fermer();
        return;
      case "ArrowDown":
      case "ArrowUp":
        e.preventDefault();
        choisirIndice(deplacerSelection(selBorne, e.key === "ArrowDown" ? 1 : -1, lignes.length));
        return;
      case "Enter": {
        // Entrée sur le bouton « Échap » le déclenche lui-même.
        if (e.target === fermerBtnRef.current) return;
        e.preventDefault();
        const l = lignes[selBorne];
        if (l) choisir(l);
        return;
      }
      case "Tab": {
        // Piège du focus : deux arrêts (champ, bouton Échap) ; les lignes se choisissent
        // aux flèches, pas à Tab.
        e.preventDefault();
        const cible = document.activeElement === inputRef.current ? fermerBtnRef.current : inputRef.current;
        if (cible === inputRef.current) setAnneau(true);
        cible?.focus();
        return;
      }
    }
  };

  // Le champ est le seul point de saisie : un clic ailleurs dans la boîte (intertitre,
  // pied, ligne) ne doit pas lui voler le focus, sinon il tombe sur body, hors de la
  // racine, et Échap, flèches et Entrée ne sont plus captés. La liste elle-même est
  // laissée faire (sa barre de défilement doit rester saisissable) et rattrapée au
  // relâchement.
  const garderFocus = (e: MouseEvent<HTMLDivElement>) => {
    const t = e.target;
    if (t === inputRef.current || t === fermerBtnRef.current || t === listeRef.current) return;
    e.preventDefault();
  };
  const rattraperFocus = () => {
    if (!racineRef.current?.contains(document.activeElement)) inputRef.current?.focus();
  };

  const idOption = (i: number) => `${idBase}-opt-${i}`;
  const idListe = `${idBase}-liste`;

  return (
    <div ref={racineRef} className="pal-racine" onKeyDown={surClavier}>
      <button type="button" className="pal-voile" tabIndex={-1} aria-label="Fermer la palette" onClick={() => fermer()} />
      {/* Modal : tant qu'elle est ouverte, la coquille (App) rend inerte tout ce qu'elle
          recouvre, la promesse d'aria-modal est tenue. */}
      <div
        className="pal-boite"
        role="dialog"
        aria-modal="true"
        aria-label="Palette de commandes"
        onMouseDown={garderFocus}
        onMouseUp={rattraperFocus}
      >
        <div className="pal-entete">
          <IconeRecherche taille={16} epaisseur={1.5} style={{ color: "var(--texte-discret)", flexShrink: 0 }} />
          <input
            ref={inputRef}
            className="pal-champ"
            data-anneau={anneau || undefined}
            onMouseDown={() => setAnneau(true)}
            type="text"
            role="combobox"
            aria-expanded="true"
            aria-controls={idListe}
            aria-autocomplete="list"
            aria-activedescendant={lignes.length > 0 ? idOption(selBorne) : undefined}
            aria-label="Rechercher un espace ou une action"
            placeholder="Aller à un espace, lancer une action…"
            autoComplete="off"
            spellCheck={false}
            value={requete}
            onChange={(e) => {
              setRequete(e.target.value);
              // Nouvelle recherche : la première ligne sera épinglée au rendu suivant.
              setSelId(null);
            }}
          />
          <button ref={fermerBtnRef} type="button" className="pal-echap hov" onClick={() => fermer()}>
            Échap
          </button>
        </div>

        <div ref={listeRef} id={idListe} className="pal-liste" role="listbox" aria-label="Résultats">
          <div ref={surbrillanceRef} className="pal-surbrillance" aria-hidden="true" />
          {sections.map((section) => (
            <div key={section.id} role="group" aria-labelledby={`${idBase}-t-${section.id}`}>
              <div id={`${idBase}-t-${section.id}`} className="pal-titre">
                {section.titre}
              </div>
              {section.entrees.map((entree) => {
                const i = indexDe.get(entree.id) ?? 0;
                return (
                  <button
                    key={entree.id}
                    id={idOption(i)}
                    type="button"
                    role="option"
                    tabIndex={-1}
                    aria-selected={i === selBorne}
                    data-pal-index={i}
                    className="pal-ligne"
                    // Le survol (CSS, comme .pi:hover de la maquette) s'ajoute à la
                    // sélection du clavier sans la déplacer : Entrée valide toujours la
                    // ligne choisie aux flèches.
                    onClick={() => choisir(entree)}
                  >
                    <Pastille entree={entree} />
                    <span className="pal-libelle">
                      {segmenterSurlignage(entree.libelle, entree.indices).map((m, k) =>
                        m.trouve ? (
                          <span key={k} className="pal-trouve">
                            {m.texte}
                          </span>
                        ) : (
                          m.texte
                        ),
                      )}
                    </span>
                    <span className="pal-indice" data-ton={entree.tonIndice}>
                      {entree.indice}
                    </span>
                    {entree.raccourci && <Kbd>{entree.raccourci}</Kbd>}
                  </button>
                );
              })}
            </div>
          ))}
          {lignes.length === 0 && <div className="pal-vide">Aucun espace ni action pour cette recherche.</div>}
        </div>

        <span className="pal-sr" role="status">
          {lignes.length === 0 ? "Aucun résultat" : `${lignes.length} résultat${lignes.length > 1 ? "s" : ""}`}
        </span>
      </div>
    </div>
  );
}

/** Couleur de l'icône d'un onglet selon l'état de son agent. */
const COULEUR_ONGLET: Record<EtatAgent, string> = {
  attente: "var(--attente)",
  travail: "var(--travail)",
  termine: "var(--succes)",
  repos: "var(--texte-discret)",
};

/** Repère à gauche d'une ligne : avatar de l'espace, terminal de l'onglet, carré d'une action. */
function Pastille({ entree }: { entree: EntreePalette }) {
  const v = entree.visuel;
  return (
    <span className="pal-pastille" aria-hidden="true">
      {/* Rond de 10 px de la couleur de l'espace (maquettes) : son état se lit dans l'indice. */}
      {v.genre === "espace" && <span className="pal-rond" style={{ background: v.couleur }} />}
      {v.genre === "onglet" && (
        <IconeTerminal
          taille={15}
          style={{
            color: COULEUR_ONGLET[v.etat],
          }}
        />
      )}
      {v.genre === "action" && <span className="pal-carre" />}
      {v.genre === "accent" && <span className="pal-carre" style={{ background: "var(--accent)" }} />}
    </span>
  );
}
