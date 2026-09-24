import { cellTooltip, dotTooltip, type Frise as FriseData } from "../../lib/frise";
import { Markdown } from "./Markdown";

function noop(): void {}

/** Opacité d'une case : un plancher visible dès le premier événement, puis la densité. */
function opacite(density: number): number {
  if (density <= 0) return 0;
  return 0.18 + 0.82 * density;
}

/**
 * Frise d'activité (écran principal du dashboard) : une ligne par projet, des
 * cases teintées à la couleur du projet selon la densité, les commits en
 * points, et sous la ligne la phrase du bilan LLM pour ce projet (`phrases`,
 * cf. `attacherPuces`) ; une rangée de repères horaires (ou journaliers) en bas.
 *
 * Composant de présentation pur : tout le calcul est dans `buildFrise`. Les
 * infobulles sont natives (`title`) — pas de bibliothèque, pas d'état.
 */
export function Frise({
  frise,
  mode,
  phrases,
  onOpenTicket,
  onOpenLink,
}: {
  frise: FriseData;
  mode: "day" | "week";
  /** Phrase du bilan par nom de projet ; absente tant qu'il n'y a pas de synthèse. */
  phrases?: Map<string, string>;
  onOpenTicket?: (url: string) => void;
  /** Liens markdown des phrases (tickets ClickUp). */
  onOpenLink?: (href: string) => void;
}) {
  if (frise.rows.length === 0) {
    return <p className="dash-frise-empty">Aucune activité {mode === "day" ? "ce jour" : "cette semaine"}</p>;
  }

  return (
    <div className="dash-frise" role="img" aria-label="Frise d'activité par projet">
      {frise.rows.map((row) => (
        <div className="dash-frise-row" key={row.dir ?? "__clickup__"}>
          <span className="dash-frise-name" style={{ color: row.color }}>
            {row.name}
          </span>
          <div className="dash-frise-strip">
            {row.cells.map((cell) =>
              cell.total === 0 ? null : (
                <span
                  key={cell.t0}
                  className="dash-frise-cell"
                  title={cellTooltip(cell, mode)}
                  style={{
                    left: `${cell.left * 100}%`,
                    width: `${cell.width * 100}%`,
                    background: row.color,
                    opacity: opacite(cell.density),
                  }}
                />
              ),
            )}
            {row.dots.map((dot) => {
              const ticket = dot.tickets[0];
              const commun = {
                className: "dash-frise-dot",
                title: dotTooltip(dot, mode),
                style: { left: `${dot.left * 100}%`, borderColor: row.color },
              };
              return ticket && onOpenTicket ? (
                <a
                  key={dot.ts}
                  {...commun}
                  href={ticket.url}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenTicket(ticket.url);
                  }}
                />
              ) : (
                <span key={dot.ts} {...commun} />
              );
            })}
          </div>
          <span className="dash-frise-count">
            {row.commits > 0 ? `${row.commits} commit${row.commits > 1 ? "s" : ""}` : ""}
          </span>
          {phrases?.has(row.name) && (
            <div className="dash-frise-phrase">
              <Markdown text={phrases.get(row.name) ?? ""} onOpenLink={onOpenLink ?? noop} />
            </div>
          )}
        </div>
      ))}
      <div className="dash-frise-row dash-frise-axis">
        <span className="dash-frise-name" />
        <div className="dash-frise-strip">
          {frise.ticks.map((tick) => (
            <span key={tick.label} className="dash-frise-tick" style={{ left: `${tick.left * 100}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
        <span className="dash-frise-count" />
      </div>
    </div>
  );
}
