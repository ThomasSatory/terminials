import type { WorkspaceCount } from "../../lib/activityApi";
import { niceMax } from "../../lib/chartScale";

/**
 * Barres horizontales par workspace (§8 du design) : clic = filtre de la
 * timeline (toggle — cliquer la ligne déjà sélectionnée la désélectionne).
 */
export function WorkspaceBars({
  rows,
  selected,
  onSelect,
}: {
  rows: WorkspaceCount[];
  selected: string | null;
  onSelect: (dir: string | null) => void;
}) {
  const max = niceMax(rows.map((r) => r.events));
  return (
    <div className="dash-wsbars">
      {rows.map((row) => {
        const pressed = row.dir === selected;
        const pct = Math.min(100, (row.events / max) * 100);
        return (
          <button
            key={row.dir}
            type="button"
            className="dash-wsbar"
            aria-pressed={pressed}
            onClick={() => onSelect(pressed ? null : row.dir)}
          >
            <span className="dash-wsbar-name">{row.name}</span>
            <span className="dash-wsbar-track">
              <span className="dash-wsbar-fill" style={{ width: `${pct}%` }} />
            </span>
            <span className="dash-wsbar-count">{row.events}</span>
          </button>
        );
      })}
    </div>
  );
}
