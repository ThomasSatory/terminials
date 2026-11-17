// @vitest-environment jsdom
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";

/*
 * Chaîne du superviseur côté front, de bout en bout : événements Tauri `outil-requete`
 * et `superviseur-flux` (simulés : `listen` est remplacé, rien ne part vers un backend)
 * → useOutilsSuperviseur → garde-fou → carte « À valider » → validation → écriture PTY
 * (simulée) → trace au fil → réponse `outil_repondre` au pont. Le seul faux est la
 * frontière : `invoke`, `listen`, `writePty` et la lecture des terminaux.
 *
 * Ce qui est vérifié avant tout : AUCUNE voie n'écrit dans une session sans passer par le
 * garde-fou — appel d'un espace ou de l'extérieur (CLI lancée à la main, autre client du
 * socket), niveau changé pendant qu'une carte attend, pause, superviseur désactivé.
 */

type Rappel = (e: { payload: unknown }) => void;
const ecouteurs = new Map<string, Rappel>();
const appels: { cmd: string; args: Record<string, unknown> }[] = [];

vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async (nom: string, cb: Rappel) => {
    ecouteurs.set(nom, cb);
    return () => ecouteurs.delete(nom);
  }),
}));
vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(async (cmd: string, args: Record<string, unknown> = {}) => {
    appels.push({ cmd, args });
    return cmd === "dir_exists" ? true : undefined;
  }),
}));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn(async () => "/home/u") }));
vi.mock("./pty", () => ({ writePty: vi.fn() }));
vi.mock("./terminalRegistry", () => ({ lireDernieresLignes: vi.fn(() => ["Autoriser npm run migrate ?"]) }));
vi.mock("./shortcutDispatch", () => ({ fermerEspace: vi.fn(() => true) }));

import { writePty } from "./pty";
import { fermerEspace } from "./shortcutDispatch";
import { useOutilsSuperviseur } from "../hooks/useOutilsSuperviseur";
import { autoriserDemande, annulerDemandesOrphelines } from "./executeurSuperviseur";
import { DELAI_ENTREE_MS } from "./outilsSuperviseur";
import { EVENEMENT_FLUX_SUPERVISEUR, EVENEMENT_OUTIL_REQUETE, type Origine, type OutilId, type ReponseOutil } from "./outilsProtocole";
import { useWorkspaceStore, type Workspace } from "../store/workspace";
import { useSuperviseurStore } from "../store/superviseur";
import { useReglagesStore } from "../store/reglages";
import { REGLAGES_DEFAUT, type ReglagesApp } from "./reglages";

const SUP: Origine = { type: "superviseur" };
const ESPACE: Origine = { type: "espace", workspaceId: "e2", ptyId: 12 };
const EXTERNE: Origine = { type: "externe" };

function espace(id: string, name: string): Workspace {
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
  };
}

/** Réglages du superviseur tels que le store les tient (sans écriture disque). */
function regler(sup: Partial<ReglagesApp["superviseur"]>) {
  const r = useReglagesStore.getState().reglages;
  useReglagesStore.setState({ reglages: { ...r, superviseur: { ...r.superviseur, ...sup } } });
}

function Hote() {
  useOutilsSuperviseur();
  return null;
}

let racine: Root;
let conteneur: HTMLDivElement;
let n = 0;

/** Le backend émet `outil-requete` ; on attend la réponse rendue au pont. */
async function appeler(outil: OutilId, args: Record<string, unknown>, origine: Origine = SUP): Promise<ReponseOutil> {
  const id = ++n;
  const ecoute = ecouteurs.get(EVENEMENT_OUTIL_REQUETE);
  if (!ecoute) throw new Error("useOutilsSuperviseur n'écoute pas outil-requete");
  ecoute({ payload: { id, outil, args, origine } });
  let rep: ReponseOutil | undefined;
  await vi.waitFor(() => {
    rep = appels.find((a) => a.cmd === "outil_repondre" && a.args.id === id)?.args.reponse as ReponseOutil | undefined;
    expect(rep).toBeDefined();
  });
  return rep!;
}

