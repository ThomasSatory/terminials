import { describe, it, expect, beforeEach } from "vitest";
import {
  MAX_FIL,
  SUPERVISEUR,
  demandesOuvertes,
  espaceEnRelais,
  modeSuperviseur,
  outilEnCours,
  useSuperviseurStore,
  type NouvelleDemande,
} from "./superviseur";

const st = () => useSuperviseurStore.getState();

const demande = (o: Partial<NouvelleDemande> = {}): NouvelleDemande => ({
  appelId: 3,
  outil: "session.demander",
  cible: { wsId: "ws:2", tabId: "tab:2" },
  de: "ws:1",
  echangeId: null,
  titre: "Transmettre la question à api",
  texte: "Quel format ?",
  entree: true,
  pourquoi: "il faut demander à son agent",
  paire: ["/site", "/api"],
  bloquee: false,
  ...o,
});

describe("store du superviseur", () => {
  beforeEach(() => st().reset());

  it("fil : entrées horodatées, non lus comptés poste de suivi fermé seulement", () => {
    const id = st().ajouterEntree({ genre: "observation", wsId: "ws:1", a: 5, parties: [{ type: "texte", texte: "a fini" }] });
    expect(st().fil[0]).toMatchObject({ id, a: 5, genre: "observation" });
    expect(st().nonLus).toBe(1);
    st().ajouterEntree({ genre: "utilisateur", parties: [{ type: "texte", texte: "où en sont-ils ?" }] });
    expect(st().nonLus).toBe(1);
    st().ouvrirPanneau();
    expect(st().nonLus).toBe(0);
    st().ajouterEntree({ genre: "superviseur", parties: [] });
    expect(st().nonLus).toBe(0);
  });

  it("le fil est plafonné", () => {
    for (let i = 0; i < MAX_FIL + 5; i++) st().ajouterEntree({ genre: "superviseur", a: i, parties: [] });
    expect(st().fil).toHaveLength(MAX_FIL);
    expect(st().fil[0].a).toBe(5);
  });

  it("appels d'outils : ajout puis mise à jour par id d'appel", () => {
    const e = st().ajouterEntree({ genre: "superviseur", parties: [] });
    st().ajouterPartie(e, { type: "outil", appelId: 9, outil: "terminal.lire", args: "api --lignes 40", statut: "en_cours" });
    expect(outilEnCours(st())).toBe("terminal.lire");
    st().majOutil(9, { statut: "fait" });
    expect(st().fil[0].parties[0]).toMatchObject({ statut: "fait" });
    expect(outilEnCours(st())).toBeNull();
    st().majOutil(404, { statut: "erreur" }); // id inconnu : sans effet
  });

  it("demandes : décision, case « toujours »", () => {
    const a = st().ajouterDemande(demande({ depuis: 1 }));
    const b = st().ajouterDemande(demande({ depuis: 2, titre: "Répondre à site" }));
    st().basculerToujours(b);
    expect(st().demandes[1].toujours).toBe(true);
    st().deciderDemande(b, "autorisee");
    expect(demandesOuvertes(st()).map((d) => d.id)).toEqual([a]);
    // Une demande tranchée ne se retranche pas.
    st().deciderDemande(b, "refusee");
    expect(st().demandes[1].statut).toBe("autorisee");
  });

  it("échanges : relais tant que la réponse n'est pas rendue", () => {
    const e = st().ouvrirEchange({ de: "ws:1", deTabId: "tab:1", vers: "ws:2", question: "format ?" });
    expect(espaceEnRelais(st(), "ws:1")).toBe(true);
    expect(espaceEnRelais(st(), "ws:2")).toBe(false);
    st().majEchange(e, { etat: "transmis", versTabId: "tab:2" });
    expect(espaceEnRelais(st(), "ws:1")).toBe(true);
    st().majEchange(e, { etat: "repondu", reponse: "201" });
    expect(espaceEnRelais(st(), "ws:1")).toBe(false);
    const q = st().ouvrirEchange({ de: "ws:3", deTabId: null, vers: SUPERVISEUR, question: "branche ?" });
    expect(st().echanges.find((x) => x.id === q)?.vers).toBe(SUPERVISEUR);
  });

  it("sessions bloquées sur une demande d'autorisation", () => {
    st().bloquerSession("tab:2", "Autoriser npm run migrate ?");
    expect(st().sessionsBloquees).toEqual({ "tab:2": "Autoriser npm run migrate ?" });
    const avant = st().sessionsBloquees;
    st().bloquerSession("tab:2", "Autoriser npm run migrate ?");
    expect(st().sessionsBloquees).toBe(avant);
    st().debloquerSession("tab:2");
    expect(st().sessionsBloquees).toEqual({});
  });

  it("flux du moteur : un tour, ses textes regroupés dans une entrée", () => {
    st().appliquerFlux({ type: "tour-debut", nbEvenements: 2 }, 10);
    expect(st().moteur.enCours).toBe(true);
    st().appliquerFlux({ type: "texte", texte: "Je regarde." }, 11);
    st().appliquerFlux({ type: "texte", texte: "  " }, 11);
    st().appliquerFlux({ type: "texte", texte: "C'est fait." }, 12);
    expect(st().fil).toHaveLength(1);
    expect(st().fil[0].parties).toHaveLength(2);
    st().appliquerFlux({ type: "tour-fin", ok: false, erreur: "délai dépassé" }, 20);
    expect(st().moteur).toEqual({ enCours: false, dernierTour: 20, derniereErreur: "délai dépassé" });
    st().appliquerFlux({ type: "texte", texte: "Autre tour" }, 30);
    expect(st().fil).toHaveLength(2);
  });

  it("manques de la pause", () => {
    st().noterManque("terminials a terminé");
    st().noterManque("api attend");
    expect(st().viderManques()).toEqual(["terminials a terminé", "api attend"]);
    expect(st().manques).toEqual([]);
  });

  it("mode affiché", () => {
    expect(modeSuperviseur(st(), false, 0)).toBe("observe");
    expect(modeSuperviseur(st(), false, 1)).toBe("parle");
    st().ajouterDemande(demande());
    expect(modeSuperviseur(st(), false, 0)).toBe("parle");
    st().appliquerFlux({ type: "tour-debut", nbEvenements: 1 });
    expect(modeSuperviseur(st(), false, 0)).toBe("agit");
    expect(modeSuperviseur(st(), true, 3)).toBe("pause");
  });
});

