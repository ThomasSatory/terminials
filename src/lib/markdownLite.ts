/**
 * Parseur markdown restreint : convertit un sous-ensemble minimal de markdown
 * (titres, listes, gras, code inline, liens http/https) en un AST simple.
 *
 * Ce parseur est volontairement limité : le texte source provient d'un LLM et
 * ne doit jamais être interprété comme du HTML (pas de dangerouslySetInnerHTML
 * côté rendu). Toute syntaxe non reconnue est conservée telle quelle en texte.
 */

export type Inline =
  | { t: "text"; v: string }
  | { t: "bold"; v: string }
  | { t: "code"; v: string }
  | { t: "link"; text: string; href: string };

export type Block =
  | { t: "h"; level: 1 | 2 | 3; inl: Inline[] }
  | { t: "p"; inl: Inline[] }
  | { t: "ul"; items: Inline[][] }
  | { t: "ol"; items: Inline[][] };

const HEADING_RE = /^(#{1,3})\s+(.*)$/;
const UL_ITEM_RE = /^[-*]\s+(.*)$/;
const OL_ITEM_RE = /^\d+\.\s+(.*)$/;

/** Découpe le texte en blocs (titres, listes, paragraphes) selon les lignes. */
export function parseMarkdown(src: string): Block[] {
  // Normalise les fins de ligne Windows (CRLF) et Mac classique (CR seul) en LF
  // avant le split, pour que les regex ancrées sur `$` ne laissent pas de `\r`
  // traînant dans le texte des blocs.
  const lines = src.replace(/\r\n?/g, "\n").split("\n");
  const blocks: Block[] = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];

    if (line.trim() === "") {
      i++;
      continue;
    }

    const headingMatch = HEADING_RE.exec(line);
    if (headingMatch) {
      const level = headingMatch[1].length as 1 | 2 | 3;
      blocks.push({ t: "h", level, inl: parseInline(headingMatch[2]) });
      i++;
      continue;
    }

    if (UL_ITEM_RE.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = UL_ITEM_RE.exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1]));
        i++;
      }
      blocks.push({ t: "ul", items });
      continue;
    }

    if (OL_ITEM_RE.test(line)) {
      const items: Inline[][] = [];
      while (i < lines.length) {
        const m = OL_ITEM_RE.exec(lines[i]);
        if (!m) break;
        items.push(parseInline(m[1]));
        i++;
      }
      blocks.push({ t: "ol", items });
      continue;
    }

    // Lignes consécutives non-liste : paragraphe joint par un espace.
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !HEADING_RE.test(lines[i]) &&
      !UL_ITEM_RE.test(lines[i]) &&
      !OL_ITEM_RE.test(lines[i])
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    blocks.push({ t: "p", inl: parseInline(paraLines.join(" ")) });
  }

  return blocks;
}

const INLINE_RE = /\*\*([^*]+)\*\*|`([^`]+)`|\[([^\]]*)\]\(([^)]*)\)/g;

/** Découpe une ligne en éléments inline : gras, code, liens (http/https uniquement). */
export function parseInline(src: string): Inline[] {
  const result: Inline[] = [];
  let lastIndex = 0;

  for (const match of src.matchAll(INLINE_RE)) {
    const [full, bold, code, linkText, linkHref] = match;
    const index = match.index ?? 0;

    if (linkText !== undefined && linkHref !== undefined && !/^https?:\/\//.test(linkHref)) {
      // URL non http(s) : on ne consomme pas la syntaxe, elle reste en texte brut.
      continue;
    }

    if (index > lastIndex) {
      result.push({ t: "text", v: src.slice(lastIndex, index) });
    }

    if (bold !== undefined) {
      result.push({ t: "bold", v: bold });
    } else if (code !== undefined) {
      result.push({ t: "code", v: code });
    } else {
      result.push({ t: "link", text: linkText, href: linkHref });
    }

    lastIndex = index + full.length;
  }

  if (lastIndex < src.length) {
    result.push({ t: "text", v: src.slice(lastIndex) });
  }

  return result;
}
