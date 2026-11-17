import { closePty } from "./pty";
import { openFolderDialog } from "./openFolder";
import { addHomeWorkspace } from "./homeWorkspace";
import { focusTab } from "./tabFocus";
import { openTab } from "./newTab";
import type { ShortcutAction } from "./shortcuts";
import { useWorkspaceStore, navigableOrder, type Workspace } from "../store/workspace";
import { useDashboardStore } from "../store/dashboard";
import { useUiStore } from "../store/ui";
import { useSuperviseurStore } from "../store/superviseur";

/** Ferme les PTYs backend de tous les onglets d'un workspace (avant de le retirer du store). */
function closeAllPtys(ws: Workspace, tabPtys: Record<string, number>): void {
  for (const t of ws.tabs) {
    const ptyId = tabPtys[t.id];
    if (ptyId !== undefined) closePty(ptyId);
  }
}

/**
 * Ferme un espace, comme la maquette Creation (« Fermer l'espace » du menu, Ctrl+Maj+Q) :
 * le DERNIER espace ne se ferme pas, sans autre signe que l'entrée grisée du menu
 * (« dernier espace ») — la maquette ne montre ni toast ni retour à l'accueil ; seul
 * « Tout fermer » (maquette Accueil) y ramène. Sinon ses PTY sont fermés sur-le-champ
 * puis il quitte le store ; son suivant dans le dock devient actif, le dock l'efface en
 * l'animant. Les calques qui le visaient se referment. Renvoie vrai si l'espace a été
 * fermé.
 */
export function fermerEspace(wsId: string): boolean {
  const s = useWorkspaceStore.getState();
  const ws = s.workspaces.find((w) => w.id === wsId);
  if (!ws) return false;
  if (s.workspaces.length < 2) return false;
  // PTY fermés AVANT de retirer l'espace : closeWorkspace purge tabPtys, on ne dépend pas
  // de l'ordre de démontage React pour tuer les shells.
  closeAllPtys(ws, s.tabPtys);
  s.closeWorkspace(ws.id);
  useUiStore.getState().oublierEspace(ws.id);
  return true;
}

/**
 * « Tout fermer » de la barre du haut (maquette Accueil) : ferme TOUS les espaces, le
 * dernier compris, et ramène à l'accueil. Les PTY de chaque espace sont fermés avant son
 * retrait (comme fermerEspace) ; les calques, la palette et les Paramètres se referment.
 * Les groupes restent : ce sont des rangements, pas des sessions. Comme dans la
 * maquette, un seul clic suffit, sans confirmation. Renvoie le nombre d'espaces fermés.
 */
export function fermerTousLesEspaces(): number {
  const s = useWorkspaceStore.getState();
  const espaces = [...s.workspaces];
  for (const ws of espaces) {
    closeAllPtys(ws, useWorkspaceStore.getState().tabPtys);
    useWorkspaceStore.getState().closeWorkspace(ws.id);
    useUiStore.getState().oublierEspace(ws.id);
  }
  const ui = useUiStore.getState();
  ui.fermerCalques();
  ui.fermerPalette();
  ui.fermerParametres();
  if (ui.vue !== "terminal") ui.setVue("terminal");
  return espaces.length;
}

/**
 * Aller à un espace au clavier (Ctrl 1…9, Ctrl PageUp/PageDown) : comme un clic sur son
 * avatar ou le bouton « Aller » de la bulle, c'est vouloir voir son terminal. Le récap et
 * la mosaïque qui le masqueraient s'effacent, les calques légers se referment ; le focus
 * suit (TabbedTerminals le rend au terminal qui redevient visible).
 */
function allerAEspace(wsId: string): void {
  useSuperviseurStore.getState().fermerPanneau();
  useDashboardStore.getState().close();
  const ui = useUiStore.getState();
  ui.fermerCalques();
  ui.fermerParametres();
  if (ui.vue !== "terminal") ui.setVue("terminal");
  useWorkspaceStore.getState().setActive(wsId);
}

/**
 * Ouvre le poste de suivi du superviseur (Ctrl+Maj+Espace, marque du dock, « Ouvrir » de
 * la bulle, palette) : les calques légers et la palette se referment pour qu'il se voie
 * seul. Désactivé, il s'ouvre quand même : il présente le superviseur et propose de
 * l'activer.
 */
export function ouvrirPosteSuperviseur(): void {
  const ui = useUiStore.getState();
  ui.fermerCalques();
  ui.fermerPalette();
  // Le récap et les Paramètres priment sur le poste dans vuePleinEcran : ils se ferment.
  useDashboardStore.getState().close();
  ui.fermerParametres();
  useSuperviseurStore.getState().ouvrirPanneau();
}

/**
 * Ferme le poste de suivi (Échap, croix, Ctrl+Maj+Espace) et rend la saisie à ce qui
 * réapparaît dessous : les Paramètres s'ils sont ouverts, le terminal actif si c'est lui
 * qui revient. Sans cela, le focus restait dans une vue qui disparaît et retombait sur
 * <body> : la frappe suivante n'allait nulle part. La mosaïque, les fichiers modifiés et
 * le récap se remontent et prennent leur propre focus : rien n'est déplacé.
 */
