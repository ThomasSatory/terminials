import { describe, it, expect, beforeEach, vi } from "vitest";

// Aucun backend : invoke, écriture PTY, registre des terminaux et API du superviseur sont
// simulés. Rien ne part vers un vrai terminal ni vers le moteur.
vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => true) }));
vi.mock("@tauri-apps/api/path", () => ({ homeDir: vi.fn(async () => "/home/u") }));
vi.mock("./pty", () => ({ writePty: vi.fn() }));
vi.mock("./terminalRegistry", () => ({ lireDernieresLignes: vi.fn(() => ["● Bash(npm run migrate)", "  Autoriser cette commande ?"]) }));
vi.mock("./shortcutDispatch", () => ({ fermerEspace: vi.fn(() => true) }));
vi.mock("./superviseurApi", () => ({
  superviseurApi: {
    signaler: vi.fn(async () => {}),
    notifierSysteme: vi.fn(async () => {}),
    repondreOutil: vi.fn(async () => {}),
  },
  envoyerAuSuperviseur: vi.fn(),
}));

import { writePty } from "./pty";
import { superviseurApi } from "./superviseurApi";
import { fermerEspace } from "./shortcutDispatch";
import { useWorkspaceStore, type Workspace } from "../store/workspace";
import { useSuperviseurStore, SUPERVISEUR } from "../store/superviseur";
import { useReglagesStore } from "../store/reglages";
import { REGLAGES_DEFAUT, type ReglagesApp } from "./reglages";
import type { Origine, OutilId, RequeteOutil } from "./outilsProtocole";
import { autoriserDemande, executer, refuserDemande, traiterRequete } from "./executeurSuperviseur";

const SUP: Origine = { type: "superviseur" };

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

function reglages(sup: Partial<ReglagesApp["superviseur"]>) {
  useReglagesStore.setState({ reglages: { ...REGLAGES_DEFAUT, superviseur: { ...REGLAGES_DEFAUT.superviseur, actif: true, nom: "Vigie", ...sup } } });
}

let n = 0;
const req = (outil: OutilId, args: unknown, origine: Origine = SUP): RequeteOutil => ({ id: ++n, outil, args, origine });

beforeEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
  useSuperviseurStore.getState().reset();
  useSuperviseurStore.setState({ moteur: { enCours: true, dernierTour: null, derniereErreur: null } });
  useWorkspaceStore.setState({
    workspaces: [espace("e1", "api-paiements"), espace("e2", "site-vitrine"), espace("e3", "notes")],
    groups: [],
    activeId: "e3",
    tabPtys: { "e1:t": 11, "e2:t": 12, "e3:t": 13 },
    busyPtys: {},
    tabsTermines: {},
  });
  reglages({ niveau: "agir" });
});

const dernier = <T,>(l: T[]): T => l[l.length - 1];
const outils = () => useSuperviseurStore.getState().fil.flatMap((e) => e.parties).filter((p) => p.type === "outil");

describe("garde-fou appliqué par l'exécuteur", () => {
  it("désactivé : refus, rien d'exécuté, l'appel est inscrit refusé", async () => {
    reglages({ actif: false });
    const r = await executer(req("espace.renommer", { espace: "notes", nom: "x" }));
    expect(r.ok).toBe(false);
    expect(useWorkspaceStore.getState().workspaces[2].name).toBe("notes");
    expect(outils()[0]).toMatchObject({ statut: "refuse" });
  });

  it("niveau Observer : pas de réorganisation", async () => {
    reglages({ niveau: "observer" });
    const r = await executer(req("espace.renommer", { espace: "notes", nom: "x" }));
    expect(r).toMatchObject({ ok: false, erreur: expect.stringContaining("Observer") });
  });

  it("depuis un espace : observer seulement", async () => {
    const r = await executer(req("espace.fermer", { espace: "notes" }, { type: "espace", workspaceId: "e1" }));
    expect(r).toEqual({ ok: false, erreur: "Réservé au superviseur." });
    expect(fermerEspace).not.toHaveBeenCalled();
  });

  it("fermer un espace où un agent attend : refusé", async () => {
    useWorkspaceStore.setState({ workspaces: useWorkspaceStore.getState().workspaces.map((w) => (w.id === "e3" ? { ...w, unread: true } : w)) });
    const r = await executer(req("espace.fermer", { espace: "notes" }));
    expect(r.ok).toBe(false);
    expect(fermerEspace).not.toHaveBeenCalled();
  });
});

