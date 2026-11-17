import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../store/workspace";
import { useDashboardStore } from "../store/dashboard";
import { coalesce } from "./coalesce";
import { parseClaudeSession } from "./claudeResume";
import { setBusy, startBusySweep } from "./agentBusy";
import { useSuperviseurStore } from "../store/superviseur";

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

/**
 * Onglet porteur du PTY `ptyId` (inversion de `tabPtys`), ou `undefined` si
 * aucun : onglet fermé entre-temps, ou émetteur hors onglet (CLI lancée ailleurs).
 */
export function tabIdForPty(
  tabPtys: Record<string, number>,
  ptyId: unknown,
): string | undefined {
  if (typeof ptyId !== "number") return undefined;
  return Object.entries(tabPtys).find(([, id]) => id === ptyId)?.[0];
}

/**
 * Hook SessionStart / SessionEnd relayé par `terminials claude-session` : retient ou oublie
 * la session Claude de l'onglet émetteur. Sans onglet identifiable (CLI lancée hors
 * onglet, onglet fermé), ou avec un id de session invalide, rien n'est retenu.
 */
export function applyClaudeSession(wsId: string, params: Record<string, unknown>): void {
  const s = useWorkspaceStore.getState();
  const tabId = tabIdForPty(s.tabPtys, params.ptyId);
  if (!tabId) return;
  if (params.ended === true) {
    if (typeof params.sessionId === "string") s.endTabClaudeSession(wsId, tabId, params.sessionId);
    return;
  }
  const session = parseClaudeSession({ id: params.sessionId, cwd: params.cwd });
  if (session) s.setTabClaudeSession(wsId, tabId, session);
}

/**
 * Notification d'un hook qui annonce une DEMANDE D'AUTORISATION (l'agent est bloqué sur
 * « Autoriser cette commande ? ») : le superviseur ne doit alors rien écrire dans la
 * session sans validation explicite. Paramètre `attente` posé par la CLI
 * (`terminials notify --attente autorisation`) ; à défaut, le texte que le script de hook
 * produit pour ce cas (scripts installés avant ce paramètre).
 */
export function estDemandeAutorisation(params: Record<string, unknown>): boolean {
  if (params.attente === "autorisation") return true;
  if (params.attente !== undefined) return false;
  return typeof params.body === "string" && params.body.startsWith("Claude demande l'autorisation");
}

/** Écoute les events émis par le backend (socket-command, agent-notification) → store,
    et balaie les indicateurs « au travail » restés allumés (cf. agentBusy). */
export function registerSocketEvents(): Promise<UnlistenFn> {
  const store = () => useWorkspaceStore.getState();

  const p1 = listen<SocketCommand>("socket-command", (e) => {
    const s = store();
    const { method } = e.payload;
    // Une requête sans params arrive avec `null` : on la lit comme un objet vide.
    const params: SocketCommand["params"] = e.payload.params ?? {};
    // Routage : la CLI joint workspaceId (env TERMINIALS_WORKSPACE_ID injectée
    // dans le shell du pane) ; fallback sur le workspace actif (CLI hors pane).
    // Un workspaceId qui ne résout plus (workspace fermé) → commande ignorée.
    const targetId = (params.workspaceId as string | undefined) ?? s.activeId;
    const target = s.workspaces.find((w) => w.id === targetId);
    switch (method) {
      case "new-workspace":
        s.addWorkspace(params.cwd ?? "/home");
        break;
      case "notify": {
        // Hook Claude Code lancé dans un onglet : la CLI joint aussi ptyId
        // (TERMINIALS_PTY_ID), ce qui allume le point de CET onglet.
        const tabId = tabIdForPty(s.tabPtys, params.ptyId);
        const attente = typeof params.attente === "string" ? { attente: params.attente } : {};
        if (target) s.setNotification(target.id, { title: params.title, body: params.body, ...attente }, tabId);
        // Session bloquée sur une demande d'autorisation, ou rendue (fin de tour).
        if (tabId) {
          const sup = useSuperviseurStore.getState();
          if (estDemandeAutorisation(params)) sup.bloquerSession(tabId, String(params.body ?? ""));
          else sup.debloquerSession(tabId);
        }
        break;
      }
      case "set-status":
        if (target) s.setStatus(target.id, { label: params.label, color: params.color });
        break;
      case "set-progress":
        if (target) s.setProgress(target.id, { value: params.value, label: params.label });
        break;
      case "claude-session":
        if (target) applyClaudeSession(target.id, params);
        break;
      case "agent-busy": {
        // Identifié par le PTY émetteur seul : un hook lancé hors onglet n'a rien à allumer.
        if (typeof params.ptyId === "number") setBusy(params.ptyId, params.busy === true);
        // L'agent repart (autorisation accordée, nouveau prompt) ou rend la main (fin de
        // tour, session close) : plus de demande en cours. Une nouvelle demande
        // d'autorisation suit toujours ce passage au repos (hook Notification : idle puis
        // notify), elle rebloque l'onglet.
        const tabId = tabIdForPty(s.tabPtys, params.ptyId);
        if (tabId) useSuperviseurStore.getState().debloquerSession(tabId);
        break;
      }
      default:
        break;
    }
  });

  const p2 = listen<AgentNotification>("agent-notification", (e) => {
    const s = store();
    const { workspaceId, ptyId, title, body } = e.payload;
    // Inversion tabPtys (ptyId → tabId) : cible l’onglet émetteur (point bleu).
    // Onglet introuvable (fermé entre-temps, ptyId absent) → fallback unread
    // au niveau workspace (setNotification sans tabId).
    s.setNotification(workspaceId, { title, body }, tabIdForPty(s.tabPtys, ptyId));
  });

  // Dashboard d'activité (§7/§8 du design) : un événement collecté (git, claude,
  // clickup, shell) invalide les données affichées ; un résumé LLM prêt allume
  // la pastille de la sidebar si l'overlay est fermé (sinon no-op, cf. store).
  // Un cycle de collecte émet trois `activity-updated` (git, claude, clickup) et
  // chaque commande shell terminée en émet un : sans amortissement, chaque
  // rafale relance les 4 appels IPC de `useActivityData` et la lecture de cache
  // des trois panneaux de synthèse. Une seule `bumpRefresh` par fenêtre de 2 s.
  const rafraichir = coalesce(() => useDashboardStore.getState().bumpRefresh(), 2000);
  const p3 = listen("activity-updated", rafraichir);
  const p4 = listen("summary-ready", () => useDashboardStore.getState().markSummaryReady());
  const stopSweep = startBusySweep();

  return Promise.all([p1, p2, p3, p4]).then((fns) => () => {
    rafraichir.cancel();
    stopSweep();
    fns.forEach((f) => f());
  });
}
