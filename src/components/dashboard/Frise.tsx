import { useMemo, useState, type MouseEvent } from "react";
import {
  colonneA,
  colonnesEmpilees,
  dotTooltip,
  dureeActive,
  survolColonne,
  type Frise as FriseData,
  type FriseDot,
  type FriseRow,
  type SurvolColonne,
} from "../../lib/frise";
import { Markdown } from "./Markdown";
import { StatutClickup } from "./StatutClickup";

function noop(): void {}

/** « 4 commits · 5 h 15 » sous le nom du projet ; la durée seule sans commit. */
function metaLigne(row: FriseRow, cellSeconds: number): string {
  const commits = row.commits > 0 ? `${row.commits} commit${row.commits > 1 ? "s" : ""}` : "";
  return [commits, dureeActive(row, cellSeconds)].filter(Boolean).join(" · ");
}

/**
 * Frise d'activité (écran principal du dashboard), variante « rythme empilé » :
 * une seule bande de temps où, à chaque case, les projets actifs s'empilent à
 * leur couleur — la hauteur dit l'intensité du moment, les couleurs sur quoi.
 * Les commits sont des anneaux au-dessus de la bande. Dessous, une légende par
 * projet (temps actif, commits) qui porte ce que le bilan LLM en dit — ses
 * puces, ou la phrase d'un bilan v3 (`phrases`, cf. `attacherPuces`).
 *
 * Le calcul est dans `buildFrise`, `colonnesEmpilees` et `survolColonne`.
 * L'infobulle est dessinée par le composant plutôt que confiée à `title`
 * (texte brut, lent à venir, peu fiable dans le webview) : elle suit le
 * pointeur sur toute la hauteur de la bande, et un anneau de commit a la sienne.
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

  return <FriseChart frise={frise} mode={mode} phrases={phrases} onOpenTicket={onOpenTicket} onOpenLink={onOpenLink} />;
}

/** Ce que montre l'infobulle : une colonne de temps, ou un commit. */
type Survol =
  | { x: number; y: number; colonne: SurvolColonne }
  | { x: number; y: number; commit: { lignes: string[]; color: string } };

/** Écart au bord de la fenêtre, et entre le pointeur et l'infobulle. */
const MARGE = 14;
const LARGEUR_BULLE = 360;