describe("observer", () => {
  it("espaces.etat : forme du contrat, ligne d'outil cochée", async () => {
    const r = await executer(req("espaces.etat", {}));
    expect(r.ok).toBe(true);
    expect((r.data as { espaces: { nom: string }[] }).espaces.map((e) => e.nom)).toEqual(["api-paiements", "site-vitrine", "notes"]);
    expect(outils()[0]).toMatchObject({ outil: "espaces.etat", args: "--tous", statut: "fait" });
  });

  it("espaces.etat lu par le moteur hors tour : rien au fil", async () => {
    useSuperviseurStore.setState({ moteur: { enCours: false, dernierTour: null, derniereErreur: null } });
    await executer(req("espaces.etat", {}));
    expect(useSuperviseurStore.getState().fil).toEqual([]);
  });

  it("espaces.etat en réponse à l'utilisateur : tableau des agents, une seule fois", async () => {
    const etats = () => useSuperviseurStore.getState().fil.flatMap((e) => e.parties).filter((p) => p.type === "etats");
    // Coup d'œil du moteur sans question de l'utilisateur : pas de tableau.
    await executer(req("espaces.etat", {}));
    expect(etats()).toHaveLength(0);
    useSuperviseurStore.getState().ajouterEntree({ genre: "utilisateur", parties: [{ type: "texte", texte: "Le point ?" }] });
    await executer(req("espaces.etat", {}));
    await executer(req("espaces.etat", {}));
    expect(etats()).toHaveLength(1);
  });

  it("terminal.lire : lignes du registre, onglet de la session Claude", async () => {
    const r = await executer(req("terminal.lire", { espace: "api" }));
    expect(r).toMatchObject({ ok: true, data: { espace: { id: "e1" }, onglet: { id: "e1:t", titre: "claude" } } });
    expect(outils()[0]).toMatchObject({ args: "api-paiements › claude  --lignes 40" });
  });

  it("désignation introuvable : erreur avec les candidats", async () => {
    const r = await executer(req("terminal.lire", { espace: "infra" }));
    expect(r).toMatchObject({ ok: false, erreur: expect.stringContaining("api-paiements (e1)") });
  });
});

describe("réorganiser", () => {
  it("espace.creer : créé sans voler l'espace actif", async () => {
    const r = await executer(req("espace.creer", { dossier: "~/dev/x", nom: "correctif" }));
    expect(r).toMatchObject({ ok: true, data: { statut: "fait", espace: { nom: "correctif" } } });
    const s = useWorkspaceStore.getState();
    expect(s.activeId).toBe("e3");
    expect(s.workspaces.find((w) => w.name === "correctif")?.cwd).toBe("/home/u/dev/x");
  });

  it("groupe.creer range les espaces nommés", async () => {
    const r = await executer(req("groupe.creer", { nom: "services", espaces: ["api", "site"] }));
    expect(r.ok).toBe(true);
    const gid = (r.data as { groupe: { id: string } }).groupe.id;
    expect(useWorkspaceStore.getState().workspaces.filter((w) => w.groupId === gid).map((w) => w.name)).toEqual([
      "api-paiements",
      "site-vitrine",
    ]);
  });
});

