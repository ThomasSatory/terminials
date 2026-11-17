import { describe, it, expect, beforeEach } from "vitest";
import {
  MAX_FIL,
  SUPERVISEUR,
  demandeEnTete,
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

  it("fil : entrées horodatées, non lus comptés panneau fermé seulement", () => {
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

  it("demandes : pile, focus, décision, case « toujours »", () => {
    const a = st().ajouterDemande(demande({ depuis: 1 }));
    const b = st().ajouterDemande(demande({ depuis: 2, titre: "Répondre à site" }));
    expect(demandeEnTete(st())?.id).toBe(a);
    st().focaliserDemande(b);
    expect(demandeEnTete(st())?.id).toBe(b);
    st().basculerToujours(b);
    expect(st().demandes[1].toujours).toBe(true);
    st().deciderDemande(b, "autorisee");
    expect(st().demandeFocus).toBeNull();
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
