import { describe, it, expect } from "vitest";
import {
  argsAffiches,
  autorisationLisible,
  construireEtatEspaces,
  developperDossier,
  extrait,
  lignesEtats,
  nettoyerTexte,
  nomBoutPaire,
  nombreLignes,
  ongletParDefaut,
  resoudreEspace,
  resoudreOnglet,
  sequenceEcriture,
  titreDemande,
  titreOnglet,
  type EspaceSource,
  type SourcesEtatEspaces,
} from "./outilsSuperviseur";

const espaces = [
  { id: "ws:1", name: "api-paiements" },
  { id: "ws:2", name: "site-vitrine" },
  { id: "ws:3", name: "apps" },
  { id: "ws:4", name: "Notes" },
];

describe("resoudreEspace", () => {
  it("par id, par nom (casse ignorée), par préfixe unique", () => {
    expect(resoudreEspace("ws:2", espaces)).toEqual({ ok: true, valeur: espaces[1] });
    expect(resoudreEspace("notes", espaces)).toEqual({ ok: true, valeur: espaces[3] });
    expect(resoudreEspace("  SITE ", espaces)).toEqual({ ok: true, valeur: espaces[1] });
    expect(resoudreEspace("api", espaces)).toEqual({ ok: true, valeur: espaces[0] });
  });

  it("ambigu ou introuvable : l'erreur liste les candidats", () => {
    const amb = resoudreEspace("ap", espaces);
    expect(amb.ok).toBe(false);
    if (!amb.ok) expect(amb.erreur).toContain("api-paiements (ws:1), apps (ws:3)");
    const inc = resoudreEspace("infra", espaces);
    expect(inc.ok).toBe(false);
    if (!inc.ok) expect(inc.erreur).toContain("Espaces : api-paiements (ws:1)");
    expect(resoudreEspace("", espaces).ok).toBe(false);
    expect(resoudreEspace(undefined, espaces).ok).toBe(false);
  });

  it("deux espaces du même nom : désigner par id", () => {
    const deux = [
      { id: "a", name: "api" },
      { id: "b", name: "api" },
    ];
    const r = resoudreEspace("api", deux);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain("par son id");
  });
});

describe("onglets", () => {
  const ws = {
    activeTabId: "t2",
    tabs: [{ id: "t1", title: "✳ Refonte du dock", claude: { id: "x", cwd: "/" } }, { id: "t2", title: "zsh" }, { id: "t3" }],
  };

  it("par défaut : la session Claude, sinon l'onglet actif", () => {
    expect(ongletParDefaut(ws)?.id).toBe("t1");
    expect(ongletParDefaut({ ...ws, tabs: ws.tabs.slice(1) })?.id).toBe("t2");
    expect(ongletParDefaut({ activeTabId: null, tabs: [] })).toBeNull();
  });

  it("titre affiché sans glyphe, « Terminal N » sans titre", () => {
    expect(titreOnglet(ws.tabs[0], 0)).toBe("Refonte du dock");
    expect(titreOnglet(ws.tabs[2], 2)).toBe("Terminal 3");
  });

  it("par id, rang, titre ou préfixe", () => {
    const id = (d: unknown) => {
      const r = resoudreOnglet(ws, d);
      return r.ok ? r.valeur.tab.id : null;
    };
    expect(id(undefined)).toBe("t1");
    expect(id("t3")).toBe("t3");
    expect(id("2")).toBe("t2");
    expect(id(3)).toBe("t3");
    expect(id("ZSH")).toBe("t2");
    expect(id("refonte")).toBe("t1");
    const r = resoudreOnglet(ws, "vim");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.erreur).toContain("1. Refonte du dock, 2. zsh, 3. Terminal 3");
  });

  it("lignes lues : 40 par défaut, bornées à 1…200", () => {
    expect(nombreLignes(undefined)).toBe(40);
    expect(nombreLignes(500)).toBe(200);
    expect(nombreLignes(0)).toBe(1);
  });
});

describe("écriture dans un terminal", () => {
  it("retire les contrôles, garde \\n et \\t, ramène \\r", () => {
    expect(nettoyerTexte("a\x1b[201~b\r\nc\td\u0007\u009b")).toBe("a[201~b\nc\td");
  });

  it("multiligne : collage entre crochets ; une ligne : tel quel", () => {
    expect(sequenceEcriture("1")).toBe("1");
    expect(sequenceEcriture("a\nb")).toBe("\x1b[200~a\nb\x1b[201~");
  });
});

