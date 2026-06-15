import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../store/workspace";

interface SocketCommand {
  method: string;
  params: Record<string, any>;
}
interface AgentNotification {
  workspaceId: string;
  title: string;
  body: string;
}

/** Écoute les events émis par le backend (socket-command, agent-notification) → store. */
export function registerSocketEvents(): Promise<UnlistenFn> {
  const store = () => useWorkspaceStore.getState();

  const p1 = listen<SocketCommand>("socket-command", (e) => {
    const s = store();
    const { method, params } = e.payload;
    const active = s.workspaces.find((w) => w.id === s.activeId);
    switch (method) {
      case "new-workspace":
        s.addWorkspace(params.cwd ?? "/home");
        break;
      case "notify":
        if (active) s.setNotification(active.id, { title: params.title, body: params.body });
        break;
      case "set-status":
        if (active) s.setStatus(active.id, { label: params.label, color: params.color });
        break;
      case "set-progress":
        if (active) s.setProgress(active.id, { value: params.value, label: params.label });
        break;
      default:
        break;
    }
  });

  const p2 = listen<AgentNotification>("agent-notification", (e) => {
    store().setNotification(e.payload.workspaceId, {
      title: e.payload.title,
      body: e.payload.body,
    });
  });

  return Promise.all([p1, p2]).then((fns) => () => fns.forEach((f) => f()));
}
