import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType, type KeyboardEvent } from "react";
import { useUiStore, type SectionParametres } from "../../store/ui";
import { useReglagesStore } from "../../store/reglages";
import { useWorkspaceStore } from "../../store/workspace";
import { focusTab } from "../../lib/tabFocus";
import { mouvementReduit } from "../../lib/mouvement";
import { rangeesRaccourcis } from "../../lib/parametresRaccourcis";
import {
  construireSections,
  filtrerRaccourcis,
  introRecherche,
  rechercher,
  type BlocParametres,
  type RangeeParametre,
} from "../../lib/parametresModele";
import { ContexteParametres, type RetourEnregistre, type ValeurParametres } from "./contexte";
import { RANGEES_APP, Raccourci } from "./RangeesApp";
import { RANGEES_ACTIVITE } from "./RangeesActivite";
import { ContexteActivite, useReglagesActivite } from "./useReglagesActivite";
import "../../styles/parametres.css";

/**
 * Vue plein écran Paramètres (maquette Parametres), au-dessus du terminal et sous la
 * barre du haut, montée par la coquille quand `useUiStore.parametres` est ouvert.
 *
 * Navigation à gauche (sept sections, sélection qui glisse), recherche qui traverse
 * toutes les sections et compte les résultats de chacune, contenu de la section ou des
 * résultats à droite. Chaque réglage s'applique et s'enregistre aussitôt : pas de bouton
 * Enregistrer, un « ✓ Enregistré » discret à côté de la rangée touchée, qui s'efface seul,
 * et la même annonce dans une région `role=status`. Arriver par la palette (ou par
 * « Ouvrir <section> » d'une recherche) fait clignoter les rangées visées.
 *
 * La forme de la page vient de `lib/parametresModele` ; chaque rangée est rendue par son
 * composant (RangeesApp, RangeesActivite) d'après son id. Échap se gère ici, par
 * `onKeyDown` sur la racine (jamais sur window : Échap appartient au terminal).
 */

/** Confirmation affichée, puis fondu, puis retirée (maquette : 1,5 s puis 0,45 s). */
const DUREE_RETOUR_MS = 1500;
const DUREE_FONDU_MS = 450;
/** Durée du clignotement des rangées visées (keyframes par-flash, 1,8 s). */
const DUREE_FLASH_MS = 1900;
/** Pas de la sélection de la navigation : bouton de 36 + écart de 2. */
const PAS_NAV = 38;

const RENDUS: Record<string, ComponentType<{ rangee: RangeeParametre }>> = { ...RANGEES_APP, ...RANGEES_ACTIVITE };

function RangeeRendue({ rangee }: { rangee: RangeeParametre }) {
  if (rangee.combos) return <Raccourci rangee={rangee} />;
  const Composant = RENDUS[rangee.id];
  return Composant ? <Composant rangee={rangee} /> : null;
}

/** Rend la saisie au terminal de l'espace actif (fermeture de la vue). */
function rendreFocusTerminal() {
  const s = useWorkspaceStore.getState();
  const w = s.workspaces.find((x) => x.id === s.activeId);
  if (w?.activeTabId) focusTab(w.activeTabId);
}