describe("échanges entre sessions", () => {
  it("demander (depuis un espace) ouvre un échange et réveille le superviseur", async () => {
    useWorkspaceStore.setState({ tabPtys: { ...useWorkspaceStore.getState().tabPtys } });
    const r = await executer(req("demander", { espace: "api", question: "Quel format ?" }, { type: "espace", workspaceId: "e2", ptyId: 12 }));
    expect(r).toMatchObject({ ok: true, data: { statut: "transmise", message: "Question confiée à Vigie." } });
    const e = useSuperviseurStore.getState().echanges[0];
    expect(e).toMatchObject({ de: "e2", deTabId: "e2:t", vers: "e1", etat: "ouvert" });
    expect(useSuperviseurStore.getState().fil[0]).toMatchObject({ genre: "message", de: "e2", vers: "e1" });
    expect(superviseurApi.signaler).toHaveBeenCalledWith(expect.objectContaining({ genre: "question" }));
  });

  it("session.demander sans paire : carte « À valider », rien d'écrit", async () => {
    const id = useSuperviseurStore.getState().ouvrirEchange({ de: "e2", deTabId: "e2:t", vers: "e1", question: "Q" });
    const r = await executer(req("session.demander", { echange: id, texte: "Q", pourquoi: "il faut demander" }));
    expect(r).toMatchObject({ ok: true, data: { statut: "en_attente" } });
    expect(writePty).not.toHaveBeenCalled();
    const d = useSuperviseurStore.getState().demandes[0];
    expect(d).toMatchObject({
      titre: "Transmettre la question à api-paiements",
      // Texte exact de la maquette : qui pose la question, par qui elle passe, la consigne.
      texte: "Question de site-vitrine, transmise par Vigie :\nQ\nRéponds en quelques lignes, sans modifier de fichier.",
      brut: "Q",
      paire: ["/dev/site-vitrine", "/dev/api-paiements"],
      statut: "ouverte",
    });
    expect(outils()[0]).toMatchObject({ statut: "en_attente" });
  });

  it("session.demander d'une paire autorisée : écrit tout de suite, compte l'échange", async () => {
    vi.useFakeTimers();
    useReglagesStore.getState().autoriserPaire("/dev/api-paiements", "/dev/site-vitrine");
    const id = useSuperviseurStore.getState().ouvrirEchange({ de: "e2", deTabId: "e2:t", vers: "e1", question: "Q" });
    const r = await executer(req("session.demander", { echange: id, texte: "ligne 1\nligne 2", pourquoi: "p" }));
    expect(r).toEqual({ ok: true, data: { statut: "fait" } });
    expect(writePty).toHaveBeenCalledWith(
      11,
      "\x1b[200~Question de site-vitrine, transmise par Vigie :\nligne 1\nligne 2\nRéponds en quelques lignes, sans modifier de fichier.\x1b[201~",
    );
    vi.advanceTimersByTime(100);
    expect(writePty).toHaveBeenLastCalledWith(11, "\r");
    expect(useSuperviseurStore.getState().echanges[0]).toMatchObject({ etat: "transmis", versTabId: "e1:t" });
    expect(useReglagesStore.getState().reglages.superviseur.paires[0].echanges).toBe(1);
    const entree = dernier(useSuperviseurStore.getState().fil);
    expect(entree.parties[0]).toMatchObject({ ton: "discret", texte: "Sans validation : échanges autorisés entre site-vitrine et api-paiements." });
  });

  it("session bloquée : toujours une carte, même pour une paire autorisée", async () => {
    useReglagesStore.getState().autoriserPaire("/dev/api-paiements", "/dev/site-vitrine");
    useSuperviseurStore.getState().bloquerSession("e1:t", "Claude demande l'autorisation d'utiliser Bash");
    const id = useSuperviseurStore.getState().ouvrirEchange({ de: "e2", deTabId: "e2:t", vers: "e1", question: "Q" });
    const r = await executer(req("session.demander", { echange: id, texte: "Q", pourquoi: "p" }));
    expect(r).toMatchObject({ data: { statut: "en_attente" } });
    expect(useSuperviseurStore.getState().demandes[0]).toMatchObject({ bloquee: true, apercu: expect.any(Array) });
  });

  it("session.repondre au nom du superviseur : « Répondre à … »", async () => {
    const id = useSuperviseurStore.getState().ouvrirEchange({ de: "e3", deTabId: "e3:t", vers: SUPERVISEUR, question: "Q" });
    await executer(req("session.repondre", { echange: id, texte: "main", pourquoi: "je sais" }));
    expect(useSuperviseurStore.getState().demandes[0]).toMatchObject({ titre: "Répondre à notes", de: SUPERVISEUR, paire: ["/dev/notes", "superviseur"] });
  });
});

