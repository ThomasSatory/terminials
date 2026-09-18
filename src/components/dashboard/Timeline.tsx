import type { ActivityEvent, EventKind } from "../../lib/activityApi";
import { groupByHour, type TimelineLine } from "../../lib/timelineHours";

/** Forme du glyphe par kind : rond plein pour un commit, losange bordé pour
    Claude, chevron pour le shell, carré plein pour ClickUp. La couleur, elle,
    vient du workspace et arrive en style inline. */
const GLYPHES: Record<EventKind, string> = {
  commit: "dash-glyph-commit",
  claude_prompt: "dash-glyph-losange",
  claude_session: "dash-glyph-losange",
  shell_cmd: "dash-glyph-shell",
  clickup_change: "dash-glyph-carre",
};

function Ligne({
  line,
  onOpenTicket,
}: {
  line: TimelineLine;
  onOpenTicket: (url: string) => void;
}) {
  return (
    <div className={line.muted ? "dash-line dash-line-muted" : "dash-line"}>
      <span className={`dash-glyph ${GLYPHES[line.kind]}`} style={{ color: line.color }}>
        {line.kind === "shell_cmd" ? ">" : null}
      </span>
      <span>
        {line.text}
        {line.tickets.map((ticket) => (
          <span key={ticket.id}>
            {" "}
            <a
              href={ticket.url}
              title={ticket.status ?? undefined}
              onClick={(e) => {
                e.preventDefault();
                onOpenTicket(ticket.url);
              }}
            >
              {ticket.name ?? ticket.id}
            </a>
          </span>
        ))}
        {line.workspaceName && (
          <span className="dash-ws-suffix" style={{ color: line.color }}>
            {" "}
            {line.workspaceName}
          </span>
        )}
      </span>
    </div>
  );
}

/**
 * Chronologie du jour (tâche 17) : une règle verticale discrète, groupée par
 * heure. Tout le calcul (filtrage, agrégation, teintes) est dans `groupByHour` ;
 * ce composant ne fait que peindre, et ne fait aucun appel `invoke`.
 */
export function Timeline({
  events,
  filterDir,
  filterText,
  colors,
  onOpenTicket,
}: {
  events: ActivityEvent[];
  filterDir: string | null;
  filterText: string;
  colors: Map<string, string>;
  onOpenTicket: (url: string) => void;
}) {
  const hours = groupByHour(events, filterDir, filterText, colors);

  if (hours.length === 0) {
    return <p className="dash-tl-empty">Aucune activité ce jour</p>;
  }

  return (
    <div className="dash-rule">
      {hours.map((hour) => (
        <div className="dash-hour" key={hour.hour}>
          <span className="dash-hour-label">{hour.hour}h</span>
          <div className="dash-hour-lines">
            {hour.lines.map((line, i) => (
              <Ligne key={i} line={line} onOpenTicket={onOpenTicket} />
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}
