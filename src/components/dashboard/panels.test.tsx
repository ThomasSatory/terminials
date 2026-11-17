import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenTasks, TACHES_VISIBLES } from "./OpenTasks";
import { TempsSaisie } from "./TempsSaisie";
import { Reunions } from "./Reunions";
import { Chiffres } from "./Chiffres";
import { BilanProjets, type SectionVue } from "./BilanProjets";
import { Rythme } from "./Rythme";
import { SelecteurJours } from "./SelecteurJours";
import { BarreRecap } from "./BarreRecap";
import { Chronologie } from "./Chronologie";
import { colonnesRythme, commitsFrise, position, pucesDe, reperes, type JourSelecteur } from "../../lib/recapModele";
import type { TempsSaisie as TempsData } from "../../lib/tempsSaisie";
import { buildFrise } from "../../lib/frise";
import { clickupActif, type ActivityEvent, type OpenTask } from "../../lib/activityApi";

const rien = () => {};

describe("clickupActif", () => {
  it("le MCP est actif sans jeton, la clé API exige un jeton, « off » n'est jamais actif", () => {
    expect(clickupActif({ source: "claude_mcp", token: "", listes: [] })).toBe(true);
    expect(clickupActif({ source: "api", token: "", listes: [] })).toBe(false);
    expect(clickupActif({ source: "api", token: "pk_1", listes: [] })).toBe(true);
    expect(clickupActif({ source: "off", token: "pk_1", listes: [] })).toBe(false);
  });
});

describe("OpenTasks", () => {
  const lot = (n: number): OpenTask[] =>
    Array.from({ length: n }, (_, i) => ({ id: `T-${i}`, name: `Tâche ${i}`, status: "en cours", url: `https://x/${i}` }));

  it("suivi inactif : renvoie aux réglages", () => {
    const html = renderToStaticMarkup(<OpenTasks tasks={[]} active={false} onOpen={rien} />);
    expect(html).toContain("Activer le suivi des tâches dans les réglages");
  });

  it("triées par échéance (sans échéance en dernier), état teinté, « — » sans échéance", () => {
    const tasks: OpenTask[] = [
      { id: "1", name: "Sans échéance", status: "à faire", url: "https://x/1" },
      { id: "2", name: "Avec échéance", status: "en revue", url: "https://x/2", dueDate: 1_700_000_000 },
    ];
    const html = renderToStaticMarkup(<OpenTasks tasks={tasks} active={true} onOpen={rien} />);
    expect(html.indexOf("Avec échéance")).toBeLessThan(html.indexOf("Sans échéance"));
    expect(html).toContain('<span class="rc-statut" data-ton="revue">en revue</span>');
    expect(html).toContain(">—<");
    expect(html).toContain('<a class="rc-tk" href="https://x/2" title="Avec échéance">2</a>');
  });

  it(`au-delà de ${TACHES_VISIBLES}, les suivantes dans un pli fermé et inerte`, () => {
    const html = renderToStaticMarkup(<OpenTasks tasks={lot(TACHES_VISIBLES + 3)} active={true} onOpen={rien} />);
    expect(html).toContain("+ 3 autres");
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-ouvert="false" inert=""');
  });

  it("liste courte : pas de pli", () => {
    const html = renderToStaticMarkup(<OpenTasks tasks={lot(TACHES_VISIBLES)} active={true} onOpen={rien} />);
    expect(html).not.toContain("rc-plier");
  });

});

