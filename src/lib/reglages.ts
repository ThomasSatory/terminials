/**
 * Réglages de l'application (vue Paramètres), en logique pure.
 *
 * Persistés côté Rust dans le fichier de réglages unique de l'app
 * (`~/.config/terminials/settings.json`, clé `app`, cf. crates/core/src/reglages.rs) :
 * même forme JSON, mêmes défauts, mêmes bornes (`normaliserReglages` ⇔ `normaliser`).
 * Le store (`store/reglages.ts`) les charge au démarrage et les réécrit à chaque
 * changement ; `lib/apparence.ts` en tire ce qui s'applique en direct.
 */

export type Densite = "compacte" | "normale" | "ample";
export type PoliceTerminal = "integree" | "systeme";
export type NiveauAutonomie = "observer" | "reorganiser" | "agir";

/** Membre d'une paire qui désigne le superviseur lui-même. */
export const PAIRE_SUPERVISEUR = "superviseur";

/**
 * Deux espaces, ou un espace et le superviseur, qui échangent par le superviseur sans
 * validation. Un espace y est désigné par son DOSSIER : les ids d'espace changent à
 * chaque lancement de l'app, le dossier non. Paire non orientée.
 */
export interface PaireAutorisee {
  a: string;
  b: string;
  /** Epoch ms de l'autorisation. */
  depuis: number;
  /** Échanges passés sans validation depuis. */
  echanges: number;
}

export interface ReglagesApp {
  apparence: {
    /** #rrggbb */
    accent: string;
    densite: Densite;
    reduireAnimations: boolean;
  };
  terminal: {
    taillePolice: number;
    police: PoliceTerminal;
    /** Programme du shell ; "" : `$SHELL` de la session. */
    shell: string;
    /** Dossier d'un espace créé sans formulaire (Ctrl+Maj+Entrée) ; `~` accepté. */
    dossierDepart: string;
    defilement: number;
    copierSelection: boolean;
    reprendreSessions: boolean;
  };
  notifications: {
    systeme: boolean;
    bulle: boolean;
    son: boolean;
  };
  superviseur: {
    /** Désactivé par défaut : rien ne tourne, aucun jeton consommé. */
    actif: boolean;
    nom: string;
    niveau: NiveauAutonomie;
    pause: boolean;
    paires: PaireAutorisee[];
  };
}

export const TAILLE_POLICE_MIN = 10;
export const TAILLE_POLICE_MAX = 20;
export const DEFILEMENTS = [1000, 5000, 10000, 50000] as const;
export const NOM_SUPERVISEUR_MAX = 16;
export const NOM_SUPERVISEUR_DEFAUT = "Superviseur";

/** Accents proposés (maquette Parametres), le premier est celui des jetons. */
export const ACCENTS: readonly { nom: string; couleur: string }[] = [
  { nom: "Pervenche", couleur: "#8f9bff" },
  { nom: "Citron", couleur: "#b4f461" },
  { nom: "Corail", couleur: "#ff8a4c" },
  { nom: "Orchidée", couleur: "#e9a8ff" },
];

/** Taille des avatars du dock (px) selon la densité. */
export const TAILLE_AVATAR_DOCK: Record<Densite, number> = { compacte: 32, normale: 40, ample: 48 };

export const REGLAGES_DEFAUT: ReglagesApp = {
  apparence: { accent: "#8f9bff", densite: "normale", reduireAnimations: false },
  terminal: {
    taillePolice: 13,
    police: "integree",
    shell: "",
    dossierDepart: "~",
    defilement: 1000,
    copierSelection: false,
    reprendreSessions: true,
  },
  notifications: { systeme: true, bulle: true, son: false },
  superviseur: { actif: false, nom: NOM_SUPERVISEUR_DEFAUT, niveau: "observer", pause: false, paires: [] },
};

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const texte = (v: unknown, d: string) => (typeof v === "string" ? v : d);
const booleen = (v: unknown, d: boolean) => (typeof v === "boolean" ? v : d);
const parmi = <T extends string>(v: unknown, choix: readonly T[], d: T): T =>
  typeof v === "string" && (choix as readonly string[]).includes(v) ? (v as T) : d;

/** `#rrggbb` en minuscules, sinon null. */
export function couleurHex(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const c = v.trim().toLowerCase();
  return /^#[0-9a-f]{6}$/.test(c) ? c : null;
}

/** Clé d'une paire indépendante de l'ordre de ses membres. */
export function clePaire(a: string, b: string): string {
  return a <= b ? `${a}\u0000${b}` : `${b}\u0000${a}`;
}

