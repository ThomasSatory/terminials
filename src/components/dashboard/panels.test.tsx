import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { OpenTasks, TACHES_VISIBLES } from "./OpenTasks";
import { foldLabel } from "./Fold";
import { champsLlmDetailles } from "./SettingsPanel";
import { SummaryPanel, summaryFooter, scheduleSentence } from "./SummaryPanel";
import { TempsSaisie } from "./TempsSaisie";
import type { TempsSaisie as TempsData } from "../../lib/tempsSaisie";
import { clickupActif, type OpenTask, type Summary } from "../../lib/activityApi";

describe("clickupActif", () => {
  it("le MCP est actif sans jeton, la clé API exige un jeton, « off » n'est jamais actif", () => {
    expect(clickupActif({ source: "claude_mcp", token: "", listes: [] })).toBe(true);
    expect(clickupActif({ source: "api", token: "", listes: [] })).toBe(false);
    expect(clickupActif({ source: "api", token: "pk_1", listes: [] })).toBe(true);
    expect(clickupActif({ source: "off", token: "pk_1", listes: [] })).toBe(false);
  });
});

describe("champsLlmDetailles", () => {
  it("cachés pour claude -p, montrés pour les API configurables", () => {
    expect(champsLlmDetailles("claude_cli")).toBe(false);
    expect(champsLlmDetailles("openai")).toBe(true);
    expect(champsLlmDetailles("ollama")).toBe(true);
  });
});

describe("OpenTasks", () => {
  it("ClickUp inactif affiche l'invite à l'activer dans les réglages", () => {
    const html = renderToStaticMarkup(<OpenTasks tasks={[]} active={false} onOpen={() => {}} />);
    expect(html).toContain("Activer ClickUp dans les réglages");
  });

  it("avec 2 tâches : triées par échéance (sans échéance en dernier) et affiche le statut", () => {
    const tasks: OpenTask[] = [
      { id: "1", name: "Tâche sans échéance", status: "à faire", url: "https://x/1" },
      {
        id: "2",
        name: "Tâche avec échéance",
        status: "en cours",
        url: "https://x/2",
        dueDate: 1_700_000_000,
      },
    ];
    const html = renderToStaticMarkup(
      <OpenTasks tasks={tasks} active={true} onOpen={() => {}} />,
    );

    const liCount = (html.match(/<li/g) ?? []).length;
    expect(liCount).toBe(2);

    const idxWithDue = html.indexOf("Tâche avec échéance");
    const idxWithoutDue = html.indexOf("Tâche sans échéance");
    expect(idxWithDue).toBeGreaterThanOrEqual(0);
    expect(idxWithoutDue).toBeGreaterThan(idxWithDue);

    expect(html).toContain('<span class="dash-statut" data-ton="encours">en cours</span>');
    expect(html).toContain('<span class="dash-statut" data-ton="neutre">à faire</span>');
  });

  it("identifiant affiché en entier", () => {
    const html = renderToStaticMarkup(
      <OpenTasks
        tasks={[{ id: "ABC-76983", name: "US", status: "test", url: "https://x/3" }]}
        active={true}
        onOpen={() => {}}
      />,
    );
    expect(html).toContain('<a class="dash-task-id" href="https://x/3">ABC-76983</a>');
  });
});

describe("OpenTasks — dépliage", () => {
  const lot = (n: number): OpenTask[] =>
    Array.from({ length: n }, (_, i) => ({
      id: `t${i}`,
      name: `Ticket ${i}`,
      status: "en cours",
      url: `https://x/${i}`,
    }));

  it(`au plus ${TACHES_VISIBLES} tickets visibles, les autres derrière le bouton`, () => {
    const html = renderToStaticMarkup(
      <OpenTasks tasks={lot(TACHES_VISIBLES + 8)} active={true} onOpen={() => {}} />,
    );
    expect((html.match(/<li/g) ?? []).length).toBe(TACHES_VISIBLES);
    expect(html).toContain("+ 8 autres");
    expect(html).toContain('aria-expanded="false"');
  });

  it("liste courte : aucun bouton de dépliage", () => {
    const html = renderToStaticMarkup(
      <OpenTasks tasks={lot(TACHES_VISIBLES)} active={true} onOpen={() => {}} />,
    );
    expect((html.match(/<li/g) ?? []).length).toBe(TACHES_VISIBLES);
    expect(html).not.toContain("dash-fold");
  });
});

