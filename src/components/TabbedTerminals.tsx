import { useEffect, useRef, useState, type CSSProperties } from "react";
import type { Workspace } from "../store/workspace";
import { useWorkspaceStore } from "../store/workspace";
import { ATTENTION_COLOR, identityColor } from "../lib/palette";
import { closePty } from "../lib/pty";
import { dropBoundary, finalIndex, type RowRect } from "../lib/reorder";
import { focusTab } from "../lib/tabFocus";
import { openTab } from "../lib/newTab";
import { TerminalPane } from "./TerminalPane";

export const TAB_BAR_HEIGHT = 28;

/** Déplacement horizontal minimal avant qu'un appui devienne un drag d'onglet. */
const DRAG_THRESHOLD = 4;

const TAB_CLOSE: CSSProperties = {
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
  flexShrink: 0,
};

/**
 * Zone terminal d'un workspace : barre d'onglets + pile de TerminalPane.
 *
 * Keep-alive : TOUS les onglets restent montés, l'inactif en `visibility:hidden` —
 * JAMAIS display:none (un conteneur 0×0 ferait fit() → resize_pty(0) → reflow shell
 * cassé), JAMAIS de démontage tant que l'onglet existe (son cleanup ferme le PTY).
 * `visible` = le workspace lui-même est affiché ; un onglet n'est visible que si
 * son workspace l'est ET qu'il est l'onglet actif.
 */
