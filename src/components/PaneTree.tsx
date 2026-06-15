import { Allotment } from "allotment";
import "allotment/dist/style.css";
import type { PaneNode, Workspace } from "../store/workspace";
import { TerminalPane } from "./TerminalPane";

function renderNode(node: PaneNode, ws: Workspace) {
  if (node.kind === "leaf") {
    return <TerminalPane key={node.paneId} wsId={ws.id} cwd={ws.cwd} />;
  }
  return (
    <Allotment vertical={node.dir === "vertical"}>
      {node.children.map((child, i) => (
        <Allotment.Pane key={i}>{renderNode(child, ws)}</Allotment.Pane>
      ))}
    </Allotment>
  );
}

export function PaneTree({ ws }: { ws: Workspace }) {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        boxShadow: ws.unread ? "inset 0 0 0 2px #4ea1ff" : "none",
      }}
    >
      {renderNode(ws.root, ws)}
    </div>
  );
}
