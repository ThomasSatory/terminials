import { describe, it, expect, beforeEach, vi } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));

import { invoke } from "@tauri-apps/api/core";
import { envoyerAuSuperviseur, estQuestionEtatAgents } from "./superviseurApi";
import { useSuperviseurStore } from "../store/superviseur";
import { useReglagesStore } from "../store/reglages";
import { useWorkspaceStore, type Workspace } from "../store/workspace";
import { REGLAGES_DEFAUT } from "./reglages";

const espace = (id: string, name: string, p: Partial<Workspace> = {}): Workspace => ({
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
  ...p,
});

function reglages(pause: boolean) {
  useReglagesStore.setState({
    reglages: { ...REGLAGES_DEFAUT, superviseur: { ...REGLAGES_DEFAUT.superviseur, actif: true, pause } },
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  useSuperviseurStore.getState().reset();
  useWorkspaceStore.setState({
    workspaces: [espace("e1", "api", { unread: true, lastNotification: { title: "", body: "Quelle base ?" } }), espace("e2", "notes")],
    groups: [],
    activeId: "e2",
    tabPtys: {},
    busyPtys: {},
    tabsTermines: {},
  });
  reglages(false);
});

describe("envoyerAuSuperviseur", () => {
  it("message : entre au fil (❯) et réveille le moteur", () => {
    envoyerAuSuperviseur("  Range les espaces par groupe ");
    expect(useSuperviseurStore.getState().fil).toMatchObject([
      { genre: "utilisateur", parties: [{ type: "texte", texte: "Range les espaces par groupe" }] },
    ]);
    expect(invoke).toHaveBeenCalledWith("superviseur_signaler", { evenement: { genre: "message", texte: "Range les espaces par groupe" } });
  });

  it("en pause : réponse immédiate avec « Reprendre », aucun réveil", () => {
    reglages(true);
    envoyerAuSuperviseur("Que fait api ?");
    const fil = useSuperviseurStore.getState().fil;
    expect(fil[1].parties[1]).toEqual({ type: "action", libelle: "Reprendre", action: { type: "reprendre" } });
    expect(invoke).not.toHaveBeenCalled();
  });

  it("« Où en sont mes agents ? » : tableau de l'état réel aussitôt, puis réveil", () => {
    envoyerAuSuperviseur("Où en sont mes agents ?");
    const fil = useSuperviseurStore.getState().fil;
    expect(fil[1].parties[0]).toEqual({
      type: "etats",
      lignes: [
        { wsId: "e1", etat: "attente", phrase: "Quelle base ?" },
        { wsId: "e2", etat: "repos", phrase: "hors dépôt" },
      ],
    });
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("vide : rien", () => {
    envoyerAuSuperviseur("   ");
    expect(useSuperviseurStore.getState().fil).toEqual([]);
  });

  it("reconnaît la question toute faite", () => {
    expect(estQuestionEtatAgents("où en sont mes agents")).toBe(true);
    expect(estQuestionEtatAgents("Ou en sont mes agents ?")).toBe(true);
    expect(estQuestionEtatAgents("Où en sont mes agents sur la branche ?")).toBe(false);
  });

  it("à propos d'un espace : le wsId suit le message au fil et au moteur", () => {
    envoyerAuSuperviseur("Où en est api ?", "e1");
    expect(useSuperviseurStore.getState().fil[0]).toMatchObject({ genre: "utilisateur", wsId: "e1" });
    expect(invoke).toHaveBeenCalledWith("superviseur_signaler", {
      evenement: { genre: "message", texte: "Où en est api ?", wsId: "e1" },
    });
  });

  it("sans espace : aucune clé wsId, ni au fil ni au moteur", () => {
    envoyerAuSuperviseur("Bonjour", null);
    expect("wsId" in useSuperviseurStore.getState().fil[0]).toBe(false);
    const evt = (invoke as unknown as { mock: { calls: [string, { evenement: object }][] } }).mock.calls[0][1].evenement;
    expect("wsId" in evt).toBe(false);
  });

  it("en pause avec un espace : la réponse porte aussi le wsId", () => {
    reglages(true);
    envoyerAuSuperviseur("Que fait api ?", "e1");
    const fil = useSuperviseurStore.getState().fil;
    expect(fil[0].wsId).toBe("e1");
    expect(fil[1].wsId).toBe("e1");
    expect(invoke).not.toHaveBeenCalled();
  });

  it("« Où en sont mes agents ? » à propos d'un espace : pas de tableau global", () => {
    envoyerAuSuperviseur("Où en sont mes agents ?", "e1");
    expect(useSuperviseurStore.getState().fil).toHaveLength(1);
  });
});