describe("clôture des échanges à la désactivation", () => {
  it("les échanges ouverts ou transmis passent à refusé, les autres restent", () => {
    const st = useSuperviseurStore.getState();
    const a = st.ouvrirEchange({ de: "ws-a", deTabId: null, vers: "ws-b", question: "q ?" });
    const b = st.ouvrirEchange({ de: "ws-c", deTabId: null, vers: "ws-b", question: "q2 ?" });
    st.majEchange(b, { etat: "repondu", reponse: "r" });
    expect(espaceEnRelais(useSuperviseurStore.getState(), "ws-a")).toBe(true);
    useSuperviseurStore.getState().cloreEchangesEnCours();
    const s = useSuperviseurStore.getState();
    expect(s.echanges.find((x) => x.id === a)?.etat).toBe("refuse");
    expect(s.echanges.find((x) => x.id === b)?.etat).toBe("repondu");
    expect(espaceEnRelais(s, "ws-a")).toBe(false);
  });
});

describe("résumés par espace", () => {
  it("poserResume nettoie le texte, remplace le précédent et garde le groupe", () => {
    st().poserResume("ws:1", "  Migre\n la base \u001b[31mvers v2\u001b[0m  ", "travail", 5);
    expect(st().resumes["ws:1"]).toEqual({ texte: "Migre la base vers v2", a: 5, groupe: "travail" });
    st().poserResume("ws:1", "Tests verts", "repos", 9);
    expect(st().resumes["ws:1"]).toEqual({ texte: "Tests verts", a: 9, groupe: "repos" });
  });

  it("poserResume borne le texte à 160 caractères", () => {
    st().poserResume("ws:1", "x".repeat(300), "travail");
    expect(Array.from(st().resumes["ws:1"].texte)).toHaveLength(160);
    expect(st().resumes["ws:1"].texte.endsWith("…")).toBe(true);
  });

  it("un texte vide après nettoyage retire l'entrée (et ne change rien s'il n'y en a pas)", () => {
    st().poserResume("ws:1", "Quelque chose", "travail");
    st().poserResume("ws:1", " \n\t ", "travail");
    expect(st().resumes).toEqual({});
    const avant = st().resumes;
    st().poserResume("ws:9", "", "repos");
    expect(st().resumes).toBe(avant);
  });

  it("oublierResumes retire les espaces disparus, référence stable si rien à retirer", () => {
    st().poserResume("ws:1", "Un", "travail");
    st().poserResume("ws:2", "Deux", "repos");
    const avant = st().resumes;
    st().oublierResumes(["ws:1", "ws:2", "ws:3"]);
    expect(st().resumes).toBe(avant);
    st().oublierResumes(["ws:2"]);
    expect(Object.keys(st().resumes)).toEqual(["ws:2"]);
  });

  it("reset vide les résumés", () => {
    st().poserResume("ws:1", "Un", "travail");
    st().reset();
    expect(st().resumes).toEqual({});
  });
});
