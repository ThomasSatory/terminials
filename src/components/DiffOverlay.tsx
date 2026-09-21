import { memo, useCallback, useEffect, useRef, useState, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore, type Workspace } from "../store/workspace";
import { focusTab } from "../lib/tabFocus";
import { parseUnifiedDiff, type ChangedFile, type DiffLine } from "../lib/diff";

/** Lettre + couleur de statut par fichier (fidèle cmux). */
const STATUS_BADGE: Record<ChangedFile["status"], { letter: string; color: string }> = {
  modified: { letter: "M", color: "#e67e22" },
  added: { letter: "A", color: "#1abc9c" },
  deleted: { letter: "D", color: "#e74c3c" },
  renamed: { letter: "R", color: "#9b59b6" },
  untracked: { letter: "?", color: "#95a5a6" },
};

/** Compteurs +n / −n (verts/rouges) ; absents pour un binaire (numstat vide). */
function Stats({ added, deleted }: { added?: number; deleted?: number }) {
  return (
    <span className="diff-stats">
      {added !== undefined && <span style={{ color: "#2ecc71" }}>+{added}</span>}
      {deleted !== undefined && <span style={{ color: "#e74c3c" }}>−{deleted}</span>}
    </span>
  );
}

/**
 * Section d'un fichier dans le panneau principal : header sticky + lignes du diff.
 * Le diff est chargé lazy : un IntersectionObserver (root = .diff-main, marge 300px)
 * signale l'approche de la section ; le parent fetch une seule fois par fichier.
 */
