/**
 * Registre des terminaux xterm vivants, par onglet. Chaque TerminalPane s'y enregistre
 * à son montage et s'en retire à son démontage ; la mosaïque y lit, sans rien monter ni
 * démonter, les dernières lignes de chaque onglet.
 *
 * Lecture seule : le registre ne touche ni au PTY ni au cycle de vie du terminal. Il ne
 * dépend que d'une interface minimale (ce qu'il lit du tampon, l'événement de fin
 * d'écriture), qu'un Terminal xterm satisfait tel quel et qu'un test simule sans DOM.
 */

/** Une ligne du tampon xterm (IBufferLine). */
export interface LigneTampon {
  /** La ligne continue la précédente (retour à la ligne automatique, pas un \n). */
  readonly isWrapped: boolean;
  translateToString(trimRight?: boolean): string;
}

/** Le tampon actif xterm (IBuffer) : scrollback + écran. */
export interface TamponLisible {
  readonly length: number;
  getLine(y: number): LigneTampon | undefined;
}

/** Ce que le registre utilise d'un Terminal xterm. */
export interface TerminalLisible {
  readonly buffer: { readonly active: TamponLisible };
  /** Émis après chaque écriture analysée (xterm ≥ 5.2). */
  onWriteParsed(cb: () => void): { dispose(): void };
}

/** Plafond de lignes physiques parcourues : un tampon vide de 1000 lignes ne coûte rien,
    mais une lecture ne doit jamais balayer tout un scrollback géant. */
export const LIGNES_PARCOURUES_MAX = 2000;

/**
 * Les `n` dernières lignes LOGIQUES non vides du tampon, en texte brut, de la plus
 * ancienne à la plus récente. Une ligne repliée par xterm (isWrapped) est recollée à
 * celle qu'elle prolonge. Les espaces de fin sont retirés ; une ligne faite d'espaces
 * est vide. Pure : testable sur un faux tampon.
 */
export function dernieresLignes(tampon: TamponLisible, n: number, maxParcours = LIGNES_PARCOURUES_MAX): string[] {
  const sortie: string[] = [];
  if (n <= 0) return sortie;
  const plancher = Math.max(0, tampon.length - maxParcours);
  let y = tampon.length - 1;
  while (y >= plancher && sortie.length < n) {
    // Remonte jusqu'au début de la ligne logique qui finit en y.
    let debut = y;
    while (debut > plancher && tampon.getLine(debut)?.isWrapped) debut--;
    let texte = "";
    for (let i = debut; i <= y; i++) {
      // Les segments intermédiaires occupent toute la largeur : on garde leurs espaces,
      // qui peuvent être de vrais espaces coupés par le repli.
      texte += tampon.getLine(i)?.translateToString(i === y) ?? "";
    }
    texte = texte.trimEnd();
    if (texte.trim() !== "") sortie.push(texte);
    y = debut - 1;
  }
  return sortie.reverse();
}

/**
 * Limiteur de cadence : `fn` part au premier appel, puis au plus une fois par `delaiMs`,
 * le dernier appel d'une rafale étant toujours honoré (rien n'est perdu en fin de flux).
 * `annuler` coupe un envoi en attente.
 */
export function limiter(fn: () => void, delaiMs: number): { appeler: () => void; annuler: () => void } {
  let dernier = -Infinity;
  let minuterie: ReturnType<typeof setTimeout> | undefined;
  const partir = () => {
    minuterie = undefined;
    dernier = Date.now();
    fn();
  };
  return {
    appeler: () => {
      if (minuterie !== undefined) return;
      const attente = dernier + delaiMs - Date.now();
      if (attente <= 0) partir();
      else minuterie = setTimeout(partir, attente);
    },
    annuler: () => {
      clearTimeout(minuterie);
      minuterie = undefined;
    },
  };
}

type Ecouteur = () => void;

const terminaux = new Map<string, TerminalLisible>();
const ecouteurs = new Map<string, Set<Ecouteur>>();
/** Abonnement xterm (un seul par terminal), relayé à tous les écouteurs de l'onglet. */
const relais = new Map<string, { dispose(): void }>();

function notifier(tabId: string): void {
  for (const e of ecouteurs.get(tabId) ?? []) e();
}

function brancherRelais(tabId: string): void {
  const term = terminaux.get(tabId);
  if (!term || relais.has(tabId) || !ecouteurs.get(tabId)?.size) return;
  relais.set(tabId, term.onWriteParsed(() => notifier(tabId)));
}

function debrancherRelais(tabId: string): void {
  relais.get(tabId)?.dispose();
  relais.delete(tabId);
}

/** Appelé par TerminalPane juste après `term.open`. */
export function enregistrerTerminal(tabId: string, term: TerminalLisible): void {
  if (terminaux.get(tabId) !== term) debrancherRelais(tabId);
  terminaux.set(tabId, term);
  brancherRelais(tabId);
  notifier(tabId);
}

/** Appelé par TerminalPane à son démontage. Sans effet si un autre terminal a pris la
    place entre-temps (respawn : le nouveau s'enregistre avant le nettoyage de l'ancien). */
export function desenregistrerTerminal(tabId: string, term: TerminalLisible): void {
  if (terminaux.get(tabId) !== term) return;
  debrancherRelais(tabId);
  terminaux.delete(tabId);
  notifier(tabId);
}

export function terminalEnregistre(tabId: string): boolean {
  return terminaux.has(tabId);
}

/** Les `n` dernières lignes non vides de l'onglet ; [] s'il n'a pas (encore) de terminal. */
export function lireDernieresLignes(tabId: string, n: number): string[] {
  const term = terminaux.get(tabId);
  return term ? dernieresLignes(term.buffer.active, n) : [];
}

/** Délai par défaut entre deux notifications d'un même abonné : la mosaïque n'a pas
    besoin de suivre un flux de build à 60 images/s. */
export const DELAI_ABONNEMENT_MS = 250;

/**
 * S'abonne aux changements du tampon de l'onglet : `cb` est rappelé au plus une fois par
 * `delaiMs` tant que le terminal écrit, ainsi qu'à son enregistrement et à son retrait.
 * L'abonnement peut précéder le montage du terminal. Rend la fonction de désabonnement.
 */
export function abonnerTerminal(tabId: string, cb: () => void, delaiMs = DELAI_ABONNEMENT_MS): () => void {
  const limite = limiter(cb, delaiMs);
  const ecouteur: Ecouteur = limite.appeler;
  let set = ecouteurs.get(tabId);
  if (!set) {
    set = new Set();
    ecouteurs.set(tabId, set);
  }
  set.add(ecouteur);
  brancherRelais(tabId);
  return () => {
    limite.annuler();
    const s = ecouteurs.get(tabId);
    s?.delete(ecouteur);
    if (s && s.size === 0) {
      ecouteurs.delete(tabId);
      // Plus personne n'écoute : on rend à xterm son événement.
      debrancherRelais(tabId);
    }
  };
}
