import type { ActivityStats } from "../../lib/activityApi";
import { formatDuration } from "../../lib/dashboardDay";

/** Totaux affichés en tuiles (§8 du design) — extrait de `ActivityStats.totals`. */
type Totals = ActivityStats["totals"];

const TILES: Array<{ key: keyof Totals; label: string; format: (v: number) => string }> = [
  { key: "commits", label: "commits", format: String },
  { key: "prompts", label: "prompts Claude", format: String },
  { key: "commands", label: "commandes", format: String },
  { key: "tickets", label: "tickets touchés", format: String },
  { key: "activeMinutes", label: "temps actif", format: formatDuration },
];

/** Tuiles de synthèse du dashboard : commits, prompts, commandes, tickets, temps actif. */
export function StatTiles({ totals }: { totals: Totals }) {
  return (
    <div className="dash-tiles">
      {TILES.map((tile) => (
        <div className="dash-tile" key={tile.key}>
          <div className="dash-tile-value">{tile.format(totals[tile.key])}</div>
          <div className="dash-tile-label">{tile.label}</div>
        </div>
      ))}
    </div>
  );
}
