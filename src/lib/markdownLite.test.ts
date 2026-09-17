import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { parseMarkdown, parseInline } from "./markdownLite";
import { Markdown } from "../components/dashboard/Markdown";

describe("parseMarkdown", () => {
  it("titres, listes, paragraphes", () => {
    expect(parseMarkdown("## Bilan\n- a\n- **b** fort\n\nTexte\nsuite\n1. un\n2. deux")).toEqual([
      { t: "h", level: 2, inl: [{ t: "text", v: "Bilan" }] },
      { t: "ul", items: [[{ t: "text", v: "a" }], [{ t: "bold", v: "b" }, { t: "text", v: " fort" }]] },
      { t: "p", inl: [{ t: "text", v: "Texte suite" }] },
      { t: "ol", items: [[{ t: "text", v: "un" }], [{ t: "text", v: "deux" }]] },
    ]);
  });

  it("texte brut sans balise reste un paragraphe", () => {
    expect(parseMarkdown("<b>x</b>")).toEqual([{ t: "p", inl: [{ t: "text", v: "<b>x</b>" }] }]);
  });

  it("fins de ligne CRLF donnent le même AST qu'en LF", () => {
    const lf = "## Bilan\n- a\n- b\n";
    const crlf = "## Bilan\r\n- a\r\n- b\r\n";
    expect(parseMarkdown(crlf)).toEqual(parseMarkdown(lf));
  });
});

describe("parseInline", () => {
  it("liens http seulement, code inline", () => {
    expect(
      parseInline("voir [86c1abc](https://app.clickup.com/t/86c1abc) et `npm test` et [x](javascript:alert(1))")
    ).toEqual([
      { t: "text", v: "voir " },
      { t: "link", text: "86c1abc", href: "https://app.clickup.com/t/86c1abc" },
      { t: "text", v: " et " },
      { t: "code", v: "npm test" },
      { t: "text", v: " et [x](javascript:alert(1))" },
    ]);
  });
});

describe("Markdown", () => {
  it("rend des liens cliquables sans innerHTML", () => {
    const html = renderToStaticMarkup(createElement(Markdown, { text: "- [t](https://x.y)", onOpenLink: () => {} }));
    expect(html).toContain('<a href="https://x.y"');
    expect(html).toContain("<li>");
  });
});
