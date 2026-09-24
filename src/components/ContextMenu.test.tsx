import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { ContextMenu } from "./ContextMenu";

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
