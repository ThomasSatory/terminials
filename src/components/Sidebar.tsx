import { useWorkspaceStore } from "../store/workspace";

const HOME = "/home/user";

export function Sidebar() {
  const { workspaces, activeId, addWorkspace, setActive, markRead } = useWorkspaceStore();
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
            borderLeft: w.unread ? "3px solid #4ea1ff" : "3px solid transparent",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{w.cwd.split("/").pop() || w.cwd}</span>
            {w.unread && <span style={{ color: "#4ea1ff" }}>●</span>}
          </div>
          <div style={{ fontSize: 11, color: "#888" }}>
            {w.branch ? `⎇ ${w.branch}` : ""} {w.ports.length ? `:${w.ports.join(",")}` : ""}
          </div>
          {w.status && (
            <div style={{ fontSize: 11, color: w.status.color ?? "#aaa" }}>{w.status.label}</div>
          )}
          {w.progress && (
            <div style={{ height: 3, background: "#333", marginTop: 4 }}>
              <div
                style={{ height: 3, width: `${w.progress.value * 100}%`, background: "#4ea1ff" }}
              />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
