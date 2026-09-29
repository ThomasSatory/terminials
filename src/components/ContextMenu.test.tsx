import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextMenu, menuHeight } from "./ContextMenu";
import { SIDEBAR_COLORS } from "../lib/palette";

const noop = () => {};

describe("ContextMenu", () => {
  const html = renderToStaticMarkup(
    <ContextMenu
      x={10}
      y={10}
      items={[
        { label: "Renommer…", shortcut: "Ctrl+Maj+R", run: noop },
        { label: "Dupliquer", run: noop },
        { separator: true },
        { label: "Fermer", shortcut: "Ctrl+Maj+Q", run: noop },
      ]}
      onClose={noop}
    />,
  );

  it("rend le libellé de chaque entrée", () => {
    expect(html).toContain("Renommer…");
    expect(html).toContain("Dupliquer");
    expect(html).toContain("Fermer");
  });

  it("affiche le raccourci des entrées qui en ont un", () => {
    expect(html).toContain("Ctrl+Maj+R");
    expect(html).toContain("Ctrl+Maj+Q");
  });

  it("rend un séparateur pour chaque entrée separator (et aucun bouton pour elle)", () => {
    expect(html.match(/<button/g)).toHaveLength(3);
    expect(html).toContain("data-separator");
  });
});

describe("ContextMenu, grille de couleurs", () => {
  const html = renderToStaticMarkup(
    <ContextMenu
      x={10}
      y={10}
      items={[
        { label: "Dupliquer", run: noop },
        { swatches: SIDEBAR_COLORS, current: "#7d6608", pick: noop },
      ]}
      onClose={noop}
    />,
  );

  it("rend une pastille par couleur, nommée au survol", () => {
    expect(html.match(/data-swatch=/g)).toHaveLength(16);
    expect(html).toContain('title="Amber"');
    expect(html).toContain('title="Charcoal"');
  });

  it("entoure la seule couleur courante, sans tenir compte de la casse", () => {
    expect(html.match(/data-current=/g)).toHaveLength(1);
    expect(html).toMatch(/data-swatch="#7D6608"[^>]*data-current="true"/);
  });

  it("la hauteur estimée compte les deux rangées de pastilles", () => {
    // 8 (marges du menu) + 4 + 16 + 6 + 16 + 4
    expect(menuHeight([{ swatches: SIDEBAR_COLORS, pick: noop }])).toBe(54);
  });
});
