import type { WorkspaceCount } from "../../lib/activityApi";
import { assignWorkspaceColors } from "../../lib/workspacePalette";

/**
 * Rangée de chips workspaces sous la phrase de chiffres (tâche 17) : un carré
 * de la teinte du projet, son nom, son nombre d'événements. Un clic filtre la
 * chronologie ; recliquer le chip actif enlève le filtre.
 *
 * Les teintes viennent de `assignWorkspaceColors` sur ces mêmes lignes : le
 * dashboard entier (chips, glyphes, barres) partage donc la même affectation.
 */
export function WorkspaceChips({
  rows,
  selected,
  onSelect,
}: {
  rows: WorkspaceCount[];
  selected: string | null;
  onSelect: (dir: string | null) => void;
}) {
  if (rows.length === 0) return null;
  const colors = assignWorkspaceColors(rows);

  return (
    <div className="dash-chips">
      {rows.map((row) => {
        const pressed = row.dir === selected;
        return (
          <button
            key={row.dir}
            type="button"
            className="dash-chip"
            aria-pressed={pressed}
            onClick={() => onSelect(pressed ? null : row.dir)}
          >
            {/* Seule couleur dynamique de la rangée : elle ne peut pas vivre dans la feuille. */}
            <span className="dash-chip-dot" style={{ background: colors.get(row.dir) }} />
            <span>{row.name}</span>
            <span className="dash-chip-count">{row.events}</span>
          </button>
        );
      })}
      <span className="dash-chips-hint">cliquer pour filtrer</span>
    </div>
  );
}
