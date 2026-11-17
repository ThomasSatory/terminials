import type { ReactNode } from "react";
import { tonStatut } from "../../lib/clickupStatut";

/**
 * Pastille d'identifiant de ticket (JetBrains Mono 11 px, accent sur fond accent
 * adouci) : un lien qui ouvre le ticket par `onOpen` plutôt que par la navigation
 * du webview. Sans URL, la même pastille en simple texte.
 */
export function Ticket({
  id,
  url,
  titre,
  onOpen,
  className,
}: {
  id: string;
  url?: string | null;
  /** Nom du ticket, en infobulle. */
  titre?: string | null;
  onOpen: (url: string) => void;
  className?: string;
}) {
  const classes = className ? `rc-tk ${className}` : "rc-tk";
  if (!url) {
    return (
      <span className={classes} title={titre ?? undefined}>
        {id}
      </span>
    );
  }
  return (
    <a
      className={classes}
      href={url}
      title={titre ?? undefined}
      onClick={(e) => {
        e.preventDefault();
        onOpen(url);
      }}
    >
      {id}
    </a>
  );
}

/**
 * Pastille d'état d'une tâche, teintée par famille d'état (`tonStatut`) : revue et
 * recette en avertissement, en cours en texte fort, le reste discret.
 */
export function Statut({ status }: { status: string | null | undefined }): ReactNode {
  if (!status) return null;
  return (
    <span className="rc-statut" data-ton={tonStatut(status)}>
      {status}
    </span>
  );
}
