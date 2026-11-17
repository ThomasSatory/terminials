import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => true) }));

import { MarqueSuperviseur } from "./MarqueSuperviseur";
import { PanneauSuperviseur } from "./PanneauSuperviseur";
import { BulleSuperviseur, CarteBulle } from "./BulleSuperviseur";
import { placerSurMarque } from "../../hooks/usePlacementSuperviseur";
import { useWorkspaceStore, type Workspace } from "../../store/workspace";
import { useSuperviseurStore, type SuperviseurState } from "../../store/superviseur";
import { useReglagesStore, type ReglagesState } from "../../store/reglages";
import { REGLAGES_DEFAUT, type ReglagesApp } from "../../lib/reglages";

/** Pose un état dans un store ; le rendu serveur lit l'instantané INITIAL, on l'écrit aussi. */
function etat<T extends object>(st: { setState: (p: Partial<T>) => void; getInitialState: () => T }, p: Partial<T>) {
  st.setState(p);
  Object.assign(st.getInitialState(), p);
}

function espace(id: string, name: string, p: Partial<Workspace> = {}): Workspace {
  return {
    id,
    cwd: `/dev/${name}`,
    name,
    tabs: [{ id: `${id}:t`, title: "claude", claude: { id: "s", cwd: "/" } }],
    activeTabId: `${id}:t`,
    groupId: null,
    ports: [],
    unread: false,
    unreadTabs: [],
    diffOpen: false,
    ...p,
  };
}

function superviseur(p: Partial<ReglagesApp["superviseur"]>) {
  etat<ReglagesState>(useReglagesStore, {
    reglages: { ...REGLAGES_DEFAUT, superviseur: { ...REGLAGES_DEFAUT.superviseur, actif: true, nom: "Vigie", ...p } },
  });
}

const VIDE: Partial<SuperviseurState> = {
  fil: [],
  demandes: [],
  demandeFocus: null,
  echanges: [],
  sessionsBloquees: {},
  moteur: { enCours: false, dernierTour: null, derniereErreur: null },
  entreeTour: null,
  panneauOuvert: false,
  nonLus: 0,
  bulleEcartee: null,
  manques: [],
};

beforeEach(() => {
  etat(useWorkspaceStore, {
    workspaces: [espace("a", "api-paiements"), espace("b", "site-vitrine"), espace("c", "notes")],
    groups: [],
    activeId: "c",
    tabPtys: {},
    busyPtys: {},
    tabsTermines: {},
  });
  etat<SuperviseurState>(useSuperviseurStore, { ...VIDE });
  superviseur({});
});

