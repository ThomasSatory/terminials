// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { TopBar } from "./TopBar";
import { useWorkspaceStore, type Workspace } from "../store/workspace";
import { useUiStore } from "../store/ui";
import { useDashboardStore } from "../store/dashboard";
import { closePty } from "../lib/pty";

vi.mock("../lib/pty", () => ({ closePty: vi.fn(), ptyCwd: vi.fn(() => Promise.resolve(null)) }));

function espace(id: string, name: string): Workspace {
  return {
    id,
    cwd: `/dev/${name}`,
    name,
    tabs: [{ id: `${id}:t`, numero: 1 }],
    activeTabId: `${id}:t`,
    groupId: null,
    ports: [],
    unread: false,
    unreadTabs: [],
    diffOpen: false,
  };
}

describe("TopBar : « Tout fermer »", () => {
  let hote: HTMLDivElement;
  let racine: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    HTMLElement.prototype.scrollIntoView ??= function () {} as typeof HTMLElement.prototype.scrollIntoView;
    // jsdom n'a pas CSS.escape ; les ids d'onglet des tests n'ont rien à échapper.
    globalThis.CSS ??= { escape: (s: string) => s } as unknown as typeof CSS;
    vi.useFakeTimers();
    vi.mocked(closePty).mockClear();
    hote = document.createElement("div");
    document.body.appendChild(hote);
    racine = createRoot(hote);
    useWorkspaceStore.getState().reset();
    useUiStore.getState().reset();
    useDashboardStore.getState().close();
    useWorkspaceStore.setState({
      workspaces: [espace("w1", "notes"), espace("w2", "api")],
      activeId: "w2",
      tabPtys: { "w1:t": 3, "w2:t": 4 },
    });
    act(() => racine.render(<TopBar />));
  });
  afterEach(() => {
    act(() => racine.unmount());
    hote.remove();
    vi.useRealTimers();
  });

  const bouton = () => hote.querySelector<HTMLButtonElement>(".topbar-tout-fermer");

  it("un clic ferme tous les espaces et leurs PTY, sans confirmation (maquette Accueil)", () => {
    expect(bouton()?.textContent).toContain("Tout fermer");
    // Nom accessible gardé quand le texte se masque en fenêtre étroite (icône seule).
    expect(bouton()?.getAttribute("aria-label")).toBe("Tout fermer");
    expect(bouton()?.title).toBe("Fermer tous les espaces et revenir à l’accueil");
    act(() => bouton()!.click());
    expect(useWorkspaceStore.getState().workspaces).toEqual([]);
    expect(closePty).toHaveBeenCalledWith(3);
    expect(closePty).toHaveBeenCalledWith(4);
    // Plus d'espace actif : la barre disparaît (l'accueil prend la fenêtre).
    expect(hote.querySelector(".topbar")).toBeNull();
  });
});