describe("TempsSaisie", () => {
  const temps: TempsData = {
    us: [
      {
        cle: "ABC-1",
        ticket: { id: "ABC-1", name: "Faire A", status: "test", url: "https://x/a" },
        projets: ["app"],
        minutes: 50,
        saisie: 45,
        debut: 1_789_000_200,
      },
    ],
    reunion: {
      ticket: { id: "ABC-9", name: "Réunions", status: null, url: "https://x/r" },
      reunions: [],
      saisie: 405,
      debut: 1_789_000_200,
    },
    horsUs: [],
    total: 450,
    jours: 1,
    entrees: [
      { taskId: "ABC-1", debut: "2026-09-15 09:00", minutes: 45 },
      { taskId: "ABC-9", debut: "2026-09-15 09:45", minutes: 405 },
    ],
  };
  const saisie = (saisies: Record<string, number>, enCours: string[] = []) => ({
    saisies,
    enCours: new Set(enCours),
    erreurs: {},
    saisir: rien,
  });

  it("sans saisie : lecture seule, ni bouton ni barre", () => {
    const html = renderToStaticMarkup(<TempsSaisie temps={temps} saisie={null} note="Cible 7 h 30." onOpen={rien} />);
    expect(html).not.toContain("rc-saisir");
    expect(html).not.toContain("rc-progression");
    expect(html).toContain("7 h 30");
    expect(html).toContain("app · mesuré 50 min");
    expect(html).toContain("Cible 7 h 30.");
  });

  it("saisi coché, reste après saisie partielle, « Tout saisir » et total saisi / cible", () => {
    const html = renderToStaticMarkup(
      <TempsSaisie temps={temps} saisie={saisie({ "ABC-1": 45, "ABC-9": 390 })} note="" onOpen={rien} />,
    );
    expect(html).toContain("saisi</span>");
    expect(html).toContain("+15 min");
    expect(html).toContain("Tout saisir");
    expect(html).toContain("7 h 15</span> / 7 h 30");
  });

  it("tout saisi : « Journée saisie », total en vert", () => {
    const html = renderToStaticMarkup(
      <TempsSaisie temps={temps} saisie={saisie({ "ABC-1": 45, "ABC-9": 405 })} note="" onOpen={rien} />,
    );
    expect(html).toContain("Journée saisie");
    expect(html).toContain('data-succes="true"');
    expect(html).not.toContain("Tout saisir");
  });

  it("saisie en cours", () => {
    const html = renderToStaticMarkup(<TempsSaisie temps={temps} saisie={saisie({}, ["ABC-1"])} note="" onOpen={rien} />);
    expect(html).toContain("Saisie…");
    expect(html).toContain(">Saisir</button>");
  });
});

describe("Reunions et Chiffres", () => {
  it("réunions : plage, titre, durée, total", () => {
    const debut = Math.floor(new Date(2026, 10, 16, 9, 30).getTime() / 1000);
    const html = renderToStaticMarkup(
      <Reunions reunions={[{ id: "r1", titre: "Point quotidien", debut, fin: debut + 15 * 60 }]} />,
    );
    expect(html).toContain("9h30–9h45");
    expect(html).toContain("Point quotidien");
    expect(html).toContain("15 min");
  });

  it("chiffres : une entrée de liste de description par chiffre", () => {
    const html = renderToStaticMarkup(
      <Chiffres chiffres={[{ label: "Commits", valeur: "3", sous: "sur 2 espaces" }, { label: "Temps à saisir", valeur: "7 h 30", sous: "tout est saisi", succes: true }]} />,
    );
    expect((html.match(/<dt/g) ?? []).length).toBe(2);
    expect(html).toContain('data-succes="true">7 h 30');
  });
});

