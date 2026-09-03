import { useEffect, useState } from "react";
import { homeDir } from "@tauri-apps/api/path";
import { useWorkspaceStore, hasAttention } from "../store/workspace";
import { PALETTE, ATTENTION_COLOR, STATUS_DEFAULT_COLOR } from "../lib/palette";
import { abbreviateHome } from "../lib/paths";
import { openFolderDialog } from "../lib/openFolder";
import { closePty } from "../lib/pty";
import { WorkspaceForm } from "./WorkspaceForm";

/** Métadonnées git/ports condensées en une ligne discrète : `branch • · :ports`.
   Le `•` (dirty) et les ports sont optionnels ; hors repo, renvoie "". */
function metaLine(branch: string | undefined, dirty: boolean | undefined, ports: number[]): string {
  const parts: string[] = [];
  if (branch) parts.push(dirty ? `${branch} •` : branch);
  if (ports.length) parts.push(`:${ports.join(",")}`);
  return parts.join(" · ");
}

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
  } = useWorkspaceStore();
  // Workspace en cours d'édition (nom + dossier) et champ à focus à l'ouverture.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [focusField, setFocusField] = useState<"name" | "folder">("name");
  // Formulaire de création ouvert en bas de liste (aucun workspace créé tant
  // qu'il n'est pas validé : le + ne crée plus silencieusement sur ~).
  const [creating, setCreating] = useState(false);
  const [paletteFor, setPaletteFor] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const openEdit = (wsId: string, field: "name" | "folder") => {
    setCreating(false);
    setPaletteFor(null);
    setFocusField(field);
    setEditingId(wsId);
  };

  // Home résolu une fois via Tauri ; tant qu'il est vide, abbreviateHome est un no-op.
  const [home, setHome] = useState("");
  useEffect(() => {
    homeDir()
      .then(setHome)
      .catch(() => {});
  }, []);

  // Ctrl+Shift+R : le dispatch (K.5) pose renameRequestId sur le workspace actif.
  // Quand il matche un workspace, on ouvre l'édition inline (même chemin que le
  // double-clic sur le nom), puis on consomme la demande (requestRename(null)) —
  // sinon un second Ctrl+Shift+R sur le même workspace ne redéclencherait pas l'effet.
  const renameRequestId = useWorkspaceStore((s) => s.renameRequestId);
  useEffect(() => {
    if (!renameRequestId) return;
    if (workspaces.some((x) => x.id === renameRequestId)) openEdit(renameRequestId, "name");
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
          onClick={() => setActive(w.id)}
          onMouseEnter={() => setHoverId(w.id)}
          onMouseLeave={() => setHoverId((cur) => (cur === w.id ? null : cur))}
          style={{
            padding: "7px 10px",
            margin: "1px 6px",
            borderRadius: 6,
            cursor: "pointer",
            background: w.id === activeId ? "#242424" : "transparent",
            borderLeft: `3px solid ${hasAttention(w) ? ATTENTION_COLOR : "transparent"}`,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: editingId === w.id ? "flex-start" : "center",
              gap: 7,
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
                // Remonte quand le champ ciblé change (nom → dossier) : autoFocus
                // ne refire pas sur une instance déjà montée.
                key={focusField}
                initialName={w.name}
                initialFolder={w.cwd}
                home={home}
                focusField={focusField}
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
              <span
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  openEdit(w.id, "name");
                }}
                title="Renommer (double-clic, Ctrl+Shift+R)"
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
              style={{
                width: 16,
                height: 16,
                padding: 0,
                lineHeight: "14px",
                flexShrink: 0,
                border: "none",
                borderRadius: 3,
                background: "transparent",
                color: "#8a8a8a",
                cursor: "pointer",
                visibility: hoverId === w.id ? "visible" : "hidden",
              }}
            >
              ×
            </button>
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
          <div
            onClick={(e) => {
              // Seule affordance visible pour changer le dossier d'un workspace
              // déjà créé : le chemin lui-même ouvre le formulaire sur ce champ.
              e.stopPropagation();
              setActive(w.id);
              openEdit(w.id, "folder");
            }}
            title="Changer le dossier"
            style={{
              fontSize: 11,
              color: "#6f6f6f",
              marginLeft: 17,
              marginTop: 2,
              cursor: "pointer",
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
      ))}

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
