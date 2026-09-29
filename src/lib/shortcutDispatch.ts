import { closePty } from "./pty";
import { openFolderDialog } from "./openFolder";
import { addHomeWorkspace } from "./homeWorkspace";
import { focusTab } from "./tabFocus";
import { openTab } from "./newTab";
import type { ShortcutAction } from "./shortcuts";
import { useWorkspaceStore, navigableOrder, type Workspace } from "../store/workspace";
import { useDashboardStore } from "../store/dashboard";

/** Ferme les PTYs backend de tous les onglets d'un workspace (avant de le retirer du store). */
function closeAllPtys(ws: Workspace, tabPtys: Record<string, number>): void {
  for (const t of ws.tabs) {
    const ptyId = tabPtys[t.id];
    if (ptyId !== undefined) closePty(ptyId);
  }
}

/**
 * Exécute une action de raccourci sur le store. Point UNIQUE de dispatch :
 * seule la couche window (useShortcuts) l'appelle. La couche terminal
 * (attachCustomKeyEventHandler) se contente de retourner false à xterm ;
 * le keydown bulle ensuite jusqu'au listener window — dispatcher aux deux
 * niveaux exécuterait chaque action deux fois.
 */
export function dispatchShortcut(action: ShortcutAction): void {
  const s = useWorkspaceStore.getState();
  const active = s.workspaces.find((w) => w.id === s.activeId);
  switch (action.type) {
    case "open-folder":
      void openFolderDialog();
      return;
    case "new-workspace":
      // Le formulaire nom+dossier vit dans la Sidebar : on la révèle si elle est
      // masquée (Ctrl+Shift+B), sinon le raccourci n'aurait aucun effet visible.
      if (!s.sidebarVisible) s.toggleSidebar();
      s.requestNewWorkspace(true);
      return;
    case "new-home-workspace":
      void addHomeWorkspace();
      return;
    case "new-group":
      if (!s.sidebarVisible) s.toggleSidebar();
      s.requestNewGroup(true);
      return;
    case "toggle-group":
      if (active?.groupId) s.toggleGroupCollapsed(active.groupId);
      return;
    case "new-tab":
      if (active) void openTab(active.id);
      return;
    case "close-tab":
      if (!active?.activeTabId) return;
      // Dernier onglet = fermeture du workspace : on ferme explicitement ses PTYs
      // comme close-workspace, sans dépendre de l'ordre de démontage React.
      if (active.tabs.length <= 1) closeAllPtys(active, s.tabPtys);
      // Sinon le PTY est fermé par le cleanup du TerminalPane démonté.
      s.closeTab(active.id, active.activeTabId);
      return;
    case "close-workspace": {
      if (!active) return;
      // Ferme explicitement les PTYs AVANT de retirer le workspace :
      // closeWorkspace purge tabPtys, on ne dépend pas de l'ordre de
      // démontage React pour tuer les shells.
      closeAllPtys(active, s.tabPtys);
      s.closeWorkspace(active.id);
      return;
    }
    case "rename-workspace":
      // Même raison que new-workspace : l'édition inline est dans la Sidebar.
      if (!active) return;
      if (!s.sidebarVisible) s.toggleSidebar();
      s.requestRename(active.id);
      return;
    case "toggle-diff":
      // Uniquement si le workspace a un dossier : le diff s'appuie sur git dans cwd.
      if (active?.cwd) s.toggleDiff(active.id);
      return;
    case "toggle-sidebar":
      s.toggleSidebar();
      return;
    case "toggle-dashboard":
      useDashboardStore.getState().toggle();
      return;
    case "prev-workspace":
    case "next-workspace": {
      // Ordre VISIBLE (hors-groupe puis groupes), sans les groupes repliés — sauf si
      // l'actif y est : on part de lui quand même pour ne pas sauter au hasard.
      const order = navigableOrder(s.workspaces, s.groups);
      if (order.length === 0) return;
      const idx = order.findIndex((w) => w.id === s.activeId);
      const delta = action.type === "next-workspace" ? 1 : -1;
      const next = idx === -1 ? order[0] : order[(idx + delta + order.length) % order.length];
      s.setActive(next.id);
      return;
    }
    case "move-workspace": {
      // Réordonnancement, PAS de la navigation : pas de wrap-around (contrairement
      // à prev/next-workspace) — téléporter un workspace d'un bout à l'autre de la
      // liste sur une frappe de trop serait désagréable. Confiné à l'appartenance.
      if (!active) return;
      const peers = s.workspaces.filter((w) => w.groupId === active.groupId);
      const idx = peers.indexOf(active);
      const target = idx + (action.dir === "up" ? -1 : 1);
      if (target < 0 || target >= peers.length) return;
      s.moveWorkspace(active.id, target);
      return;
    }
    case "select-workspace": {
      const target = navigableOrder(s.workspaces, s.groups)[action.index];
      if (target) s.setActive(target.id);
      return;
    }
    case "prev-tab":
    case "next-tab": {
      if (!active || active.tabs.length === 0) return;
      const idx = active.tabs.findIndex((t) => t.id === active.activeTabId);
      const delta = action.type === "next-tab" ? 1 : -1;
      const n = active.tabs.length;
      const target = active.tabs[idx === -1 ? 0 : (idx + delta + n) % n];
      s.setActiveTab(active.id, target.id);
      focusTab(target.id);
      return;
    }
    case "move-tab": {
      if (!active?.activeTabId) return;
      const idx = active.tabs.findIndex((t) => t.id === active.activeTabId);
      const target = idx + (action.dir === "left" ? -1 : 1);
      if (target < 0 || target >= active.tabs.length) return; // pas de wrap
      s.moveTab(active.id, active.activeTabId, target);
      return;
    }
  }
}
