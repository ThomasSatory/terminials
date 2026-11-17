// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { Dock } from "./Dock";
import { useWorkspaceStore, type Workspace } from "../../store/workspace";
import { useUiStore } from "../../store/ui";
import { useDashboardStore } from "../../store/dashboard";
import { DUREE_DISPARITION_MS } from "../../lib/dockFantomes";

vi.mock("../../lib/pty", () => ({ closePty: vi.fn(), ptyCwd: vi.fn(() => Promise.resolve(null)) }));

function espace(id: string, name: string): Workspace {
  return {
    id,
    cwd: `/dev/${name}`,
    name,
    tabs: [{ id: `${id}:t` }],
    activeTabId: `${id}:t`,
    groupId: null,
    ports: [],
    unread: false,
    unreadTabs: [],
    diffOpen: false,
  };
}

describe("Dock (rendu client)", () => {
  let hote: HTMLDivElement;
  let racine: Root;
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    // jsdom n'a pas de ResizeObserver : le dock n'en a besoin que pour mesurer.
    globalThis.ResizeObserver ??= class {
      observe() {}
      disconnect() {}
      unobserve() {}
    } as unknown as typeof ResizeObserver;
    // Ni défilement doux ni mesures dans jsdom : la bande se croit trop étroite et défile.
    HTMLElement.prototype.scrollTo ??= function () {} as typeof HTMLElement.prototype.scrollTo;
    vi.useFakeTimers();
    hote = document.createElement("div");
    document.body.appendChild(hote);
    racine = createRoot(hote);
    useWorkspaceStore.getState().reset();
    useUiStore.getState().reset();
    useDashboardStore.getState().close();
    useWorkspaceStore.setState({
      workspaces: [espace("w1", "notes"), espace("w2", "api"), espace("w3", "infra")],
      activeId: "w2",
    });
    act(() => racine.render(<Dock />));
  });
  afterEach(() => {
    act(() => racine.unmount());
    hote.remove();
    vi.useRealTimers();
  });

  const avatar = (id: string) => hote.querySelector<HTMLButtonElement>(`[data-ws-id="${id}"]`);

  it("un espace fermé s'efface sur place (fantôme), sans retarder sa fermeture", () => {
    act(() => useWorkspaceStore.getState().closeWorkspace("w2"));
    // Le store l'a déjà retiré, son suivant est actif…
    expect(useWorkspaceStore.getState().workspaces.map((w) => w.id)).toEqual(["w1", "w3"]);
    expect(useWorkspaceStore.getState().activeId).toBe("w3");
    // …mais le dock le dessine encore, inerte et sans ancre, le temps de l'animation.
    expect(avatar("w2")).toBeNull();
    const fantome = hote.querySelector('[data-disparition="true"]');
    expect(fantome).not.toBeNull();
    const bouton = fantome!.closest("button")!;
    expect(bouton.getAttribute("aria-hidden")).toBe("true");
    expect(bouton.tabIndex).toBe(-1);
    act(() => vi.advanceTimersByTime(DUREE_DISPARITION_MS));
    expect(hote.querySelector('[data-disparition="true"]')).toBeNull();
    expect(hote.querySelectorAll(".dock-btn")).toHaveLength(2);
  });

  it("clic sur l'avatar ouvert pendant sa modification : la referme, aria-expanded suit", () => {
    act(() => useUiStore.getState().ouvrirPopoverEspace({ mode: "modifier", wsId: "w2" }));
    expect(avatar("w2")!.getAttribute("aria-expanded")).toBe("true");
    act(() => avatar("w2")!.click());
    expect(useUiStore.getState().popoverEspace).toBeNull();
    expect(useUiStore.getState().menuEspace).toBeNull();
    expect(avatar("w2")!.getAttribute("aria-expanded")).toBe("false");
    // Un nouveau clic ouvre son menu.
    act(() => avatar("w2")!.click());
    expect(useUiStore.getState().menuEspace).toBe("w2");
    expect(avatar("w2")!.getAttribute("aria-expanded")).toBe("true");
  });

  it("récap ou mosaïque ouverts : l'indicateur reste visible (il glisse sous leur bouton)", () => {
    const indicateur = () => hote.querySelector<HTMLElement>(".dock-indicateur")!;
    expect(indicateur().style.opacity).toBe("1");
    act(() => useDashboardStore.getState().toggle());
    expect(indicateur().style.opacity).toBe("1");
    expect(hote.querySelector(".dock-activite")!.getAttribute("aria-pressed")).toBe("true");
    act(() => useDashboardStore.getState().close());
    act(() => useUiStore.getState().setVue("mosaique"));
    expect(indicateur().style.opacity).toBe("1");
    // Aucun avatar n'est marqué ouvert dans la mosaïque.
    expect(avatar("w2")!.hasAttribute("aria-expanded")).toBe(false);
  });
});
