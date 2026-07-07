import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../store/workspace";

interface SocketCommand {
  method: string;
  params: Record<string, any>;
}
interface AgentNotification {
  workspaceId: string;
  /** id du PTY émetteur ; absent si la notification ne vient pas d'un pane. */
  ptyId?: number;
  title: string;
  body: string;
}

/** Écoute les events émis par le backend (socket-command, agent-notification) → store. */
export function registerSocketEvents(): Promise<UnlistenFn> {
  const store = () => useWorkspaceStore.getState();

  const p1 = listen<SocketCommand>("socket-command", (e) => {
    const s = store();
    const { method, params } = e.payload;
    // Routage : la CLI joint workspaceId (env TERMINIALS_WORKSPACE_ID injectée
    // dans le shell du pane) ; fallback sur le workspace actif (CLI hors pane).
    // Un workspaceId qui ne résout plus (workspace fermé) → commande ignorée.
    const targetId = (params.workspaceId as string | undefined) ?? s.activeId;
    const target = s.workspaces.find((w) => w.id === targetId);
    switch (method) {
      case "new-workspace":
        s.addWorkspace(params.cwd ?? "/home");
        break;
      case "notify":
        if (target) s.setNotification(target.id, { title: params.title, body: params.body });
        break;
      case "set-status":
        if (target) s.setStatus(target.id, { label: params.label, color: params.color });
        break;
      case "set-progress":
        if (target) s.setProgress(target.id, { value: params.value, label: params.label });
        break;
      default:
        break;
    }
  });

  const p2 = listen<AgentNotification>("agent-notification", (e) => {
    const s = store();
    const { workspaceId, ptyId, title, body } = e.payload;
    // Inversion panePtys (ptyId → paneId) : cible le pane émetteur (anneau bleu).
    // Pane introuvable (fermé entre-temps, ptyId absent) → fallback unread
    // au niveau workspace (setNotification sans paneId).
    const entry =
      ptyId === undefined
        ? undefined
        : Object.entries(s.panePtys).find(([, id]) => id === ptyId);
    s.setNotification(workspaceId, { title, body }, entry?.[0]);
  });

  return Promise.all([p1, p2]).then((fns) => () => fns.forEach((f) => f()));
}