function nombre(v: unknown, d: number): number {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

/**
 * Réglages lus (fichier, backend, n'importe quel JSON) → réglages valides : champs
 * absents complétés par les défauts, valeurs ramenées dans leur domaine. Même règle que
 * `normaliser` côté Rust ; idempotente.
 */
export function normaliserReglages(brut: unknown): ReglagesApp {
  const d = REGLAGES_DEFAUT;
  const r = estObjet(brut) ? brut : {};
  const ap = estObjet(r.apparence) ? r.apparence : {};
  const te = estObjet(r.terminal) ? r.terminal : {};
  const no = estObjet(r.notifications) ? r.notifications : {};
  const su = estObjet(r.superviseur) ? r.superviseur : {};

  const taille = Math.round(nombre(te.taillePolice, d.terminal.taillePolice));
  const defil = nombre(te.defilement, d.terminal.defilement);
  const dossier = texte(te.dossierDepart, d.terminal.dossierDepart).trim();
  const nom = [...texte(su.nom, "").trim()].slice(0, NOM_SUPERVISEUR_MAX).join("");

  const vues = new Set<string>();
  const paires: PaireAutorisee[] = [];
  for (const p of Array.isArray(su.paires) ? su.paires : []) {
    if (!estObjet(p)) continue;
    const a = texte(p.a, "").trim();
    const b = texte(p.b, "").trim();
    if (!a || !b || a === b || vues.has(clePaire(a, b))) continue;
    vues.add(clePaire(a, b));
    paires.push({ a, b, depuis: nombre(p.depuis, 0), echanges: Math.max(0, Math.round(nombre(p.echanges, 0))) });
  }

  return {
    apparence: {
      accent: couleurHex(ap.accent) ?? d.apparence.accent,
      densite: parmi(ap.densite, ["compacte", "normale", "ample"] as const, d.apparence.densite),
      reduireAnimations: booleen(ap.reduireAnimations, d.apparence.reduireAnimations),
    },
    terminal: {
      taillePolice: Math.min(TAILLE_POLICE_MAX, Math.max(TAILLE_POLICE_MIN, taille)),
      police: parmi(te.police, ["integree", "systeme"] as const, d.terminal.police),
      shell: texte(te.shell, d.terminal.shell).trim(),
      dossierDepart: dossier || d.terminal.dossierDepart,
      // Valeur hors liste (fichier édité à la main) : la proposée la plus proche.
      defilement: DEFILEMENTS.reduce((m, v) => (Math.abs(v - defil) < Math.abs(m - defil) ? v : m), DEFILEMENTS[0]),
      copierSelection: booleen(te.copierSelection, d.terminal.copierSelection),
      reprendreSessions: booleen(te.reprendreSessions, d.terminal.reprendreSessions),
    },
    notifications: {
      systeme: booleen(no.systeme, d.notifications.systeme),
      bulle: booleen(no.bulle, d.notifications.bulle),
      son: booleen(no.son, d.notifications.son),
    },
    superviseur: {
      actif: booleen(su.actif, d.superviseur.actif),
      nom: nom || d.superviseur.nom,
      niveau: parmi(su.niveau, ["observer", "reorganiser", "agir"] as const, d.superviseur.niveau),
      pause: booleen(su.pause, d.superviseur.pause),
      paires,
    },
  };
}

/** « Revenir aux réglages d'origine » : tout reprend sa valeur par défaut, sauf les
    paires autorisées (maquette : « vos espaces, onglets, paires et hooks ne sont pas
    touchés »). */
export function reglagesReinitialises(r: ReglagesApp): ReglagesApp {
  return {
    ...structuredClone(REGLAGES_DEFAUT),
    superviseur: { ...REGLAGES_DEFAUT.superviseur, paires: r.superviseur.paires },
  };
}

/** Vrai si la paire {a, b} est autorisée (ordre indifférent). */
export function paireAutorisee(paires: readonly PaireAutorisee[], a: string, b: string): boolean {
  const cle = clePaire(a, b);
  return paires.some((p) => clePaire(p.a, p.b) === cle);
}

/** Ajoute la paire {a, b} (sans effet si elle existe déjà ou si a = b). */
export function avecPaire(paires: readonly PaireAutorisee[], a: string, b: string, maintenant: number): PaireAutorisee[] {
  if (!a || !b || a === b || paireAutorisee(paires, a, b)) return [...paires];
  return [...paires, { a, b, depuis: maintenant, echanges: 0 }];
}

/** Retire la paire {a, b}. */
export function sansPaire(paires: readonly PaireAutorisee[], a: string, b: string): PaireAutorisee[] {
  const cle = clePaire(a, b);
  return paires.filter((p) => clePaire(p.a, p.b) !== cle);
}

/** Compte un échange passé sans validation par la paire {a, b}. */
export function compterEchange(paires: readonly PaireAutorisee[], a: string, b: string): PaireAutorisee[] {
  const cle = clePaire(a, b);
  return paires.map((p) => (clePaire(p.a, p.b) === cle ? { ...p, echanges: p.echanges + 1 } : p));
}

/** Shell à lancer : le réglage, sinon celui de la session (`$SHELL`), sinon bash. */
export function shellEffectif(r: ReglagesApp, shellSession: string | null | undefined): string {
  return r.terminal.shell || shellSession || "/bin/bash";
}
