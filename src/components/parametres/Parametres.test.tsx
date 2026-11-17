// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

vi.mock("../../lib/reglagesApi", () => ({
  reglagesApi: {
    lire: vi.fn(),
    ecrire: vi.fn(async (r: unknown) => r),
    infos: vi.fn(),
    hooksEtat: vi.fn(),
    hooksInstaller: vi.fn(),
  },
}));
vi.mock("../../lib/activityApi", () => ({
  activityApi: {
    getSettings: vi.fn(),
    setSettings: vi.fn(async () => {}),
    status: vi.fn(),
    collectNow: vi.fn(),
  },
}));
vi.mock("@tauri-apps/plugin-opener", () => ({ revealItemInDir: vi.fn(async () => {}) }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn(async () => "/home/moi") }));
vi.mock("../../lib/pty", () => ({ closePty: vi.fn(), ptyCwd: vi.fn(() => Promise.resolve(null)) }));

import { Parametres } from "./Parametres";
import { reglagesApi } from "../../lib/reglagesApi";
import { activityApi, type ActivitySettings } from "../../lib/activityApi";
import { useUiStore } from "../../store/ui";
import { useReglagesStore } from "../../store/reglages";
import { useWorkspaceStore } from "../../store/workspace";
import { DELAI_ECRITURE_ACTIVITE_MS } from "./useReglagesActivite";

const ACTIVITE: ActivitySettings = {
  clickup: { source: "claude_mcp", token: "", listes: [] },
  schedule: { hour: 7, minute: 0, weekdaysOnly: true },
  shell: { integration: true, ignoredCommands: ["ls", "cd"] },
  git: { authorEmail: null },
  ticketPatterns: ["T-\\d+"],
  saisie: { journeeMinutes: 450, vendrediMinutes: 420, usReunion: "" },
};

/** Laisse passer les promesses en attente (lectures simulées du backend). */
const vider = () => act(async () => {});