export function Parametres() {
  const ouverture = useUiStore((s) => s.parametres);
  const section: SectionParametres = ouverture?.section ?? "apparence";
  const supActif = useReglagesStore((s) => s.reglages.superviseur.actif);
  const supNom = useReglagesStore((s) => s.reglages.superviseur.nom);
  const erreurReglages = useReglagesStore((s) => s.erreur);
  const activite = useReglagesActivite();

  const racineRef = useRef<HTMLElement>(null);
  const contenuRef = useRef<HTMLDivElement>(null);
  const [recherche, setRecherche] = useState("");
  const [filtre, setFiltre] = useState("");
  const [flash, setFlash] = useState<{ ids: ReadonlySet<string>; cle: number }>({ ids: new Set(), cle: 0 });
  const [retour, setRetour] = useState<RetourEnregistre | null>(null);
  const [annonce, setAnnonce] = useState("");
  // Alterne à chaque changement de section : rejoue l'entrée du contenu (inA / inB).
  const [bascule, setBascule] = useState(false);

  const raccourcis = useMemo(() => rangeesRaccourcis(), []);
  const sourceTaches = activite.reglages?.clickup.source ?? null;
  const integrationShell = activite.reglages?.shell.integration ?? false;
  const sections = useMemo(
    () =>
      construireSections({
        supActif,
        supNom,
        activite: sourceTaches === null ? null : { source: sourceTaches, integrationShell },
        noteActivite: activite.erreur ?? undefined,
        raccourcis,
      }),
    [supActif, supNom, sourceTaches, integrationShell, activite.erreur, raccourcis],
  );
  const libelles = useMemo(() => {
    const m = new Map<string, string>();
    for (const s of sections) for (const b of s.blocs) for (const r of b.rangees) m.set(r.id, r.libelle);
    return m;
  }, [sections]);

  // La vue prend le focus à l'ouverture.
  useEffect(() => {
    racineRef.current?.focus();
  }, []);

  // Arrivée (ouverture, palette, « Ouvrir <section> ») : recherche effacée, contenu rejoué,
  // rangées visées en surbrillance, la première amenée à l'écran.
  useEffect(() => {
    if (!ouverture) return;
    setRecherche("");
    setFiltre("");
    setBascule((b) => !b);
    setFlash((f) => ({ ids: new Set(ouverture.surbrillance), cle: f.cle + 1 }));
    if (!ouverture.surbrillance.length) return;
    const h = window.setTimeout(() => setFlash((f) => ({ ids: new Set(), cle: f.cle })), DUREE_FLASH_MS);
    const cible = ouverture.surbrillance[0];
    const raf = window.requestAnimationFrame(() => {
      contenuRef.current
        ?.querySelector(`[data-rangee="${CSS.escape(cible)}"]`)
        ?.scrollIntoView({ block: "center", behavior: mouvementReduit() ? "auto" : "smooth" });
    });
    return () => {
      window.clearTimeout(h);
      window.cancelAnimationFrame(raf);
    };
  }, [ouverture]);

  // « ✓ Enregistré » : affiché, fondu, retiré ; un nouveau signalement repart de zéro.
  const minuteries = useRef<number[]>([]);
  useEffect(() => () => minuteries.current.forEach((h) => window.clearTimeout(h)), []);
  const signaler = useCallback(
    (id: string, texte = "Enregistré") => {
      minuteries.current.forEach((h) => window.clearTimeout(h));
      setRetour((r) => ({ id, texte, sortie: false, cle: (r?.cle ?? 0) + 1 }));
      setAnnonce(`${libelles.get(id) ?? "Réglage"} : ${texte.toLowerCase()}`);
      minuteries.current = [
        window.setTimeout(() => setRetour((r) => (r ? { ...r, sortie: true } : r)), DUREE_RETOUR_MS),
        window.setTimeout(() => setRetour(null), DUREE_RETOUR_MS + DUREE_FONDU_MS),
      ];
    },
    [libelles],
  );
  const contexte = useMemo<ValeurParametres>(() => ({ retour, flash, signaler }), [retour, flash, signaler]);

  const fermer = () => {
    useUiStore.getState().fermerParametres();
    rendreFocusTerminal();
  };

  const surClavier = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    // Échap dans un champ de recherche rempli : il l'efface d'abord.
    const cible = e.target as HTMLElement;
    if (cible.dataset.parRecherche !== undefined && (cible as HTMLInputElement).value) {
      if (cible.dataset.parRecherche === "filtre") setFiltre("");
      else setRecherche("");
      return;
    }
    fermer();
  };

  const ouvrirSection = (id: SectionParametres, surbrillance: string[] = []) =>
    useUiStore.getState().ouvrirParametres(id, surbrillance);

  // --- Contenu ---
  const cherche = recherche.trim().length > 0;
  const resultats = cherche ? rechercher(sections, recherche) : [];
  const total = resultats.reduce((n, r) => n + r.rangees.length, 0);
  const compte = (id: SectionParametres) => resultats.find((r) => r.section.id === id)?.rangees.length ?? 0;
  const courante = sections.find((s) => s.id === section) ?? sections[0];
  const rangSection = Math.max(
    0,
    sections.findIndex((s) => s.id === section),
  );

  let blocs: (BlocParametres & { cle: string; ouvrir?: () => void })[];
  if (cherche) {
    blocs = resultats.map((r) => ({
      cle: r.section.id,
      titre: r.section.nom,
      rangees: r.rangees,
      ouvrir: () =>
        ouvrirSection(
          r.section.id,
          r.rangees.map((x) => x.id),
        ),
    }));
  } else {
    const propres = courante.id === "raccourcis" ? filtrerRaccourcis(courante.blocs, filtre) : courante.blocs;
    blocs = propres.map((b, i) => ({ ...b, cle: `${courante.id}-${i}` }));
  }
  const raccourcisVides = !cherche && courante.id === "raccourcis" && filtre.trim() !== "" && blocs.length === 0;
  const aucunResultat = (cherche && total === 0) || raccourcisVides;

  return (
    <section ref={racineRef} className="par" aria-label="Paramètres" tabIndex={-1} onKeyDown={surClavier}>
      <div className="par-tete">
        <div className="par-titre">
          <h1 className="par-intertitre">Paramètres</h1>
          <span className="par-puce">Ctrl+Maj+,</span>
        </div>
        <span role="status" aria-live="polite" className="par-sr">
          {annonce}
        </span>
        <button type="button" className="hov par-retour" title="Retour au terminal (Échap)" onClick={fermer}>
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 4.5l3 3-3 3M8 11.5h5" />
          </svg>
          Retour au terminal
          <span className="par-puce par-puce-forte">Échap</span>
        </button>
      </div>

      {erreurReglages && (
        <p className="par-erreur" role="alert">
          {erreurReglages}
        </p>
      )}

      <div className="par-corps">
        <nav aria-label="Sections des paramètres" className="par-nav">
          <div className="par-recherche">
            <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--texte-discret)" strokeWidth="1.5" strokeLinecap="round">
              <circle cx="7" cy="7" r="4.2" />
              <path d="M10.2 10.2L13.5 13.5" />
            </svg>
            <input
              className="par-champ par-recherche-champ"
              aria-label="Rechercher un réglage"
              placeholder="Rechercher un réglage"
              data-par-recherche="reglages"
              value={recherche}
              spellCheck={false}
              autoComplete="off"
              onChange={(e) => setRecherche(e.target.value)}
            />
            {cherche && (
              <button type="button" className="hov par-effacer" aria-label="Effacer la recherche" onClick={() => setRecherche("")}>
                <svg aria-hidden="true" width="10" height="10" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
                  <path d="M4 4l8 8M12 4l-8 8" />
                </svg>
              </button>
            )}
          </div>
          <div className="par-nav-liste">
            <span
              aria-hidden="true"
              className="par-nav-selection"
              style={{ transform: `translateY(${rangSection * PAS_NAV}px)`, opacity: cherche ? 0 : 1 }}
            >
              <span />
            </span>
            {sections.map((s) => {
              const actuelle = !cherche && s.id === section;
              const n = compte(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  className="par-nav-item"
                  aria-current={actuelle ? "page" : undefined}
                  data-actuelle={actuelle || undefined}
                  data-eteinte={(cherche && n === 0) || undefined}
                  onClick={() =>
                    ouvrirSection(
                      s.id,
                      cherche ? (resultats.find((r) => r.section.id === s.id)?.rangees.map((x) => x.id) ?? []) : [],
                    )
                  }
                >
                  <svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                    <path d={s.icone} />
                  </svg>
                  <span className="par-nav-nom">{s.nom}</span>
                  {cherche && n > 0 && (
                    <span className="par-nav-compte">{n}</span>
                  )}
                </button>
              );
            })}
          </div>
          <p className="par-nav-note">Chaque réglage s’applique tout de suite et s’enregistre seul.</p>
        </nav>

        <ContexteParametres.Provider value={contexte}>
          <ContexteActivite.Provider value={activite}>
            <div
              ref={contenuRef}
              key={cherche ? "recherche" : section}
              className="par-contenu"
              style={{ animationName: bascule ? "inA" : "inB" }}
            >
              <div>
                <h2 className="par-page-titre">{cherche ? "Recherche" : courante.nom}</h2>
                <p className="par-page-intro">{cherche ? introRecherche(total, recherche) : courante.intro}</p>
              </div>

              {!cherche && courante.id === "raccourcis" && (
                <input
                  className="par-champ par-filtre"
                  aria-label="Filtrer les raccourcis"
                  placeholder="Filtrer : onglet, Maj+D, dock…"
                  data-par-recherche="filtre"
                  value={filtre}
                  spellCheck={false}
                  autoComplete="off"
                  onChange={(e) => setFiltre(e.target.value)}
                />
              )}

              {blocs.map((b) => (
                <section key={b.cle} aria-label={b.titre || courante.nom} className="par-bloc">
                  {(b.titre || b.ouvrir) && (
                    <div className="par-bloc-tete">
                      <h3 className="par-intertitre par-bloc-titre">{b.titre}</h3>
                      {b.ouvrir && (
                        <button type="button" className="hov par-ouvrir" onClick={b.ouvrir}>
                          Ouvrir {b.titre}
                          <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M3 8h10M9 4l4 4-4 4" />
                          </svg>
                        </button>
                      )}
                    </div>
                  )}
                  {b.note && <p className="par-bloc-note">{b.note}</p>}
                  {b.rangees.length > 0 && (
                    <div className="par-carte">
                      {b.rangees.map((r) => (
                        <RangeeRendue key={r.id} rangee={r} />
                      ))}
                    </div>
                  )}
                </section>
              ))}

              {aucunResultat && (
                <div className="par-vide">
                  <div className="par-vide-titre">
                    {cherche ? `Aucun réglage pour « ${recherche.trim()} ».` : `Aucun raccourci pour « ${filtre.trim()} ».`}
                  </div>
                  <div className="par-vide-aide">Essayez « police », « hooks », « bilan » ou « onglet ».</div>
                </div>
              )}
            </div>
          </ContexteActivite.Provider>
        </ContexteParametres.Provider>
      </div>
    </section>
  );
}
