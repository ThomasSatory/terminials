import type { ReactNode } from "react";
import { Fragment } from "react";
import { parseMarkdown, type Block, type Inline } from "../../lib/markdownLite";

/**
 * Rendu React d'un texte markdown restreint (voir `markdownLite`).
 *
 * Ne rend jamais de HTML brut (pas de dangerouslySetInnerHTML) : le texte
 * provient d'un LLM et n'est jamais fiable. Seuls les liens http(s) deviennent
 * des `<a>` cliquables ; le clic est intercepté pour passer par `onOpenLink`
 * plutôt que par la navigation par défaut.
 */
export function Markdown({ text, onOpenLink }: { text: string; onOpenLink: (href: string) => void }) {
  const blocks = parseMarkdown(text);
  return (
    <div className="dash-md">
      {blocks.map((block, i) => (
        <Fragment key={i}>{renderBlock(block, onOpenLink)}</Fragment>
      ))}
    </div>
  );
}

function renderBlock(block: Block, onOpenLink: (href: string) => void): ReactNode {
  switch (block.t) {
    case "h": {
      const Tag = (`h${block.level}` as unknown) as "h1" | "h2" | "h3";
      return <Tag>{renderInline(block.inl, onOpenLink)}</Tag>;
    }
    case "p":
      return <p>{renderInline(block.inl, onOpenLink)}</p>;
    case "ul":
      return (
        <ul>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item, onOpenLink)}</li>
          ))}
        </ul>
      );
    case "ol":
      return (
        <ol>
          {block.items.map((item, i) => (
            <li key={i}>{renderInline(item, onOpenLink)}</li>
          ))}
        </ol>
      );
  }
}

function renderInline(inl: Inline[], onOpenLink: (href: string) => void): ReactNode {
  return inl.map((node, i) => {
    switch (node.t) {
      case "text":
        return <Fragment key={i}>{node.v}</Fragment>;
      case "bold":
        return <strong key={i}>{node.v}</strong>;
      case "code":
        return <code key={i}>{node.v}</code>;
      case "link":
        return (
          <a
            key={i}
            href={node.href}
            onClick={(e) => {
              e.preventDefault();
              onOpenLink(node.href);
            }}
          >
            {node.text}
          </a>
        );
    }
  });
}
