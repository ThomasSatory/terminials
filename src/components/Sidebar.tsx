import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { useWorkspaceStore, hasAttention } from "../store/workspace";
import { useDashboardStore } from "../store/dashboard";
import { PALETTE, ATTENTION_COLOR, STATUS_DEFAULT_COLOR } from "../lib/palette";
import { abbreviateHome } from "../lib/paths";
import { openFolderDialog } from "../lib/openFolder";
import { closePty } from "../lib/pty";
import { dropBoundary, finalIndex, type RowRect } from "../lib/reorder";
import { WorkspaceForm } from "./WorkspaceForm";

/** Métadonnées git/ports condensées en une ligne discrète : `branch • · :ports`.
   Le `•` (dirty) et les ports sont optionnels ; hors repo, renvoie "". */
function metaLine(branch: string | undefined, dirty: boolean | undefined, ports: number[]): string {
  const parts: string[] = [];
  if (branch) parts.push(dirty ? `${branch} •` : branch);
  if (ports.length) parts.push(`:${ports.join(",")}`);
  return parts.join(" · ");
}

/** Déplacement vertical minimal avant qu'un appui devienne un drag de
    réordonnancement. En dessous, l'appui reste un clic d'activation. */
const DRAG_THRESHOLD = 4;

/** Boutons de la pile d'actions (× et ✎), révélée au survol de la ligne. */
const ACTION_BTN: CSSProperties = {
  width: 16,
  height: 16,
  padding: 0,
  lineHeight: "14px",
  fontSize: 12,
  border: "none",
  borderRadius: 3,
  background: "transparent",
  color: "#8a8a8a",
  cursor: "pointer",
};

/** Réserve la gouttière de la pile d'actions : l'ellipsis du nom ne doit jamais
    passer sous les boutons, y compris quand ils sont masqués. */
const ACTIONS_GUTTER = 20;

