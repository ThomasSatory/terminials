import type { ActivityStats, WorkspaceCount } from "./activityApi";
import { formatDuration } from "./dashboardDay";

type Totals = ActivityStats["totals"];

/** Part d'événements à partir de laquelle un projet « prend » toute la journée. */
const SEUIL_DOMINANT = 0.7;

/** « 4 commits » / « 1 commit ». */
function compte(n: number, singulier: string, pluriel: string): string {
  return `${n} ${n === 1 ? singulier : pluriel}`;
}

/** « a, b et c » — virgules puis « et » devant le dernier morceau. */
function enumerer(parts: string[]): string {
  if (parts.length <= 1) return parts[0] ?? "";
  return `${parts.slice(0, -1).join(", ")} et ${parts[parts.length - 1]}`;
}

/**
 * Queue de la phrase, sur la répartition par projet :
 * un seul projet → « , sur <nom> » ; plusieurs dont un ≥ 70 % des événements →
 * « , presque tout sur <nom> » ; plusieurs équilibrés → « , sur N projets ».
 *
 * Le seuil ne s'applique qu'à partir de deux projets : avec un seul, la part
 * vaut toujours 100 % et « presque tout » n'aurait aucun sens.
 */
function queue(byWorkspace: WorkspaceCount[]): string {
  if (byWorkspace.length === 0) return "";
  const tries = [...byWorkspace].sort((a, b) => b.events - a.events || a.dir.localeCompare(b.dir));
  if (tries.length === 1) return `, sur ${tries[0].name}`;
  const total = tries.reduce((sum, r) => sum + r.events, 0);
  if (total > 0 && tries[0].events / total >= SEUIL_DOMINANT) {
    return `, presque tout sur ${tries[0].name}`;
  }
  return `, sur ${tries.length} projets`;
}

/**
 * Phrase de chiffres de l'en-tête (tâche 17), qui remplace les tuiles :
 * « 4 commits, 38 échanges avec Claude, 112 commandes et 6 h 40 d'activité,
 * presque tout sur terminials. »
 *
 * Les compteurs à zéro sont omis ; tout à zéro donne « Aucune activité
 * enregistrée. ». Les tickets touchés n'y figurent pas : ils ont déjà leur
 * place dans « Reste à faire ».
 */
export function statsSentence(totals: Totals, byWorkspace: WorkspaceCount[]): string {
  const parts: string[] = [];
  if (totals.commits > 0) parts.push(compte(totals.commits, "commit", "commits"));
  if (totals.prompts > 0) {
    parts.push(compte(totals.prompts, "échange avec Claude", "échanges avec Claude"));
  }
  if (totals.commands > 0) parts.push(compte(totals.commands, "commande", "commandes"));
  if (totals.activeMinutes > 0) parts.push(`${formatDuration(totals.activeMinutes)} d'activité`);

  if (parts.length === 0) return "Aucune activité enregistrée.";
  return `${enumerer(parts)}${queue(byWorkspace)}.`;
}