const flux = (f: unknown) => act(() => ecouteurs.get(EVENEMENT_FLUX_SUPERVISEUR)!({ payload: f }));
const demande = (r: ReponseOutil) => (r.data as { demande: string }).demande;
const ouvertes = () => useSuperviseurStore.getState().demandes.filter((d) => d.statut === "ouverte");
const outilsAuFil = () => useSuperviseurStore.getState().fil.flatMap((e) => e.parties).filter((p) => p.type === "outil");
const signaux = () => appels.filter((a) => a.cmd === "superviseur_signaler").map((a) => a.args.evenement);

beforeEach(async () => {
  vi.clearAllMocks();
  vi.useRealTimers();
  appels.length = 0;
  useSuperviseurStore.getState().reset();
  useWorkspaceStore.setState({
    workspaces: [espace("e1", "api-paiements"), espace("e2", "site-vitrine")],
    groups: [],
    activeId: "e1",
    tabPtys: { "e1:t": 11, "e2:t": 12 },
    busyPtys: {},
    tabsTermines: {},
  });
  useReglagesStore.setState({
    reglages: { ...REGLAGES_DEFAUT, superviseur: { ...REGLAGES_DEFAUT.superviseur, actif: true, nom: "Vigie", niveau: "agir" } },
  });
  conteneur = document.createElement("div");
  racine = createRoot(conteneur);
  await act(async () => racine.render(<Hote />));
  await vi.waitFor(() => expect(ecouteurs.has(EVENEMENT_OUTIL_REQUETE)).toBe(true));
});

afterEach(() => {
  act(() => racine.unmount());
});

describe("chaîne complète", () => {
  it("tour → écrire → carte → Autoriser → texte EXACT au PTY → trace au fil → réveil", async () => {
    await flux({ type: "tour-debut", nbEvenements: 1 });
    // L'état lu par le moteur pour son invite ne s'inscrit pas au fil.
    expect(await appeler("espaces.etat", { interne: true })).toMatchObject({ ok: true, data: { espaces: expect.any(Array) } });
    expect(outilsAuFil()).toHaveLength(0);
    await flux({ type: "texte", texte: "api-paiements attend un choix." });

    const r = await appeler("terminal.ecrire", { espace: "api", texte: "2", entree: true, pourquoi: "le plan B est validé" });
    expect(r).toEqual({ ok: true, data: { statut: "en_attente", demande: expect.any(String), message: "En attente de la validation de l'utilisateur." } });
    expect(writePty).not.toHaveBeenCalled();
    expect(ouvertes()).toHaveLength(1);
    expect(ouvertes()[0]).toMatchObject({ titre: "Écrire dans api-paiements", texte: "2", pourquoi: "le plan B est validé" });
    expect(outilsAuFil()).toEqual([expect.objectContaining({ outil: "terminal.ecrire", statut: "en_attente" })]);

    vi.useFakeTimers();
    expect(autoriserDemande(demande(r))).toBeNull();
    expect(writePty).toHaveBeenCalledWith(11, "2");
    vi.advanceTimersByTime(DELAI_ENTREE_MS);
    expect(writePty).toHaveBeenLastCalledWith(11, "\r");
    vi.useRealTimers();

    expect(ouvertes()).toHaveLength(0);
    expect(outilsAuFil()[0]).toMatchObject({ statut: "fait", detail: "autorisé par vous" });
    const fil = useSuperviseurStore.getState().fil;
    expect(fil[fil.length - 1].parties[0]).toMatchObject({ texte: "Autorisé par vous." });
    expect(signaux()).toEqual([expect.objectContaining({ genre: "validation" })]);
    // Une validation ne s'autorise qu'une fois.
    expect(autoriserDemande(demande(r))).toBeNull();
    expect(writePty).toHaveBeenCalledTimes(2);

    await flux({ type: "tour-fin", ok: true, coutUsd: 0.01 });
    expect(useSuperviseurStore.getState().moteur.enCours).toBe(false);
  });

  it("question d'un agent → transmise par une paire autorisée → réponse rendue, sans carte", async () => {
    useReglagesStore.getState().autoriserPaire("/dev/site-vitrine", "/dev/api-paiements");
    const q = await appeler("demander", { espace: "api", question: "Quel format de date ?" }, ESPACE);
    expect(q).toMatchObject({ ok: true, data: { statut: "transmise" } });
    const echange = (q.data as { echange: string }).echange;
    expect(signaux()).toEqual([expect.objectContaining({ genre: "question" })]);

    vi.useFakeTimers();
    expect(await appeler("session.demander", { echange, texte: "Quel format de date ?", pourquoi: "relais" })).toMatchObject({
      ok: true,
      data: { statut: "fait" },
    });
    // Le texte écrit dit qui pose la question et par qui elle passe (maquette).
    expect(writePty).toHaveBeenCalledWith(
      11,
      "\x1b[200~Question de site-vitrine, transmise par Vigie :\nQuel format de date ?\nRéponds en quelques lignes, sans modifier de fichier.\x1b[201~",
    );
    expect(await appeler("session.repondre", { echange, texte: "ISO 8601", pourquoi: "réponse" })).toMatchObject({ ok: true });
    expect(writePty).toHaveBeenCalledWith(12, "\x1b[200~Réponse d’api-paiements, transmise par Vigie :\nISO 8601\x1b[201~");
    vi.useRealTimers();
    expect(ouvertes()).toHaveLength(0);
    expect(useSuperviseurStore.getState().echanges[0]).toMatchObject({ etat: "repondu", reponse: "ISO 8601" });
    expect(useReglagesStore.getState().reglages.superviseur.paires[0].echanges).toBe(2);
  });
});

