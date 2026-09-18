import type { WeekDayRow } from "../../lib/weekDays";

/**
 * Colonne « Jour par jour » du mode semaine (tâche 17) : une ligne cliquable
 * par jour, qui ouvre la journée correspondante. Tout le calcul est dans
 * `buildWeekDays` ; ce composant ne fait que peindre.
 */
export function WeekDays({
  rows,
  selectedDay,
  onSelect,
}: {
  rows: WeekDayRow[];
  selectedDay: string;
  onSelect: (day: string) => void;
}) {
  return (
    <div className="dash-dayrows">
      {rows.map((row) => (
        <button
          type="button"
          className="dash-dayrow"
          key={row.day}
          aria-pressed={row.day === selectedDay}
          onClick={() => onSelect(row.day)}
        >
          <span className="dash-dayrow-label">{row.label}</span>
          {row.future ? (
            <span className="dash-dayrow-future">à venir</span>
          ) : (
            <span className="dash-dayrow-main">
              {row.fait && <span className="dash-dayrow-fait">{row.fait}</span>}
              {row.compteurs && <span className="dash-dayrow-counts">{row.compteurs}</span>}
              {row.segments.length > 0 && (
                <span className="dash-dayrow-bar">
                  {row.segments.map((seg) => (
                    <span
                      key={seg.dir ?? "__clickup__"}
                      className="dash-dayrow-seg"
                      // Part et teinte du projet : les deux seules valeurs dynamiques.
                      style={{ flex: seg.events, background: seg.color }}
                    />
                  ))}
                </span>
              )}
            </span>
          )}
        </button>
      ))}
    </div>
  );
}
