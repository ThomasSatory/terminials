import { etatEspace, type EspaceEtat, type SourcesTravail } from "./etatAgent";

/**
 * Son « un agent vous attend » (réglage Paramètres › Agents et notifications › Son) :
 * détection des passages en attente, en logique pure, et le son lui-même, synthétisé en
 * WebAudio (deux notes brèves et douces : rien à charger, rien à empaqueter).
 */

/** Deux passages en attente plus rapprochés que ça ne sonnent qu'une fois. */
export const INTERVALLE_SON_MS = 1500;

/** Ids des espaces dont un agent attend (même règle que la pastille du dock). */
export function idsEnAttente(s: SourcesTravail & { workspaces: readonly (EspaceEtat & { id: string })[] }): Set<string> {
  return new Set(s.workspaces.filter((w) => etatEspace(w, s) === "attente").map((w) => w.id));
}

/** Espaces passés en attente d'un instantané à l'autre. */
export function espacesPassesEnAttente(avant: ReadonlySet<string>, apres: ReadonlySet<string>): string[] {
  return [...apres].filter((id) => !avant.has(id));
}

export function sonPermis(dernier: number, maintenant: number): boolean {
  return maintenant - dernier >= INTERVALLE_SON_MS;
}

let contexte: AudioContext | null = null;

/** Deux notes (la5 puis mi6), enveloppe courte, volume bas. Silencieux sans WebAudio. */
export function jouerSonAttente(): void {
  try {
    const Ctor = globalThis.AudioContext;
    if (!Ctor) return;
    contexte ??= new Ctor();
    const ctx = contexte;
    if (ctx.state === "suspended") void ctx.resume().catch(() => {});
    const t0 = ctx.currentTime + 0.01;
    [880, 1318.5].forEach((frequence, i) => {
      const debut = t0 + i * 0.11;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.value = frequence;
      gain.gain.setValueAtTime(0, debut);
      gain.gain.linearRampToValueAtTime(0.07, debut + 0.012);
      gain.gain.exponentialRampToValueAtTime(0.0001, debut + 0.16);
      osc.connect(gain).connect(ctx.destination);
      osc.start(debut);
      osc.stop(debut + 0.18);
    });
  } catch {
    // Pas de sortie audio : le son est un confort, jamais une erreur.
  }
}
