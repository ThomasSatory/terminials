// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/*
 * La reprise réveille le superviseur. Le moteur filtre les signaux sur les réglages qu'il
 * connaît, écrits par le store après un regroupement de 250 ms : la reprise doit donc
 * partir APRÈS l'écriture de « pause: false », sinon il la jette (vu dans l'app : après
 * une pause, plus aucun tour jusqu'à l'événement suivant).
 */

const appels: { cmd: string; args: Record<string, unknown> }[] = [];

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    appels.push({ cmd, args });
    return cmd === "reglages_ecrire" ? args.reglages : undefined;
  }),
}));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn(async () => "/home/u") }));
vi.mock("../lib/pty", () => ({ writePty: vi.fn() }));
vi.mock("../lib/terminalRegistry", () => ({ lireDernieresLignes: vi.fn(() => []) }));

import { useReveilSuperviseur } from "./useReveilSuperviseur";
import { useReglagesStore } from "../store/reglages";
import { useSuperviseurStore } from "../store/superviseur";

function Hote() {
  useReveilSuperviseur();
  return null;
}

let racine: Root;
let conteneur: HTMLDivElement;

function regler(sup: Partial<ReturnType<typeof useReglagesStore.getState>["reglages"]["superviseur"]>) {
  const r = useReglagesStore.getState().reglages;
  useReglagesStore.setState({ reglages: { ...r, superviseur: { ...r.superviseur, ...sup } } });
}

const vider = () => act(async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
});

beforeEach(async () => {
  vi.useFakeTimers();
  appels.length = 0;
  useReglagesStore.getState().reset();
  useSuperviseurStore.getState().reset();
  regler({ actif: true, pause: true, niveau: "agir" });
  conteneur = document.createElement("div");
  racine = createRoot(conteneur);
  await act(async () => racine.render(<Hote />));
});

afterEach(() => {
  act(() => racine.unmount());
  useReglagesStore.getState().reset();
  vi.useRealTimers();
});

describe("useReveilSuperviseur — reprise", () => {
  it("écrit « pause: false » sans attendre le regroupement, PUIS signale la reprise", async () => {
    act(() => useReglagesStore.getState().setPause(false));
    await vider();
    const cmds = appels.map((a) => a.cmd);
    const ecriture = cmds.indexOf("reglages_ecrire");
    const reprise = appels.findIndex(
      (a) => a.cmd === "superviseur_signaler" && (a.args.evenement as { genre: string }).genre === "reprise",
    );
    expect(ecriture).toBeGreaterThanOrEqual(0);
    expect(reprise).toBeGreaterThan(ecriture);
    const ecrits = appels[ecriture].args.reglages as { superviseur: { pause: boolean } };
    expect(ecrits.superviseur.pause).toBe(false);
  });

  it("mettre en pause s'écrit aussi tout de suite (le moteur arrête le tour sans délai)", async () => {
    act(() => useReglagesStore.getState().setPause(false));
    await vider();
    appels.length = 0;
    act(() => useReglagesStore.getState().setPause(true));
    await vider();
    expect(appels.filter((a) => a.cmd === "reglages_ecrire")).toHaveLength(1);
    expect(appels.some((a) => a.cmd === "superviseur_signaler")).toBe(false);
  });

  it("un changement de niveau garde l'écriture regroupée", async () => {
    regler({ pause: false });
    await vider();
    appels.length = 0;
    act(() => useReglagesStore.getState().setNiveau("observer"));
    await vider();
    expect(appels.some((a) => a.cmd === "reglages_ecrire")).toBe(false);
    await act(async () => {
      vi.advanceTimersByTime(300);
    });
    await vider();
    expect(appels.filter((a) => a.cmd === "reglages_ecrire")).toHaveLength(1);
  });
});