describe("libellés", () => {
  it("arguments affichés comme la maquette", () => {
    expect(argsAffiches("espaces.etat", {}, {})).toBe("--tous");
    expect(argsAffiches("terminal.lire", { espace: "api" }, { cible: "api-paiements › claude" })).toBe(
      "api-paiements › claude  --lignes 40",
    );
    expect(argsAffiches("espace.renommer", { espace: "front", nom: "site-vitrine" }, { nomEspace: "front" })).toBe(
      "front → site-vitrine",
    );
    expect(argsAffiches("terminal.ecrire", { texte: "1", entree: true }, { cible: "api › claude" })).toBe(
      "api › claude  « 1 » + Entrée",
    );
    expect(argsAffiches("espace.deplacer", { espace: "infra", groupe: "" }, {})).toBe("infra → hors groupe");
    expect(argsAffiches("espace.resumer", { espace: "api", texte: "Écrit les tests." }, { nomEspace: "api-paiements" })).toBe(
      "api-paiements  « Écrit les tests. »",
    );
    expect(argsAffiches("groupe.creer", { nom: "ops", espaces: ["infra"] }, {})).toBe("ops ← infra");
    expect(argsAffiches("session.demander", { texte: "Quel format ?" }, { cible: "api › claude" })).toBe(
      "api › claude  « Quel format ? »",
    );
  });

  it("extrait sur une ligne, tronqué", () => {
    expect(extrait("a\n  b")).toBe("a b");
    expect(extrait("x".repeat(10), 5)).toBe("xxxx…");
  });

  it("titres des cartes", () => {
    expect(titreDemande("session.demander", "api", { bloquee: false })).toBe("Transmettre la question à api");
    expect(titreDemande("session.repondre", "site", { bloquee: false })).toBe("Transmettre la réponse à site");
    expect(titreDemande("session.repondre", "notes", { bloquee: false, deSuperviseur: true })).toBe("Répondre à notes");
    expect(titreDemande("terminal.ecrire", "api", { bloquee: true })).toBe("Répondre à api");
    expect(titreDemande("terminal.ecrire", "api", { bloquee: false })).toBe("Écrire dans api");
  });

  it("autorisation lisible", () => {
    expect(autorisationLisible("Claude demande l'autorisation d'utiliser Bash")).toBe("autorisation : utiliser Bash");
    expect(autorisationLisible("Autoriser npm run migrate ?")).toBe("autorisation : npm run migrate");
    expect(autorisationLisible("Lancer la migration")).toBe("autorisation : Lancer la migration");
  });

  it("bouts de paire : superviseur, espace ouvert, sinon dossier", () => {
    const ws = [{ name: "api-paiements", cwd: "/dev/api" }];
    expect(nomBoutPaire("superviseur", ws, "Vigie")).toBe("Vigie");
    expect(nomBoutPaire("/dev/api", ws, "Vigie")).toBe("api-paiements");
    expect(nomBoutPaire("/dev/ailleurs/", ws, "Vigie")).toBe("ailleurs");
  });

  it("dossier personnel développé", () => {
    expect(developperDossier("~", "/home/u")).toBe("/home/u");
    expect(developperDossier("~/dev/x", "/home/u/")).toBe("/home/u/dev/x");
    expect(developperDossier("/tmp", "/home/u")).toBe("/tmp");
  });
});

describe("espaces.etat", () => {
  const source = (id: string, name: string, p: Partial<EspaceSource> = {}): EspaceSource => ({
    id,
    name,
    cwd: `/dev/${name}`,
    groupId: null,
    unread: false,
    unreadTabs: [],
    tabs: [{ id: `${id}:t`, title: "claude", claude: { id: "s", cwd: "/" } }],
    activeTabId: `${id}:t`,
    ...p,
  });
  const etats: Record<string, "travail" | "attente" | "repos" | "termine"> = { a: "attente", b: "travail", c: "repos" };
  const src: SourcesEtatEspaces = {
    espaces: [
      source("c", "notes", { branch: "main", groupId: "g" }),
      source("a", "api", { unread: true, lastNotification: { title: "t", body: "Autoriser npm run migrate ?" } }),
      source("b", "site"),
    ],
    groupes: [{ id: "g", name: "perso", color: "#fdba74", collapsed: false }],
    activeId: "b",
    ordre: ["a", "b", "c"],
    etatEspace: (id) => etats[id],
    etatOnglet: (id) => etats[id],
    sessionsBloquees: { "a:t": "Claude demande l'autorisation d'utiliser Bash" },
    enRelais: (id) => id === "b",
    resume: (id) => (id === "a" ? "Écrit les tests." : null),
  };

  it("forme du contrat, dans l'ordre du dock", () => {
    const d = construireEtatEspaces(src);
    expect(d.espaces.map((e) => e.id)).toEqual(["a", "b", "c"]);
    expect(d.espaces[0]).toMatchObject({
      nom: "api",
      etat: "attente",
      raccourci: "Ctrl 1",
      notification: "Autoriser npm run migrate ?",
      onglets: [{ rang: 1, titre: "claude", claude: true, bloque: "Claude demande l'autorisation d'utiliser Bash" }],
    });
    expect(d.espaces[0].resume).toBe("Écrit les tests.");
    expect(d.espaces[1]).toMatchObject({ actif: true, relais: true, notification: null, resume: null });
    expect(d.espaces[2]).toMatchObject({ groupe: "perso", branche: "main" });
    expect(d.groupes).toEqual([{ id: "g", nom: "perso", couleur: "#fdba74", replie: false }]);
    expect(construireEtatEspaces(src, "c").espaces.map((e) => e.id)).toEqual(["c"]);
  });

  it("tableau des agents : ce qui réclame d'abord, avec une phrase", () => {
    const lignes = lignesEtats(construireEtatEspaces(src).espaces, (id) => (id === "b" ? "api" : null));
    expect(lignes).toEqual([
      { wsId: "a", etat: "attente", phrase: "autorisation : utiliser Bash" },
      { wsId: "b", etat: "relais", phrase: "attend la réponse de api" },
      { wsId: "c", etat: "repos", phrase: "main" },
    ]);
  });
});
