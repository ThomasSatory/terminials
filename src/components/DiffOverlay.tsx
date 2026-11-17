import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
} from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore, type Workspace } from "../store/workspace";
import { focusTab } from "../lib/tabFocus";
import { couleurEspace } from "../lib/couleurEspace";
import {
  STATUT_FICHIER,
  filtrerFichiers,
  libelleFichier,
  parseUnifiedDiff,
  pluriel,
  scinderChemin,
  scinderEnteteHunk,
  totauxDiff,
  type ChangedFile,
  type DiffLine,
} from "../lib/diff";
import { Kbd } from "./ui/Kbd";
import { IconeCoche, IconeHorsDepot, IconeRafraichir, IconeTerminal } from "./ui/icons";
import "../styles/diff.css";
import { cheminCourt } from "../lib/espacesRecents";
import { useHome } from "../hooks/useHome";

/** Durée minimale du rafraîchissement (maquette : 520 ms), pour qu'un clic ait un retour visible. */
const RECHARGE_MIN_MS = 520;

/** Pas de la liste : hauteur d'une ligne (50) + écart (2), comme la maquette. */
const PAS_LIGNE = 52;

/** Compteurs +n / −n ; absents pour un binaire (numstat vide). */
function Compteurs({ fichier, className }: { fichier: ChangedFile; className: string }) {
  if (fichier.added === undefined && fichier.deleted === undefined) return null;
  return (
    <span className={className}>
      <span className="diff-v-ajout">+{fichier.added ?? 0}</span>
      <span className="diff-v-retrait">−{fichier.deleted ?? 0}</span>
    </span>
  );
}

function Lettre({ status }: { status: ChangedFile["status"] }) {
  const st = STATUT_FICHIER[status];
  return (
    <span className="diff-v-lettre" title={st.libelle} style={{ "--st": st.couleur, "--st-doux": st.fond } as CSSProperties}>
      {st.lettre}
    </span>
  );
}

/**
 * Diff du fichier choisi, seul dans le panneau (maquette Diff : pas de pile, pas de
 * sous-en-tête, l'en-tête du panneau nomme déjà le fichier).
 */
function DiffFichier({ lines }: { lines: DiffLine[] | undefined }) {
  // Les en-têtes git (meta) sont masquées, sauf « Binary files … differ ».
  const visibles = (lines ?? []).filter(
    (l) => l.kind !== "meta" || l.text.startsWith("Binary files"),
  );
  let hunksVus = 0;

  return (
    <>
      {lines === undefined && <div className="diff-v-attente">chargement…</div>}
      {visibles.map((l, i) => {
        if (l.kind === "hunk") {
          const { plage, section } = scinderEnteteHunk(l.text);
          const suite = hunksVus++ > 0;
          return (
            <div key={i} className="diff-v-hunk" data-suite={suite}>
              <span className="diff-v-hunk-plage">{plage}</span>
              <span className="diff-v-hunk-section">{section}</span>
            </div>
          );
        }
        if (l.kind === "meta") {
          return (
            <div key={i} className="diff-v-meta">
              {l.text}
            </div>
          );
        }
        return (
          <div key={i} className="diff-v-l" data-genre={l.kind}>
            <span aria-hidden="true" className="diff-v-no">
              {l.oldNo ?? ""}
            </span>
            <span aria-hidden="true" className="diff-v-no diff-v-no-neuf">
              {l.newNo ?? ""}
            </span>
            <span className="diff-v-signe">
              {l.kind === "add" ? "+" : l.kind === "del" ? "−" : " "}
            </span>
            <span className="diff-v-texte">{l.text || " "}</span>
          </div>
        );
      })}
    </>
  );
}

function BoutonRetour({ onClick, seul }: { onClick: () => void; seul?: boolean }) {
  return (
    <button
      type="button"
      className={"hov diff-v-retour" + (seul ? " diff-v-retour-seul" : "")}
      onClick={onClick}
      title="Retour au terminal (Échap ou Ctrl+Maj+D)"
    >
      {!seul && <IconeTerminal taille={14} />}
      Retour au terminal
      <Kbd variante="puce">Échap</Kbd>
    </button>
  );
}