describe("garde-fou incontournable", () => {
  it("depuis un espace ou l'extérieur : aucune écriture, aucune carte, quel que soit le niveau", async () => {
    const echange = useSuperviseurStore.getState().ouvrirEchange({ de: "e2", deTabId: "e2:t", vers: "e1", question: "Q" });
    useReglagesStore.getState().autoriserPaire("/dev/site-vitrine", "/dev/api-paiements");
    for (const origine of [ESPACE, EXTERNE, { type: "espace", workspaceId: "e1" } as Origine]) {
      for (const [outil, args] of [
        ["terminal.ecrire", { espace: "api", texte: "rm -rf ~", pourquoi: "x" }],
        ["session.demander", { echange, texte: "Q", pourquoi: "x" }],
        ["session.repondre", { echange, texte: "R", pourquoi: "x" }],
        ["espace.fermer", { espace: "api" }],
        ["espace.focus", { espace: "api" }],
      ] as const) {
        const r = await appeler(outil, args, origine);
        expect(r, `${outil} depuis ${origine.type}`).toEqual({ ok: false, erreur: "Réservé au superviseur." });
      }
    }
    expect(writePty).not.toHaveBeenCalled();
    expect(fermerEspace).not.toHaveBeenCalled();
    expect(useSuperviseurStore.getState().demandes).toHaveLength(0);
    // Les appels des espaces ne s'inscrivent pas comme des actions du superviseur.
    expect(outilsAuFil()).toHaveLength(0);
  });

  it("niveau baissé pendant qu'une carte attend : Autoriser n'écrit rien tant qu'on n'est pas revenu à Agir", async () => {
    const r = await appeler("terminal.ecrire", { espace: "api", texte: "oui", pourquoi: "p" });
    regler({ niveau: "reorganiser" });
    expect(autoriserDemande(demande(r))).toMatch(/niveau Agir/);
    expect(writePty).not.toHaveBeenCalled();
    expect(ouvertes()).toHaveLength(1);
    // Et toute nouvelle écriture est refusée net.
    expect(await appeler("terminal.ecrire", { espace: "api", texte: "oui", pourquoi: "p" })).toMatchObject({
      ok: false,
      erreur: expect.stringContaining("Niveau Réorganiser"),
    });
    regler({ niveau: "observer" });
    expect(await appeler("espace.renommer", { espace: "api", nom: "x" })).toMatchObject({ ok: false });
    expect(useWorkspaceStore.getState().workspaces[0].name).toBe("api-paiements");

    regler({ niveau: "agir" });
    expect(autoriserDemande(demande(r))).toBeNull();
    expect(writePty).toHaveBeenCalledWith(11, "oui");
    // Entrée part à part, un instant après le texte.
    await vi.waitFor(() => expect(writePty).toHaveBeenLastCalledWith(11, "\r"));
  });

  it("en pause : tout est refusé, même une paire autorisée ; les cartes attendent la reprise", async () => {
    useReglagesStore.getState().autoriserPaire("/dev/site-vitrine", "/dev/api-paiements");
    const echange = useSuperviseurStore.getState().ouvrirEchange({ de: "e2", deTabId: "e2:t", vers: "e1", question: "Q" });
    const r = await appeler("terminal.ecrire", { espace: "api", texte: "oui", pourquoi: "p" });
    regler({ pause: true });
    for (const [outil, args] of [
      ["session.demander", { echange, texte: "Q", pourquoi: "p" }],
      ["terminal.lire", { espace: "api" }],
      ["espaces.etat", {}],
    ] as const) {
      expect(await appeler(outil, args), outil).toMatchObject({ ok: false, erreur: expect.stringMatching(/pause/i) });
    }
    expect(autoriserDemande(demande(r))).toMatch(/pause/i);
    expect(writePty).not.toHaveBeenCalled();
    // Une question d'agent n'est pas transmise non plus (le moteur ne serait pas réveillé).
    expect(await appeler("demander", { question: "?" }, ESPACE)).toMatchObject({ ok: false });
    expect(signaux()).toHaveLength(0);
  });

  it("désactivé : rien n'est exécuté ni réveillé, seule l'observation reste ouverte aux espaces", async () => {
    const r = await appeler("terminal.ecrire", { espace: "api", texte: "oui", pourquoi: "p" });
    regler({ actif: false });
    expect(autoriserDemande(demande(r))).toMatch(/désactivé/);
    for (const [outil, args] of [
      ["terminal.ecrire", { espace: "api", texte: "oui", pourquoi: "p" }],
      ["espace.creer", { dossier: "/tmp" }],
      ["notifier", { texte: "coucou" }],
    ] as const) {
      expect(await appeler(outil, args), outil).toMatchObject({ ok: false, erreur: "Le superviseur est désactivé." });
    }
    expect(await appeler("demander", { question: "?" }, ESPACE)).toMatchObject({ ok: false });
    // Observer depuis un terminal d'espace reste permis (l'agent lit l'état des autres).
    expect(await appeler("espaces.etat", {}, ESPACE)).toMatchObject({ ok: true });
    expect(writePty).not.toHaveBeenCalled();
    expect(signaux()).toHaveLength(0);
    expect(useWorkspaceStore.getState().workspaces).toHaveLength(2);
  });

  it("session bloquée sur une autorisation : carte même pour une paire autorisée", async () => {
    useReglagesStore.getState().autoriserPaire("/dev/site-vitrine", "/dev/api-paiements");
    useSuperviseurStore.getState().bloquerSession("e1:t", "Claude demande l'autorisation d'utiliser Bash");
    const echange = useSuperviseurStore.getState().ouvrirEchange({ de: "e2", deTabId: "e2:t", vers: "e1", question: "Q" });
    const r = await appeler("session.demander", { echange, texte: "1", pourquoi: "p" });
    expect(r).toMatchObject({ ok: true, data: { statut: "en_attente" } });
    expect(writePty).not.toHaveBeenCalled();
    expect(ouvertes()[0]).toMatchObject({ bloquee: true, titre: "Transmettre la question à api-paiements", apercu: ["Autoriser npm run migrate ?"] });
  });

  it("onglet visé fermé : la carte est annulée, Autoriser n'écrit nulle part", async () => {
    const r = await appeler("terminal.ecrire", { espace: "api", texte: "oui", pourquoi: "p" });
    useWorkspaceStore.setState({ workspaces: [espace("e2", "site-vitrine")] });
    annulerDemandesOrphelines();
    expect(ouvertes()).toHaveLength(0);
    expect(autoriserDemande(demande(r))).toBeNull();
    expect(writePty).not.toHaveBeenCalled();
  });

  it("outil inconnu ou arguments absurdes : réponse d'erreur, jamais de silence", async () => {
    expect(await appeler("rm" as OutilId, {})).toMatchObject({ ok: false, erreur: expect.stringContaining("Outil inconnu") });
    expect(await appeler("terminal.ecrire", { espace: 42, texte: ["x"] })).toMatchObject({ ok: false });
    expect(writePty).not.toHaveBeenCalled();
  });
});
