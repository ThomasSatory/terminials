import { useState, type CSSProperties } from "react";
import type { Workspace } from "../store/workspace";
import { useWorkspaceStore } from "../store/workspace";
import { ATTENTION_COLOR } from "../lib/palette";
import { TerminalPane } from "./TerminalPane";

const AREAS = ["a", "b", "c", "d"];

/** Géométrie de la grille selon le nombre de panes (1..4). Ordre des cellules : a,b,c,d. */
function gridStyle(count: number): CSSProperties {
  switch (count) {
    case 1:
      return { gridTemplateAreas: '"a"', gridTemplateColumns: "1fr", gridTemplateRows: "1fr" };
    case 2:
      return {
        gridTemplateAreas: '"a b"',
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr",
      };
    case 3:
      return {
        gridTemplateAreas: '"a b" "c c"',
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
      };
    default: // 4
      return {
        gridTemplateAreas: '"a b" "c d"',
        gridTemplateColumns: "1fr 1fr",
        gridTemplateRows: "1fr 1fr",
      };
  }
}

function PaneCell({
  ws,
  paneId,
  area,
  visible,
}: {
  ws: Workspace;
  paneId: string;
  area: string;
  visible: boolean;
}) {
  const setActivePane = useWorkspaceStore((s) => s.setActivePane);
  const closePane = useWorkspaceStore((s) => s.closePane);
  const [hover, setHover] = useState(false);
  const isActive = ws.activePaneId === paneId;
  // Anneau bleu cmux : un agent attend dans CE pane (sémantique attention, distincte
  // de la bordure active 1px couleur d'identité qui, elle, reste inchangée).
  const isUnread = ws.unreadPanes.includes(paneId);
  const canClose = ws.panes.length > 1;
  return (
    <div
      /* Cible du glisser-déposer de fichiers : resolvePaneId remonte jusqu'ici depuis
         l'élément xterm survolé (cf. lib/dropTarget). */
      data-pane-id={paneId}
      onMouseDownCapture={() => setActivePane(ws.id, paneId)}
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      style={{
        gridArea: area,
        position: "relative",
        minWidth: 0,
        minHeight: 0,
        boxSizing: "border-box",
        border: `1px solid ${isActive ? ws.color : "transparent"}`,
        boxShadow: isUnread
          ? `0 0 0 2px ${ATTENTION_COLOR}, 0 0 8px ${ATTENTION_COLOR}80`
          : "none",
        // Le glow 8px déborde sur les cellules voisines (gap 2px) : on le fait
        // passer au-dessus pour qu'il ne soit pas rogné.
        zIndex: isUnread ? 2 : "auto",
      }}
    >
      {canClose && hover && (
        <button
          onMouseDown={(e) => {
            e.stopPropagation();
            e.preventDefault();
          }}
          onClick={() => closePane(ws.id, paneId)}
          title="Fermer le terminal (Ctrl+Shift+W)"
          style={{
            position: "absolute",
            top: 3,
            right: 3,
            zIndex: 3,
            width: 18,
            height: 18,
            padding: 0,
            lineHeight: "16px",
            border: "none",
            borderRadius: 3,
            background: "rgba(0,0,0,0.55)",
            color: "#ddd",
            cursor: "pointer",
          }}
        >
          ×
        </button>
      )}
      <TerminalPane wsId={ws.id} paneId={paneId} cwd={ws.cwd} visible={visible} />
    </div>
  );
}

export function PaneTree({ ws, visible }: { ws: Workspace; visible: boolean }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <div
        style={{
          display: "grid",
          width: "100%",
          height: "100%",
          gap: 2,
          ...gridStyle(ws.panes.length),
        }}
      >
        {ws.panes.map((paneId, i) => (
          <PaneCell key={paneId} ws={ws} paneId={paneId} area={AREAS[i]} visible={visible} />
        ))}
      </div>
    </div>
  );
}