export function fermerPanneauSuperviseur(): void {
  useSuperviseurStore.getState().fermerPanneau();
  if (typeof document === "undefined") return;
  const ui = useUiStore.getState();
  if (ui.parametres) {
    document.querySelector<HTMLElement>(".par")?.focus();
    return;
  }
  const s = useWorkspaceStore.getState();
  const w = s.workspaces.find((x) => x.id === s.activeId);
  const tab = w?.activeTabId;
  if (ui.vue !== "terminal" || useDashboardStore.getState().open || !tab || w.diffOpen) return;
  // Le terminal redevient visible au rendu suivant : le focus après (comme `allerA`).
  if (typeof requestAnimationFrame !== "function") {
    focusTab(tab);
    return;
  }
  requestAnimationFrame(() => requestAnimationFrame(() => focusTab(tab)));
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
  const ui = useUiStore.getState();
  const active = s.workspaces.find((w) => w.id === s.activeId);
  switch (action.type) {
    case "open-folder":
      void openFolderDialog();
      return;
    case "new-workspace":
      // Popover de création ancré au « + » du dock (le store réaffiche le dock masqué).
      ui.ouvrirPopoverEspace({ mode: "creer" });
      return;
    case "new-home-workspace":
      void addHomeWorkspace();
      return;
    case "new-group":
      ui.ouvrirFormulaireGroupe({ mode: "creer" });
      return;
    case "toggle-group":
      if (active?.groupId) s.toggleGroupCollapsed(active.groupId);
      return;
    case "new-tab":
      // Le nouvel onglet doit se voir : les Paramètres qui le couvriraient se ferment.
      ui.fermerParametres();
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
    case "close-workspace":
      // Même chemin que « Fermer l'espace » du menu (maquette Creation).
      if (active) fermerEspace(active.id);
      return;
    case "rename-workspace":
      // Popover de modification (nom, dossier, couleur, groupe) ancré à l'avatar actif.
      if (!active) return;
      ui.ouvrirPopoverEspace({ mode: "modifier", wsId: active.id });
      return;
    case "toggle-diff":
      // Uniquement si le workspace a un dossier : le diff s'appuie sur git dans cwd.
      if (!active?.cwd) return;
      // Les Paramètres passent devant le diff : on les ferme pour qu'il se voie.
      if (!active.diffOpen) ui.fermerParametres();
      s.toggleDiff(active.id);
      return;
    case "toggle-dock":
      ui.basculerDock();
      return;
    case "toggle-palette":
      ui.basculerPalette();
      return;
    case "toggle-mosaique":
      // Sans espace, l'accueil prime : basculer la vue n'afficherait rien et la mosaïque
      // surgirait au lieu du terminal de l'espace rouvert ensuite.
      if (s.workspaces.length === 0 && ui.vue !== "mosaique") return;
      // Poste ouvert par-dessus la mosaïque : le raccourci ferme le poste et la montre,
      // au lieu de la quitter cachée dessous.
      if (useSuperviseurStore.getState().panneauOuvert && ui.vue === "mosaique") {
        useSuperviseurStore.getState().fermerPanneau();
        return;
      }
      // Entrer en mosaïque referme les vues plein écran qui la masqueraient (récap,
      // fichiers modifiés) : sinon le raccourci n'aurait aucun effet visible.
      if (ui.vue !== "mosaique") {
        useSuperviseurStore.getState().fermerPanneau();
        useDashboardStore.getState().close();
        ui.fermerParametres();
        if (active?.diffOpen) s.toggleDiff(active.id);
      }
      ui.basculerMosaique();
      return;
    case "toggle-dashboard":
      // Une vue plein écran s'ouvre : les calques légers ne restent pas suspendus devant.
      ui.fermerCalques();
      if (!useDashboardStore.getState().open) useSuperviseurStore.getState().fermerPanneau();
      ui.fermerParametres();
      // Autre vue : le retour vers la mosaïque ne survit pas au récap.
      ui.desarmerRetourMosaique();
      useDashboardStore.getState().toggle();
      return;
    case "toggle-parametres":
      // Vue plein écran sous la barre du haut : le récap, qui la couvrirait, se ferme.
      useDashboardStore.getState().close();
      // Ouvrir les Paramètres referme le poste, qui les masquerait.
      if (useSuperviseurStore.getState().panneauOuvert) {
        useSuperviseurStore.getState().fermerPanneau();
        if (ui.parametres === null) ui.basculerParametres();
        return;
      }
      ui.basculerParametres();
      return;
    case "toggle-superviseur":
      // Désactivé, le poste s'ouvre quand même : il présente le superviseur et propose
      // de l'activer (ou d'aller à ses réglages).
      if (useSuperviseurStore.getState().panneauOuvert) fermerPanneauSuperviseur();
      else ouvrirPosteSuperviseur();
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
      allerAEspace(next.id);
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
      if (target) allerAEspace(target.id);
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
