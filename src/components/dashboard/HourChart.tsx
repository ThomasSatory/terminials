import { KIND_COLORS, KIND_LABELS, KIND_ORDER, kindTotal, niceMax, stackSegments, visibleHours } from "../../lib/chartScale";
import type { DayCounts, HourCounts, KindCounts } from "../../lib/activityApi";

/** Hauteur utile du graphique (px, dans le viewBox) ; place sous les barres réservée aux libellés d'axe. */
const HEIGHT = 120;
const LABEL_SPACE = 20;
const BAR_WIDTH = 18;
const BAR_GAP = 8;

const EMPTY_COUNTS: KindCounts = { commit: 0, claude_prompt: 0, shell_cmd: 0, clickup_change: 0 };

interface Column {
  key: string;
  label: string;
  counts: KindCounts;
  showLabel: boolean;
}

function buildHourColumns(byHour: HourCounts[]): Column[] {
  const byHourMap = new Map(byHour.map((h) => [h.hour, h]));
  return visibleHours(byHour).map((hour) => ({
    key: `h${hour}`,
    label: `${hour}h`,
    counts: byHourMap.get(hour) ?? EMPTY_COUNTS,
    // Un libellé toutes les 3 heures pour ne pas surcharger l'axe.
    showLabel: hour % 3 === 0,
  }));
}

function buildDayColumns(byDay: DayCounts[]): Column[] {
  return byDay.map((d) => ({ key: d.day, label: d.day.slice(5), counts: d, showLabel: true }));
}

/** Tooltip natif d'une barre, ex. "9h · 2 commits · 1 prompt Claude". */
function tooltip(label: string, c: KindCounts): string {
  const parts = KIND_ORDER.filter((k) => c[k] > 0).map((k) => `${c[k]} ${KIND_LABELS[k]}`);
  return parts.length ? `${label} · ${parts.join(" · ")}` : label;
}

type HourChartData = { kind: "hour"; byHour: HourCounts[] } | { kind: "day"; byDay: DayCounts[] };

/** Graphique en barres empilées par kind (SVG maison, §8 du design). */
export function HourChart({ data }: { data: HourChartData }) {
  const columns = data.kind === "hour" ? buildHourColumns(data.byHour) : buildDayColumns(data.byDay);
  const scaleMax = niceMax(columns.map((c) => kindTotal(c.counts)));
  const width = Math.max(1, columns.length) * (BAR_WIDTH + BAR_GAP);

  return (
    <svg
      className="dash-hourchart"
      viewBox={`0 0 ${width} ${HEIGHT + LABEL_SPACE}`}
      width="100%"
      role="img"
      aria-label="Activité par heure"
    >
      {columns.map((col, i) => {
        const x = i * (BAR_WIDTH + BAR_GAP);
        const segments = stackSegments(col.counts, scaleMax, HEIGHT);
        return (
          <g className="bar" key={col.key}>
            <title>{tooltip(col.label, col.counts)}</title>
            {segments.map((seg) => (
              <rect key={seg.kind} x={x} y={seg.y} width={BAR_WIDTH} height={seg.h} fill={KIND_COLORS[seg.kind]} />
            ))}
            {col.showLabel && (
              <text className="dash-hourchart-label" x={x + BAR_WIDTH / 2} y={HEIGHT + 14} textAnchor="middle">
                {col.label}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}
