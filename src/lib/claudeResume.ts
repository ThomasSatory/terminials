/** Session Claude Code qui tourne dans un onglet, signalée par le hook SessionStart. */
export interface ClaudeSession {
  id: string;
  /** Dossier de la session : `claude --resume` ne retrouve une session que depuis son projet. */
  cwd: string;
}

const SESSION_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Vrai pour un id de session Claude Code (UUID). Tout autre texte est refusé : l'id finit
    tapé dans un shell, il ne doit rien pouvoir y injecter. */
export function isClaudeSessionId(v: unknown): v is string {
  return typeof v === "string" && SESSION_ID.test(v);
}

/** Session valide lue d'une source non sûre (socket, localStorage), sinon null. */
export function parseClaudeSession(v: unknown): ClaudeSession | null {
  if (typeof v !== "object" || v === null) return null;
  const { id, cwd } = v as Record<string, unknown>;
  if (!isClaudeSessionId(id) || typeof cwd !== "string" || cwd === "") return null;
  return { id, cwd };
}

/** Ligne tapée dans le shell d'un onglet restauré pour reprendre sa session. */
export function resumeCommand(id: string): string | null {
  return isClaudeSessionId(id) ? `claude --resume ${id}\r` : null;
}

/** Retire de l'entrée sauvegardée les sessions Claude dont le dossier n'existe plus. */
export async function keepExistingSessions<T extends { claudeSessions?: (ClaudeSession | null)[] }>(
  entry: T,
  dirExists: (path: string) => Promise<boolean>,
): Promise<T> {
  const sessions = entry.claudeSessions;
  if (!sessions) return entry;
  const kept = await Promise.all(
    sessions.map(async (x) => (x && (await dirExists(x.cwd).catch(() => false)) ? x : null)),
  );
  if (kept.every((x) => x === null)) {
    const { claudeSessions: _none, ...rest } = entry;
    return rest as T;
  }
  return { ...entry, claudeSessions: kept };
}