describe("Parametres (rendu client)", () => {
  let hote: HTMLDivElement;
  let racine: Root;

  beforeEach(async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    Element.prototype.scrollIntoView ??= function () {};
    vi.clearAllMocks();
    vi.mocked(reglagesApi.hooksEtat).mockResolvedValue({
      scriptAJour: false,
      cheminScript: "/home/moi/.claude/hooks/terminials-notify.sh",
      evenementsDeclares: [],
      installes: false,
    });
    vi.mocked(reglagesApi.hooksInstaller).mockResolvedValue({
      scriptAJour: true,
      cheminScript: "/home/moi/.claude/hooks/terminials-notify.sh",
      evenementsDeclares: ["Stop"],
      installes: true,
    });
    vi.mocked(activityApi.getSettings).mockResolvedValue(structuredClone(ACTIVITE));
    vi.mocked(activityApi.status).mockResolvedValue({ lastCollect: {}, errors: [], shellIntegration: true });
    useReglagesStore.getState().reset();
    useReglagesStore.setState({
      infos: {
        version: "1.2.3",
        fichierReglages: "/home/moi/.config/terminials/settings.json",
        dossierConfig: "/home/moi/.config/terminials",
        shellSession: "/usr/bin/zsh",
        shellsDisponibles: ["/bin/bash", "/usr/bin/zsh", "/usr/bin/fish"],
      },
    });
    useUiStore.getState().reset();
    useWorkspaceStore.setState({ workspaces: [], activeId: null });
    useUiStore.getState().ouvrirParametres("apparence");
    hote = document.createElement("div");
    document.body.appendChild(hote);
    racine = createRoot(hote);
    act(() => racine.render(<Parametres />));
    await vider();
  });

  afterEach(() => {
    act(() => racine.unmount());
    hote.remove();
    useReglagesStore.getState().reset();
  });

  const $ = <T extends Element = HTMLElement>(sel: string) => hote.querySelector<T>(sel);
  const bouton = (texte: string) =>
    [...hote.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent?.trim().startsWith(texte));
  const saisir = (el: HTMLInputElement, valeur: string) => {
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
    act(() => {
      setter.call(el, valeur);
      el.dispatchEvent(new Event("input", { bubbles: true }));
    });
  };

  it("ouvre sur la section demandée, prend le focus, sept sections", () => {
    expect($("h2")?.textContent).toBe("Apparence");
    expect(document.activeElement).toBe($("section.par"));
    expect(hote.querySelectorAll(".par-nav-item")).toHaveLength(7);
    expect($('[aria-current="page"]')?.textContent).toContain("Apparence");
  });

  it("un interrupteur applique le réglage aussitôt et confirme « Enregistré »", () => {
    const inter = $<HTMLButtonElement>('[role="switch"][aria-label="Réduire les animations"]')!;
    expect(inter.getAttribute("aria-checked")).toBe("false");
    act(() => inter.click());
    expect(useReglagesStore.getState().reglages.apparence.reduireAnimations).toBe(true);
    expect(inter.getAttribute("aria-checked")).toBe("true");
    expect($('[data-rangee="reduire"] .par-enregistre')?.textContent).toContain("Enregistré");
    expect($('[role="status"]')?.textContent).toBe("Réduire les animations : enregistré");
  });

  it("segments et pastilles : densité du dock et accent", () => {
    act(() => [...hote.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === "Compacte")!.click());
    expect(useReglagesStore.getState().reglages.apparence.densite).toBe("compacte");
    act(() => $<HTMLButtonElement>('[role="radio"][aria-label="Citron"]')!.click());
    expect(useReglagesStore.getState().reglages.apparence.accent).toBe("#b4f461");
    expect($('[data-rangee="accent"] .par-enregistre')?.textContent).toContain("Citron");
  });

  it("le pas à pas borne la taille de police", () => {
    act(() => useReglagesStore.getState().modifier((r) => ({ ...r, terminal: { ...r.terminal, taillePolice: 20 } })));
    expect($<HTMLButtonElement>('[aria-label="Augmenter la taille"]')!.disabled).toBe(true);
    act(() => $<HTMLButtonElement>('[aria-label="Réduire la taille"]')!.click());
    expect(useReglagesStore.getState().reglages.terminal.taillePolice).toBe(19);
  });

  it("la recherche couvre toutes les sections, compte, et « Ouvrir » y mène en surbrillance", () => {
    saisir($<HTMLInputElement>('[aria-label="Rechercher un réglage"]')!, "police");
    expect($("h2")?.textContent).toBe("Recherche");
    expect($(".par-page-intro")?.textContent).toMatch(/réglages? pour « police »/);
    expect($('[aria-current="page"]')).toBeNull();
    const terminal = [...hote.querySelectorAll(".par-nav-item")].find((b) => b.textContent?.includes("Terminal"))!;
    expect(terminal.querySelector(".par-nav-compte")?.textContent).toBe("1");
    act(() => bouton("Ouvrir Terminal")!.click());
    expect(useUiStore.getState().parametres).toEqual({ section: "terminal", surbrillance: ["police"] });
    expect($("h2")?.textContent).toBe("Terminal");
    expect($('[data-rangee="police"] .par-flash')).not.toBeNull();
  });

  it("aucun résultat : le message de la maquette", () => {
    saisir($<HTMLInputElement>('[aria-label="Rechercher un réglage"]')!, "zzzz");
    expect($(".par-vide")?.textContent).toContain("Aucun réglage pour « zzzz ».");
  });

  it("Échap efface d'abord la recherche, puis ferme la vue", () => {
    const champ = $<HTMLInputElement>('[aria-label="Rechercher un réglage"]')!;
    saisir(champ, "son");
    act(() => champ.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(champ.value).toBe("");
    expect(useUiStore.getState().parametres).not.toBeNull();
    act(() => champ.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));
    expect(useUiStore.getState().parametres).toBeNull();
  });

  it("terminal : shells installés proposés, choix enregistré", () => {
    act(() => useUiStore.getState().ouvrirParametres("terminal"));
    const shells = [...hote.querySelectorAll('[role="radiogroup"][aria-label="Shell par défaut"] [role="radio"]')].map((b) => b.textContent);
    expect(shells).toEqual(["$SHELL · zsh", "bash", "fish"]);
    act(() => [...hote.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === "fish")!.click());
    expect(useReglagesStore.getState().reglages.terminal.shell).toBe("/usr/bin/fish");
  });

  it("agents : installe les hooks et affiche leur état réel", async () => {
    act(() => useUiStore.getState().ouvrirParametres("agents"));
    await vider();
    expect($(".par-hooks-statut")?.textContent).toContain("À installer");
    act(() => bouton("Installer les hooks")!.click());
    await vider();
    expect(reglagesApi.hooksInstaller).toHaveBeenCalledOnce();
    expect($(".par-hooks-statut")?.textContent).toContain("Installés");
    expect($(".par-hooks-sous")?.textContent).toBe("~/.claude/hooks/terminials-notify.sh");
  });

  it("superviseur : activé, ses réglages apparaissent", () => {
    act(() => useUiStore.getState().ouvrirParametres("superviseur"));
    expect($('[data-rangee="supNom"]')).toBeNull();
    act(() => $<HTMLButtonElement>('[role="switch"][aria-label="Superviseur activé"]')!.click());
    expect(useReglagesStore.getState().reglages.superviseur.actif).toBe(true);
    expect($('[data-rangee="supNom"]')).not.toBeNull();
    expect($(".par-paires-vide")).not.toBeNull();
    act(() => [...hote.querySelectorAll<HTMLButtonElement>(".par-niveau")].find((b) => b.textContent?.includes("Agir"))!.click());
    expect(useReglagesStore.getState().reglages.superviseur.niveau).toBe("agir");
  });

  it("activité : les réglages du récap s'enregistrent seuls", async () => {
    act(() => useUiStore.getState().ouvrirParametres("activite"));
    await vider();
    const jours = $<HTMLButtonElement>('[role="switch"][aria-label="Jours ouvrés seulement"]')!;
    act(() => jours.click());
    await act(() => new Promise((r) => setTimeout(r, DELAI_ECRITURE_ACTIVITE_MS + 20)));
    expect(activityApi.setSettings).toHaveBeenCalledOnce();
    expect(vi.mocked(activityApi.setSettings).mock.calls[0][0].schedule.weekdaysOnly).toBe(false);
    // Source par clé : la rangée des listes laisse place à celle de la clé.
    expect($('[data-rangee="listes"]')).not.toBeNull();
    act(() => [...hote.querySelectorAll<HTMLButtonElement>('[role="radio"]')].find((b) => b.textContent === "Clé personnelle")!.click());
    expect($('[data-rangee="listes"]')).toBeNull();
    expect($('[data-rangee="cle"]')).not.toBeNull();
  });

  it("raccourcis : table filtrable, en lecture seule", () => {
    act(() => useUiStore.getState().ouvrirParametres("raccourcis"));
    expect(hote.querySelectorAll(".par-rangee").length).toBeGreaterThan(20);
    saisir($<HTMLInputElement>('[aria-label="Filtrer les raccourcis"]')!, "dock");
    const libelles = [...hote.querySelectorAll(".par-libelle")].map((x) => x.textContent);
    expect(libelles).toEqual(["Masquer ou afficher le dock"]);
    expect(hote.querySelectorAll("input, button[role='switch']").length).toBe(2); // recherche + filtre
  });

  it("à propos : version réelle, chemin abrégé, réinitialisation en deux temps", async () => {
    act(() => useUiStore.getState().ouvrirParametres("apropos"));
    await vider();
    expect($('[data-rangee="version"] .par-info')?.textContent).toBe("1.2.3");
    expect($('[data-rangee="fichier"] .par-info')?.textContent).toBe("~/.config/terminials/settings.json");
    act(() => useReglagesStore.getState().modifier((r) => ({ ...r, apparence: { ...r.apparence, accent: "#ff8a4c" } })));
    act(() => bouton("Réinitialiser…")!.click());
    expect(useReglagesStore.getState().reglages.apparence.accent).toBe("#ff8a4c");
    act(() => bouton("Tout réinitialiser")!.click());
    expect(useReglagesStore.getState().reglages.apparence.accent).toBe("#8f9bff");
  });
});
