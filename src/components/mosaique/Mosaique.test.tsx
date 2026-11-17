// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { useWorkspaceStore, type Workspace } from "../../store/workspace";
import { useUiStore } from "../../store/ui";
import { Mosaique } from "../Mosaique";

function espace(id: string, nom: string, groupId: string | null, extra: Partial<Workspace> = {}): Workspace {
  return {
    id,
    cwd: `/home/moi/dev/${nom}`,
    name: nom,
    tabs: [{ id: `${id}-t1` }],
    activeTabId: `${id}-t1`,
    groupId,
    ports: [],
    unread: false,
    unreadTabs: [],
    diffOpen: false,
    ...extra,
  };
}

describe("Mosaique (rendu)", () => {
  // Rendu client (le rendu serveur de zustand lirait l'état initial du store, vide).
  let hote: HTMLDivElement;
  let racine: Root;
  const rendre = () => {
    act(() => racine.render(<Mosaique />));
    return hote.innerHTML;
  };
  afterEach(() => {
    act(() => racine.unmount());
    hote.remove();
  });
  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    hote = document.createElement("div");
    document.body.appendChild(hote);
    racine = createRoot(hote);
    useWorkspaceStore.getState().reset();
    useUiStore.getState().reset();
    useWorkspaceStore.setState({
      groups: [{ id: "g1", name: "produit", color: "#a99cff", collapsed: false }],
      workspaces: [
        espace("w1", "notes", null),
        espace("w2", "terminials", "g1", { branch: "master", dirty: true }),
        espace("w3", "api", "g1", {
          unread: true,
          lastNotification: { title: "Claude Code", body: "Autoriser npm run migrate ?" },
        }),
      ],
      activeId: "w2",
      tabPtys: { "w2-t1": 7 },
      busyPtys: { 7: true },
    });
  });

  it("sections par groupe (hors groupe en dernier), filtres et résumé", () => {
    const html = rendre();
    expect(html).toContain("3 espaces · 1 au travail · 1 vous attend");
    expect(html.indexOf('aria-label="Groupe produit"')).toBeLessThan(html.indexOf('aria-label="Hors groupe"'));
    expect(html).toContain('aria-label="Tous les espaces, 3 espaces, 1 en attente, 1 au travail"');
    expect(html).toContain('role="switch" aria-checked="false"');
  });

  it("tuiles : état, branche, attente mise en avant avec « Aller »", () => {
    const html = rendre();
    expect(html).toContain('data-etat="travail"');
    expect(html).toContain("master •");
    expect(html).toContain("Ouvrir le terminal de api, vous attend : Autoriser npm run migrate ?");
    expect(html).toContain('aria-label="Aller répondre à api"');
    // Au repos sans sortie lue : le dossier abrégé en pied.
    expect(html).toContain("~/dev/notes");
    // Mini-terminal sur 6 lignes en vue « Tous ».
    expect(html).toContain("height: 9.6em");
  });

  it("filtrer un groupe agrandit les tuiles : 2 colonnes larges, 12 lignes", () => {
    rendre();
    const bouton = hote.querySelector<HTMLButtonElement>('[aria-label^="Groupe produit"]')!;
    act(() => bouton.click());
    expect(bouton.getAttribute("aria-pressed")).toBe("true");
    expect(hote.innerHTML).toContain("minmax(min(520px, 100%), 1fr)");
    expect(hote.innerHTML).toContain("height: 19.2em");
    expect(hote.innerHTML).not.toContain('aria-label="Hors groupe"');
  });

  it("choisir une tuile active l'espace et revient au terminal ; Échap aussi", () => {
    useUiStore.setState({ vue: "mosaique" });
    rendre();
    act(() => hote.querySelector<HTMLButtonElement>('[aria-label="Aller répondre à api"]')!.click());
    expect(useWorkspaceStore.getState().activeId).toBe("w3");
    expect(useUiStore.getState().vue).toBe("terminal");

    useUiStore.setState({ vue: "mosaique" });
    const vue = hote.querySelector<HTMLElement>(".mos")!;
    act(() => {
      vue.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(useUiStore.getState().vue).toBe("terminal");
  });

  it("la tuile de l'espace actif prend le focus à l'ouverture", () => {
    rendre();
    expect((document.activeElement as HTMLElement).dataset.mosWs).toBe("w2");
  });

  it("tabindex itinérant : une seule tuile tabulable, « Aller » le reste", () => {
    rendre();
    const tabulables = Array.from(hote.querySelectorAll<HTMLButtonElement>("[data-mos-ws]")).filter(
      (b) => b.tabIndex === 0,
    );
    expect(tabulables.map((b) => b.dataset.mosWs)).toEqual(["w2"]);
    expect(hote.querySelector<HTMLButtonElement>('[aria-label="Aller répondre à api"]')!.tabIndex).toBe(0);
    act(() => hote.querySelector<HTMLButtonElement>('[data-mos-ws="w3"]')!.focus());
    expect(hote.querySelector<HTMLButtonElement>('[data-mos-ws="w3"]')!.tabIndex).toBe(0);
    expect(hote.querySelector<HTMLButtonElement>('[data-mos-ws="w2"]')!.tabIndex).toBe(-1);
  });

  it("réserve basse : celle du dock, réduite dock masqué", () => {
    rendre();
    expect(hote.querySelector<HTMLElement>(".mos")!.style.getPropertyValue("--mos-reserve")).toBe("var(--reserve-dock)");
    act(() => useUiStore.setState({ dockVisible: false }));
    expect(hote.querySelector<HTMLElement>(".mos")!.style.getPropertyValue("--mos-reserve")).toBe(
      "var(--reserve-sans-dock)",
    );
  });

  it("agent qui vient de finir : tuile « terminé », coche et pied vert", () => {
    // terminials (groupe produit) finit son tour : plus occupé, onglet terminé.
    act(() =>
      useWorkspaceStore.setState((st) => ({
        workspaces: st.workspaces.map((w) => (w.id === "w2" ? { ...w, tabs: [{ id: "w2-t1", title: "✳ Refonte" }] } : w)),
        busyPtys: {},
        tabsTermines: { "w2-t1": true },
      })),
    );
    const html = rendre();
    expect(html).toContain('data-etat="termine"');
    expect(html).toContain("mos-pied-termine");
    expect(html).toContain("Terminé : Refonte");
    expect(html).toContain("1 terminé");
  });
});