function FileSection({
  file,
  lines,
  onVisible,
  refCb,
}: {
  file: ChangedFile;
  lines: DiffLine[] | undefined;
  onVisible: (f: ChangedFile) => void;
  refCb: (el: HTMLDivElement | null) => void;
}) {
  const localRef = useRef<HTMLDivElement | null>(null);
  const loaded = lines !== undefined;

  useEffect(() => {
    const el = localRef.current;
    if (!el || loaded) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) onVisible(file);
      },
      { root: el.closest(".diff-main"), rootMargin: "300px 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [loaded, file, onVisible]);

  // Les meta (en-têtes git) sont masquées, sauf « Binary files … differ » (spec §8).
  const visible = (lines ?? []).filter(
    (l) => l.kind !== "meta" || l.text.startsWith("Binary files"),
  );

  return (
    <div
      ref={(el) => {
        localRef.current = el;
        refCb(el);
      }}
      className="diff-file"
    >
      <div className="diff-file-header">
        <span className="diff-file-path">
          {file.origPath ? `${file.origPath} → ${file.path}` : file.path}
        </span>
        <Stats added={file.added} deleted={file.deleted} />
      </div>
      {visible.map((l, i) => (
        <div key={i} className={`diff-line diff-line-${l.kind}`}>
          <span className="diff-gutter">{l.oldNo ?? ""}</span>
          <span className="diff-gutter">{l.newNo ?? ""}</span>
          <span className="diff-text">
            {l.kind === "add" ? "+" : l.kind === "del" ? "-" : l.kind === "ctx" ? " " : ""}
            {l.text}
          </span>
        </div>
      ))}
    </div>
  );
}

function DiffOverlayInner({ ws }: { ws: Workspace }) {
  const { id: wsId, cwd, name } = ws;
  const toggleDiff = useWorkspaceStore((s) => s.toggleDiff);
  // Sélecteur étroit (primitive) : l'overlay ne doit re-render que si la branche change,
  // pas à chaque tick des pollers ports/git qui réécrivent le tableau workspaces.
  const branch = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === wsId)?.branch);

  const containerRef = useRef<HTMLDivElement>(null);
  const mainRef = useRef<HTMLDivElement>(null);
  const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});
  const requested = useRef<Set<string>>(new Set());

  const [files, setFiles] = useState<ChangedFile[] | null>(null); // null = chargement
  const [diffs, setDiffs] = useState<Record<string, DiffLine[]>>({});
  const [filter, setFilter] = useState(""); // filtre sous-chaîne de l'aside Files (touche « / »)
  const filterRef = useRef<HTMLInputElement>(null);
  const lastG = useRef(0); // timestamp du dernier « g » (chord « g g » < 500 ms)

  // Fetch de la liste des fichiers : à l'ouverture + bouton reload. Jamais pollé (spec §4).
  const loadFiles = useCallback(async () => {
    setFiles(null);
    setDiffs({});
    requested.current.clear();
    try {
      const list = await invoke<ChangedFile[]>("git_changed_files", { cwd });
      setFiles([...list].sort((a, b) => a.path.localeCompare(b.path)));
    } catch {
      setFiles([]); // backend indisponible : même rendu que « aucun changement »
    }
  }, [cwd]);

  useEffect(() => {
    void loadFiles();
  }, [loadFiles]);

  // Focus : l'overlay prend le focus au montage (blur implicite du textarea xterm) ;
  // au démontage, le focus revient au textarea de l’onglet actif du workspace (spec §4).
  useEffect(() => {
    containerRef.current?.focus();
    return () => {
      const s = useWorkspaceStore.getState();
      const w = s.workspaces.find((x) => x.id === wsId);
      if (w?.activeTabId) focusTab(w.activeTabId);
    };
  }, [wsId]);

  // Un seul fetch par fichier ; fallback --cached si le diff worktree est vide (changement staged).
  const loadFile = useCallback(
    async (f: ChangedFile) => {
      if (requested.current.has(f.path)) return;
      requested.current.add(f.path);
      try {
        let text = await invoke<string>("git_file_diff", { cwd, path: f.path, staged: false });
        if (!text && f.status !== "untracked") {
          text = await invoke<string>("git_file_diff", { cwd, path: f.path, staged: true });
        }
        setDiffs((d) => ({ ...d, [f.path]: parseUnifiedDiff(text) }));
      } catch {
        setDiffs((d) => ({ ...d, [f.path]: [] }));
      }
    },
    [cwd],
  );

  const totalAdded = (files ?? []).reduce((n, f) => n + (f.added ?? 0), 0);
  const totalDeleted = (files ?? []).reduce((n, f) => n + (f.deleted ?? 0), 0);

  // Le filtre ne s'applique qu'à l'aside Files ; le main garde toutes les sections.
  const shownFiles = (files ?? []).filter((f) =>
    f.path.toLowerCase().includes(filter.toLowerCase()),
  );

  // Clavier de l'overlay — uniquement sur le conteneur focusé, aucun listener window (spec §4).
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    // Événements venant de l'input de filtre : seul Escape est géré (retour du focus à l'overlay).
    if (e.target === filterRef.current) {
      if (e.key === "Escape") containerRef.current?.focus();
      return;
    }
    const main = mainRef.current;
    switch (e.key) {
      case "j":
        main?.scrollBy({ top: 60 });
        break;
      case "k":
        main?.scrollBy({ top: -60 });
        break;
      case "G": // Shift+G : bas du diff
        if (main) main.scrollTop = main.scrollHeight;
        break;
      case "g": {
        // Chord « g g » (deux g en < 500 ms) : haut du diff.
        const now = Date.now();
        if (now - lastG.current < 500) {
          if (main) main.scrollTop = 0;
          lastG.current = 0;
        } else {
          lastG.current = now;
        }
        break;
      }
      case "/":
        e.preventDefault(); // sinon le « / » serait tapé dans l'input fraîchement focusé
        filterRef.current?.focus();
        break;
      case "Escape":
        toggleDiff(wsId);
        break;
    }
  };

  return (
    <div ref={containerRef} tabIndex={-1} className="diff-overlay" onKeyDown={onKeyDown}>
      <div className="diff-toolbar">
        <span className="diff-toolbar-title">
          {name}
          {branch ? ` — ${branch}` : ""}
        </span>
        <span className="diff-toolbar-right">
          {files && files.length > 0 && (
            <>
              <span style={{ color: "#8a8a8a" }}>
                {files.length} fichier{files.length > 1 ? "s" : ""}
              </span>
              <span style={{ color: "#2ecc71" }}>+{totalAdded}</span>
              <span style={{ color: "#e74c3c" }}>−{totalDeleted}</span>
            </>
          )}
          <button className="icon-btn" title="Rafraîchir" onClick={() => void loadFiles()}>
            ⟳
          </button>
          <button className="icon-btn" title="Fermer (Escape)" onClick={() => toggleDiff(wsId)}>
            ×
          </button>
        </span>
      </div>
      {files === null ? (
        <div className="diff-empty">chargement…</div>
      ) : files.length === 0 ? (
        <div className="diff-empty">{branch ? "Aucun changement" : "Pas un dépôt git"}</div>
      ) : (
        <div className="diff-body">
          <div className="diff-aside">
            <input
              ref={filterRef}
              className="diff-filter"
              placeholder="filtrer ( / )"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
            />
            {shownFiles.map((f) => (
              <div
                key={f.path}
                className="diff-aside-row"
                onClick={() =>
                  sectionRefs.current[f.path]?.scrollIntoView({
                    behavior: "smooth",
                    block: "start",
                  })
                }
              >
                <span
                  className="diff-status-letter"
                  style={{ color: STATUS_BADGE[f.status].color }}
                >
                  {STATUS_BADGE[f.status].letter}
                </span>
                <span className="diff-aside-path" title={f.path}>
                  {f.path}
                </span>
                <Stats added={f.added} deleted={f.deleted} />
              </div>
            ))}
          </div>
          <div className="diff-main" ref={mainRef}>
            {files.map((f) => (
              <FileSection
                key={f.path}
                file={f}
                lines={diffs[f.path]}
                onVisible={loadFile}
                refCb={(el) => {
                  sectionRefs.current[f.path] = el;
                }}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Mémoïsé : l'objet ws change d'identité à chaque tick des pollers (ports/branch/dirty),
 * mais l'overlay n'en consomme que id/cwd/name — la branche passe par son propre sélecteur.
 */
export const DiffOverlay = memo(
  DiffOverlayInner,
  (prev, next) =>
    prev.ws.id === next.ws.id && prev.ws.cwd === next.ws.cwd && prev.ws.name === next.ws.name,
);
