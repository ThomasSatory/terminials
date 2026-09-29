import { ptyCwd } from "./pty";
import { focusTab } from "./tabFocus";
import { useWorkspaceStore, type Workspace } from "../store/workspace";

/** Dossier de départ d'un nouvel onglet ; undefined = celui du workspace. */
export async function newTabCwd(
  ws: Workspace,
  tabPtys: Record<string, number>,
  readCwd: (ptyId: number) => Promise<string | null>,
): Promise<string | undefined> {
  const active = ws.tabs.find((t) => t.id === ws.activeTabId);
  if (!active) return undefined;
  const ptyId = tabPtys[active.id];
  const current = ptyId === undefined ? null : await readCwd(ptyId).catch(() => null);
  const dir = current ?? active.cwd;
  return dir === ws.cwd ? undefined : dir;
}

/** Nouvel onglet dans le dossier du terminal actif du workspace. */
export async function openTab(wsId: string): Promise<void> {
  const s = useWorkspaceStore.getState();
  const ws = s.workspaces.find((w) => w.id === wsId);
  if (!ws) return;
  const cwd = await newTabCwd(ws, s.tabPtys, ptyCwd);
  // Le workspace a pu être fermé pendant la lecture du dossier.
  const st = useWorkspaceStore.getState();
  if (!st.workspaces.some((w) => w.id === wsId)) return;
  // Le TerminalPane n'existe pas encore : le focus se fera à son montage
  // (TabbedTerminals focus l'onglet actif quand il change).
  focusTab(st.addTab(wsId, cwd));
}
