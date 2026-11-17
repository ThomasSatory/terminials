import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => true) }));

import { MarqueSuperviseur } from "./MarqueSuperviseur";
import { PosteSuperviseur } from "./PosteSuperviseur";
import { CarteValidation } from "./CarteValidation";
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
  echanges: [],
  sessionsBloquees: {},
  resumes: {},
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
  it("désactivé : la marque reste, estompée, et invite à l'activer", () => {
    superviseur({ actif: false });
    const html = renderToStaticMarkup(<MarqueSuperviseur />);
    expect(html).toContain('data-inactif="true"');
    expect(html).toContain('data-mode="pause"');
    expect(html).toContain("désactivé · cliquer pour l’activer");
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

const BASE_DEMANDE = {
  appelId: 1,
  outil: "session.demander" as const,
  cible: { wsId: "a", tabId: "a:t" },
  de: "b" as string | null,
  echangeId: "echange:1" as string | null,
  texte: "Question de site-vitrine :\nQuel format ?",
  entree: true,
  pourquoi: "Rien dans son terminal ne répond à la question.",
  paire: ["/dev/site-vitrine", "/dev/api-paiements"] as [string, string] | null,
  bloquee: false,
  depuis: Date.now() - 5000,
  statut: "ouverte" as const,
  toujours: false,
};

function infoEspaces() {
  return new Map([
    ["a", { id: "a", nom: "api-paiements", mono: "ap", couleur: "#f78fc6", cwd: "/dev/api-paiements", raccourci: "Ctrl 1", activeTabId: "a:t" }],
    ["b", { id: "b", nom: "site-vitrine", mono: "sv", couleur: "#7ee787", cwd: "/dev/site-vitrine", raccourci: "Ctrl 2", activeTabId: "b:t" }],
  ]);
}

describe("PosteSuperviseur", () => {
  it("premier lancement : en-tête, compteurs, autonomie, espaces au repos, fil vide soigné, prompt", () => {
    const html = renderToStaticMarkup(<PosteSuperviseur />);
    expect(html).toContain('aria-label="Vigie, poste de suivi"');
    expect(html).toContain('aria-label="Renommer Vigie"');
    expect(html).toContain("veille sur 3 espaces");
    expect(html).toContain("0 vous attend");
    expect(html).toContain("0 au travail");
    expect(html).toContain("3 au repos");
    expect(html).toContain('role="radiogroup"');
    expect(html).toMatch(/role="radio" aria-checked="true"[^>]*>.*Observer/);
    expect(html).toContain("Vigie regarde et vous prévient.");
    expect(html).toContain('role="switch" aria-checked="false"');
    expect(html).toContain('aria-label="Fermer le poste de suivi (Échap)"');
    // Rien n'attend : pas de section « Vous attendent » ; personne ne travaille.
    expect(html).not.toContain("Espaces qui vous attendent");
    expect(html).toContain("Au travail · 0");
    expect(html).toContain("Personne ne travaille.");
    expect(html).toContain("Au repos · 3");
    expect(html).toContain('aria-label="api-paiements, Au repos. Filtrer le fil sur cet espace"');
    expect(html).toContain('aria-label="Aller au terminal de notes"');
    // Fil et prompt.
    expect(html).toContain('role="log"');
    expect(html).toContain("Vigie suit vos 3 espaces.");
    expect(html).toContain("terminials demander");
    expect(html).toContain("À Vigie, sur tous les espaces");
    expect(html).toContain('placeholder="Demandez où en sont vos agents, ou donnez une consigne…"');
    expect(html).toContain("Où en sont mes agents ?");
    expect(html).toContain("tous les espaces");
    expect(html).toContain('aria-label="Échanges toujours autorisés (0)"');
    expect(html).toContain('aria-label="Parler à Vigie"');
  });

  it("aucun espace : état vide et retour à l'accueil", () => {
    etat(useWorkspaceStore, { workspaces: [] });
    const html = renderToStaticMarkup(<PosteSuperviseur />);
    expect(html).toContain("Aucun espace ouvert.");
    expect(html).toContain("Retour à l’accueil");
  });

  it("au travail : résumé du superviseur s'il est à jour, sinon le titre de l'onglet", () => {
    etat(useWorkspaceStore, {
      workspaces: [
        espace("a", "api-paiements", { tabs: [{ id: "a:t", title: "✳ Refonte du dock", claude: { id: "s", cwd: "/" } }], nbModifies: 3 }),
        espace("b", "site-vitrine"),
      ],
      tabPtys: { "a:t": 7 },
      busyPtys: { 7: true },
    });
    let html = renderToStaticMarkup(<PosteSuperviseur />);
    expect(html).toContain("1 au travail");
    expect(html).toContain("Au travail · 1");
    expect(html).toContain("Refonte du dock");
    expect(html).toContain("± </span> 3 fichiers".replace("± </span>", "±</span>"));
    expect(html).toContain("Aller au terminal");
    // Le résumé posé par le superviseur remplace le repli ; périmé (autre groupe), il est ignoré.
    etat<SuperviseurState>(useSuperviseurStore, { resumes: { a: { texte: "Migre les routes vers le nouveau dock", a: 0, groupe: "travail" } } });
    html = renderToStaticMarkup(<PosteSuperviseur />);
    expect(html).toContain("Migre les routes vers le nouveau dock");
    etat<SuperviseurState>(useSuperviseurStore, { resumes: { a: { texte: "Migre les routes vers le nouveau dock", a: 0, groupe: "repos" } } });
    html = renderToStaticMarkup(<PosteSuperviseur />);
    expect(html).not.toContain("Migre les routes");
  });

  it("fil : message routé, ligne d'outil, tableau des agents cliquable, action", () => {
    etat<SuperviseurState>(useSuperviseurStore, {
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
    const html = renderToStaticMarkup(<PosteSuperviseur />);
    expect(html).toContain("❯");
    expect(html).toContain("« Quel format ? »");
    expect(html).toContain('aria-label="Aller à site-vitrine"');
    expect(html).toContain("espaces.état");
    expect(html).toContain('data-statut="en_cours"');
    expect(html).toContain("sup-spin");
    expect(html).toContain('aria-label="Aller à api-paiements, vous attend : autorisation : utiliser Bash"');
    expect(html).toContain("Y aller");
    expect(html).toContain("Ctrl 1");
  });

  it("niveau Agir : les cartes « À valider » se rangent sur l'espace écrit, avec leurs boutons", () => {
    superviseur({ niveau: "agir" });
    etat(useWorkspaceStore, {
      workspaces: [espace("a", "api-paiements", { unread: true }), espace("b", "site-vitrine"), espace("c", "notes")],
    });
    etat<SuperviseurState>(useSuperviseurStore, {
      demandes: [
        { ...BASE_DEMANDE, id: "d1", titre: "Transmettre la question à api-paiements" },
        { ...BASE_DEMANDE, id: "d2", titre: "Répondre à api-paiements", outil: "session.repondre", depuis: Date.now() - 1000 },
      ],
    });
    const html = renderToStaticMarkup(<PosteSuperviseur />);
    expect(html).toContain('aria-label="Espaces qui vous attendent"');
    expect(html).toContain("Vous attendent · 1");
    expect(html).toContain('aria-label="api-paiements, vous attend, Question à transmettre. Filtrer le fil sur cet espace"');
    // Les deux cartes de l'espace écrit, pas de pile ni de « Ensuite ».
    expect(html).toContain('aria-label="Transmettre la question à api-paiements, à valider"');
    expect(html).toContain('aria-label="Répondre à api-paiements, à valider"');
    expect(html).not.toContain("Ensuite");
    expect(html).toContain("Quel format ?");
    expect(html).toContain("Avis de Vigie");
    expect(html).toContain("Ctrl+Entrée");
    expect(html).not.toContain("sup-masque ");
    // L'espace expéditeur ne forme pas de carte d'attente.
    expect(html).not.toContain("site-vitrine, vous attend");
  });

  it("sous le niveau Agir : texte exact et « Aller au terminal » seuls, un bandeau unique", () => {
    etat(useWorkspaceStore, {
      workspaces: [espace("a", "api-paiements", { unread: true }), espace("b", "site-vitrine"), espace("c", "notes")],
    });
    etat<SuperviseurState>(useSuperviseurStore, {
      demandes: [{ ...BASE_DEMANDE, id: "d1", titre: "Écrire dans api-paiements", outil: "terminal.ecrire", texte: "1", bloquee: true, de: null, paire: null, echangeId: null }],
    });
    const html = renderToStaticMarkup(<PosteSuperviseur />);
    expect(html).toContain("Une écriture dans une session est prête ; elle demande le niveau Agir.");
    expect(html).toContain("Passer en Agir");
    expect(html).toContain("Aller au terminal");
    expect(html).not.toContain("Autoriser");
    expect(html).not.toContain("Refuser");
    expect(html).not.toContain("Ctrl+Entrée");
  });

  it("espace en attente sans carte : sa demande exacte et le seul « Aller au terminal »", () => {
    superviseur({ niveau: "agir" });
    etat(useWorkspaceStore, {
      workspaces: [espace("a", "api-paiements", { unread: true, unreadTabs: ["a:t"] }), espace("b", "site-vitrine"), espace("c", "notes")],
    });
    etat<SuperviseurState>(useSuperviseurStore, {
      sessionsBloquees: { "a:t": "Autoriser Bash : npm test ?" },
      resumes: { a: { texte: "Attend l’accord pour lancer les tests", a: 0, groupe: "attendent" } },
    });
    const html = renderToStaticMarkup(<PosteSuperviseur />);
    expect(html).toContain("Vous attendent · 1");
    expect(html).toContain("Autoriser Bash : npm test ?");
    expect(html).toContain("Autorisation");
    expect(html).toContain("Attend l’accord pour lancer les tests");
    expect(html).toContain("Aller au terminal");
    expect(html).not.toContain("sup-autoriser");
    expect(html).not.toContain("Refuser");
  });

  it("désactivé : ce que l'activer implique, et le bouton pour l'activer", () => {
    superviseur({ actif: false });
    const html = renderToStaticMarkup(<PosteSuperviseur />);
    expect(html).toContain("désactivé · rien ne tourne");
    expect(html).toContain("consomme des jetons");
    expect(html).toContain("Activer Vigie");
    expect(html).not.toContain('role="log"');
  });
});

describe("CarteValidation", () => {
  const carte = (p: Partial<React.ComponentProps<typeof CarteValidation>> = {}) =>
    renderToStaticMarkup(
      <CarteValidation
        d={{ ...BASE_DEMANDE, id: "d1", titre: "Transmettre la question à api-paiements" }}
        espaces={infoEspaces()}
        nom="Vigie"
        maintenant={Date.now()}
        masquee={false}
        {...p}
      />,
    );

  it("route, texte exact, avis, case « toujours », Autoriser Ctrl+Entrée, Refuser, Aller au terminal", () => {
    const html = carte();
    expect(html).toContain('aria-label="Transmettre la question à api-paiements, à valider"');
    expect(html).toContain("de site-vitrine");
    expect(html).toContain("Texte exact");
    expect(html).toContain("Quel format ?");
    expect(html).toContain("Sera envoyé : ce texte, puis");
    expect(html).toContain("→ api-paiements › claude");
    expect(html).toContain("Avis de Vigie");
    expect(html).toContain("Rien dans son terminal ne répond à la question.");
    expect(html).toContain('role="checkbox" aria-checked="false"');
    expect(html).toContain("Toujours autoriser les échanges entre site-vitrine et api-paiements");
    expect(html).toContain("sup-autoriser");
    expect(html).toContain("Ctrl+Entrée");
    expect(html).toContain("Refuser");
    expect(html).toContain("Aller au terminal");
    expect(html).not.toContain("sur 2");
  });

  it("masquée : le texte exact reste, ni case ni Autoriser/Refuser", () => {
    const html = carte({ masquee: true });
    expect(html).toContain("Quel format ?");
    expect(html).toContain("Aller au terminal");
    expect(html).not.toContain("sup-autoriser");
    expect(html).not.toContain("Refuser");
    expect(html).not.toContain('role="checkbox"');
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
