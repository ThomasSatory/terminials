import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type FocusEvent,
  type KeyboardEvent,
} from "react";
import { useWorkspaceStore } from "../store/workspace";
import { useUiStore } from "../store/ui";
import { etatEspace, type EtatAgent } from "../lib/etatAgent";
import { couleurGroupe } from "../lib/couleurEspace";
import {
  FILTRE_TOUS,
  colonnesGrille,
  construireSections,
  dispositionGrille,
  estToucheNavigation,
  filtreValide,
  filtresMosaique,
  partiesSection,
  pluriel,
  resumeMosaique,
  tuileVoisine,
  type EspaceMosaique,
} from "../lib/mosaique";
import { mouvementReduit } from "../lib/mouvement";
import { focusTab } from "../lib/tabFocus";
import { EnTeteMosaique } from "./mosaique/EnTeteMosaique";
import { Tuile } from "./mosaique/Tuile";
import { zoomerVersTerminal } from "./mosaique/ZoomTerminal";
import { demarrerSuiviEtats } from "./mosaique/suivi";
import "../styles/mosaique.css";

// Le suivi « depuis quand » démarre avec l'app (App importe ce module au lancement) :
// rouvrir la mosaïque doit dire depuis combien de temps un agent attend déjà.
demarrerSuiviEtats();

/** Réglages de la vue retrouvés d'une ouverture à l'autre (session seulement). */
const memoire = { filtre: FILTRE_TOUS, attenteDabord: false };

/** Durée de l'éclair « vu » sur la tuile de l'espace qu'on vient de quitter. */
const DUREE_ECLAIR_MS = 1600;

const SEP_CHAMP = "\u0001";
const SEP_LIGNE = "\u0002";

/**
 * Mosaïque des agents (Ctrl+Maj+M) : une tuile par espace, regroupées par groupe (hors
 * groupe en dernier), avec l'état de son agent et les dernières lignes VIVANTES de son
 * onglet actif (registre des terminaux, lecture seule : les terminaux restent montés
 * dessous). Choisir une tuile zoome vers le terminal de l'espace ; Échap revient au
 * terminal de l'espace actif. Clavier : une seule tuile dans l'ordre de tabulation
 * (tabindex itinérant), les flèches, Début et Fin passent d'une tuile à l'autre ; les
 * « Aller » des tuiles en attente restent tabulables, ce sont les actions pressantes.
 *
 * Montée par App dans le calque des vues plein écran quand `useUiStore.vue ===
 * "mosaique"`, démontée sinon : aucun abonnement aux terminaux ne survit à sa fermeture.
 */
