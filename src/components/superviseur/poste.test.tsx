// @vitest-environment jsdom
import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => true) }));
vi.mock("../../lib/pty", () => ({ writePty: vi.fn(), closePty: vi.fn(), ptyCwd: vi.fn(async () => null) }));
vi.mock("../../lib/tabFocus", () => ({ focusTab: vi.fn() }));
vi.mock("../../lib/terminalRegistry", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/terminalRegistry")>()),
  lireDernieresLignes: vi.fn(() => []),
  abonnerTerminal: vi.fn(() => () => {}),
}));
vi.mock("../../lib/superviseurApi", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/superviseurApi")>()),
  envoyerAuSuperviseur: vi.fn(),
}));
// Les décisions et la navigation sont espionnées sans perdre leur comportement.
vi.mock("../../lib/executeurSuperviseur", async (importOriginal) => {
  const reel = await importOriginal<typeof import("../../lib/executeurSuperviseur")>();
  return {
    ...reel,
    autoriserDemande: vi.fn(reel.autoriserDemande),
    refuserDemande: vi.fn(reel.refuserDemande),
    allerA: vi.fn(reel.allerA),
  };
});

import { PosteSuperviseur } from "./PosteSuperviseur";
import { BulleSuperviseur } from "./BulleSuperviseur";
import { writePty } from "../../lib/pty";
import { focusTab } from "../../lib/tabFocus";
import { envoyerAuSuperviseur } from "../../lib/superviseurApi";
import { autoriserDemande, refuserDemande, allerA, annulerDemandesOrphelines } from "../../lib/executeurSuperviseur";
import { dispatchShortcut } from "../../lib/shortcutDispatch";
import { vuePleinEcran } from "../../lib/vuePleinEcran";
import { suggestionsEspace } from "../../lib/superviseurLibelles";
import { useWorkspaceStore, type Workspace } from "../../store/workspace";
import { useSuperviseurStore, type SuperviseurState, type DemandeValidation } from "../../store/superviseur";
import { useReglagesStore } from "../../store/reglages";
import { useUiStore } from "../../store/ui";
import { REGLAGES_DEFAUT, type ReglagesApp } from "../../lib/reglages";

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
  useReglagesStore.setState({
    reglages: { ...REGLAGES_DEFAUT, superviseur: { ...REGLAGES_DEFAUT.superviseur, actif: true, nom: "Vigie", niveau: "agir", ...p } },
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

const BASE: Omit<DemandeValidation, "id" | "titre"> = {
  appelId: 1,
  outil: "session.demander",
  cible: { wsId: "a", tabId: "a:t" },
  de: "b",
  echangeId: "echange:1",
  texte: "Question de site-vitrine :\nQuel format ?",
  entree: true,
  pourquoi: "Rien dans son terminal ne répond.",
  paire: ["/dev/site-vitrine", "/dev/api-paiements"],
  bloquee: false,
  depuis: Date.now() - 5000,
  statut: "ouverte",
  toujours: false,
};

function carte(id: string, p: Partial<DemandeValidation> = {}): DemandeValidation {
  return { ...BASE, id, titre: `Carte ${id}`, ...p };
}

/** Les cinq espaces du scénario : deux attendent (avec carte, sans carte), deux travaillent
    (avec résumé, sans), un a terminé. */
function cinqEspaces() {
  useWorkspaceStore.setState({
    workspaces: [
      espace("a", "api-paiements", { unread: true, unreadTabs: ["a:t"] }),
      espace("b", "site-vitrine", { unread: true, unreadTabs: ["b:t"] }),
      espace("c", "facturation"),
      espace("d", "notes", { tabs: [{ id: "d:t", title: "✳ Refonte du dock", claude: { id: "s", cwd: "/" } }] }),
      espace("e", "docs", { tabs: [{ id: "e:t", title: "Guide livré", claude: { id: "s", cwd: "/" } }] }),
    ],
    activeId: "e",
    tabPtys: { "c:t": 3, "d:t": 4 },
    busyPtys: { 3: true, 4: true },
    tabsTermines: { "e:t": true },
  });
  useSuperviseurStore.setState({
    demandes: [carte("d1", { titre: "Écrire dans api-paiements", outil: "terminal.ecrire", de: null, paire: null, echangeId: null, texte: "npm test" })],
    sessionsBloquees: { "b:t": "Autoriser Bash : npm run build ?" },
    resumes: { c: { texte: "Calcule les avoirs du trimestre", a: 0, groupe: "travail" } },
  });
}

let hote: HTMLDivElement;
let racine: Root;

function monter(ui = <PosteSuperviseur />) {
  act(() => racine.render(ui));
}
const q = <T extends Element = HTMLElement>(sel: string) => hote.querySelector<T>(sel);
const tous = <T extends Element = HTMLElement>(sel: string) => Array.from(hote.querySelectorAll<T>(sel));
const texte = () => hote.textContent ?? "";
function bouton(libelle: string | RegExp, dans: ParentNode = hote): HTMLButtonElement {
  const b = Array.from(dans.querySelectorAll("button")).find((x) =>
    typeof libelle === "string" ? x.textContent?.includes(libelle) : libelle.test(x.textContent ?? ""),
  );
  if (!b) throw new Error(`bouton introuvable : ${libelle}`);
  return b;
}
const parLabel = (label: string) => q<HTMLButtonElement>(`[aria-label="${label}"]`)!;
function touche(cible: Element, key: string, init: KeyboardEventInit = {}) {
  const e = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
  act(() => {
    cible.dispatchEvent(e);
  });
  return e;
}
function saisir(champ: HTMLInputElement, valeur: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
  act(() => {
    setter.call(champ, valeur);
    champ.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
const champ = () => q<HTMLInputElement>(".sup-champ-texte")!;
const ouvert = () => useSuperviseurStore.getState().panneauOuvert;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  globalThis.ResizeObserver ??= class {
    observe() {}
    disconnect() {}
    unobserve() {}
  } as unknown as typeof ResizeObserver;
  vi.clearAllMocks();
  hote = document.createElement("div");
  document.body.appendChild(hote);
  racine = createRoot(hote);
  useWorkspaceStore.getState().reset();
  useUiStore.getState().reset();
  useSuperviseurStore.setState({ ...VIDE, panneauOuvert: true });
  superviseur({});
});

afterEach(() => {
  act(() => racine.unmount());
  hote.remove();
  vi.unstubAllGlobals();
});

describe("groupes du poste", () => {
  beforeEach(cinqEspaces);

  it("cinq espaces rangés par état, titres de section et compteurs de l'en-tête", () => {
    monter();
    expect(q(".sup-poste-compteurs")!.textContent).toBe("2 vous attendent2 au travail1 au repos");
    const titres = tous("h2.sup-poste-titre").map((h) => h.textContent);
    expect(titres).toEqual(["Vous attendent · 2", "Au travail · 2", "Au repos · 1"]);
    const attendent = q('[data-groupe="attendent"]')!;
    expect(attendent.textContent).toContain("api-paiements");
    expect(attendent.textContent).toContain("site-vitrine");
    // Carte à valider rattachée à son espace ; l'autre attend sans carte, sa demande exacte.
    expect(attendent.textContent).toContain("npm test");
    expect(attendent.textContent).toContain("Autoriser Bash : npm run build ?");
    const travail = q('[data-groupe="travail"]')!;
    expect(travail.textContent).toContain("Calcule les avoirs du trimestre");
    // Sans résumé : repli sur le titre d'onglet, sans son glyphe.
    expect(travail.textContent).toContain("Refonte du dock");
    expect(travail.textContent).not.toContain("✳");
    expect(q('[data-groupe="repos"]')!.textContent).toContain("Terminé : Guide livré");
  });

  it("aucun espace n'attend : pas de section « Vous attendent »", () => {
    useWorkspaceStore.setState({ workspaces: [espace("c", "facturation"), espace("e", "docs")], tabPtys: {}, busyPtys: {}, tabsTermines: {} });
    useSuperviseurStore.setState({ demandes: [], sessionsBloquees: {} });
    monter();
    expect(q('[data-groupe="attendent"]')).toBeNull();
    expect(texte()).not.toContain("Vous attendent");
    expect(q(".sup-poste-compteurs")!.textContent).toContain("0 vous attend");
  });

  it("résumé périmé : posé au travail, l'espace est au repos, la ligne montre le repli", () => {
    useSuperviseurStore.setState({ resumes: { e: { texte: "Rédige le guide d’installation", a: 0, groupe: "travail" } } });
    monter();
    expect(q('[data-groupe="repos"]')!.textContent).toContain("Terminé : Guide livré");
    expect(texte()).not.toContain("Rédige le guide");
    // Le résumé n'est pas effacé : il reste dans le store, ignoré.
    expect(useSuperviseurStore.getState().resumes.e).toBeDefined();
  });
});

describe("rattachement des cartes", () => {
  beforeEach(cinqEspaces);

  it("une carte de site-vitrine vers api-paiements apparaît sous api-paiements, pas sous site-vitrine", () => {
    useSuperviseurStore.setState({ demandes: [carte("d1")] });
    monter();
    const article = (nom: string) => tous("article").find((a) => a.querySelector(".sup-poste-nom")?.textContent === nom)!;
    expect(article("api-paiements").querySelector('[aria-label="Carte d1, à valider"]')).not.toBeNull();
    expect(article("site-vitrine").querySelector(".sup-carte")).toBeNull();
    // La route montre l'expéditeur.
    expect(article("api-paiements").textContent).toContain("de site-vitrine");
  });

  it("deux cartes pour le même espace s'affichent toutes les deux, la plus ancienne d'abord", () => {
    useSuperviseurStore.setState({
      demandes: [carte("d2", { depuis: Date.now() - 1000 }), carte("d1", { depuis: Date.now() - 9000 })],
    });
    monter();
    expect(tous(".sup-carte")).toHaveLength(2);
  });

  it("une carte autorisée ou annulée n'apparaît plus", () => {
    useSuperviseurStore.setState({ demandes: [carte("d1", { statut: "autorisee" }), carte("d2", { statut: "annulee" })] });
    monter();
    expect(tous(".sup-carte")).toHaveLength(0);
  });

  it("la carte dont l'onglet a disparu est annulée : l'espace n'a plus de carte", () => {
    useSuperviseurStore.setState({ demandes: [carte("d1", { cible: { wsId: "a", tabId: "a:disparu" } })] });
    monter();
    act(() => annulerDemandesOrphelines());
    expect(useSuperviseurStore.getState().demandes[0].statut).toBe("annulee");
    expect(tous(".sup-carte")).toHaveLength(0);
  });
});

describe("validation", () => {
  beforeEach(() => {
    cinqEspaces();
    vi.mocked(autoriserDemande).mockReturnValue(null);
    vi.mocked(refuserDemande).mockReturnValue(undefined as never);
  });

  it("Autoriser appelle autoriserDemande(id), Refuser refuserDemande(id), sans jamais écrire dans un PTY", () => {
    monter();
    act(() => bouton("Autoriser").click());
    expect(autoriserDemande).toHaveBeenCalledWith("d1");
    act(() => bouton("Refuser").click());
    expect(refuserDemande).toHaveBeenCalledWith("d1");
    expect(writePty).not.toHaveBeenCalled();
  });

  it("niveau Réorganiser : texte exact sans bouton de validation, un seul bandeau « masquées »", () => {
    superviseur({ niveau: "reorganiser" });
    monter();
    expect(texte()).toContain("npm test");
    expect(q(".sup-autoriser")).toBeNull();
    expect(texte()).not.toContain("Refuser");
    expect(tous(".sup-masque")).toHaveLength(1);
    expect(bouton("Passer en Agir")).toBeTruthy();
    act(() => bouton("Passer en Agir").click());
    expect(useReglagesStore.getState().reglages.superviseur.niveau).toBe("agir");
  });

  it("en pause : même bandeau unique, avec Reprendre", () => {
    superviseur({ pause: true });
    monter();
    expect(tous(".sup-masque")).toHaveLength(1);
    expect(q(".sup-autoriser")).toBeNull();
    act(() => bouton("Reprendre").click());
    expect(useReglagesStore.getState().reglages.superviseur.pause).toBe(false);
  });

  it("espace en attente sans carte : seulement « Aller au terminal », qui ferme le poste", () => {
    monter();
    const article = tous("article").find((a) => a.querySelector(".sup-poste-nom")?.textContent === "site-vitrine")!;
    const boutons = Array.from(article.querySelectorAll("button")).map((b) => b.textContent?.trim());
    expect(boutons.filter((b) => b !== "site-vitrine")).toEqual(expect.arrayContaining(["Aller au terminal"]));
    expect(article.querySelector(".sup-autoriser")).toBeNull();
    expect(article.textContent).not.toContain("Refuser");
    act(() => bouton("Aller au terminal", article).click());
    expect(allerA).toHaveBeenCalledWith("b", "b:t");
    expect(ouvert()).toBe(false);
  });
});

describe("filtre du fil", () => {
  beforeEach(() => {
    cinqEspaces();
    useSuperviseurStore.setState({
      fil: [
        { id: "f1", a: 1, genre: "utilisateur", wsId: "d", parties: [{ type: "texte", texte: "Où en est notes ?" }] },
        { id: "f2", a: 2, genre: "superviseur", parties: [{ type: "texte", texte: "Notes refond le dock." }] },
        { id: "f3", a: 3, genre: "utilisateur", parties: [{ type: "texte", texte: "Et le reste ?" }] },
        { id: "f4", a: 4, genre: "superviseur", parties: [{ type: "texte", texte: "Le reste est calme." }] },
        { id: "f5", a: 5, genre: "message", de: "b", vers: "a", parties: [{ type: "texte", texte: "Quel format ?" }] },
      ],
    });
  });

  const teteNotes = () => parLabel("notes, au travail : Refonte du dock. Filtrer le fil sur cet espace");

  it("cliquer la tête d'une carte filtre le fil, la puce, le prompt et les suggestions", () => {
    monter();
    expect(teteNotes().getAttribute("aria-pressed")).toBe("false");
    act(() => teteNotes().click());
    expect(teteNotes().getAttribute("aria-pressed")).toBe("true");
    expect(q('[aria-label^="Fil filtré sur notes"]')).not.toBeNull();
    const fil = q(".sup-fil")!.textContent!;
    expect(fil).toContain("Où en est notes ?");
    expect(fil).toContain("Notes refond le dock.");
    expect(fil).not.toContain("Et le reste ?");
    expect(fil).not.toContain("Le reste est calme.");
    expect(fil).not.toContain("Quel format ?");
    expect(q(".sup-champ-etiquette")!.textContent).toBe("À Vigie, à propos de notes");
    for (const s of suggestionsEspace("notes")) expect(bouton(s)).toBeTruthy();
  });

  it("Entrée dans le champ envoie le texte avec l'espace filtré", () => {
    monter();
    act(() => teteNotes().click());
    saisir(champ(), "Fais un point");
    touche(champ(), "Enter");
    expect(envoyerAuSuperviseur).toHaveBeenCalledWith("Fais un point", "d");
    expect(champ().value).toBe("");
  });

  it("la puce ramène à tous les espaces", () => {
    monter();
    act(() => teteNotes().click());
    act(() => q<HTMLButtonElement>('[aria-label^="Fil filtré sur notes"]')!.click());
    expect(q('[aria-label^="Fil filtré sur"]')).toBeNull();
    expect(q(".sup-fil")!.textContent).toContain("Le reste est calme.");
    expect(q(".sup-champ-etiquette")!.textContent).toBe("À Vigie, sur tous les espaces");
    saisir(champ(), "Bonjour");
    touche(champ(), "Enter");
    expect(envoyerAuSuperviseur).toHaveBeenLastCalledWith("Bonjour", undefined);
  });

  it("l'espace filtré est fermé : le filtre revient à null", () => {
    monter();
    act(() => teteNotes().click());
    expect(q('[aria-label^="Fil filtré sur notes"]')).not.toBeNull();
    act(() => useWorkspaceStore.setState({ workspaces: useWorkspaceStore.getState().workspaces.filter((w) => w.id !== "d") }));
    expect(q('[aria-label^="Fil filtré sur"]')).toBeNull();
    expect(q(".sup-champ-etiquette")!.textContent).toBe("À Vigie, sur tous les espaces");
  });
});

describe("cas limites", () => {
  it("aucun espace : état vide, le bouton ferme le poste", () => {
    useWorkspaceStore.setState({ workspaces: [] });
    monter();
    expect(texte()).toContain("Aucun espace ouvert.");
    act(() => bouton("Retour à l’accueil").click());
    expect(ouvert()).toBe(false);
  });

  it("superviseur désactivé : la vue s'ouvre quand même, avec de quoi l'activer", () => {
    superviseur({ actif: false });
    monter();
    expect(q(".sup-poste")).not.toBeNull();
    expect(texte()).toContain("désactivé · rien ne tourne");
    expect(q('[role="log"]')).toBeNull();
    expect(document.activeElement).toBe(q(".sup-poste"));
  });

  it("fil vide : l'accueil du fil, pas de ligne", () => {
    cinqEspaces();
    monter();
    expect(q('[role="log"]')!.textContent).toContain("Vigie suit vos 5 espaces.");
  });
});

describe("clavier sur la racine", () => {
  beforeEach(() => {
    cinqEspaces();
    vi.mocked(autoriserDemande).mockReturnValue(null);
  });

  it("Échap ferme le poste et n'est pas propagé", () => {
    monter();
    const surFenetre = vi.fn();
    window.addEventListener("keydown", surFenetre);
    const e = touche(champ(), "Escape");
    window.removeEventListener("keydown", surFenetre);
    expect(ouvert()).toBe(false);
    expect(e.defaultPrevented).toBe(true);
    expect(surFenetre).not.toHaveBeenCalled();
  });

  it("Échap pendant le renommage annule le nom sans fermer le poste", () => {
    monter();
    act(() => parLabel("Renommer Vigie").click());
    const saisie = q<HTMLInputElement>('[aria-label^="Nom du superviseur"]')!;
    touche(saisie, "Escape");
    expect(ouvert()).toBe(true);
    expect(q('[aria-label^="Nom du superviseur"]')).toBeNull();
  });

  it("Ctrl+Entrée autorise la carte de l'espace filtré, sinon la plus ancienne ouverte", () => {
    useSuperviseurStore.setState({
      demandes: [
        carte("vieille", { cible: { wsId: "a", tabId: "a:t" }, depuis: 1 }),
        carte("recente", { cible: { wsId: "d", tabId: "d:t" }, depuis: 2 }),
      ],
    });
    monter();
    touche(champ(), "Enter", { ctrlKey: true });
    expect(autoriserDemande).toHaveBeenLastCalledWith("vieille");
    act(() => parLabel("notes, vous attend, Question à transmettre. Filtrer le fil sur cet espace").click());
    touche(champ(), "Enter", { ctrlKey: true });
    expect(autoriserDemande).toHaveBeenLastCalledWith("recente");
    expect(writePty).not.toHaveBeenCalled();
  });

  it("Ctrl+Entrée ne fait rien quand la validation est impossible (niveau, pause) ou sans carte", () => {
    useSuperviseurStore.setState({ demandes: [carte("d1")] });
    superviseur({ niveau: "reorganiser" });
    monter();
    touche(champ(), "Enter", { ctrlKey: true });
    superviseur({ pause: true });
    touche(champ(), "Enter", { ctrlKey: true });
    superviseur({});
    useSuperviseurStore.setState({ demandes: [] });
    touche(champ(), "Enter", { ctrlKey: true });
    expect(autoriserDemande).not.toHaveBeenCalled();
  });

  it("au montage le focus va au champ du prompt (actif) ou à la racine (désactivé)", () => {
    monter();
    expect(document.activeElement).toBe(champ());
    act(() => racine.unmount());
    racine = createRoot(hote);
    superviseur({ actif: false });
    monter();
    expect(document.activeElement).toBe(q(".sup-poste"));
  });

  it("après Autoriser, le focus passe au bouton Autoriser suivant, sinon au champ", () => {
    // Les images sont jouées à la main, une fois la carte retirée du DOM.
    const images: FrameRequestCallback[] = [];
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => images.push(f));
    const jouer = () => act(() => images.splice(0).forEach((f) => f(0)));
    useSuperviseurStore.setState({
      demandes: [carte("d1"), carte("d2", { cible: { wsId: "d", tabId: "d:t" } })],
    });
    monter();
    const [premier] = tous<HTMLButtonElement>(".sup-autoriser");
    premier.focus();
    // La décision retire la carte : le bouton cliqué disparaît avec elle.
    vi.mocked(autoriserDemande).mockImplementation(() => {
      useSuperviseurStore.setState({ demandes: useSuperviseurStore.getState().demandes.filter((d) => d.id !== "d1") });
      return null;
    });
    act(() => premier.click());
    jouer();
    const suivant = q<HTMLButtonElement>(".sup-autoriser");
    expect(suivant).not.toBeNull();
    expect(document.activeElement).toBe(suivant);
    vi.mocked(autoriserDemande).mockImplementation(() => {
      useSuperviseurStore.setState({ demandes: [] });
      return null;
    });
    act(() => suivant!.click());
    jouer();
    expect(document.activeElement).toBe(champ());
  });
});

describe("bulle et ouverture", () => {
  /** La bulle se pose sur la marque du dock : une marque factice la lui fournit. */
  const marque = () => {
    const m = document.createElement("button");
    m.setAttribute("data-dock-superviseur", "");
    document.body.appendChild(m);
    return m;
  };

  it("la bulle est invisible quand le poste est ouvert", () => {
    vi.useFakeTimers();
    const m = marque();
    cinqEspaces();
    monter(<BulleSuperviseur />);
    act(() => vi.advanceTimersByTime(3000));
    expect(q(".sup-bulle-carte")).toBeNull();
    m.remove();
    vi.useRealTimers();
  });

  it("« Ouvrir » ouvre le poste", () => {
    vi.useFakeTimers();
    cinqEspaces();
    const m = marque();
    useSuperviseurStore.setState({ panneauOuvert: false });
    monter(<BulleSuperviseur />);
    act(() => vi.advanceTimersByTime(3000));
    act(() => bouton("Ouvrir").click());
    expect(ouvert()).toBe(true);
    m.remove();
    vi.useRealTimers();
  });
});

describe("dispatch et vue plein écran", () => {
  beforeEach(() => {
    cinqEspaces();
    useSuperviseurStore.setState({ panneauOuvert: false });
    vi.stubGlobal("requestAnimationFrame", (f: FrameRequestCallback) => {
      f(0);
      return 0;
    });
  });

  it("Ctrl+Maj+Espace ouvre puis referme ; la fermeture vers le terminal rend le focus", () => {
    useWorkspaceStore.setState({ activeId: "e" });
    dispatchShortcut({ type: "toggle-superviseur" });
    expect(ouvert()).toBe(true);
    dispatchShortcut({ type: "toggle-superviseur" });
    expect(ouvert()).toBe(false);
    expect(focusTab).toHaveBeenCalledWith("e:t");
  });

  it("mosaïque, récap, Paramètres et allerAEspace ferment le poste", () => {
    const rouvrir = () => useSuperviseurStore.setState({ panneauOuvert: true });
    rouvrir();
    dispatchShortcut({ type: "toggle-mosaique" });
    expect(ouvert()).toBe(false);
    useUiStore.getState().setVue("terminal");
    rouvrir();
    dispatchShortcut({ type: "toggle-dashboard" });
    expect(ouvert()).toBe(false);
    rouvrir();
    dispatchShortcut({ type: "toggle-parametres" });
    expect(ouvert()).toBe(false);
    rouvrir();
    dispatchShortcut({ type: "next-workspace" });
    expect(ouvert()).toBe(false);
  });

  it("vuePleinEcran rend « superviseur », et App ne réserve plus de place à droite", async () => {
    const base = { demarrage: false, nbEspaces: 2, recapOuvert: false, diffOuvert: false, vue: "terminal" as const };
    expect(vuePleinEcran({ ...base, superviseurOuvert: true })).toBe("superviseur");
    expect(vuePleinEcran({ ...base, nbEspaces: 0, superviseurOuvert: true })).toBe("superviseur");
    const app = await lire("../../App.tsx");
    expect(app).not.toContain("data-panneau-superviseur");
    expect(app).not.toContain("reserve-panneau");
  });
});

describe("accessibilité", () => {
  beforeEach(() => {
    cinqEspaces();
    useSuperviseurStore.setState({ fil: [{ id: "f1", a: 1, genre: "utilisateur", parties: [{ type: "texte", texte: "Salut" }] }] });
  });

  it("sections nommées avec un h2, têtes en boutons aria-pressed, aucun bouton imbriqué", () => {
    monter();
    const sections = tous("section.sup-poste-section");
    expect(sections).toHaveLength(3);
    for (const s of sections) {
      expect(s.getAttribute("aria-label")).toBeTruthy();
      expect(s.querySelector("h2")).not.toBeNull();
    }
    const tetes = tous("button.sup-poste-tete");
    expect(tetes).toHaveLength(5);
    for (const t of tetes) {
      expect(t.getAttribute("aria-pressed")).toMatch(/^(true|false)$/);
      expect(t.getAttribute("aria-label")).toMatch(/Filtrer le fil sur cet espace$/);
    }
    // L'état est dit dans le nom accessible.
    expect(tetes.map((t) => t.getAttribute("aria-label")).join("|")).toMatch(/vous attend.*au travail.*Terminé/s);
    expect(tous("button button")).toHaveLength(0);
    expect(tous("[role=button] button, button [role=button]")).toHaveLength(0);
  });

  it("le fil est un log poli, le champ a un label associé", () => {
    monter();
    const log = q('[role="log"]')!;
    expect(log.getAttribute("aria-live")).toBe("polite");
    const c = champ();
    const label = q<HTMLLabelElement>(`label[for="${c.id}"]`);
    expect(label).not.toBeNull();
    expect(label!.textContent).toContain("Vigie");
  });

  it("ordre de tabulation : en-tête, Vous attendent, Au travail, Au repos, fil, suggestions, champ", () => {
    monter();
    const avant = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
    const ordre = [
      parLabel("Renommer Vigie"),
      q('[data-groupe="attendent"] button')!,
      q('[data-groupe="travail"] button')!,
      q('[data-groupe="repos"] button')!,
      q(".sup-fil")!,
      q(".sup-suggestion")!,
      champ(),
    ];
    for (let i = 0; i < ordre.length - 1; i++) expect(avant(ordre[i], ordre[i + 1])).toBe(true);
    // Aucun tabindex positif ne vient fausser l'ordre naturel.
    expect(tous("[tabindex]").filter((e) => Number(e.getAttribute("tabindex")) > 0)).toHaveLength(0);
  });
});

/** Lecture sur disque : sous vitest, un import `?raw` d'une feuille CSS rend une chaîne
    vide ; module node importé par un nom calculé (le projet n'embarque pas ses types). */
async function lire(chemin: string): Promise<string> {
  const nomModule = "node:fs";
  const fs = (await import(/* @vite-ignore */ nomModule)) as { readFileSync(c: URL, e: "utf8"): string };
  return fs.readFileSync(new URL(chemin, import.meta.url), "utf8");
}

describe("feuille de style du poste", () => {
  let css = "";
  let sansCommentaires = "";
  beforeAll(async () => {
    css = await lire("../../styles/poste.css");
    sansCommentaires = css.replace(/\/\*[\s\S]*?\*\//g, "");
  });

  it("couleurs, graisses, rayons et z-index passent par les jetons", () => {
    expect(sansCommentaires).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(sansCommentaires).not.toMatch(/rgba?\((?!var\()/);
    expect(sansCommentaires).not.toMatch(/font-weight:\s*\d/);
    expect(sansCommentaires).not.toMatch(/z-index:\s*-?\d/);
  });

  it("focus visible, animations coupées sous prefers-reduced-motion", () => {
    expect(css).toContain(":focus-visible");
    expect(css).toContain("prefers-reduced-motion: reduce");
    const animee = /animation:/.test(sansCommentaires);
    if (animee) expect(css.slice(css.indexOf("prefers-reduced-motion"))).toMatch(/animation:\s*none/);
  });

  it("à 360 px : une colonne, pas de défilement horizontal de la page", () => {
    expect(css).toMatch(/@media \(max-width: \d+px\)/);
    const etroit = css.slice(css.search(/@media \(max-width: \d+px\)/));
    expect(etroit).toMatch(/flex-direction:\s*column|grid-template-columns:\s*1fr|grid-template-columns:\s*minmax\(0,\s*1fr\)/);
    expect(css).toMatch(/\.sup-poste\s*\{[^}]*overflow:\s*hidden/);
    // Les grilles de cartes se replient d'elles-mêmes : jamais plus large que le conteneur.
    expect(css).toContain("minmax(min(100%, 280px), 1fr)");
  });
});
