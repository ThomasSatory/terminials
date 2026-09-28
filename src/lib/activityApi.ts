import { invoke } from "@tauri-apps/api/core";
import type { EntreeTemps } from "./tempsSaisie";

/**
 * Contrat IPC du dashboard d'activité (§7 du design). Toutes les commandes
 * `activity_*` sont côté Rust ; les clés JSON sont en camelCase (Tauri convertit
 * automatiquement les arguments camelCase vers les paramètres snake_case Rust),
 * les timestamps sont en epoch secondes, les jours en "YYYY-MM-DD" (heure locale).
 */

export type EventKind =
  | "commit"
  | "claude_prompt"
  | "claude_session"
  | "shell_cmd"
  | "clickup_change";

export interface TicketRef {
  id: string;
  name?: string | null;
  status?: string | null;
  url: string;
}

export interface ActivityEvent {
  id: number;
  ts: number;
  kind: EventKind;
  workspaceDir?: string | null;
  branch?: string | null;
  title: string;
  body?: string | null;
  ticketIds: string[];
  tickets: TicketRef[];
  /** US déduite de la branche ou du worktree (`ABC-123-…`), résolue côté Rust. */
  usTicket?: TicketRef | null;
}

/** Compteurs par type d'événement — les clés restent en snake_case (alignées sur EventKind). */
export interface KindCounts {
  commit: number;
  claude_prompt: number;
  shell_cmd: number;
  clickup_change: number;
}

export interface HourCounts extends KindCounts {
  hour: number;
}

export interface DayCounts extends KindCounts {
  day: string;
}

export interface WorkspaceCount {
  dir: string;
  name: string;
  events: number;
  commits: number;
}

export interface ActivityStats {
  totals: {
    commits: number;
    prompts: number;
    commands: number;
    tickets: number;
    activeMinutes: number;
  };
  byHour: HourCounts[];
  byDay: DayCounts[];
  byWorkspace: WorkspaceCount[];
}

export type SummaryKind = "bilan" | "reste_a_faire" | "semaine";

export interface Summary {
  /** Jour sous lequel la synthèse est rangée ; pour `semaine`, le lundi de la semaine. */
  day: string;
  text: string;
  model: string;
  generatedAt: number;
  cached: boolean;
}

export interface OpenTask {
  id: string;
  name: string;
  status: string;
  url: string;
  dueDate?: number | null;
  priority?: string | null;
  listName?: string | null;
}

export interface CollectReport {
  git: number;
  claude: number;
  clickup: number;
  errors: string[];
}

export interface ActivityStatus {
  lastCollect: Record<string, number>;
  errors: string[];
  shellIntegration: boolean;
  dbError?: string | null;
}

/** D'où viennent les tâches ClickUp (miroir de `ClickupSource` côté Rust). */
export type ClickupSource = "claude_mcp" | "api" | "off";

export interface ClickupSettings {
  source: ClickupSource;
  token: string;
}

export interface ActivitySettings {
  llm: {
    provider: "openai" | "ollama" | "claude_cli";
    baseUrl: string;
    model: string;
    token: string;
    extraHeaders: Record<string, string>;
    temperature: number;
    maxTokens: number;
    tokenCommand: string | null;
  };
  clickup: ClickupSettings;
  schedule: {
    hour: number;
    minute: number;
    weekdaysOnly: boolean;
  };
  shell: {
    integration: boolean;
    ignoredCommands: string[];
  };
  git: {
    authorEmail: string | null;
  };
  ticketPatterns: string[];
  saisie: SaisieSettings;
}

/** Issue d'une entrée de temps (miroir de `ResultatSaisie` côté Rust). */
export interface ResultatSaisie {
  taskId: string;
  ok: boolean;
  erreur?: string | null;
}

/** Saisie des temps (miroir de `SaisieSettings` côté Rust). */
export interface SaisieSettings {
  /** Minutes à saisir du lundi au jeudi. */
  journeeMinutes: number;
  /** Minutes à saisir le vendredi. */
  vendrediMinutes: number;
  /** US qui reçoit le temps sans US ; vide = l'US « Réunion » du sprint. */
  usReunion: string;
}

export const activityApi = {
  registerWorkspaces: (dirs: string[]): Promise<void> =>
    invoke("activity_register_workspaces", { dirs }),

  collectNow: (): Promise<CollectReport> => invoke("activity_collect_now"),

  query: (from: number, to: number, workspaceDir?: string): Promise<ActivityEvent[]> =>
    invoke("activity_query", { from, to, workspaceDir }),

  stats: (from: number, to: number): Promise<ActivityStats> =>
    invoke("activity_stats", { from, to }),

  /** Génère (ou relit le cache) — peut déclencher un appel LLM de plusieurs dizaines de secondes. */
  summary: (day: string, kind: SummaryKind, force?: boolean): Promise<Summary> =>
    invoke("activity_summary", { day, kind, force: force ?? false }),

  /**
   * Lecture seule du cache de synthèses : `null` si rien n'a encore été généré
   * pour ce jour. N'appelle jamais le LLM — c'est le chemin du chargement
   * automatique (montage, changement de jour, `activity-updated`).
   */
  summaryCached: (day: string, kind: SummaryKind): Promise<Summary | null> =>
    invoke("activity_summary_cached", { day, kind }),

  openTasks: (): Promise<OpenTask[]> => invoke("activity_open_tasks"),

  status: (): Promise<ActivityStatus> => invoke("activity_status"),

  /** Temps déjà saisi dans ClickUp depuis le dashboard ce jour-là, par id d'US. */
  saisies: (day: string): Promise<Record<string, number>> => invoke("activity_saisies", { day }),

  /** Saisit des temps dans ClickUp (`claude -p` + MCP) : plusieurs dizaines de secondes. */
  saisirTemps: (day: string, entrees: EntreeTemps[]): Promise<ResultatSaisie[]> =>
    invoke("activity_saisir_temps", { day, entrees }),

  /** US « Réunion » du sprint en cours, `null` tant qu'aucune collecte ne l'a trouvée. */
  reunionUs: (): Promise<TicketRef | null> => invoke("activity_reunion_us"),

  getSettings: (): Promise<ActivitySettings> => invoke("activity_get_settings"),

  setSettings: (settings: ActivitySettings): Promise<void> =>
    invoke("activity_set_settings", { settings }),
};

/**
 * Vrai si la collecte ClickUp est configurée. Le mode MCP n'a pas besoin de
 * jeton : c'est Claude Code qui porte l'authentification du serveur `clickup`.
 */
export function clickupActif(clickup: ClickupSettings): boolean {
  return clickup.source !== "off" && (clickup.source !== "api" || clickup.token !== "");
}

/** Vrai si `err` est une erreur de jeton LLM expiré (convention "unauthorized:" en préfixe). */
export function isUnauthorized(err: unknown): boolean {
  return String(err).startsWith("unauthorized:");
}
