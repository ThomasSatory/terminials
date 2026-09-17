import type { ActivityEvent, EventKind } from "../../lib/activityApi";
import { groupTimeline, eventIcon } from "../../lib/timelineGroups";
import { formatHm } from "../../lib/dashboardDay";
import { abbreviateHome } from "../../lib/paths";
import { KIND_COLORS } from "../../lib/chartScale";

/** Couleur de l'icône par kind ; `claude_session` reprend le bleu Claude (absent de `KIND_COLORS`,
    qui ne couvre que les 4 kinds comptés dans les statistiques). */
const ICON_COLORS: Record<EventKind, string> = {
  ...KIND_COLORS,
  claude_session: KIND_COLORS.claude_prompt,
};

/** Un événement `claude_session` s'affiche en tête de son groupe (§8 du design). */
function orderGroupEvents(events: ActivityEvent[]): ActivityEvent[] {
  const sessions = events.filter((e) => e.kind === "claude_session");
  const rest = events.filter((e) => e.kind !== "claude_session");
  return [...sessions, ...rest];
}

/**
 * Timeline groupée par workspace (§8 du design) : ordre chronologique, icône
 * par kind, heure, texte, badges ticket cliquables. `home` (optionnel, résolu
 * par le parent via `homeDir()`) sert uniquement à abréger l'affichage du
 * répertoire ; ce composant ne fait lui-même aucun appel `invoke`.
 */
export function Timeline({
  events,
  filterDir,
  filterText,
  onOpenTicket,
  home,
}: {
  events: ActivityEvent[];
  filterDir: string | null;
  filterText: string;
  onOpenTicket: (url: string) => void;
  home?: string;
}) {
  const groups = groupTimeline(events, filterDir, filterText);

  return (
    <div className="dash-timeline">
      {groups.map((group) => (
        <section className="dash-tl-group" key={group.dir ?? "__clickup__"}>
          <header className="dash-tl-group-header">
            <span className="dash-tl-group-name">{group.name}</span>
            {group.dir && <span className="dash-tl-group-dir">{abbreviateHome(group.dir, home ?? "")}</span>}
          </header>
          {orderGroupEvents(group.events).map((ev) => (
            <div className="dash-ev" key={ev.id}>
              <span className="dash-ev-time">{formatHm(ev.ts)}</span>
              <span className="dash-ev-icon" style={{ color: ICON_COLORS[ev.kind] }}>
                {eventIcon(ev.kind)}
              </span>
              <span className="dash-ev-title">{ev.title}</span>
              {ev.tickets.map((ticket) => (
                <a
                  key={ticket.id}
                  href={ticket.url}
                  title={ticket.status ?? undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    onOpenTicket(ticket.url);
                  }}
                >
                  {ticket.name ?? ticket.id}
                </a>
              ))}
            </div>
          ))}
        </section>
      ))}
    </div>
  );
}