export function Sidebar() {
  const {
    workspaces,
    activeId,
    setActive,
    toggleDiff,
    closeWorkspace,
    panePtys,
    renameWorkspace,
    setCwd,
    setColor,
    addWorkspace,
    moveWorkspace,
  } = useWorkspaceStore();
  // Workspace en cours d'édition (nom + dossier), ouvert par le ✎ ou Ctrl+Shift+R.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Formulaire de création ouvert en bas de liste (aucun workspace créé tant
  // qu'il n'est pas validé : le + ne crée plus silencieusement sur ~).
  const [creating, setCreating] = useState(false);
  const [paletteFor, setPaletteFor] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const dashboardOpen = useDashboardStore((s) => s.open);
  const unreadSummary = useDashboardStore((s) => s.unreadSummary);
  const toggleDashboard = useDashboardStore((s) => s.toggle);

  const openEdit = (wsId: string) => {
    setCreating(false);
    setPaletteFor(null);
    setEditingId(wsId);
  };

  // --- Réordonnancement par glisser-déposer (pointer events) ---
  // PAS de HTML5 `draggable` : `dragDropEnabled` (défaut Tauri, ce qui fait vivre
  // l'injection de fichiers déposés dans App.tsx) rend le DnD HTML5 interne peu
  // fiable sous WebKitGTK. Les pointer events ne dépendent pas de ce handler OS.
  const listRef = useRef<HTMLDivElement>(null);
  // Appui en cours ; `dragging` ne passe à true qu'au franchissement du seuil.
  const dragRef = useRef<{ id: string; startY: number; dragging: boolean } | null>(null);
  // Un drop ne doit pas activer le workspace tiré : le click qui suit le pointerup
  // est avalé une fois (remis à false au pointerdown suivant, jamais laissé armé).
  const suppressClick = useRef(false);
  const [dragId, setDragId] = useState<string | null>(null);
  // Frontière d'insertion visée (indicateur de dépôt), dans [0, workspaces.length].
  const [boundary, setBoundary] = useState<number | null>(null);

  /** Géométrie verticale des lignes, dans l'ordre du DOM. Lue à chaque pointermove :
      aucun réordonnancement n'a lieu pendant le drag, les rects sont donc stables. */
  const rowRects = (): RowRect[] =>
    [...(listRef.current?.querySelectorAll<HTMLElement>("[data-ws-row]") ?? [])].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, height: r.height };
    });

  const endDrag = () => {
    dragRef.current = null;
    setDragId(null);
    setBoundary(null);
  };

  // Home résolu une fois via Tauri ; tant qu'il est vide, abbreviateHome est un no-op.
  const [home, setHome] = useState("");
  useEffect(() => {
    homeDir()
      .then(setHome)
      .catch(() => {});
  }, []);

  // Ctrl+Shift+R : le dispatch (K.5) pose renameRequestId sur le workspace actif.
  // Quand il matche un workspace, on ouvre l'édition inline (même chemin que le ✎),
  // puis on consomme la demande (requestRename(null)) — sinon un second
  // Ctrl+Shift+R sur le même workspace ne redéclencherait pas l'effet.
  const renameRequestId = useWorkspaceStore((s) => s.renameRequestId);
  useEffect(() => {
    if (!renameRequestId) return;
    if (workspaces.some((x) => x.id === renameRequestId)) openEdit(renameRequestId);
    useWorkspaceStore.getState().requestRename(null);
  }, [renameRequestId]);

  // Ctrl+Shift+N (et le bouton de l'état vide) : même protocole de demande
  // consommée que le renommage, le formulaire de création vivant ici.
  const newWorkspaceRequested = useWorkspaceStore((s) => s.newWorkspaceRequested);
  useEffect(() => {
    if (!newWorkspaceRequested) return;
    setEditingId(null);
    setPaletteFor(null);
    setCreating(true);
    useWorkspaceStore.getState().requestNewWorkspace(false);
  }, [newWorkspaceRequested]);

  /** Trait d'insertion du drag. `margin: -1px` compense sa hauteur : l'insérer dans
      le flux ne décale donc AUCUNE ligne, et les rects lus au pointermove suivant
      restent valides (sinon la cible oscillerait autour du point de bascule). */
  const dropLine = (index: number) =>
    dragId !== null && boundary === index ? (
      <div key={`drop:${index}`} style={{ height: 2, margin: "-1px 6px", background: "#ddd", borderRadius: 1 }} />
    ) : null;

  return (
    <div
      ref={listRef}
      style={{
        width: 240,
        background: "#141414",
        color: "#ddd",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
        borderRight: "1px solid #242424",
      }}
    >
      {/* Entrée fixe en tête de liste (§8 du design), au-dessus des workspaces :
          le dashboard n'est lié à aucun d'entre eux. Pastille bleue = résumé
          LLM prêt et pas encore vu (overlay resté fermé depuis, cf. store). */}
      <div
        className="dash-entry"
        onClick={toggleDashboard}
        title="Dashboard (Ctrl+Shift+H)"
        // `undefined` (et non "transparent") quand fermé : une valeur inline
        // écraserait en permanence le survol défini par la classe `.dash-entry:hover`.
        style={{ background: dashboardOpen ? "#2c2c2c" : undefined }}
      >
        <span>▦</span>
        <span style={{ flex: 1 }}>Dashboard</span>
        {unreadSummary && (
          <span
            style={{
              width: 8,
              height: 8,
              borderRadius: "50%",
              background: "#3b82f6",
              flexShrink: 0,
            }}
          />
        )}
      </div>
      {workspaces.map((w, i) => (
        // Fragment et non un div englobant : la ligne reste un enfant DIRECT du
        // conteneur flex, donc ses marges verticales ne peuvent pas fusionner à
        // travers un wrapper (et le trait de dépôt contribue bien 0 px).
        <Fragment key={w.id}>
          {dropLine(i)}
          <div
            data-ws-row
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              setActive(w.id);
            }}
            onMouseEnter={() => setHoverId(w.id)}
            onMouseLeave={() => setHoverId((cur) => (cur === w.id ? null : cur))}
            // `userSelect: none` ne bloque que le DÉMARRAGE d'une sélection sur la
            // ligne : WebKitGTK l'étend quand même depuis un ancêtre sélectionnable
            // pendant le glissement, et le texte du workspace finit surligné.
            // Annuler le mousedown coupe la sélection à la source ; le `click`
            // d'activation, lui, continue d'être émis (seul le focus est perdu,
            // sans effet ici). En édition la ligne est un formulaire : on laisse
            // passer, sinon les champs ne prendraient plus le focus.
            onMouseDown={(e) => {
              if (e.button !== 0 || editingId === w.id) return;
              e.preventDefault();
            }}
            onPointerDown={(e) => {
              suppressClick.current = false;
              // Bouton gauche seulement ; pendant l'édition la ligne est un
              // formulaire (sélection de texte dans les champs).
              if (e.button !== 0 || editingId === w.id) return;
              dragRef.current = { id: w.id, startY: e.clientY, dragging: false };
            }}
            onPointerMove={(e) => {
              const d = dragRef.current;
              if (!d || d.id !== w.id) return;
              if (!d.dragging) {
                if (Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD) return;
                d.dragging = true;
                // Capture : le drag survit à la sortie de la ligne d'origine.
                e.currentTarget.setPointerCapture(e.pointerId);
                setDragId(w.id);
              }
              setBoundary(dropBoundary(rowRects(), e.clientY));
            }}
            onPointerUp={(e) => {
              const d = dragRef.current;
              if (d?.dragging) {
                suppressClick.current = true;
                const from = workspaces.findIndex((x) => x.id === d.id);
                if (from !== -1) moveWorkspace(d.id, finalIndex(from, dropBoundary(rowRects(), e.clientY)));
              }
              endDrag();
            }}
            // Geste annulé par le système : on annule sans déplacer.
            onPointerCancel={endDrag}
            // Filet : si la capture est perdue autrement qu'au pointerup, l'état de
            // drag ne doit pas rester armé (endDrag est idempotent).
            onLostPointerCapture={endDrag}
            style={{
              position: "relative",
              padding: "7px 10px",
              margin: "1px 6px",
              borderRadius: 6,
              cursor: "pointer",
              // Le drag traverse du texte : sans ça, il le sélectionnerait.
              userSelect: "none",
              // Empêche le geste de scroll tactile de préempter le pointer.
              touchAction: "none",
              opacity: dragId === w.id ? 0.5 : 1,
              background: w.id === activeId ? "#242424" : "transparent",
              borderLeft: `3px solid ${hasAttention(w) ? ATTENTION_COLOR : "transparent"}`,
            }}
          >
            <div
              style={{
                display: "flex",
                alignItems: editingId === w.id ? "flex-start" : "center",
                gap: 7,
                paddingRight: ACTIONS_GUTTER,
              }}
            >
              <span
                onClick={(e) => {
                  e.stopPropagation();
                  setPaletteFor(paletteFor === w.id ? null : w.id);
                }}
                title="Changer la couleur"
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: w.color,
                  flexShrink: 0,
                  cursor: "pointer",
                  boxShadow: hasAttention(w) ? `0 0 0 3px ${ATTENTION_COLOR}40` : "none",
                }}
              />
              {editingId === w.id ? (
                <WorkspaceForm
                  initialName={w.name}
                  initialFolder={w.cwd}
                  home={home}
                  focusField="name"
                  onCommit={(r) => {
                    // Ordre important : le dossier d'abord, pour que le fallback
                    // « nom vide → basename(cwd) » de renameWorkspace porte sur le
                    // NOUVEAU dossier. Changer cwd respawn les panes (TerminalPane).
                    if (r.cwd !== w.cwd) {
                      setCwd(w.id, r.cwd);
                      useWorkspaceStore.getState().showToast("dossier changé — terminaux relancés");
                    }
                    renameWorkspace(w.id, r.name ?? "");
                    setEditingId(null);
                  }}
                  onCancel={() => setEditingId(null)}
                />
              ) : (
                <>
                  <span
                    style={{
                      flex: 1,
                      minWidth: 0,
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {w.name}
                  </span>
                  {/* Pastille d'attention : un agent de ce workspace a notifié
                      (session Claude terminée, ou en attente d'une entrée).
                      Toujours rendue, transparente au repos : s'allumer ne
                      décale donc pas le nom. S'éteint à l'activation (unread),
                      ou au focus du pane émetteur (unreadPanes). */}
                  <span
                    title={hasAttention(w) ? w.lastNotification?.title : undefined}
                    style={{
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      flexShrink: 0,
                      background: hasAttention(w) ? ATTENTION_COLOR : "transparent",
                      boxShadow: hasAttention(w) ? `0 0 5px ${ATTENTION_COLOR}` : "none",
                    }}
                  />
                </>
              )}
            </div>

            {/* Pile d'actions en position absolue : empiler × et ✎ dans le flux
                ferait grandir la ligne au survol. Masquée pendant l'édition (le
                formulaire s'annule au blur et porte déjà ses propres boutons). */}
            {editingId !== w.id && (
              <div
                style={{
                  position: "absolute",
                  top: 5,
                  right: 6,
                  display: "flex",
                  flexDirection: "column",
                  gap: 2,
                  visibility: hoverId === w.id ? "visible" : "hidden",
                }}
              >
                <button
                  onMouseDown={(e) => {
                    // Comme le × de PaneCell : ne pas voler le mousedown (pas d'activation de la ligne).
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    // Ferme d'abord les PTYs backend de tous les panes (même chemin que Ctrl+Shift+Q),
                    // puis retire le workspace du store (closeWorkspace purge panePtys et réactive un voisin).
                    for (const paneId of w.panes) {
                      const ptyId = panePtys[paneId];
                      if (ptyId !== undefined) closePty(ptyId);
                    }
                    closeWorkspace(w.id);
                  }}
                  title="Fermer le workspace (Ctrl+Shift+Q)"
                  style={ACTION_BTN}
                >
                  ×
                </button>
                <button
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    e.preventDefault();
                  }}
                  onClick={(e) => {
                    e.stopPropagation();
                    setActive(w.id);
                    openEdit(w.id);
                  }}
                  title="Modifier nom et dossier (Ctrl+Shift+R)"
                  style={ACTION_BTN}
                >
                  ✎
                </button>
              </div>
            )}

            {paletteFor === w.id && (
              <div
                onClick={(e) => e.stopPropagation()}
                style={{ display: "flex", flexWrap: "wrap", gap: 4, margin: "6px 0 2px 17px" }}
              >
                {PALETTE.map((c) => (
                  <span
                    key={c}
                    onClick={() => {
                      setColor(w.id, c);
                      setPaletteFor(null);
                    }}
                    style={{
                      width: 16,
                      height: 16,
                      borderRadius: 3,
                      background: c,
                      cursor: "pointer",
                      outline: c === w.color ? "2px solid #fff" : "none",
                    }}
                  />
                ))}
              </div>
            )}

            {metaLine(w.branch, w.dirty, w.ports) && (
              <div
                onClick={(e) => {
                  // Le clic active le workspace ET ouvre son diff (sans déclencher le onClick de la ligne).
                  e.stopPropagation();
                  setActive(w.id);
                  toggleDiff(w.id);
                }}
                title="Voir les fichiers modifiés (Ctrl+Shift+D)"
                style={{ fontSize: 11, color: "#6f6f6f", marginLeft: 17, marginTop: 3, cursor: "pointer" }}
              >
                {metaLine(w.branch, w.dirty, w.ports)}
              </div>
            )}
            {/* Chemin purement informatif : c'est le ✎ qui ouvre l'édition,
                pour ne pas rouvrir le formulaire à chaque clic sur la ligne. */}
            <div
              style={{
                fontSize: 11,
                color: "#6f6f6f",
                marginLeft: 17,
                marginTop: 2,
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {abbreviateHome(w.cwd, home)}
            </div>
            {w.lastNotification && (
              <div
                style={{
                  fontSize: 11,
                  color: "#8a8a8a",
                  marginLeft: 17,
                  marginTop: 2,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {w.lastNotification.title}
              </div>
            )}
            {w.status && (
              <div style={{ fontSize: 11, color: w.status.color ?? "#8a8a8a", marginLeft: 17, marginTop: 2 }}>
                {w.status.label}
              </div>
            )}
            {w.progress && (
              <div style={{ height: 3, background: "#2a2a2a", borderRadius: 2, marginLeft: 17, marginTop: 5 }}>
                <div
                  style={{ height: 3, width: `${w.progress.value * 100}%`, background: STATUS_DEFAULT_COLOR }}
                />
              </div>
            )}
          </div>
        </Fragment>
      ))}
      {/* Frontière après la dernière ligne (dépôt en fin de liste). */}
      {dropLine(workspaces.length)}

      {creating && (
        <div style={{ display: "flex", padding: "7px 10px", margin: "1px 6px" }}>
          <WorkspaceForm
            initialName=""
            initialFolder=""
            home={home}
            focusField="name"
            onCommit={(r) => {
              addWorkspace(r.cwd, r.name);
              setCreating(false);
            }}
            onCancel={() => setCreating(false)}
          />
        </div>
      )}

      <div style={{ marginTop: "auto", padding: "6px 10px", display: "flex", gap: 6 }}>
        <button
          className="icon-btn"
          onClick={() => setCreating(true)}
          title="Nouvel espace : nom + dossier (Ctrl+Shift+N)"
        >
          +
        </button>
        <button
          className="icon-btn"
          onClick={() => void openFolderDialog()}
          title="Ouvrir un dossier (Ctrl+Shift+O)"
        >
          📂
        </button>
      </div>
    </div>
  );
}
