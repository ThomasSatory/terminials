import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

vi.mock("../lib/reglagesApi", () => ({
  reglagesApi: {
    lire: vi.fn(),
    ecrire: vi.fn(),
    infos: vi.fn(),
    hooksEtat: vi.fn(),
    hooksInstaller: vi.fn(),
  },
}));

import { reglagesApi } from "../lib/reglagesApi";
import { DELAI_ECRITURE_MS, useReglagesStore } from "./reglages";
import { REGLAGES_DEFAUT, PAIRE_SUPERVISEUR } from "../lib/reglages";

const st = () => useReglagesStore.getState();

describe("store des réglages", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
    vi.mocked(reglagesApi.ecrire).mockImplementation(async (r) => r);
    vi.mocked(reglagesApi.infos).mockResolvedValue({
      version: "0.1.0",
      fichierReglages: "/c/settings.json",
      dossierConfig: "/c",
      shellSession: "/bin/zsh",
    });
    st().reset();
  });
  afterEach(() => vi.useRealTimers());

  it("part des défauts, superviseur désactivé", () => {
    expect(st().reglages).toEqual(REGLAGES_DEFAUT);
    expect(st().charges).toBe(false);
  });

  it("charger lit et normalise le backend, une seule fois", async () => {
    vi.mocked(reglagesApi.lire).mockResolvedValue({ apparence: { accent: "#B4F461" }, terminal: { taillePolice: 40 } });
    await st().charger();
    await st().charger();
    expect(reglagesApi.lire).toHaveBeenCalledTimes(1);
    expect(st().charges).toBe(true);
    expect(st().reglages.apparence.accent).toBe("#b4f461");
    expect(st().reglages.terminal.taillePolice).toBe(20);
    expect(st().infos?.shellSession).toBe("/bin/zsh");
  });

  it("une lecture en échec garde les défauts et le signale", async () => {
    vi.mocked(reglagesApi.lire).mockRejectedValue(new Error("illisible"));
    await st().charger();
    expect(st().charges).toBe(true);
    expect(st().reglages).toEqual(REGLAGES_DEFAUT);
    expect(st().erreur).toContain("illisible");
  });

  it("modifier applique tout de suite et regroupe les écritures", async () => {
    st().setNomSuperviseur("V");
    st().setNomSuperviseur("Vi");
    st().setNomSuperviseur("Vigie");
    expect(st().reglages.superviseur.nom).toBe("Vigie");
    expect(reglagesApi.ecrire).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(DELAI_ECRITURE_MS);
    expect(reglagesApi.ecrire).toHaveBeenCalledTimes(1);
    expect(vi.mocked(reglagesApi.ecrire).mock.calls[0][0].superviseur.nom).toBe("Vigie");
  });

  it("enregistrerMaintenant écrit sans attendre, et rien s'il n'y a rien", async () => {
    await st().enregistrerMaintenant();
    expect(reglagesApi.ecrire).not.toHaveBeenCalled();
    st().setNiveau("agir");
    await st().enregistrerMaintenant();
    expect(reglagesApi.ecrire).toHaveBeenCalledTimes(1);
  });

  it("une écriture en échec est signalée", async () => {
    vi.mocked(reglagesApi.ecrire).mockRejectedValue("disque plein");
    st().basculerPause();
    await st().enregistrerMaintenant();
    expect(st().erreur).toContain("disque plein");
    expect(st().reglages.superviseur.pause).toBe(true);
  });

  it("modifier normalise", () => {
    st().modifier((r) => ({ ...r, terminal: { ...r.terminal, taillePolice: 2 } }));
    expect(st().reglages.terminal.taillePolice).toBe(10);
  });

  it("paires : autoriser, compter, révoquer", () => {
    st().autoriserPaire("/site", "/api");
    st().autoriserPaire("/api", PAIRE_SUPERVISEUR);
    st().compterEchange("/api", "/site");
    const paires = st().reglages.superviseur.paires;
    expect(paires).toHaveLength(2);
    expect(paires[0].echanges).toBe(1);
    st().revoquerPaire("/api", "/site");
    expect(st().reglages.superviseur.paires.map((p) => p.b)).toEqual([PAIRE_SUPERVISEUR]);
  });

  it("réinitialiser garde les paires", () => {
    st().autoriserPaire("/a", "/b");
    st().setSuperviseurActif(true);
    st().modifier((r) => ({ ...r, apparence: { ...r.apparence, densite: "ample" } }));
    st().reinitialiser();
    expect(st().reglages.apparence.densite).toBe("normale");
    expect(st().reglages.superviseur.actif).toBe(false);
    expect(st().reglages.superviseur.paires).toHaveLength(1);
  });
});
