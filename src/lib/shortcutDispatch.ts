import { closePty } from "./pty";
import { openFolderDialog } from "./openFolder";
import { focusPane } from "./paneFocus";
import { paneNavTarget, type ShortcutAction } from "./shortcuts";
import { useWorkspaceStore, MAX_PANES } from "../store/workspace";
import { useDashboardStore } from "../store/dashboard";

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
    case "new-pane":
      if (active && !s.addPane(active.id)) s.showToast(`max ${MAX_PANES} terminaux`);
      return;
    case "close-pane":
      // Le PTY est fermé par le cleanup du TerminalPane démonté.
      if (active?.activePaneId) s.closePane(active.id, active.activePaneId);
      return;
    case "close-workspace": {
      if (!active) return;
      // Ferme explicitement les PTYs AVANT de retirer le workspace :
      // closeWorkspace purge panePtys, on ne dépend pas de l'ordre de
      // démontage React pour tuer les shells.
      for (const paneId of active.panes) {
        const ptyId = s.panePtys[paneId];
        if (ptyId !== undefined) closePty(ptyId);
      }
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
      if (s.workspaces.length === 0) return;
      const idx = s.workspaces.findIndex((w) => w.id === s.activeId);
      const delta = action.type === "next-workspace" ? 1 : -1;
      const next =
        idx === -1
          ? s.workspaces[0]
          : s.workspaces[(idx + delta + s.workspaces.length) % s.workspaces.length];
      s.setActive(next.id);
      return;
    }
    case "move-workspace": {
      // Réordonnancement, PAS de la navigation : pas de wrap-around (contrairement
      // à prev/next-workspace) — téléporter un workspace d'un bout à l'autre de la
      // liste sur une frappe de trop serait désagréable.
      if (!active) return;
      const idx = s.workspaces.indexOf(active);
      const target = idx + (action.dir === "up" ? -1 : 1);
      if (target < 0 || target >= s.workspaces.length) return;
      s.moveWorkspace(active.id, target);
      return;
    }
    case "select-workspace": {
      const target = s.workspaces[action.index];
      if (target) s.setActive(target.id);
      return;
    }
    case "focus-pane": {
      if (!active || !active.activePaneId) return;
      const current = active.panes.indexOf(active.activePaneId);
      const target = paneNavTarget(active.panes.length, current, action.dir);
      if (target === null) return;
      const targetPaneId = active.panes[target];
      s.setActivePane(active.id, targetPaneId);
      focusPane(targetPaneId);
      return;
    }
  }
}
