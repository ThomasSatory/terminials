import { useWorkspaceStore } from "../store/workspace";

/**
 * Garde-fous de l'indicateur « agent au travail ». L'état busy vient des hooks Claude Code
 * (UserPromptSubmit/PostToolUse → busy, Stop/Notification/SessionEnd → idle), mais aucun
 * hook ne part quand l'utilisateur interrompt le tour (Échap, Ctrl+C) ni quand Claude meurt
 * sans SessionEnd : sans ces garde-fous, l'onglet resterait « au travail » pour toujours.
 */

/** Sans hook ni sortie PTY depuis ce délai, l'agent ne travaille plus : son spinner
    redessine l'écran en continu tant qu'un tour est en cours. Large, parce que Claude
    Code ralentit ses animations quand le terminal n'a pas le focus. */
export const BUSY_SILENCE_MS = 120_000;

/** Dernier signe de vie (sortie PTY ou hook busy) de chaque PTY. */
const lastSeen = new Map<number, number>();

/** Appelé à chaque paquet de sortie : un Map.set, rien d'autre (chemin chaud). */
export function noteOutput(ptyId: number, now = Date.now()): void {
  lastSeen.set(ptyId, now);
}

/** `finDeTour` : le passage au repos vient de l'agent lui-même (hook), son onglet passe
    « terminé ». Une interruption ou le balayage des silencieux passent `false`. */
export function setBusy(ptyId: number, busy: boolean, now = Date.now(), finDeTour = true): void {
  if (busy) lastSeen.set(ptyId, now);
  useWorkspaceStore.getState().setPtyBusy(ptyId, busy, finDeTour);
}

/** Échap ou Ctrl+C tapés seuls : c'est ainsi qu'on interrompt un tour de Claude Code. Une
    séquence (flèche, F-touche) commence aussi par Échap mais n'est jamais réduite à lui. */
export function isInterrupt(data: string): boolean {
  return data === "\x1b" || data === "\x03";
}

/** Saisie clavier envoyée au PTY : une interruption éteint l'indicateur. À tort, le
    PostToolUse suivant le rallume. */
export function noteInput(ptyId: number, data: string): void {
  if (isInterrupt(data) && ptyId in useWorkspaceStore.getState().busyPtys) setBusy(ptyId, false, Date.now(), false);
}

export function forget(ptyId: number): void {
  lastSeen.delete(ptyId);
}

/** PTY busy restés silencieux plus de `silenceMs`. */
export function stalePtys(
  busy: number[],
  seen: ReadonlyMap<number, number>,
  now: number,
  silenceMs = BUSY_SILENCE_MS,
): number[] {
  return busy.filter((id) => now - (seen.get(id) ?? 0) > silenceMs);
}

/** Balayage périodique des PTY busy silencieux ; renvoie la fonction d'arrêt. */
export function startBusySweep(periodMs = 10_000): () => void {
  const timer = setInterval(() => {
    const busy = Object.keys(useWorkspaceStore.getState().busyPtys).map(Number);
    for (const id of stalePtys(busy, lastSeen, Date.now())) setBusy(id, false, Date.now(), false);
  }, periodMs);
  return () => clearInterval(timer);
}
