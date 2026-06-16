import { useState, useRef } from "react";
import { useWorkspaceStore } from "../store/workspace";
import { PALETTE, ALERT_COLOR } from "../lib/palette";

const HOME = "/home/user";

/** Métadonnées git/ports condensées en une ligne discrète : `branch • · :ports`.
   Le `•` (dirty) et les ports sont optionnels ; hors repo, renvoie "". */
function metaLine(branch: string | undefined, dirty: boolean | undefined, ports: number[]): string {
  const parts: string[] = [];
  if (branch) parts.push(dirty ? `${branch} •` : branch);
  if (ports.length) parts.push(`:${ports.join(",")}`);
  return parts.join(" · ");
}

export function Sidebar() {
  const { workspaces, activeId, addWorkspace, setActive, markRead, renameWorkspace, setColor } =
    useWorkspaceStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [paletteFor, setPaletteFor] = useState<string | null>(null);
  const blurShouldCommit = useRef(true);

  return (
    <div
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
      {workspaces.map((w) => (
        <div
          key={w.id}
          onClick={() => {
            setActive(w.id);
            markRead(w.id);
          }}
          style={{
            padding: "7px 10px",
            margin: "1px 6px",
            borderRadius: 6,
            cursor: "pointer",
            background: w.id === activeId ? "#242424" : "transparent",
            borderLeft: `3px solid ${w.unread ? ALERT_COLOR : "transparent"}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
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
                boxShadow: w.unread ? `0 0 0 3px ${ALERT_COLOR}40` : "none",
              }}
            />
            {editingId === w.id ? (
              <input
                autoFocus
                onFocus={(e) => e.target.select()}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => {
                  if (blurShouldCommit.current) renameWorkspace(w.id, draft);
                  blurShouldCommit.current = true;
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    renameWorkspace(w.id, draft);
                    blurShouldCommit.current = false;
                    setEditingId(null);
                  } else if (e.key === "Escape") {
                    blurShouldCommit.current = false;
                    setEditingId(null);
                  }
                }}
                style={{
                  flex: 1,
                  minWidth: 0,
                  background: "#111",
                  color: "#eee",
                  border: "1px solid #444",
                  font: "inherit",
                }}
              />
            ) : (
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  setDraft(w.name);
                  setPaletteFor(null);
                  setEditingId(w.id);
                }}
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
            )}
          </div>

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
            <div style={{ fontSize: 11, color: "#6f6f6f", marginLeft: 17, marginTop: 3 }}>
              {metaLine(w.branch, w.dirty, w.ports)}
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
                style={{ height: 3, width: `${w.progress.value * 100}%`, background: ALERT_COLOR }}
              />
            </div>
          )}
        </div>
      ))}

      <div style={{ marginTop: "auto", padding: "6px 10px" }}>
        <button className="icon-btn" onClick={() => addWorkspace(HOME)} title="Nouveau workspace">
          +
        </button>
      </div>
    </div>
  );
}
