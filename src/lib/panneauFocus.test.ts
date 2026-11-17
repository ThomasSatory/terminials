// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("./tabFocus", () => ({ focusTab: vi.fn() }));
vi.mock("./pty", () => ({ closePty: vi.fn(), writePty: vi.fn(), ptyCwd: vi.fn(async () => null) }));

import { focusTab } from "./tabFocus";
import { dispatchShortcut, fermerPanneauSuperviseur } from "./shortcutDispatch";
import { useSuperviseurStore } from "../store/superviseur";
import { useReglagesStore } from "../store/reglages";
import { useUiStore } from "../store/ui";
import { useDashboardStore } from "../store/dashboard";
import { useWorkspaceStore, type Workspace } from "../store/workspace";
import { REGLAGES_DEFAUT } from "./reglages";

const ws: Workspace = {
  id: "e1",
  cwd: "/dev/api",
  name: "api",
  tabs: [{ id: "t1", title: "claude" }],
  activeTabId: "t1",
  groupId: null,
  ports: [],
  unread: false,
  unreadTabs: [],
  diffOpen: false,
};

beforeEach(() => {
  vi.clearAllMocks();
  document.body.replaceChildren();
  useSuperviseurStore.getState().reset();
  useUiStore.getState().fermerParametres();
  useUiStore.getState().setVue("terminal");
  useDashboardStore.getState().close();
  useWorkspaceStore.setState({ workspaces: [ws], activeId: "e1" });
  useReglagesStore.setState({
    reglages: { ...REGLAGES_DEFAUT, superviseur: { ...REGLAGES_DEFAUT.superviseur, actif: true } },
  });
});

describe("fermeture du panneau du superviseur", () => {
  it("Ctrl+Maj+Espace qui ferme rend la saisie au terminal affiché", () => {
    dispatchShortcut({ type: "toggle-superviseur" });
    expect(useSuperviseurStore.getState().panneauOuvert).toBe(true);
    expect(focusTab).not.toHaveBeenCalled();
    dispatchShortcut({ type: "toggle-superviseur" });
    expect(useSuperviseurStore.getState().panneauOuvert).toBe(false);
    expect(focusTab).toHaveBeenCalledWith("t1");
  });

  it("Paramètres ouverts dessous : la saisie va à la vue, pas au terminal masqué", () => {
    const vue = document.createElement("section");
    vue.className = "par";
    vue.tabIndex = -1;
    document.body.append(vue);
    useUiStore.getState().ouvrirParametres("apparence");
    useSuperviseurStore.getState().ouvrirPanneau();
    fermerPanneauSuperviseur();
    expect(document.activeElement).toBe(vue);
    expect(focusTab).not.toHaveBeenCalled();
  });

  it("vue plein écran (récap, diff) : son focus n'est pas déplacé", () => {
    useSuperviseurStore.getState().ouvrirPanneau();
    useDashboardStore.setState({ open: true });
    fermerPanneauSuperviseur();
    expect(useSuperviseurStore.getState().panneauOuvert).toBe(false);
    useWorkspaceStore.setState({ workspaces: [{ ...ws, diffOpen: true }] });
    useDashboardStore.getState().close();
    fermerPanneauSuperviseur();
    expect(focusTab).not.toHaveBeenCalled();
  });
});