describe("BilanProjets", () => {
  const sections: SectionVue[] = [
    {
      dir: "/dev/a",
      name: "api",
      couleur: "#f78fc6",
      monogramme: "ap",
      branche: "fix/rejeu",
      minutes: 135,
      commits: 3,
      puces: pucesDe("- Rejeu validé [ABC-12](https://x/12).\n- Migration bloquée en recette."),
    },
  ];
  const props = { onBasculer: rien, onTout: rien, focus: null, noms: new Map([["ABC-12", "Rejouer les webhooks"]]), onOpen: rien, texteDaily: ["x"] };

  it("section ouverte : avatar, branche, méta, puces avec pastille de ticket et étiquette", () => {
    const html = renderToStaticMarkup(<BilanProjets {...props} sections={sections} etat="ok" fermes={{}} />);
    expect(html).toContain(">ap<");
    expect(html).toContain("fix/rejeu");
    expect(html).toContain("2 h 15 · 3 commits");
    expect(html).toContain('title="Rejouer les webhooks">ABC-12</a>');
    expect(html).toContain('data-etiquette="bloqué">bloqué</span>');
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("Tout replier");
    expect(html).toContain("Copier pour le daily");
  });

  it("section repliée : drapeau visible, pli inerte, « Tout déplier »", () => {
    const html = renderToStaticMarkup(<BilanProjets {...props} sections={sections} etat="ok" fermes={{ "/dev/a": true }} />);
    expect(html).toContain('class="rc-drapeau" data-etiquette="bloqué"');
    expect(html).toContain('inert=""');
    expect(html).toContain("Tout déplier");
  });

  it("sans bilan : invite par section, copie désactivée", () => {
    const vides = sections.map((s) => ({ ...s, puces: [] }));
    const html = renderToStaticMarkup(<BilanProjets {...props} sections={vides} etat="absent" fermes={{}} />);
    expect(html).toContain("Pas encore de bilan rédigé pour ce projet.");
    expect(html).toMatch(/class="rc-copier"[^>]*disabled=""/);
  });

  it("aria-controls : un id unique sans espace, jamais le chemin du dossier", () => {
    const deux = [sections[0], { ...sections[0], dir: "/dev/mon projet", name: "web" }];
    const html = renderToStaticMarkup(<BilanProjets {...props} sections={deux} etat="ok" fermes={{}} />);
    const ids = [...html.matchAll(/aria-controls="([^"]*)"/g)].map((m) => m[1]);
    expect(ids).toHaveLength(2);
    expect(new Set(ids).size).toBe(2);
    for (const id of ids) {
      expect(id).not.toMatch(/\s|\//);
      expect(html).toContain(`id="${id}"`);
    }
  });
});

describe("Rythme", () => {
  const A = "/home/x/dev/a";
  const at = (h: number, m = 0) => Math.floor(new Date(2026, 10, 16, h, m).getTime() / 1000);
  const ev = (ts: number, kind: ActivityEvent["kind"], title = "x"): ActivityEvent => ({
    id: ts,
    ts,
    kind,
    workspaceDir: A,
    branch: "main",
    title,
    ticketIds: [],
    tickets: [],
  });
  const ws = [{ dir: A, name: "a", events: 3, commits: 1 }];
  const frise = buildFrise(
    "day",
    "2026-11-16",
    [ev(at(9, 5), "shell_cmd"), ev(at(9, 10), "claude_prompt", "ajoute la file de rejeu des webhooks"), ev(at(11, 30), "commit", "fix: rejeu")],
    ws,
    new Map([[A, "#a99cff"]]),
  );
  const reunion = { id: "r", titre: "Point quotidien", debut: at(9, 30), fin: at(9, 45) };
  const colonnes = colonnesRythme(frise, [reunion], at(23));
  const rendu = (epingle: number | null, focus: string | null = null) =>
    renderToStaticMarkup(
      <Rythme
        colonnes={colonnes}
        reperes={reperes(frise, "day")}
        commits={commitsFrise(frise)}
        reunions={[reunion]}
        legende={[{ dir: A, name: "a", couleur: "#a99cff", minutes: 30 }]}
        position={(ts) => position(frise, ts)}
        maintenant={at(23)}
        afficherMaintenant={false}
        focus={focus}
        onFocus={rien}
        epingle={epingle}
        onEpingle={rien}
        noms={new Map()}
        onOpen={rien}
        semaine={false}
      />,
    );

  it("une colonne-bouton par quart d'heure, un anneau par commit, la réunion en bloc", () => {
    const html = rendu(null);
    expect((html.match(/class="rc-col"/g) ?? []).length).toBe(colonnes.length);
    expect((html.match(/class="rc-commit"/g) ?? []).length).toBe(1);
    expect(html).toContain("fix: rejeu");
    expect(html).toContain('title="Point quotidien, 9h30–9h45"');
    expect(html).toContain('aria-label="9h00 à 9h15 : a"');
    expect(html).toContain("Survolez la frise");
  });

  it("créneau épinglé : plage, espace, minutes, prompt", () => {
    const i = colonnes.findIndex((c) => c.t0 === at(9));
    const html = rendu(i);
    expect(html).toContain('aria-label="Désépingler le créneau"');
    expect(html).toContain("un espace actif");
    expect(html).toContain("15 min");
    expect(html).toContain("« ajoute la file de rejeu des webhooks »");
  });

  it("légende : mettre un espace en avant atténue les autres et propose « Tout afficher »", () => {
    const html = rendu(null, A);
    expect(html).toContain('aria-pressed="true" title="Ne montrer que a"');
    expect(html).toContain("Tout afficher");
  });
});

describe("SelecteurJours et BarreRecap", () => {
  const jours: JourSelecteur[] = [
    { day: "2026-11-16", label: "lun. 16", long: "Lundi 16 novembre", future: false, aujourdhui: true, minutes: 135, barre: [{ dir: "/a", couleur: "#a99cff", minutes: 135 }] },
    { day: "2026-11-17", label: "mar. 17", long: "Mardi 17 novembre", future: true, aujourdhui: false, minutes: 0, barre: [] },
  ];

  it("jour choisi pressé, jour futur désactivé « à venir », chevron suivant désactivé", () => {
    const html = renderToStaticMarkup(
      <SelecteurJours jours={jours} selection="2026-11-16" precedent="2026-11-13" suivant={null} onJour={rien} onNaviguer={rien} onAujourdhui={null} semaine={false} />,
    );
    expect(html).toContain('aria-pressed="true" aria-disabled="false" aria-label="Lundi 16 novembre, 2 h 15 d’activité"');
    expect(html).toContain('aria-label="Mardi 17 novembre, à venir"');
    expect(html).toContain('aria-label="Jour suivant" aria-disabled="true"');
    expect(html).toContain("flex:135");
  });

  it("barre : onglets en tablist, Fermer avec Échap", () => {
    const html = renderToStaticMarkup(
      <BarreRecap semaine={47} onglet="recap" onOnglet={rien} mode="day" onMode={rien} onReglages={rien} alerte={false} collecte="" erreurs={[]} onFermer={rien} />,
    );
    expect(html).toContain('role="tablist"');
    expect(html).toContain('aria-selected="true"');
    expect(html).toContain("semaine 47 · Ctrl+Maj+H");
    expect(html).toContain('aria-label="Réglages de l’activité (Paramètres)"');
    expect(html).toContain("Échap</kbd>");
  });
});

describe("Chronologie", () => {
  it("lignes par heure, filtre, et jour par jour en mode semaine", () => {
    const html = renderToStaticMarkup(
      <Chronologie
        heures={[{ heure: "9h", items: [{ ts: Math.floor(new Date(2026, 10, 16, 9, 5).getTime() / 1000), genre: "commit", texte: "fix: x", dir: "/a", nom: "a", fois: 2 }] }]}
        couleur={() => "#a99cff"}
        filtre=""
        onFiltre={rien}
        champ={null}
        semaine={null}
        onJour={rien}
      />,
    );
    expect(html).toContain(">9h<");
    expect(html).toContain("9h05");
    expect(html).toContain("×2");
    expect(html).toContain('aria-label="Filtrer la chronologie ( / )"');

    const semaine = renderToStaticMarkup(
      <Chronologie
        heures={[]}
        couleur={() => "#a99cff"}
        filtre=""
        onFiltre={rien}
        champ={null}
        semaine={[{ day: "2026-11-16", label: "lun. 16", fait: "fix: x", future: false, compteurs: "1 commit", segments: [] }]}
        onJour={rien}
      />,
    );
    expect(semaine).toContain("Jour par jour");
    expect(semaine).toContain("1 commit");
  });
});