/** Espaces du dock (hors celui-ci) qui ont des changements à relire : « À relire ailleurs ». */
function useAutresADeRelire(wsId: string) {
  // Clé primitive : seul un changement de ce qui est affiché re-rend, pas chaque tick des sondes.
  const cle = useWorkspaceStore((s) =>
    JSON.stringify(
      s.workspaces
        .filter((w) => w.id !== wsId && w.dirty)
        .map((w) => [w.id, w.name, couleurEspace(w), w.cwd]),
    ),
  );
  return useMemo(
    () =>
      (JSON.parse(cle) as [string, string, string, string][]).map(([id, nom, couleur, cwd]) => ({
        id,
        nom,
        couleur,
        cwd,
      })),
    [cle],
  );
}

/**
 * Nombre de fichiers modifiés de chaque espace « à relire ailleurs », tel que la sonde dirty
 * d'App l'a lu (un seul `git status` par sonde, aucun de plus ici). Sélecteur en chaîne :
 * seul un compte qui change re-rend. Absent tant que la sonde ne l'a pas lu.
 */
function useComptesAilleurs(autres: { id: string }[]): Record<string, number> {
  const ids = autres.map((o) => o.id).join("\u0000");
  const cle = useWorkspaceStore((s) =>
    JSON.stringify(
      ids
        .split("\u0000")
        .map((id) => [id, s.workspaces.find((w) => w.id === id)?.nbModifies ?? null] as const)
        .filter(([, n]) => n !== null),
    ),
  );
  return useMemo(() => Object.fromEntries(JSON.parse(cle) as [string, number][]), [cle]);
}

