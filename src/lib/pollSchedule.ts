//! Ordonnancement adaptatif des sondes périodiques (git dirty, ports).
//!
//! Une sonde à intervalle FIXE est un piège : `git status --porcelain` coûte 6,1 s
//! sur un repo de 20 000 fichiers (mesuré sur ~/dev/monorepo), et bien plus
//! en s-CPU quand un antivirus à hook fanotify inspecte chaque `lstat`. À 2 s
//! d'intervalle, le garde in-flight relance la sonde dès qu'elle rend la main :
//! elle tourne alors EN PERMANENCE (~82 % d'un cœur, confirmé par la comptabilité
//! systemd du scope de l'app).
//!
//! Le délai est donc déduit du coût mesuré au tour précédent : une sonde qui coûte
//! cher se raréfie d'elle-même, une sonde instantanée reste au plancher. Le repo
//! lent dégrade sa propre fraîcheur, jamais celle des autres ni le framerate.

export interface PollBudget {
  /** Part du temps que la sonde peut passer à travailler (0 < dutyCycle <= 1). */
  dutyCycle: number;
  /** Plancher : une sonde gratuite ne s'emballe pas pour autant. */
  minDelayMs: number;
  /** Plafond : même un repo monstrueux garde un rafraîchissement minimal
      (au prix d'un dépassement assumé du duty cycle). */
  maxDelayMs: number;
}

/** Sonde `git status --porcelain` : chère et amplifiée par l'antivirus → 5 % max,
    et jamais plus d'une fois par 2 min sur les repos géants. La branche, elle,
    est gratuite (`symbolic-ref` : 0,00 s) et reste sondée à intervalle fixe. */
export const DIRTY_BUDGET: PollBudget = {
  dutyCycle: 0.05,
  minDelayMs: 2000,
  maxDelayMs: 120_000,
};

/** Sonde ports : parcours des `children` de chaque task du sous-arbre puis des fd
    de chaque pid, sous /proc. Bien moins chère qu'un git status, mais pas gratuite
    sur un pane qui fait tourner un node avec des centaines de fd. */
export const PORTS_BUDGET: PollBudget = {
  dutyCycle: 0.05,
  minDelayMs: 2000,
  maxDelayMs: 30_000,
};

/** Délai avant la prochaine sonde, d'après la durée de la précédente.
    Une durée absurde (NaN, négative) est traitée comme nulle → plancher. */
export function nextDelayMs(lastDurationMs: number, budget: PollBudget): number {
  const duration = Number.isFinite(lastDurationMs) && lastDurationMs > 0 ? lastDurationMs : 0;
  const target = duration / budget.dutyCycle;
  return Math.min(budget.maxDelayMs, Math.max(budget.minDelayMs, target));
}

/** Part du temps qu'une sonde ANTICIPÉE (fin de tour d'agent) peut consommer : quatre fois
    le budget ordinaire. Assez pour qu'un dépôt léger se recompte dans les 2 s qui suivent
    la fin d'un tour, jamais assez pour qu'une rafale de fins de tour sur un dépôt géant
    relance `git status` en boucle. */
export const FACTEUR_ANTICIPATION = 4;

/**
 * Échéance d'une sonde avancée par un événement (un agent vient de finir son tour : il a
 * peut-être écrit des fichiers). Jamais plus tard que l'échéance prévue, jamais avant
 * maintenant, et jamais plus tôt que `derniereFin + duree / (dutyCycle × FACTEUR)` (au
 * moins le plancher du budget) : la sonde chère garde un espacement proportionnel à son
 * coût mesuré, même sous une rafale d'événements.
 * `derniereFin` / `duree` : fin et durée de la dernière sonde (absentes : jamais sondé).
 */
export function echeanceAnticipee(
  prevue: number,
  maintenant: number,
  budget: PollBudget,
  derniere?: { fin: number; duree: number },
): number {
  if (!derniere) return Math.min(prevue, maintenant);
  const ecart = Math.max(
    budget.minDelayMs,
    nextDelayMs(derniere.duree, { ...budget, dutyCycle: budget.dutyCycle * FACTEUR_ANTICIPATION }),
  );
  return Math.min(prevue, Math.max(maintenant, derniere.fin + ecart));
}