describe("foldLabel", () => {
  it("compte les éléments cachés, au singulier comme au pluriel", () => {
    expect(foldLabel(false, 1)).toBe("+ 1 autre");
    expect(foldLabel(false, 12)).toBe("+ 12 autres");
  });
  it("sans compte (un texte), le libellé reste générique", () => {
    expect(foldLabel(false, null)).toBe("Déplier");
  });
  it("déplié, on propose toujours de replier", () => {
    expect(foldLabel(true, 12)).toBe("Replier");
    expect(foldLabel(true, null)).toBe("Replier");
  });
});

describe("scheduleSentence", () => {
  it("heure ronde, jours ouvrés", () => {
    expect(scheduleSentence({ hour: 7, minute: 0, weekdaysOnly: true })).toBe(
      "La synthèse se génère seule à 7 h du lundi au vendredi.",
    );
  });
  it("heure avec minutes, tous les jours", () => {
    expect(scheduleSentence({ hour: 6, minute: 30, weekdaysOnly: false })).toBe(
      "La synthèse se génère seule à 6 h 30 chaque jour.",
    );
  });
});

describe("summaryFooter", () => {
  it("formate « Synthèse générée à HH:MM par <model> »", () => {
    const summary: Summary = {
      day: "2026-09-17",
      text: "…",
      model: "openai:google/gemma-4-31B-it",
      generatedAt: Math.floor(new Date(2026, 8, 17, 7, 2, 0).getTime() / 1000),
      cached: true,
    };
    expect(summaryFooter(summary)).toBe(
      "Synthèse générée à 07:02 par openai:google/gemma-4-31B-it",
    );
  });
});

describe("SummaryPanel — état ok", () => {
  const summary: Summary = {
    day: "2026-09-17",
    text: "Titre\n\n- a : x",
    model: "gemma",
    generatedAt: Math.floor(new Date(2026, 8, 17, 7, 2, 0).getTime() / 1000),
    cached: true,
  };
  const props = { title: "Bilan", generate: () => {}, onOpenLink: () => {} };

  it("rend le reste du bilan non rattaché à un projet", () => {
    const html = renderToStaticMarkup(
      <SummaryPanel {...props} ui={{ status: "ok", summary }} body="- Sur autre, note libre." />,
    );
    expect(html).toContain("note libre");
    expect(html).not.toContain("Synthèse générée");
  });

  it("tout apparié aux lignes de la frise : seule la mention de génération reste", () => {
    const html = renderToStaticMarkup(
      <SummaryPanel {...props} ui={{ status: "ok", summary }} body="" />,
    );
    expect(html).toContain("dash-prose-note");
    expect(html).toContain("Synthèse générée à 07:02 par gemma");
    expect(html).not.toContain("Titre");
  });
});

describe("TempsSaisie — boutons de saisie", () => {
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
    reunion: { ticket: { id: "ABC-9", name: "Réunions", status: null, url: "https://x/r" }, horsUs: [], saisie: 405, debut: 1_789_000_200 },
    total: 450,
    jours: 1,
  };
  const saisie = (saisies: Record<string, number>, enCours: string[] = []) => ({
    saisies,
    enCours: new Set(enCours),
    erreurs: {},
    saisir: () => {},
  });

  it("vue Semaine : aucun bouton", () => {
    const html = renderToStaticMarkup(<TempsSaisie temps={temps} onOpen={() => {}} saisie={null} />);
    expect(html).not.toContain("dash-saisir");
  });

  it("Saisir, puis le reste après une saisie partielle, ✓ quand tout est saisi", () => {
    const html = renderToStaticMarkup(
      <TempsSaisie temps={temps} onOpen={() => {}} saisie={saisie({ "ABC-1": 45, "ABC-9": 390 })} />,
    );
    expect(html).toContain("✓");
    expect(html).toContain("+15 min");
    expect(html).toContain("Tout saisir");
    const enCours = renderToStaticMarkup(
      <TempsSaisie temps={temps} onOpen={() => {}} saisie={saisie({}, ["ABC-1"])} />,
    );
    expect(enCours).toContain("saisie…");
    expect(enCours).toContain(">Saisir</button>");
  });
});