function DiffOverlayInner({ ws }: { ws: Workspace }) {
  const { id: wsId, cwd, name } = ws;
  const toggleDiff = useWorkspaceStore((s) => s.toggleDiff);
  const setActive = useWorkspaceStore((s) => s.setActive);
  // Sélecteur étroit (primitive) : l'overlay ne doit re-render que si la branche change,
  // pas à chaque tick des pollers ports/git qui réécrivent le tableau workspaces.
  const branch = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === wsId)?.branch);
  const ailleurs = useAutresADeRelire(wsId);

  const home = useHome();
  const containerRef = useRef<HTMLElement>(null);
  const defileRef = useRef<HTMLDivElement>(null);
  const ligneRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const requested = useRef<Set<string>>(new Set());
  // Génération des lectures git : chaque rechargement l'incrémente, le démontage aussi ; une
  // réponse dont la génération n'est plus courante est périmée et ignorée (double clic sur
  // « Rafraîchir », lecture d'un fichier lancée avant le rechargement).
  const generation = useRef(0);

  const [files, setFiles] = useState<ChangedFile[] | null>(null); // null = premier chargement
  const [recharge, setRecharge] = useState(false);
  const [diffs, setDiffs] = useState<Record<string, DiffLine[]>>({});
  const [filter, setFilter] = useState(""); // filtre sous-chaîne de la liste (touche « / »)
  const [selPath, setSelPath] = useState<string | null>(null);
  const [bascule, setBascule] = useState(false); // alterne inA/inB pour rejouer l'entrée du bandeau
  const selRef = useRef(selPath); // sélection courante, lue par les rappels mémoïsés
  useEffect(() => {
    selRef.current = selPath;
  }, [selPath]);
  const filterRef = useRef<HTMLInputElement>(null);
  const lastG = useRef(0); // timestamp du dernier « g » (chord « g g » < 500 ms)

  // Liste des fichiers : à l'ouverture + bouton rafraîchir. Jamais pollée.
  // Au rafraîchissement l'ancienne liste reste affichée (estompée) jusqu'à la nouvelle, au
  // moins RECHARGE_MIN_MS : git répond souvent en quelques ms et le clic passerait inaperçu.
  const loadFiles = useCallback(
    async (rafraichir: boolean) => {
      const g = ++generation.current;
      setRecharge(true);
      const lecture = invoke<ChangedFile[]>("git_changed_files", { cwd }).catch(
        () => [] as ChangedFile[], // backend indisponible : même rendu que « aucun changement »
      );
      const [brute] = await Promise.all([
        lecture,
        rafraichir ? new Promise((r) => setTimeout(r, RECHARGE_MIN_MS)) : null,
      ]);
      if (g !== generation.current) return; // un rechargement plus récent a pris la main
      const list = [...brute].sort((a, b) => a.path.localeCompare(b.path));
      // Lecture fraîche : le compteur du bouton ± (store) s'aligne sur la liste affichée.
      useWorkspaceStore.getState().setDirty(wsId, list.length > 0, list.length);
      requested.current.clear();
      setDiffs({});
      setFiles(list);
      setSelPath((p) => (p && list.some((f) => f.path === p) ? p : (list[0]?.path ?? null)));
      setRecharge(false);
    },
    [cwd, wsId],
  );

  useEffect(() => {
    void loadFiles(false);
  }, [loadFiles]);

  useEffect(
    () => () => {
      generation.current++; // réponses en vol après la fermeture : ignorées
    },
    [],
  );

  // Focus : l'overlay prend le focus au montage (blur implicite du textarea xterm) ;
  // au démontage, le focus revient au textarea de l'onglet actif de l'espace.
  useEffect(() => {
    containerRef.current?.focus();
    return () => {
      const s = useWorkspaceStore.getState();
      const w = s.workspaces.find((x) => x.id === wsId);
      if (w?.activeTabId) focusTab(w.activeTabId);
    };
  }, [wsId]);

  // Un seul fetch par fichier ; repli --cached si le diff de l'arbre est vide (changement indexé).
  const loadFile = useCallback(
    async (f: ChangedFile) => {
      if (requested.current.has(f.path)) return;
      requested.current.add(f.path);
      const g = generation.current;
      let lignes: DiffLine[];
      try {
        let text = await invoke<string>("git_file_diff", { cwd, path: f.path, staged: false });
        if (!text && f.status !== "untracked") {
          text = await invoke<string>("git_file_diff", { cwd, path: f.path, staged: true });
        }
        lignes = parseUnifiedDiff(text);
      } catch {
        lignes = [];
      }
      // Lecture lancée avant un rechargement : la liste (et `diffs`) a été remise à zéro.
      if (g !== generation.current) return;
      setDiffs((d) => ({ ...d, [f.path]: lignes }));
    },
    [cwd],
  );

  const liste = files ?? [];
  const totaux = totauxDiff(liste);
  const affiches = filtrerFichiers(liste, filter);
  const courant = liste.find((f) => f.path === selPath) ?? liste[0];
  const idxAffiche = affiches.findIndex((f) => f.path === courant?.path);

  // Le panneau ne montre que le fichier choisi : son diff est lu à la sélection, et le
  // défilement repart du haut (comme le changement de fichier de la maquette).
  useEffect(() => {
    if (!courant) return;
    void loadFile(courant);
    if (defileRef.current) defileRef.current.scrollTop = 0;
  }, [courant, loadFile]);

  // Choix explicite (clic, ↑/↓) : l'entrée du panneau se rejoue, comme dans la maquette.
  const choisir = useCallback((f: ChangedFile) => {
    if (selRef.current !== f.path) setBascule((b) => !b);
    setSelPath(f.path);
  }, []);

  const naviguer = (delta: number) => {
    if (affiches.length === 0) return;
    const i = Math.max(0, Math.min(affiches.length - 1, (idxAffiche < 0 ? 0 : idxAffiche) + delta));
    const f = affiches[i];
    choisir(f);
    // Le focus était sur une ligne (clic, Tab) : il suit la sélection, sinon l'anneau de
    // focus resterait sur l'ancienne ligne pendant que l'indicateur glisse à la nouvelle.
    const actif = document.activeElement;
    if (actif instanceof HTMLElement && actif.closest(".diff-v-fichiers")) ligneRefs.current[f.path]?.focus();
  };

  const relireAilleurs = (id: string) => {
    toggleDiff(wsId); // referme celui-ci : on n'y reviendra pas sur la vue des fichiers
    setActive(id);
    // toggleDiff bascule : un diff resté ouvert sur l'autre espace se refermerait.
    const autre = useWorkspaceStore.getState().workspaces.find((w) => w.id === id);
    if (autre && !autre.diffOpen) toggleDiff(id);
  };

  // Clavier de l'overlay — uniquement sur le conteneur focusé, aucun listener window.
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape") {
      // Dans le filtre, Échap rend d'abord le focus à l'overlay.
      if (e.target === filterRef.current && filter) {
        containerRef.current?.focus();
        return;
      }
      toggleDiff(wsId);
      return;
    }
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      naviguer(e.key === "ArrowDown" ? 1 : -1);
      return;
    }
    // Dans le champ de filtre, les autres touches sont de la saisie.
    if (e.target === filterRef.current) return;
    // Avec un modificateur, la combinaison appartient à quelqu'un d'autre (raccourcis de l'app).
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const zone = defileRef.current;
    switch (e.key) {
      case "j":
        zone?.scrollBy({ top: 60 });
        break;
      case "k":
        zone?.scrollBy({ top: -60 });
        break;
      case "G": // Maj+G : bas du diff
        if (zone) zone.scrollTop = zone.scrollHeight;
        break;
      case "g": {
        // Chord « g g » (deux g en < 500 ms) : haut du diff.
        const now = Date.now();
        if (now - lastG.current < 500) {
          if (zone) zone.scrollTop = 0;
          lastG.current = 0;
        } else {
          lastG.current = now;
        }
        break;
      }
      case "/":
        e.preventDefault(); // sinon le « / » serait tapé dans le champ fraîchement focusé
        filterRef.current?.focus();
        break;
    }
  };

  const racineStyle = { "--diff-fichier": bascule ? "inA" : "inB" } as CSSProperties;
  const vide = files !== null && files.length === 0;
  const comptes = useComptesAilleurs(ailleurs);
  // Un compte à 0 veut dire que la sonde dirty est en retard : rien à relire là-bas.
  const aRelire = ailleurs.filter((o) => comptes[o.id] !== 0);

  if (vide) {
    const horsDepot = !branch;
    return (
      <section
        ref={containerRef}
        tabIndex={-1}
        className="diff-v"
        aria-label="Fichiers modifiés"
        onKeyDown={onKeyDown}
      >
        <div className="diff-v-vide">
          <div className="diff-v-vide-carte">
            <span
              aria-hidden="true"
              className="diff-v-vide-icone"
              style={{ color: horsDepot ? "var(--texte-discret)" : "var(--succes)" }}
            >
              {horsDepot ? <IconeHorsDepot taille={20} /> : <IconeCoche taille={20} epaisseur={1.5} />}
            </span>
            <h2 className="diff-v-vide-titre">Rien à relire</h2>
            <p className="diff-v-vide-texte">
              {horsDepot
                ? `${cheminCourt(cwd, home ?? undefined)} n’est pas un dépôt git : aucune modification à suivre.`
                : `L’arbre de travail de ${name} est propre sur ${branch}.`}
            </p>
            <BoutonRetour onClick={() => toggleDiff(wsId)} seul />
            {aRelire.length > 0 && (
              <div className="diff-v-ailleurs">
                <h2 className="diff-v-intertitre">À relire ailleurs</h2>
                <div className="diff-v-ailleurs-liste">
                  {aRelire.map((o) => (
                    <button
                      key={o.id}
                      type="button"
                      className="hov diff-v-ailleurs-btn"
                      onClick={() => relireAilleurs(o.id)}
                    >
                      <span
                        aria-hidden="true"
                        className="diff-v-ailleurs-point"
                        style={{ background: o.couleur }}
                      />
                      {o.nom}
                      {comptes[o.id] !== undefined && (
                        <span className="diff-v-ailleurs-compte">{pluriel(comptes[o.id], "fichier")}</span>
                      )}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </section>
    );
  }

  return (
    <section
      ref={containerRef}
      tabIndex={-1}
      className="diff-v"
      aria-label="Fichiers modifiés"
      onKeyDown={onKeyDown}
      style={racineStyle}
    >
      <div className="diff-v-tete">
        <div className="diff-v-titre">
          <h2 className="diff-v-intertitre">Fichiers modifiés</h2>
          {files !== null && (
            <span className="diff-v-somme">
              <span style={{ color: "var(--texte)" }}>{pluriel(liste.length, "fichier")}</span>
              <span className="diff-v-ajout">+{totaux.ajouts}</span>
              <span className="diff-v-retrait">−{totaux.suppressions}</span>
            </span>
          )}
        </div>
        <button
          type="button"
          className="hov diff-v-rafraichir"
          onClick={() => void loadFiles(true)}
          aria-label="Rafraîchir la liste"
          title="Rafraîchir la liste"
        >
          <IconeRafraichir taille={15} epaisseur={1.5} data-tourne={recharge} />
        </button>
        <BoutonRetour onClick={() => toggleDiff(wsId)} />
      </div>

      {files === null ? (
        <div className="diff-v-aucun">chargement…</div>
      ) : (
        <div className="diff-v-corps" data-charge={recharge}>
          <div className="diff-v-liste">
            <input
              ref={filterRef}
              className="diff-v-filtre"
              aria-label="Filtrer les fichiers"
              placeholder="Filtrer  ( / )"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            <div role="listbox" aria-label="Fichiers de l’espace" className="diff-v-fichiers">
              <span
                aria-hidden="true"
                className="diff-v-selection"
                style={{
                  transform: `translateY(${Math.max(0, idxAffiche) * PAS_LIGNE}px)`,
                  opacity: idxAffiche >= 0 ? 1 : 0,
                }}
              />
              {affiches.map((f) => {
                const { dir, nom } = scinderChemin(f.path);
                return (
                  <button
                    key={f.path}
                    ref={(el) => {
                      ligneRefs.current[f.path] = el;
                    }}
                    type="button"
                    role="option"
                    aria-selected={f.path === courant?.path}
                    aria-label={libelleFichier(f)}
                    className="diff-v-ligne"
                    onClick={() => choisir(f)}
                  >
                    <Lettre status={f.status} />
                    <span className="diff-v-noms">
                      <span className="diff-v-nom">{nom}</span>
                      {/* <bdi> : la cellule est en rtl (ellipse à gauche) ; sans isolation, les
                          signes neutres passaient devant (« /src/lib » au lieu de « src/lib/ »,
                          « /. » au lieu de « ./ » pour un fichier à la racine). */}
                      <span className="diff-v-dossier">
                        <bdi dir="ltr">{dir}</bdi>
                      </span>
                    </span>
                    <Compteurs fichier={f} className="diff-v-compteurs" />
                  </button>
                );
              })}
            </div>
            {affiches.length === 0 && (
              <div className="diff-v-aucun">Aucun fichier ne correspond à {"«\u00a0"}{filter}{"\u00a0»."}</div>
            )}
            <div className="diff-v-aide">
              <span>j k défiler</span>
              <span>g g · G début, fin</span>
              <span>/ filtrer</span>
            </div>
          </div>

          <article
            className="diff-v-panneau"
            aria-label={courant ? `Diff de ${courant.path}` : "Diff"}
          >
            {courant && (
              <header className="diff-v-panneau-tete" key={courant.path}>
                <Lettre status={courant.status} />
                <span className="diff-v-chemin">
                  <span className="diff-v-chemin-dir">{scinderChemin(courant.path).dir}</span>
                  <span className="diff-v-chemin-nom">{scinderChemin(courant.path).nom}</span>
                </span>
                <span className="diff-v-somme">
                  <span className="diff-v-statut">{STATUT_FICHIER[courant.status].libelle}</span>
                  <Compteurs fichier={courant} className="diff-v-somme" />
                </span>
              </header>
            )}
            <div className="diff-v-defile" ref={defileRef}>
              {courant && (
                <div className="diff-v-code" key={courant.path}>
                  <DiffFichier lines={diffs[courant.path]} />
                </div>
              )}
            </div>
          </article>
        </div>
      )}
    </section>
  );
}

/**
 * Une instance par espace (et par dossier) : la clé remet tout à zéro au changement d'espace
 * — liste, diffs, filtre, sélection — comme la sélection propre à chaque espace de la
 * maquette, au lieu d'afficher l'état de l'espace précédent le temps de la relecture git.
 */
function DiffOverlayParEspace({ ws }: { ws: Workspace }) {
  return <DiffOverlayInner key={`${ws.id}\n${ws.cwd}`} ws={ws} />;
}

/**
 * Mémoïsé : l'objet ws change d'identité à chaque tick des pollers (ports/branch/dirty),
 * mais l'overlay n'en consomme que id/cwd/name — la branche passe par son propre sélecteur.
 */
export const DiffOverlay = memo(
  DiffOverlayParEspace,
  (prev, next) =>
    prev.ws.id === next.ws.id && prev.ws.cwd === next.ws.cwd && prev.ws.name === next.ws.name,
);
