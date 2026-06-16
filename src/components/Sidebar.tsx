import { useState } from "react";
import { useWorkspaceStore } from "../store/workspace";
import { PALETTE, ALERT_COLOR } from "../lib/palette";

const HOME = "/home/user";

export function Sidebar() {
  const { workspaces, activeId, addWorkspace, setActive, markRead, renameWorkspace, setColor } =
    useWorkspaceStore();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [paletteFor, setPaletteFor] = useState<string | null>(null);

  return (
    <div
      style={{
        width: 240,
        background: "#181818",
        color: "#ddd",
        display: "flex",
        flexDirection: "column",
        overflowY: "auto",
      }}
    >
      <button onClick={() => addWorkspace(HOME)} style={{ margin: 8 }}>
        + Workspace
      </button>
      {workspaces.map((w) => (
        <div
          key={w.id}
          onClick={() => {
            setActive(w.id);
            markRead(w.id);
          }}
          style={{
            padding: "8px 12px",
            cursor: "pointer",
            background: w.id === activeId ? "#2a2a2a" : "transparent",
            borderLeft: `3px solid ${w.unread ? ALERT_COLOR : w.color}`,
          }}
        >
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
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
              }}
            />
            {editingId === w.id ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onClick={(e) => e.stopPropagation()}
                onBlur={() => {
                  renameWorkspace(w.id, draft);
                  setEditingId(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    renameWorkspace(w.id, draft);
                    setEditingId(null);
                  } else if (e.key === "Escape") {
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
            {w.unread && <span style={{ color: ALERT_COLOR }}>●</span>}
          </div>

          {paletteFor === w.id && (
            <div
              onClick={(e) => e.stopPropagation()}
              style={{ display: "flex", flexWrap: "wrap", gap: 4, marginTop: 6 }}
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

          <div style={{ fontSize: 11, color: "#888" }}>
            {w.branch ? `⎇ ${w.branch}${w.dirty ? " *" : ""}` : ""}{" "}
            {w.ports.length ? `:${w.ports.join(",")}` : ""}
          </div>
          {w.status && (
            <div style={{ fontSize: 11, color: w.status.color ?? "#aaa" }}>{w.status.label}</div>
          )}
          {w.progress && (
            <div style={{ height: 3, background: "#333", marginTop: 4 }}>
              <div
                style={{ height: 3, width: `${w.progress.value * 100}%`, background: ALERT_COLOR }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