describe("cartes « À valider »", () => {
  it("Autoriser écrit le texte EXACT puis Entrée, retient la paire si cochée", async () => {
    vi.useFakeTimers();
    const r = await executer(req("terminal.ecrire", { espace: "api", texte: "1", pourquoi: "les tests passent" }));
    const demande = (r.data as { demande: string }).demande;
    expect(useSuperviseurStore.getState().demandes[0].titre).toBe("Écrire dans api-paiements");
    expect(autoriserDemande(demande)).toBeNull();
    expect(writePty).toHaveBeenCalledWith(11, "1");
    vi.advanceTimersByTime(100);
    expect(writePty).toHaveBeenLastCalledWith(11, "\r");
    expect(useSuperviseurStore.getState().demandes[0].statut).toBe("autorisee");
    expect(outils()[0]).toMatchObject({ statut: "fait" });
    expect(superviseurApi.signaler).toHaveBeenCalledWith(expect.objectContaining({ genre: "validation" }));
  });

  it("« Toujours autoriser » ajoute la paire au clic", async () => {
    const id = useSuperviseurStore.getState().ouvrirEchange({ de: "e2", deTabId: "e2:t", vers: "e1", question: "Q" });
    const r = await executer(req("session.demander", { echange: id, texte: "Q", pourquoi: "p" }));
    const demande = (r.data as { demande: string }).demande;
    useSuperviseurStore.getState().basculerToujours(demande);
    autoriserDemande(demande);
    expect(useReglagesStore.getState().reglages.superviseur.paires).toHaveLength(1);
    expect(useSuperviseurStore.getState().echanges[0].etat).toBe("transmis");
  });

  it("Autoriser revérifie le garde-fou : en pause, rien n'est écrit", async () => {
    const r = await executer(req("terminal.ecrire", { espace: "api", texte: "1", pourquoi: "p" }));
    reglages({ niveau: "agir", pause: true });
    expect(autoriserDemande((r.data as { demande: string }).demande)).toMatch(/pause/i);
    expect(writePty).not.toHaveBeenCalled();
  });

  it("Refuser : rien d'écrit, l'échange est refusé, le fil propose d'aller voir", async () => {
    const id = useSuperviseurStore.getState().ouvrirEchange({ de: "e2", deTabId: "e2:t", vers: "e1", question: "Q" });
    const r = await executer(req("session.demander", { echange: id, texte: "Q", pourquoi: "p" }));
    refuserDemande((r.data as { demande: string }).demande);
    expect(writePty).not.toHaveBeenCalled();
    expect(useSuperviseurStore.getState().echanges[0].etat).toBe("refuse");
    const derniere = dernier(useSuperviseurStore.getState().fil);
    expect(derniere.parties).toEqual([
      { type: "texte", texte: "Refusé : je ne transmets rien. site-vitrine attend toujours ; dites-lui quoi faire." },
      { type: "action", libelle: "Aller à site-vitrine", action: { type: "aller", wsId: "e2" } },
    ]);
  });
});

describe("traiterRequete", () => {
  it("répond toujours, même sur une erreur inattendue", async () => {
    useWorkspaceStore.setState({ workspaces: null as unknown as Workspace[] });
    await traiterRequete(req("terminal.lire", { espace: "api" }));
    expect(superviseurApi.repondreOutil).toHaveBeenCalledWith(n, expect.objectContaining({ ok: false, erreur: expect.stringContaining("Erreur inattendue") }));
  });
});
