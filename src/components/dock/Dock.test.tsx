import { describe, it, expect, beforeEach } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Dock } from "./Dock";
import { useWorkspaceStore, type Group, type Workspace } from "../../store/workspace";
import { useUiStore } from "../../store/ui";
import { useDashboardStore } from "../../store/dashboard";

/** Espace minimal, posé directement dans le store (sans persistance). */
function espace(id: string, name: string, groupId: string | null, p: Partial<Workspace> = {}): Workspace {
  return {
    id,
    cwd: `/dev/${name}`,
    name,
    tabs: [{ id: `${id}:t` }],
    activeTabId: `${id}:t`,
    groupId,
    ports: [],
    unread: false,
    unreadTabs: [],
    diffOpen: false,
    ...p,
  };
}

const groupe = (id: string, name: string, collapsed = false): Group => ({ id, name, color: "#1565C0", collapsed });

/**
 * Pose un état dans un store. Le rendu serveur (renderToStaticMarkup) lit l'instantané
 * INITIAL du store (useSyncExternalStore) : on l'écrit donc aussi, comme l'état courant.
 * Sans effet hors de ce fichier (vitest isole chaque fichier de test).
 */
function etat<T extends object>(st: { setState: (p: Partial<T>) => void; getInitialState: () => T }, p: Partial<T>) {
  st.setState(p);
  Object.assign(st.getInitialState(), p);
}

function poser(workspaces: Workspace[], groups: Group[], activeId: string | null) {
  etat(useWorkspaceStore, { workspaces, groups, activeId, tabPtys: {}, busyPtys: {} });
}

describe("Dock", () => {
  beforeEach(() => {
    etat(useUiStore, { vue: "terminal", dockVisible: true, paletteOuverte: false, menuEspace: null });
    etat(useDashboardStore, { open: false, unreadSummary: false });
    poser([], [], null);
  });

  it("sans espace : ni bande, ni séparateur, ni mosaïque, mais « + », activité et palette", () => {
    const html = renderToStaticMarkup(<Dock />);
    expect(html).toContain('aria-label="Espaces de travail"');
    expect(html).not.toContain("dock-bande");
    expect(html).not.toContain("dock-sep");
    expect(html).toContain('data-dock-add=""');
    expect(html).not.toContain("Mosaïque des agents");
    expect(html).toContain('aria-label="Activité de la journée (Ctrl+Maj+H)"');
    expect(html).toContain(">Ctrl K<");
  });

  it("dock masqué : rien", () => {
    etat(useUiStore, { dockVisible: false });
    expect(renderToStaticMarkup(<Dock />)).toBe("");
  });

  it("avatars ancrés, raccourcis, espace ouvert et état d'agent dans le libellé", () => {
    poser(
      [
        espace("ws:1", "notes", null),
        espace("ws:2", "terminials", "g:1", { branch: "master", dirty: true, ports: [1420] }),
        espace("ws:3", "api", "g:1", { unread: true, lastNotification: { title: "t", body: "Autoriser ?" } }),
      ],
      [groupe("g:1", "produit")],
      "ws:2",
    );
    const html = renderToStaticMarkup(<Dock />);
    expect(html).toContain('data-ws-id="ws:1"');
    expect(html).toContain('data-dock-group="g:1"');
    expect(html).toContain('aria-label="terminials : actions de l’espace"');
    expect(html).toContain('aria-label="api, un agent vous attend"');
    expect(html).toContain("master •  ·  :1420");
    expect(html).toContain("Autoriser ?");
    expect(html).toContain(">Ctrl 3<");
    // Hors groupe puis groupe : un filet les sépare.
    expect(html.match(/dock-sep/g)?.length).toBe(2);
    expect(html).toContain('aria-label="Replier le groupe produit (2 espaces)"');
  });

  it("groupe replié : pile qui remonte l'attente, membres hors du focus", () => {
    poser(
      [
        espace("ws:1", "notes", null),
        espace("ws:2", "auth", "g:1"),
        espace("ws:3", "api", "g:1", { unread: true, lastNotification: { title: "t", body: "Migrer ?" } }),
      ],
      [groupe("g:1", "services", true)],
      "ws:1",
    );
    const html = renderToStaticMarkup(<Dock />);
    expect(html).toContain('aria-label="Déplier le groupe services, 2 espaces, un agent vous attend"');
    expect(html).toContain("api · Migrer ?");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('tabindex="-1"');
    expect(html).toContain('data-sautille="true"');
  });

  it("groupe vide replié : pas de pile, rien d'invisible à tabuler", () => {
    poser([espace("ws:1", "notes", null)], [groupe("g:1", "vide", true)], "ws:1");
    const html = renderToStaticMarkup(<Dock />);
    expect(html).toContain('data-dock-group="g:1"');
    expect(html).not.toContain("dock-pile");
  });

  it("mosaïque : bouton enfoncé, aucun avatar marqué ouvert", () => {
    poser([espace("ws:1", "notes", null)], [], "ws:1");
    etat(useUiStore, { vue: "mosaique" });
    const html = renderToStaticMarkup(<Dock />);
    expect(html).toContain('aria-pressed="true"');
    expect(html).not.toContain("actions de l’espace");
  });
});