export function TabbedTerminals({ ws, visible }: { ws: Workspace; visible: boolean }) {
  const setActiveTab = useWorkspaceStore((s) => s.setActiveTab);
  const closeTab = useWorkspaceStore((s) => s.closeTab);
  const moveTab = useWorkspaceStore((s) => s.moveTab);
  // Couleur d'accent de l'onglet actif : couleur propre du workspace, sinon celle
  // de son groupe, neutre sinon.
  const group = useWorkspaceStore((s) => s.groups.find((g) => g.id === ws.groupId));
  const accent = identityColor(ws, group) ?? "#5a5a5a";
  const [hoverId, setHoverId] = useState<string | null>(null);

  // Focus du terminal quand l'onglet actif change (clic, Alt+←/→, nouvel onglet) :
  // le TerminalPane d'un onglet tout neuf n'est enregistré qu'après son montage,
  // d'où l'effet plutôt qu'un appel direct dans le handler.
  useEffect(() => {
    if (visible && ws.activeTabId) focusTab(ws.activeTabId);
  }, [visible, ws.activeTabId]);

  // --- Réordonnancement des onglets par pointer events (même mécanique que la
  // sidebar : pas de DnD HTML5, peu fiable sous WebKitGTK avec dragDropEnabled). ---
  const barRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<{ id: string; startX: number; dragging: boolean } | null>(null);
  const suppressClick = useRef(false);
  const [dragId, setDragId] = useState<string | null>(null);
  const [boundary, setBoundary] = useState<number | null>(null);

  /** Géométrie horizontale des onglets (dropBoundary raisonne en top/height : on lui
      passe left/width sous ces noms). */
  const tabRects = (): RowRect[] =>
    [...(barRef.current?.querySelectorAll<HTMLElement>("[data-tab-id]") ?? [])].map((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.left, height: r.width };
    });

  const endDrag = () => {
    dragRef.current = null;
    setDragId(null);
    setBoundary(null);
  };

  const close = (tabId: string) => {
    if (ws.tabs.length <= 1) {
      // Dernier onglet : le workspace se ferme ; on ferme d'abord son PTY (comme Ctrl+Shift+Q).
      const ptyId = useWorkspaceStore.getState().tabPtys[tabId];
      if (ptyId !== undefined) closePty(ptyId);
    }
    closeTab(ws.id, tabId);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", width: "100%", height: "100%" }}>
      <div
        ref={barRef}
        role="tablist"
        style={{
          display: "flex",
          alignItems: "stretch",
          height: TAB_BAR_HEIGHT,
          flexShrink: 0,
          background: "#181818",
          borderBottom: "1px solid #242424",
          overflowX: "auto",
          overflowY: "hidden",
          userSelect: "none",
        }}
      >
        {ws.tabs.map((tab, i) => {
          const isActive = tab.id === ws.activeTabId;
          const isUnread = ws.unreadTabs.includes(tab.id);
          const title = tab.title || `Terminal ${i + 1}`;
          return (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              role="tab"
              aria-selected={isActive}
              title={title}
              onClick={() => {
                if (suppressClick.current) {
                  suppressClick.current = false;
                  return;
                }
                setActiveTab(ws.id, tab.id);
              }}
              onAuxClick={(e) => {
                if (e.button === 1) close(tab.id); // clic milieu
              }}
              onMouseEnter={() => setHoverId(tab.id)}
              onMouseLeave={() => setHoverId((cur) => (cur === tab.id ? null : cur))}
              onMouseDown={(e) => {
                if (e.button === 0) e.preventDefault(); // pas de sélection de texte pendant le drag
              }}
              onPointerDown={(e) => {
                suppressClick.current = false;
                if (e.button !== 0) return;
                dragRef.current = { id: tab.id, startX: e.clientX, dragging: false };
              }}
              onPointerMove={(e) => {
                const d = dragRef.current;
                if (!d || d.id !== tab.id) return;
                if (!d.dragging) {
                  if (Math.abs(e.clientX - d.startX) < DRAG_THRESHOLD) return;
                  d.dragging = true;
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDragId(tab.id);
                }
                setBoundary(dropBoundary(tabRects(), e.clientX));
              }}
              onPointerUp={(e) => {
                const d = dragRef.current;
                if (d?.dragging) {
                  suppressClick.current = true;
                  const from = ws.tabs.findIndex((t) => t.id === d.id);
                  if (from !== -1) moveTab(ws.id, d.id, finalIndex(from, dropBoundary(tabRects(), e.clientX)));
                }
                endDrag();
              }}
              onPointerCancel={endDrag}
              onLostPointerCapture={endDrag}
              style={{
                position: "relative",
                display: "flex",
                alignItems: "center",
                gap: 6,
                padding: "0 8px 0 10px",
                minWidth: 90,
                maxWidth: 200,
                flex: "0 1 auto",
                boxSizing: "border-box",
                cursor: "pointer",
                touchAction: "none",
                color: isActive ? "#e6e6e6" : "#8a8a8a",
                background: isActive ? "#1e1e1e" : "transparent",
                borderBottom: `2px solid ${isActive ? accent : "transparent"}`,
                borderRight: "1px solid #242424",
                opacity: dragId === tab.id ? 0.5 : 1,
                // Trait d'insertion du drag : bordure gauche 2 px, sans décaler les voisins.
                boxShadow: dragId !== null && boundary === i ? "-1px 0 0 0 #ddd, 1px 0 0 0 #ddd inset" : "none",
              }}
            >
              {/* Point bleu d'attention : un agent attend dans CET onglet (remplace
                  l'anneau de l'ancienne grille). Toujours rendu, transparent au repos :
                  s'allumer ne décale pas le titre. */}
              <span
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  flexShrink: 0,
                  background: isUnread ? ATTENTION_COLOR : "transparent",
                  boxShadow: isUnread ? `0 0 5px ${ATTENTION_COLOR}` : "none",
                }}
              />
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                  fontSize: 12,
                }}
              >
                {title}
              </span>
              <button
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  close(tab.id);
                }}
                title="Fermer l'onglet (Ctrl+Shift+W)"
                style={{ ...TAB_CLOSE, visibility: hoverId === tab.id || isActive ? "visible" : "hidden" }}
              >
                ×
              </button>
            </div>
          );
        })}
        {/* Frontière après le dernier onglet (dépôt en fin de barre). */}
        {dragId !== null && boundary === ws.tabs.length && (
          <div style={{ width: 2, margin: "4px 0", background: "#ddd", borderRadius: 1, flexShrink: 0 }} />
        )}
        <button
          className="icon-btn"
          onClick={() => void openTab(ws.id)}
          title="Nouvel onglet (Ctrl+Shift+T)"
          style={{ width: TAB_BAR_HEIGHT, height: TAB_BAR_HEIGHT, borderRadius: 0, flexShrink: 0 }}
        >
          +
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, position: "relative" }}>
        {ws.tabs.map((tab) => {
          const shown = visible && tab.id === ws.activeTabId;
          return (
            <div
              key={tab.id}
              /* Cible du glisser-déposer de fichiers : resolvePaneId remonte jusqu'ici
                 depuis l'élément xterm survolé (cf. lib/dropTarget). Seul l'onglet visible
                 peut être survolé, donc le fichier tombe dans le bon terminal. */
              data-pane-id={tab.id}
              style={{
                position: "absolute",
                inset: 0,
                visibility: shown ? "visible" : "hidden",
              }}
            >
              <TerminalPane wsId={ws.id} tabId={tab.id} cwd={tab.cwd ?? ws.cwd} visible={shown} />
            </div>
          );
        })}
      </div>
    </div>
  );
}