function FriseChart({
  frise,
  mode,
  phrases,
  onOpenTicket,
  onOpenLink,
}: {
  frise: FriseData;
  mode: "day" | "week";
  phrases?: Map<string, string>;
  onOpenTicket?: (url: string) => void;
  onOpenLink?: (href: string) => void;
}) {
  const [survol, setSurvol] = useState<Survol | null>(null);
  const colonnes = useMemo(() => colonnesEmpilees(frise), [frise]);
  const points: Array<{ dot: FriseDot; color: string }> = frise.rows
    .flatMap((row) => row.dots.map((dot) => ({ dot, color: row.color })))
    .sort((a, b) => a.dot.ts - b.dot.ts);

  const surBande = (e: MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const col = colonneA(colonnes, (e.clientX - rect.left) / rect.width);
    setSurvol(col ? { x: e.clientX, y: e.clientY, colonne: survolColonne(col, frise, mode) } : null);
  };

  return (
    <div className="dash-frise">
      <div className="dash-frise-chart" role="img" aria-label="Rythme d'activité par projet">
        <div className="dash-frise-commits">
          {points.map(({ dot, color }) => {
            const ticket = dot.tickets[0];
            const lignes = dotTooltip(dot, mode).split("\n");
            const commun = {
              className: "dash-frise-dot",
              "aria-label": lignes[0],
              style: { left: `${dot.left * 100}%`, borderColor: color },
              onMouseMove: (e: MouseEvent) => setSurvol({ x: e.clientX, y: e.clientY, commit: { lignes, color } }),
              onMouseLeave: () => setSurvol(null),
            };
            return ticket && onOpenTicket ? (
              <a
                key={`${dot.ts}-${color}`}
                {...commun}
                href={ticket.url}
                onClick={(e) => {
                  e.preventDefault();
                  onOpenTicket(ticket.url);
                }}
              />
            ) : (
              <span key={`${dot.ts}-${color}`} {...commun} />
            );
          })}
        </div>
        <div className="dash-frise-stack" onMouseMove={surBande} onMouseLeave={() => setSurvol(null)}>
          {colonnes.map((col) => (
            <div
              key={col.t0}
              className={
                survol && "colonne" in survol && survol.colonne.t0 === col.t0
                  ? "dash-frise-col dash-frise-col-survol"
                  : "dash-frise-col"
              }
              style={{ left: `${col.left * 100}%`, width: `${col.width * 100}%` }}
            >
              {col.segments.map((seg) => (
                <span
                  key={seg.name}
                  className="dash-frise-seg"
                  style={{ height: `${seg.part * 100}%`, background: seg.color }}
                />
              ))}
            </div>
          ))}
        </div>
        <div className="dash-frise-axis">
          {frise.ticks.map((tick) => (
            <span key={tick.label} className="dash-frise-tick" style={{ left: `${tick.left * 100}%` }}>
              {tick.label}
            </span>
          ))}
        </div>
      </div>
      <div className="dash-frise-legend">
        {frise.rows.map((row) => (
          <div className="dash-frise-row" key={row.dir}>
            <div className="dash-frise-head">
              <span className="dash-frise-swatch" style={{ background: row.color }} />
              <span className="dash-frise-name">{row.name}</span>
              <span className="dash-frise-count">{metaLigne(row, frise.cellSeconds)}</span>
            </div>
            {phrases?.has(row.name) && (
              <div className="dash-frise-phrase">
                <Markdown text={phrases.get(row.name) ?? ""} onOpenLink={onOpenLink ?? noop} />
              </div>
            )}
          </div>
        ))}
      </div>
      {survol && <Bulle survol={survol} />}
    </div>
  );
}

/**
 * Infobulle de la frise, en position fixe près du pointeur : l'overlay défile
 * et coupe ses débordements, une bulle fixe n'est jamais rognée. Elle bascule
 * à gauche du pointeur près du bord droit.
 */
function Bulle({ survol }: { survol: Survol }) {
  const aGauche = survol.x + MARGE + LARGEUR_BULLE > window.innerWidth;
  const style = {
    top: survol.y + MARGE,
    left: aGauche ? Math.max(MARGE, survol.x - MARGE - LARGEUR_BULLE) : survol.x + MARGE,
    width: LARGEUR_BULLE,
  };
  if ("commit" in survol) {
    const [titre, ...reste] = survol.commit.lignes;
    return (
      <div className="dash-bulle" style={style} role="tooltip">
        <p className="dash-bulle-titre">
          <span className="dash-frise-swatch" style={{ background: survol.commit.color }} />
          {titre}
        </p>
        {reste.map((l) => (
          <p key={l} className="dash-bulle-sous">
            {l}
          </p>
        ))}
      </div>
    );
  }
  const { colonne } = survol;
  return (
    <div className="dash-bulle" style={style} role="tooltip">
      <p className="dash-bulle-heure">{colonne.titre}</p>
      {colonne.projets.map((p) => (
        <div key={p.name} className="dash-bulle-projet">
          <p className="dash-bulle-titre">
            <span className="dash-frise-swatch" style={{ background: p.color }} />
            {p.name}
            <span className="dash-bulle-detail">{p.detail}</span>
          </p>
          {p.us.map((t) => (
            <p key={t.id} className="dash-bulle-us">
              <span className="dash-bulle-us-id">{t.id}</span>
              <span className="dash-bulle-us-nom">{t.name ?? ""}</span>
              <StatutClickup status={t.status} />
            </p>
          ))}
          {p.commits.map((c) => (
            <p key={c} className="dash-bulle-sous">
              ● {c}
            </p>
          ))}
          {p.extraits.map((x) => (
            <p key={x} className="dash-bulle-extrait">
              « {x} »
            </p>
          ))}
        </div>
      ))}
    </div>
  );
}
