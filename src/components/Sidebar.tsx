import { Fragment, useEffect, useRef, useState, type CSSProperties } from "react";
import { homeDir } from "@tauri-apps/api/path";
import {
  useWorkspaceStore,
  hasAttention,
  groupHasAttention,
  type Group,
  type Workspace,
} from "../store/workspace";
import { PALETTE, ATTENTION_COLOR, STATUS_DEFAULT_COLOR } from "../lib/palette";
import { abbreviateHome } from "../lib/paths";
import { openFolderDialog } from "../lib/openFolder";
import { closePty } from "../lib/pty";
import { finalIndex, resolveDrop, type DropTarget, type SidebarRow } from "../lib/reorder";
import { WorkspaceForm } from "./WorkspaceForm";
import { GroupForm } from "./GroupForm";

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

/** Indentation des workspaces membres d'un groupe (filet vertical à gauche). */
const GROUP_INDENT = 12;

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

/** Ligne rendue dans la sidebar, dans l'ordre du DOM (= ordre de `resolveDrop`). */
type Item = { kind: "ws"; w: Workspace } | { kind: "group"; g: Group };

/** Hors-groupe d'abord, puis chaque groupe : en-tête, puis ses membres s'il est déplié. */
function buildItems(workspaces: Workspace[], groups: Group[]): Item[] {
  const items: Item[] = workspaces.filter((w) => w.groupId === null).map((w) => ({ kind: "ws", w }));
  for (const g of groups) {
    items.push({ kind: "group", g });
    if (!g.collapsed) {
      for (const w of workspaces) if (w.groupId === g.id) items.push({ kind: "ws", w });
    }
  }
  return items;
}

type Drag = { id: string; kind: "ws" | "group"; startY: number; dragging: boolean };