describe("MarqueSuperviseur", () => {
  it("rien quand le superviseur est désactivé", () => {
    superviseur({ actif: false });
    expect(renderToStaticMarkup(<MarqueSuperviseur />)).toBe("");
  });

  it("observe : viseur, nom accessible avec sa ligne d'état, ancre de la bulle, séparateur", () => {
    const html = renderToStaticMarkup(<MarqueSuperviseur />);
    expect(html).toContain("data-dock-superviseur");
    expect(html).toContain('data-mode="observe"');
    expect(html).toContain('aria-label="Vigie, superviseur, observe 3 espaces (Ctrl+Maj+Espace)"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("dock-sep");
    expect(html).not.toContain("sup-marque-pastille");
  });

  it("a quelque chose à dire : pastille ; en pause : barres", () => {
    etat(useWorkspaceStore, { workspaces: [espace("a", "api-paiements", { unread: true })] });
    let html = renderToStaticMarkup(<MarqueSuperviseur />);
    expect(html).toContain('data-mode="parle"');
    expect(html).toContain("sup-marque-pastille");
    expect(html).toContain("1 vous attend");
    superviseur({ pause: true });
    html = renderToStaticMarkup(<MarqueSuperviseur />);
    expect(html).toContain('data-mode="pause"');
    expect(html).toContain("sup-viseur-barre");
  });

  it("agit : arc cyan pendant un tour", () => {
    etat<SuperviseurState>(useSuperviseurStore, { moteur: { enCours: true, dernierTour: null, derniereErreur: null } });
    const html = renderToStaticMarkup(<MarqueSuperviseur />);
    expect(html).toContain("sup-viseur-arc");
    expect(html).toContain("agit · réflexion");
  });
});

describe("PanneauSuperviseur", () => {
  it("fermé : rien", () => {
    expect(renderToStaticMarkup(<PanneauSuperviseur />)).toBe("");
  });

  it("premier lancement : en-tête, autonomie, fil vide soigné, saisie", () => {
    etat<SuperviseurState>(useSuperviseurStore, { panneauOuvert: true });
    const html = renderToStaticMarkup(<PanneauSuperviseur />);
    expect(html).toContain('aria-label="Vigie, superviseur"');
    expect(html).toContain('aria-label="Renommer Vigie"');
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>.*Observer/);
    expect(html).toContain("Vigie regarde et vous prévient.");
    expect(html).toContain('role="switch" aria-checked="false"');
    expect(html).toContain('role="log"');
    expect(html).toContain("Vigie suit vos 3 espaces.");
    expect(html).toContain("terminials demander");
    expect(html).toContain('placeholder="Demander à Vigie…"');
    expect(html).toContain("Où en sont mes agents ?");
    expect(html).toContain('aria-label="Échanges toujours autorisés (0)"');
  });

  it("fil : message routé, ligne d'outil, tableau des agents cliquable, action", () => {
    etat<SuperviseurState>(useSuperviseurStore, {
      panneauOuvert: true,
      fil: [
        { id: "f1", a: 0, genre: "utilisateur", parties: [{ type: "texte", texte: "Où en sont mes agents ?" }] },
        { id: "f2", a: 0, genre: "message", de: "b", vers: "a", parties: [{ type: "texte", texte: "« Quel format ? »" }] },
        {
          id: "f3",
          a: 0,
          genre: "superviseur",
          parties: [
            { type: "outil", appelId: 1, outil: "espaces.etat", args: "--tous", statut: "fait" },
            { type: "outil", appelId: 2, outil: "terminal.lire", args: "api-paiements › claude  --lignes 40", statut: "en_cours" },
            { type: "etats", lignes: [{ wsId: "a", etat: "attente", phrase: "autorisation : utiliser Bash" }] },
            { type: "action", libelle: "Y aller", action: { type: "aller", wsId: "a" } },
          ],
        },
      ],
    });
    const html = renderToStaticMarkup(<PanneauSuperviseur />);
    expect(html).toContain("❯");
    expect(html).toContain("« Quel format ? »");
    expect(html).toContain('aria-label="Aller à site-vitrine"');
    expect(html).toContain("espaces.état");
    expect(html).toContain('data-statut="en_cours"');
    expect(html).toContain("sup-spin");
    expect(html).toContain('aria-label="Aller à api-paiements, vous attend : autorisation : utiliser Bash"');
    expect(html).toContain("1 vous attend");
    expect(html).toContain("Y aller");
    expect(html).toContain("Ctrl 1");
  });

  it("pile « À valider » au niveau Agir : texte exact, case « toujours », Autoriser Ctrl+Entrée, Ensuite", () => {
    superviseur({ niveau: "agir" });
    const base = {
      appelId: 1,
      outil: "session.demander" as const,
      cible: { wsId: "a", tabId: "a:t" },
      de: "b",
      echangeId: "echange:1",
      texte: "Question de site-vitrine :\nQuel format ?",
      entree: true,
      pourquoi: "Rien dans son terminal ne répond à la question.",
      paire: ["/dev/site-vitrine", "/dev/api-paiements"] as [string, string],
      bloquee: false,
      depuis: Date.now() - 5000,
      statut: "ouverte" as const,
      toujours: false,
    };
    etat<SuperviseurState>(useSuperviseurStore, {
      panneauOuvert: true,
      demandes: [
        { ...base, id: "d1", titre: "Transmettre la question à api-paiements" },
        { ...base, id: "d2", titre: "Écrire dans notes", outil: "terminal.ecrire", de: null, paire: null, cible: { wsId: "c", tabId: "c:t" } },
      ],
    });
    const html = renderToStaticMarkup(<PanneauSuperviseur />);
    expect(html).toContain('aria-label="Transmettre la question à api-paiements, à valider"');
    expect(html).toContain("à valider");
    expect(html).toContain("de site-vitrine");
    expect(html).toContain("Texte exact");
    expect(html).toContain("Quel format ?");
    expect(html).toContain("Sera envoyé : ce texte, puis");
    expect(html).toContain("→ api-paiements › claude");
    expect(html).toContain('role="checkbox" aria-checked="false"');
    expect(html).toContain("Toujours autoriser les échanges entre site-vitrine et api-paiements");
    expect(html).toContain("Ctrl+Entrée");
    expect(html).toContain("Aller voir");
    expect(html).toContain("1 sur 2");
    expect(html).toContain("Ensuite");
    expect(html).toContain('aria-label="Afficher : Écrire dans notes"');
  });

  it("cartes sous le niveau Agir : bandeau « Passer en Agir », pas de carte", () => {
    etat<SuperviseurState>(useSuperviseurStore, {
      panneauOuvert: true,
      demandes: [
        {
          id: "d1",
          appelId: 1,
          outil: "terminal.ecrire",
          cible: { wsId: "a", tabId: "a:t" },
          de: null,
          echangeId: null,
          titre: "Écrire dans api-paiements",
          texte: "1",
          entree: true,
          pourquoi: "",
          paire: null,
          bloquee: true,
          depuis: 0,
          statut: "ouverte",
          toujours: false,
        },
      ],
    });
    const html = renderToStaticMarkup(<PanneauSuperviseur />);
    expect(html).toContain("Une écriture dans une session est prête ; elle demande le niveau Agir.");
    expect(html).toContain("Passer en Agir");
    expect(html).not.toContain("Ctrl+Entrée");
  });

  it("désactivé : ce que l'activer implique, et le bouton pour l'activer", () => {
    superviseur({ actif: false });
    etat<SuperviseurState>(useSuperviseurStore, { panneauOuvert: true });
    const html = renderToStaticMarkup(<PanneauSuperviseur />);
    expect(html).toContain("désactivé · rien ne tourne");
    expect(html).toContain("consomme des jetons");
    expect(html).toContain("Activer Vigie");
    expect(html).not.toContain('role="log"');
  });
});