export function Mosaique() {
  // Une CHAÎNE (id, groupe, état) plutôt que les espaces : la grille ne se recompose
  // que si l'un d'eux change de groupe ou d'état, pas à chaque tour des sondes.
  const cleEspaces = useWorkspaceStore((s) =>
    s.workspaces.map((w) => [w.id, w.groupId ?? "", etatEspace(w, s)].join(SEP_CHAMP)).join(SEP_LIGNE),
  );
  const groupesStore = useWorkspaceStore((s) => s.groups);
  const setActive = useWorkspaceStore((s) => s.setActive);
  const setVue = useUiStore((s) => s.setVue);
  // Réserve basse identique à celle des terminaux (App) : rien de mort quand le dock est
  // masqué, et la dernière rangée ne passe pas sous une bulle d'agent posée sur le dock.
  const dockVisible = useUiStore((s) => s.dockVisible);
  const bulleVisible = useUiStore((s) => s.bulleEspace !== null);
  const reserve = !dockVisible
    ? "var(--reserve-sans-dock)"
    : bulleVisible
      ? "var(--reserve-dock-bulle)"
      : "var(--reserve-dock)";

  const espaces = useMemo<EspaceMosaique[]>(
    () =>
      cleEspaces
        ? cleEspaces.split(SEP_LIGNE).map((l) => {
            const [id, groupId, etat] = l.split(SEP_CHAMP);
            return { id, groupId: groupId || null, etat: etat as EtatAgent };
          })
        : [],
    [cleEspaces],
  );
  const groupes = useMemo(
    () => groupesStore.map((g) => ({ id: g.id, nom: g.name, couleur: couleurGroupe(g) })),
    [groupesStore],
  );

  const [filtreDemande, setFiltreDemande] = useState(memoire.filtre);
  const [attenteDabord, setAttenteDabord] = useState(memoire.attenteDabord);
  // Alterne inA/inB : changer de filtre ou d'ordre rejoue l'entrée de la grille sans
  // remonter les tuiles (leurs abonnements au terminal restent en place).
  const [bascule, setBascule] = useState(false);
  const filtre = filtreValide(filtreDemande, espaces);

  const choisirFiltre = useCallback(
    (id: string) => {
      if (id === filtre) return;
      memoire.filtre = id;
      setFiltreDemande(id);
      setBascule((b) => !b);
    },
    [filtre],
  );
  const basculerAttente = useCallback(() => {
    setAttenteDabord((v) => {
      memoire.attenteDabord = !v;
      return !v;
    });
    setBascule((b) => !b);
  }, []);

  const sections = useMemo(
    () => construireSections(espaces, groupes, filtre, attenteDabord),
    [espaces, groupes, filtre, attenteDabord],
  );
  const filtres = useMemo(() => filtresMosaique(espaces, groupes, filtre), [espaces, groupes, filtre]);
  const disposition = dispositionGrille(filtre, sections[0]?.espaces.length ?? 0);
  const entree = bascule ? "inA" : "inB";

  // Éclair « vu » sur la tuile de l'espace qu'on quitte en ouvrant la mosaïque.
  const [eclairId, setEclairId] = useState(() => useWorkspaceStore.getState().activeId);
  useEffect(() => {
    const h = setTimeout(() => setEclairId(null), DUREE_ECLAIR_MS);
    return () => clearTimeout(h);
  }, []);

  // ---------- Ouvrir un espace : zoom de la tuile vers son terminal ----------

  // Comme la maquette : la mosaïque cède la place tout de suite et c'est le vrai
  // terminal qui grandit depuis la tuile (cf. zoomerVersTerminal).
  const ouvrir = useCallback(
    (wsId: string, tuile: HTMLElement | null) => {
      setActive(wsId);
      const r = tuile?.getBoundingClientRect();
      if (r && r.width && !mouvementReduit()) zoomerVersTerminal(r);
      setVue("terminal");
      // Barre du haut en variante « retour » : bouton Mosaïque, Échap y ramène tant
      // qu'on n'a rien tapé dans ce terminal (lib/retourMosaique).
      useUiStore.getState().armerRetourMosaique(wsId);
      // Focus clavier au terminal une fois la mosaïque démontée (la tuile cliquée, qui
      // l'avait, disparaît avec elle) : Échap passe alors par sa couche clavier.
      requestAnimationFrame(() => {
        const tab = useWorkspaceStore.getState().workspaces.find((w) => w.id === wsId)?.activeTabId;
        if (tab) focusTab(tab);
      });
    },
    [setActive, setVue],
  );

  // ---------- Clavier : focus d'entrée, Échap, flèches ----------

  const racine = useRef<HTMLDivElement>(null);
  const boutonsTuiles = () =>
    Array.from(racine.current?.querySelectorAll<HTMLButtonElement>("[data-mos-ws]") ?? []);
  const tuileDe = (wsId: string | null) => boutonsTuiles().find((b) => b.dataset.mosWs === wsId) ?? null;

  // Tabindex itinérant : la tuile qui a eu le focus en dernier (au départ celle de
  // l'espace actif) est la seule que Tab atteint ; filtrée, la première affichée.
  const [courant, setCourant] = useState(() => useWorkspaceStore.getState().activeId);
  const idsAffiches = sections.flatMap((sec) => sec.espaces.map((e) => e.id));
  const tabulable = courant !== null && idsAffiches.includes(courant) ? courant : (idsAffiches[0] ?? null);
  const onFocus = (e: FocusEvent<HTMLDivElement>) => {
    const id = (e.target as HTMLElement).dataset.mosWs;
    if (id) setCourant(id);
  };

  // La vue prend le focus à l'ouverture : la tuile de l'espace actif (Entrée y revient),
  // sinon la première, sinon la vue elle-même pour qu'Échap fonctionne.
  useEffect(() => {
    const actif = useWorkspaceStore.getState().activeId;
    (tuileDe(actif) ?? boutonsTuiles()[0] ?? racine.current)?.focus();
  }, []);

  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      // Échap ne quitte que la mosaïque : jamais écouté sur window (il appartient à
      // l'agent dans le terminal). Retour au terminal de l'espace actif, en zoomant
      // depuis sa tuile comme un clic.
      e.preventDefault();
      e.stopPropagation();
      const actif = useWorkspaceStore.getState().activeId;
      if (actif) ouvrir(actif, tuileDe(actif)?.closest<HTMLElement>(".mos-tuile") ?? null);
      else setVue("terminal");
      return;
    }
    if (!estToucheNavigation(e.key) || e.altKey || e.ctrlKey || e.metaKey || !racine.current) return;
    const cible = e.target as HTMLElement;
    // Depuis une tuile (ou son bouton « Aller ») ou la vue elle-même ; pas depuis les filtres.
    const tuile = cible.closest(".mos-tuile")?.querySelector<HTMLButtonElement>("[data-mos-ws]");
    if (!tuile && cible !== racine.current) return;
    const boutons = boutonsTuiles();
    const rects = boutons.map((b) => b.getBoundingClientRect());
    const i = tuile ? boutons.indexOf(tuile) : -1;
    const j = tuileVoisine(rects, i, e.key);
    if (j < 0) return;
    e.preventDefault();
    boutons[j].focus();
  };

  let rang = 0;
  return (
    <div
      ref={racine}
      className="mos"
      tabIndex={-1}
      aria-label="Mosaïque des agents"
      role="region"
      style={{ "--mos-reserve": reserve } as CSSProperties}
      onKeyDown={onKeyDown}
      onFocus={onFocus}
    >
      <EnTeteMosaique
        resume={resumeMosaique(espaces)}
        filtres={filtres}
        onFiltre={choisirFiltre}
        attenteDabord={attenteDabord}
        onAttenteDabord={basculerAttente}
      />
      <div className="mos-zone">
        {sections.map((sec) => (
          <section key={sec.id} aria-label={sec.horsGroupe ? "Hors groupe" : `Groupe ${sec.nom}`} className="mos-section">
            <div className="mos-section-tete" style={{ animation: `${entree} .32s var(--courbe-glisse) both` }}>
              <span className="mos-section-nom">
                <span aria-hidden="true" className="mos-carre" style={{ background: sec.couleur }} />
                <span className="mos-intertitre">{sec.nom}</span>
              </span>
              <span className="mos-section-nombre">{pluriel(sec.espaces.length, "espace", "espaces")}</span>
              <span className="mos-section-parts">
                {partiesSection(sec.espaces).map((p) => (
                  <span key={p.etat} className="mos-part" data-etat={p.etat}>
                    <span aria-hidden="true" className="mos-part-point" />
                    {p.texte}
                  </span>
                ))}
              </span>
            </div>
            <div className="mos-grille" style={{ gridTemplateColumns: colonnesGrille(disposition.largeurMin) }}>
              {sec.espaces.map((e) => (
                <Tuile
                  key={e.id}
                  wsId={e.id}
                  etat={e.etat}
                  nbLignes={disposition.nbLignes}
                  taillePolice={disposition.taillePolice}
                  entree={entree}
                  delai={Math.min(rang++ * 22, 330)}
                  eclair={e.id === eclairId}
                  tabulable={e.id === tabulable}
                  onOuvrir={ouvrir}
                />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  );
}