export function Sidebar() {
  const {
    workspaces,
    groups,
    activeId,
    setActive,
    toggleDiff,
    closeWorkspace,
    tabPtys,
    renameWorkspace,
    setCwd,
    setColor,
    addWorkspace,
    assignToGroup,
    addGroup,
    renameGroup,
    setGroupColor,
    toggleGroupCollapsed,
    removeGroup,
    moveGroup,
  } = useWorkspaceStore();
  // Workspace en cours d'édition (nom + dossier), ouvert par le ✎ ou Ctrl+Shift+R.
  const [editingId, setEditingId] = useState<string | null>(null);
  // Groupe en cours d'édition (nom + couleur), ouvert par le ✎ de l'en-tête.
  const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
  // Formulaires de création ouverts en bas de liste (rien n'est créé tant qu'ils
  // ne sont pas validés : ni le + ni le + groupe ne créent silencieusement).
  const [creating, setCreating] = useState(false);
  const [creatingGroup, setCreatingGroup] = useState(false);
  const [paletteFor, setPaletteFor] = useState<string | null>(null);
  const [hoverId, setHoverId] = useState<string | null>(null);

  const closeForms = () => {
    setCreating(false);
    setCreatingGroup(false);
    setPaletteFor(null);
    setEditingId(null);
    setEditingGroupId(null);
  };
  const openEdit = (wsId: string) => {
    closeForms();
    setEditingId(wsId);
  };

  // --- Réordonnancement par glisser-déposer (pointer events) ---
  // PAS de HTML5 `draggable` : `dragDropEnabled` (défaut Tauri, ce qui fait vivre
  // l'injection de fichiers déposés dans App.tsx) rend le DnD HTML5 interne peu
  // fiable sous WebKitGTK. Les pointer events ne dépendent pas de ce handler OS.
  const listRef = useRef<HTMLDivElement>(null);
  // Appui en cours ; `dragging` ne passe à true qu'au franchissement du seuil.
  const dragRef = useRef<Drag | null>(null);
  // Un drop ne doit pas activer la ligne tirée : le click qui suit le pointerup
  // est avalé une fois (remis à false au pointerdown suivant, jamais laissé armé).
  const suppressClick = useRef(false);
  const [dragId, setDragId] = useState<string | null>(null);
  // Cible visée (trait d'insertion ou en-tête surligné).
  const [target, setTarget] = useState<DropTarget | null>(null);

  const items = buildItems(workspaces, groups);

  /** Géométrie verticale des lignes, dans l'ordre du DOM. Lue à chaque pointermove :
      aucun réordonnancement n'a lieu pendant le drag, les rects sont donc stables. */
  const rows = (): SidebarRow[] =>
    [...(listRef.current?.querySelectorAll<HTMLElement>("[data-row-kind]") ?? [])].map((el) => {
      const r = el.getBoundingClientRect();
      const kind = el.dataset.rowKind === "group" ? "group" : "ws";
      const gid = el.dataset.groupId;
      return { top: r.top, height: r.height, kind, groupId: gid ? gid : null };
    });

  const endDrag = () => {
    dragRef.current = null;
    setDragId(null);
    setTarget(null);
  };

  const applyDrop = (d: Drag, t: DropTarget) => {
    if (d.kind === "group") {
      if (t.kind !== "group") return;
      const from = groups.findIndex((g) => g.id === d.id);
      if (from !== -1) moveGroup(d.id, finalIndex(from, t.index));
      return;
    }
    const w = workspaces.find((x) => x.id === d.id);
    if (!w) return; // fermé entre le pointerdown et le pointerup
    if (t.kind === "into-group") {
      assignToGroup(d.id, t.groupId); // en fin de groupe
      return;
    }
    if (t.kind !== "workspace") return;
    // Même appartenance : l'élément tiré quitte d'abord sa place (finalIndex) ;
    // appartenance différente : l'index vise directement la nouvelle liste.
    let index = t.index;
    if (t.groupId === w.groupId) {
      const from = workspaces.filter((x) => x.groupId === w.groupId).indexOf(w);
      index = finalIndex(from, t.index);
    }
    assignToGroup(d.id, t.groupId, index);
  };

  /** Handlers pointer communs aux lignes de workspace et aux en-têtes de groupe. */
  const dragHandlers = (id: string, kind: "ws" | "group", editing: boolean) => ({
    onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
      suppressClick.current = false;
      // Bouton gauche seulement ; pendant l'édition la ligne est un formulaire
      // (sélection de texte dans les champs).
      if (e.button !== 0 || editing) return;
      dragRef.current = { id, kind, startY: e.clientY, dragging: false };
    },
    onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (!d || d.id !== id) return;
      if (!d.dragging) {
        if (Math.abs(e.clientY - d.startY) < DRAG_THRESHOLD) return;
        d.dragging = true;
        // Capture : le drag survit à la sortie de la ligne d'origine.
        e.currentTarget.setPointerCapture(e.pointerId);
        setDragId(id);
      }
      setTarget(resolveDrop(rows(), e.clientY, d.kind));
    },
    onPointerUp: (e: React.PointerEvent<HTMLDivElement>) => {
      const d = dragRef.current;
      if (d?.dragging) {
        suppressClick.current = true;
        applyDrop(d, resolveDrop(rows(), e.clientY, d.kind));
      }
      endDrag();
    },
    // Geste annulé par le système : on annule sans déplacer.
    onPointerCancel: endDrag,
    // Filet : si la capture est perdue autrement qu'au pointerup, l'état de
    // drag ne doit pas rester armé (endDrag est idempotent).
    onLostPointerCapture: endDrag,
  });

  // Home résolu une fois via Tauri ; tant qu'il est vide, abbreviateHome est un no-op.
  const [home, setHome] = useState("");
  useEffect(() => {
    homeDir()
      .then(setHome)
      .catch(() => {});
  }, []);

  // Ctrl+Shift+R : le dispatch pose renameRequestId sur le workspace actif.
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
    closeForms();
    setCreating(true);
    useWorkspaceStore.getState().requestNewWorkspace(false);
  }, [newWorkspaceRequested]);

  // Ctrl+Shift+G : idem pour le formulaire de groupe.
  const newGroupRequested = useWorkspaceStore((s) => s.newGroupRequested);
  useEffect(() => {
    if (!newGroupRequested) return;
    closeForms();
    setCreatingGroup(true);
    useWorkspaceStore.getState().requestNewGroup(false);
  }, [newGroupRequested]);

  /** Trait d'insertion du drag. `margin: -1px` compense sa hauteur : l'insérer dans
      le flux ne décale donc AUCUNE ligne, et les rects lus au pointermove suivant
      restent valides (sinon la cible oscillerait autour du point de bascule). */
  const dropLine = (index: number) =>
    dragId !== null && target && target.kind !== "into-group" && target.boundary === index ? (
      <div key={`drop:${index}`} style={{ height: 2, margin: "-1px 6px", background: "#ddd", borderRadius: 1 }} />
    ) : null;

  const closeWs = (w: Workspace) => {
    // Ferme d'abord les PTYs backend de tous les onglets (même chemin que Ctrl+Shift+Q),
    // puis retire le workspace du store (closeWorkspace purge tabPtys et réactive un voisin).
    for (const t of w.tabs) {
      const ptyId = tabPtys[t.id];
      if (ptyId !== undefined) closePty(ptyId);
    }
    closeWorkspace(w.id);
  };

  const renderGroup = (g: Group) => {
    const count = workspaces.filter((w) => w.groupId === g.id).length;
    const attention = groupHasAttention(workspaces, g.id);
    const editing = editingGroupId === g.id;
    const highlighted = dragId !== null && target?.kind === "into-group" && target.groupId === g.id;
    return (
      <div
        data-row-kind="group"
        data-group-id={g.id}
        onClick={() => {
          if (suppressClick.current) {
            suppressClick.current = false;
            return;
          }
          if (!editing) toggleGroupCollapsed(g.id);
        }}
        onMouseEnter={() => setHoverId(g.id)}
        onMouseLeave={() => setHoverId((cur) => (cur === g.id ? null : cur))}
        onMouseDown={(e) => {
          if (e.button !== 0 || editing) return;
          e.preventDefault();
        }}
        {...dragHandlers(g.id, "group", editing)}
        title={g.collapsed && attention ? "un agent attend dans ce groupe" : undefined}
        style={{
          position: "relative",
          display: "flex",
          alignItems: editing ? "flex-start" : "center",
          gap: 6,
          padding: "5px 10px 4px 6px",
          margin: "6px 6px 1px",
          borderRadius: 6,
          cursor: "pointer",
          userSelect: "none",
          touchAction: "none",
          opacity: dragId === g.id ? 0.5 : 1,
          background: highlighted ? "#2a2a2a" : "transparent",
          outline: highlighted ? "1px solid #ddd" : "none",
          // Groupe replié qui réclame l'attention : même halo bleu que les lignes.
          borderLeft: `3px solid ${g.collapsed && attention ? ATTENTION_COLOR : "transparent"}`,
          color: "#bdbdbd",
          fontSize: 12,
          fontWeight: 600,
        }}
      >
        <span style={{ width: 10, color: "#8a8a8a", fontSize: 10, flexShrink: 0, textAlign: "center" }}>
          {g.collapsed ? "▸" : "▾"}
        </span>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: 2,
            background: g.color,
            flexShrink: 0,
            boxShadow: g.collapsed && attention ? `0 0 0 3px ${ATTENTION_COLOR}40` : "none",
          }}
        />
        {editing ? (
          <GroupForm
            initialName={g.name}
            initialColor={g.color}
            onCommit={(r) => {
              renameGroup(g.id, r.name);
              setGroupColor(g.id, r.color);
              setEditingGroupId(null);
            }}
            onCancel={() => setEditingGroupId(null)}
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
                paddingRight: ACTIONS_GUTTER,
              }}
            >
              {g.name}
              <span style={{ color: "#6f6f6f", fontWeight: 400, marginLeft: 6 }}>{count}</span>
            </span>
            <div
              style={{
                position: "absolute",
                top: 3,
                right: 6,
                display: "flex",
                gap: 2,
                visibility: hoverId === g.id ? "visible" : "hidden",
              }}
            >
              <button
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  closeForms();
                  setEditingGroupId(g.id);
                }}
                title="Renommer / recolorer le groupe"
                style={ACTION_BTN}
              >
                ✎
              </button>
              <button
                onMouseDown={(e) => {
                  e.stopPropagation();
                  e.preventDefault();
                }}
                onPointerDown={(e) => e.stopPropagation()}
                onClick={(e) => {
                  e.stopPropagation();
                  removeGroup(g.id); // dégroupe seulement : aucun terminal fermé
                }}
                title="Dissoudre le groupe (les workspaces restent ouverts)"
                style={ACTION_BTN}
              >
                ×
              </button>
            </div>
          </>
        )}
      </div>
    );
  };

  const renderWorkspace = (w: Workspace) => {
    const group = w.groupId ? groups.find((g) => g.id === w.groupId) : undefined;
    const editing = editingId === w.id;
    return (
      <div
        data-row-kind="ws"
        data-group-id={w.groupId ?? ""}
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
          if (e.button !== 0 || editing) return;
          e.preventDefault();
        }}
        {...dragHandlers(w.id, "ws", editing)}
        style={{
          position: "relative",
          padding: "7px 10px",
          // Membre d'un groupe : indenté, relié par un filet de la couleur du groupe.
          margin: group ? `1px 6px 1px ${6 + GROUP_INDENT}px` : "1px 6px",
          borderRadius: 6,
          cursor: "pointer",
          // Le drag traverse du texte : sans ça, il le sélectionnerait.
          userSelect: "none",
          // Empêche le geste de scroll tactile de préempter le pointer.
          touchAction: "none",
          opacity: dragId === w.id ? 0.5 : 1,
          background: w.id === activeId ? "#242424" : "transparent",
          borderLeft: `3px solid ${hasAttention(w) ? ATTENTION_COLOR : group ? `${group.color}66` : "transparent"}`,
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: editing ? "flex-start" : "center",
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
          {editing ? (
            <WorkspaceForm
              initialName={w.name}
              initialFolder={w.cwd}
              home={home}
              focusField="name"
              onCommit={(r) => {
                // Ordre important : le dossier d'abord, pour que le fallback
                // « nom vide → basename(cwd) » de renameWorkspace porte sur le
                // NOUVEAU dossier. Changer cwd respawn les onglets (TerminalPane).
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
                  ou au focus de l'onglet émetteur (unreadTabs). */}
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
        {!editing && (
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
                // Ne pas voler le mousedown (pas d'activation de la ligne, pas de drag).
                e.stopPropagation();
                e.preventDefault();
              }}
              onPointerDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                closeWs(w);
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
              onPointerDown={(e) => e.stopPropagation()}
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
            <div style={{ height: 3, width: `${w.progress.value * 100}%`, background: STATUS_DEFAULT_COLOR }} />
          </div>
        )}
      </div>
    );
  };

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
      {items.map((item, i) => (
        // Fragment et non un div englobant : la ligne reste un enfant DIRECT du
        // conteneur flex, donc ses marges verticales ne peuvent pas fusionner à
        // travers un wrapper (et le trait de dépôt contribue bien 0 px).
        <Fragment key={item.kind === "ws" ? item.w.id : item.g.id}>
          {dropLine(i)}
          {item.kind === "ws" ? renderWorkspace(item.w) : renderGroup(item.g)}
        </Fragment>
      ))}
      {/* Frontière après la dernière ligne (dépôt en fin de liste). */}
      {dropLine(items.length)}

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
      {creatingGroup && (
        <div style={{ display: "flex", padding: "7px 10px", margin: "1px 6px" }}>
          <GroupForm
            initialName=""
            initialColor={PALETTE[groups.length % PALETTE.length]}
            onCommit={(r) => {
              addGroup(r.name, r.color);
              setCreatingGroup(false);
            }}
            onCancel={() => setCreatingGroup(false)}
          />
        </div>
      )}

      <div style={{ marginTop: "auto", padding: "6px 10px", display: "flex", gap: 6 }}>
        <button
          className="icon-btn"
          onClick={() => {
            closeForms();
            setCreating(true);
          }}
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
        <button
          className="icon-btn"
          onClick={() => {
            closeForms();
            setCreatingGroup(true);
          }}
          title="Nouveau groupe (Ctrl+Shift+G)"
          style={{ fontSize: 14, fontWeight: 600, letterSpacing: -1 }}
        >
          +▾
        </button>
      </div>
    </div>
  );
}