describe("BulleSuperviseur", () => {
  it("au rendu initial : seulement la région d'annonce (elle paraît après un délai)", () => {
    etat(useWorkspaceStore, { workspaces: [espace("a", "api-paiements", { unread: true })] });
    const html = renderToStaticMarkup(<BulleSuperviseur />);
    expect(html).toContain('role="status"');
    expect(html).not.toContain("sup-bulle-carte");
  });

  it("carte : titre signé, lignes cliquables, note, Ouvrir", () => {
    const html = renderToStaticMarkup(
      <CarteBulle
        place={{ left: 388, bottom: 102, pointe: 34, largeur: 300 }}
        sortant={false}
        nom="Vigie"
        titre="2 agents vous attendent"
        note="dont 1 écriture à valider"
        noteAccent
        lignes={[{ info: { id: "a", nom: "api-paiements", mono: "ap", couleur: "#f78fc6", cwd: "/", raccourci: "Ctrl 1", activeTabId: null }, raison: "autorisation : utiliser Bash" }]}
        fermer={() => {}}
        aller={() => {}}
      />,
    );
    expect(html).toContain("Vigie :</span> 2 agents vous attendent");
    expect(html).toContain('aria-label="Aller à api-paiements : autorisation : utiliser Bash"');
    expect(html).toContain('data-accent="true"');
    expect(html).toContain("Ouvrir");
    expect(html).toContain('aria-label="Fermer la notification"');
    expect(html).toContain("left:28px");
  });

  it("placement : alignée sur la marque, pointe sous le viseur, gardée dans la fenêtre", () => {
    expect(placerSurMarque({ left: 400, top: 820, width: 44 }, 300, { largeur: 1440, hauteur: 900 })).toEqual({
      left: 388,
      bottom: 102,
      pointe: 34,
      largeur: 300,
    });
    const etroit = placerSurMarque({ left: 5, top: 600, width: 44 }, 300, { largeur: 280, hauteur: 680 });
    expect(etroit.largeur).toBe(256);
    expect(etroit.left).toBe(12);
  });
});
