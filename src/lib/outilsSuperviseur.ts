import { titreParDefaut } from "./titreParDefaut";
import type { OutilId } from "./outilsProtocole";
import type { EtatAgent } from "./etatAgent";
import type { EtatLigne, LigneEtat, Interlocuteur } from "../store/superviseur";
import { titreSansGlyphe } from "./mosaique";
import { ligneDepot, texteNotification } from "./dockInfo";
import { messageTermine } from "./etatAgent";
import { NOMS_OUTILS } from "./superviseurLibelles";

/**
 * Logique pure de l'exécuteur des outils du superviseur (hooks/useOutilsSuperviseur,
 * lib/executeurSuperviseur) : désigner un espace ou un onglet comme le fait la CLI, bâtir
 * la réponse de `espaces.etat`, préparer un texte avant de l'écrire dans un terminal, et
 * les libellés du fil (arguments affichés, titres des cartes « À valider »).
 *
 * Aucune dépendance aux stores : l'appelant passe ce qu'il a lu.
 */

export type Resolution<T> = { ok: true; valeur: T } | { ok: false; erreur: string };

const minuscules = (t: string) => t.trim().toLocaleLowerCase("fr");

/**
 * Désignation d'un espace (§3.1 du contrat) : son id, sinon son nom (casse ignorée),
 * sinon un préfixe de nom qui n'en désigne qu'un. Ambigu ou introuvable : une erreur qui
 * liste les candidats, pour que l'appelant (un agent) se corrige seul.
 */
export function resoudreEspace<T extends { id: string; name: string }>(
  designation: unknown,
  espaces: readonly T[],
): Resolution<T> {
  const d = typeof designation === "string" ? designation.trim() : "";
  if (!d) return { ok: false, erreur: "Espace non précisé." };
  const parId = espaces.find((w) => w.id === d);
  if (parId) return { ok: true, valeur: parId };
  const q = minuscules(d);
  const memeNom = espaces.filter((w) => minuscules(w.name) === q);
  if (memeNom.length === 1) return { ok: true, valeur: memeNom[0] };
  if (memeNom.length > 1) {
    return { ok: false, erreur: `Plusieurs espaces s’appellent « ${d} » : ${listeCandidats(memeNom)}. Désignez-le par son id.` };
  }
  const prefixe = espaces.filter((w) => minuscules(w.name).startsWith(q));
  if (prefixe.length === 1) return { ok: true, valeur: prefixe[0] };
  if (prefixe.length > 1) return { ok: false, erreur: `« ${d} » est ambigu : ${listeCandidats(prefixe)}.` };
  return {
    ok: false,
    erreur: espaces.length
      ? `Espace « ${d} » introuvable. Espaces : ${listeCandidats(espaces)}.`
      : `Espace « ${d} » introuvable : aucun espace ouvert.`,
  };
}

function listeCandidats(espaces: readonly { id: string; name: string }[]): string {
  return espaces.map((w) => `${w.name} (${w.id})`).join(", ");
}

/** Titre affiché d'un onglet, comme la barre du haut : celui que pousse le terminal (sans
    le glyphe animé de Claude Code), sinon « Terminal N ». */
export function titreOnglet(tab: { title?: string; numero?: number }, index: number): string {
  return titreSansGlyphe(tab.title) || titreParDefaut(tab, index);
}

interface OngletLisible {
  id: string;
  title?: string;
  claude?: unknown;
}

/**
 * Onglet visé quand l'appel n'en nomme pas : celui où tourne une session Claude Code (on
 * écrit à un agent, pas dans un shell nu), l'actif d'abord ; sinon l'onglet actif.
 */
export function ongletParDefaut<T extends OngletLisible>(ws: { tabs: readonly T[]; activeTabId: string | null }): T | null {
  const actif = ws.tabs.find((t) => t.id === ws.activeTabId);
  if (actif?.claude) return actif;
  return ws.tabs.find((t) => t.claude) ?? actif ?? ws.tabs[0] ?? null;
}

/** Désignation d'un onglet : id, titre (casse ignorée), rang (1…), ou préfixe unique du titre. */
export function resoudreOnglet<T extends OngletLisible>(
  ws: { tabs: readonly T[]; activeTabId: string | null },
  designation: unknown,
): Resolution<{ tab: T; rang: number }> {
  const avecRang = (tab: T | null | undefined): Resolution<{ tab: T; rang: number }> =>
    tab ? { ok: true, valeur: { tab, rang: ws.tabs.indexOf(tab) + 1 } } : { ok: false, erreur: "Cet espace n’a aucun onglet." };
  const d = typeof designation === "string" ? designation.trim() : typeof designation === "number" ? String(designation) : "";
  if (!d) return avecRang(ongletParDefaut(ws));
  const parId = ws.tabs.find((t) => t.id === d);
  if (parId) return avecRang(parId);
  if (/^\d+$/.test(d)) {
    const n = Number(d);
    if (n >= 1 && n <= ws.tabs.length) return avecRang(ws.tabs[n - 1]);
  }
  const titres = ws.tabs.map((t, i) => ({ t, titre: minuscules(titreOnglet(t, i)) }));
  const q = minuscules(d);
  const exacts = titres.filter((x) => x.titre === q);
  if (exacts.length === 1) return avecRang(exacts[0].t);
  const prefixes = titres.filter((x) => x.titre.startsWith(q));
  if (exacts.length === 0 && prefixes.length === 1) return avecRang(prefixes[0].t);
  const liste = ws.tabs.map((t, i) => `${i + 1}. ${titreOnglet(t, i)}`).join(", ");
  return { ok: false, erreur: `Onglet « ${d} » ${exacts.length + prefixes.length > 1 ? "ambigu" : "introuvable"}. Onglets : ${liste}.` };
}

/** `lignes` de `terminal.lire` : 40 par défaut, entre 1 et 200. */
export function nombreLignes(v: unknown): number {
  const n = typeof v === "number" && Number.isFinite(v) ? Math.round(v) : 40;
  return Math.min(200, Math.max(1, n));
}

// --- espaces.etat ---

/** Ce qu'il faut lire d'un espace pour l'état transmis au superviseur. */
export interface EspaceSource {
  id: string;
  name: string;
  cwd: string;
  groupId: string | null;
  branch?: string;
  unread: boolean;
  unreadTabs: string[];
  lastNotification?: { title: string; body: string };
  tabs: readonly OngletLisible[];
  activeTabId: string | null;
}

export interface SourcesEtatEspaces {
  espaces: readonly EspaceSource[];
  groupes: readonly { id: string; name: string; color: string; collapsed: boolean }[];
  activeId: string | null;
  /** Ordre navigable (Ctrl 1…9). */
  ordre: readonly string[];
  etatEspace: (wsId: string) => EtatAgent;
  etatOnglet: (wsId: string, tabId: string) => EtatAgent;
  sessionsBloquees: Readonly<Record<string, string>>;
  enRelais: (wsId: string) => boolean;
}

export interface OngletEtat {
  id: string;
  rang: number;
  titre: string;
  actif: boolean;
  etat: EtatAgent;
  claude: boolean;
  bloque: string | null;
}

export interface EspaceEtatTransmis {
  id: string;
  nom: string;
  dossier: string;
  groupe: string | null;
  branche: string | null;
  actif: boolean;
  etat: EtatAgent;
  relais: boolean;
  raccourci: string | null;
  notification: string | null;
  onglets: OngletEtat[];
}

/** Données de `espaces.etat` (§3.2), dans l'ordre du dock. `seul` : un espace précis. */
export function construireEtatEspaces(
  src: SourcesEtatEspaces,
  seul?: string,
): { espaces: EspaceEtatTransmis[]; groupes: { id: string; nom: string; couleur: string; replie: boolean }[] } {
  const parId = new Map(src.espaces.map((w) => [w.id, w]));
  // Ordre du dock d'abord (groupes repliés compris), puis ceux que l'ordre ne connaît pas.
  const ordonnes = [...src.ordre.map((id) => parId.get(id)).filter((w): w is EspaceSource => !!w)];
  for (const w of src.espaces) if (!ordonnes.includes(w)) ordonnes.push(w);
  const groupes = new Map(src.groupes.map((g) => [g.id, g]));
  const espaces = ordonnes
    .filter((w) => seul === undefined || w.id === seul)
    .map((w): EspaceEtatTransmis => {
      const rang = src.ordre.indexOf(w.id);
      const etat = src.etatEspace(w.id);
      return {
        id: w.id,
        nom: w.name,
        dossier: w.cwd,
        groupe: w.groupId ? (groupes.get(w.groupId)?.name ?? null) : null,
        branche: w.branch ?? null,
        actif: w.id === src.activeId,
        etat,
        relais: src.enRelais(w.id),
        raccourci: rang !== -1 && rang < 9 ? `Ctrl ${rang + 1}` : null,
        notification: etat === "attente" ? texteNotification(w.lastNotification) || null : null,
        onglets: w.tabs.map((t, i) => ({
          id: t.id,
          rang: i + 1,
          titre: titreOnglet(t, i),
          actif: t.id === w.activeTabId,
          etat: src.etatOnglet(w.id, t.id),
          claude: !!t.claude,
          bloque: src.sessionsBloquees[t.id] ?? null,
        })),
      };
    });
  return {
    espaces,
    groupes: src.groupes.map((g) => ({ id: g.id, nom: g.name, couleur: g.color, replie: g.collapsed })),
  };
}

/** Ordre du tableau « où en sont mes agents » : ce qui vous réclame d'abord. */
const ORDRE_LIGNES: Record<EtatLigne, number> = { attente: 0, relais: 1, travail: 2, termine: 3, repos: 4 };

/**
 * Lignes du tableau « où en sont mes agents » (maquette), tirées de l'état réel : l'agent
 * qui attend dit ce qu'il demande, celui qui relaie qui il attend, celui qui travaille le
 * sujet de son onglet, celui qui a fini son sujet, le reste sa ligne de dépôt.
 */
export function lignesEtats(
  espaces: readonly EspaceEtatTransmis[],
  relaisVers: (wsId: string) => string | null,
): LigneEtat[] {
  return espaces
    .map((w): LigneEtat => {
      const bloque = w.onglets.find((o) => o.bloque)?.bloque ?? null;
      const sujet = (w.onglets.find((o) => o.claude && o.etat !== "repos") ?? w.onglets.find((o) => o.actif))?.titre;
      const vers = relaisVers(w.id);
      if (w.etat === "attente") {
        return { wsId: w.id, etat: "attente", phrase: bloque ? autorisationLisible(bloque) : (w.notification ?? "vous attend") };
      }
      if (vers !== null && w.relais) return { wsId: w.id, etat: "relais", phrase: `attend la réponse de ${vers}` };
      if (w.etat === "travail") return { wsId: w.id, etat: "travail", phrase: sujetLisible(sujet) ?? "au travail" };
      if (w.etat === "termine") return { wsId: w.id, etat: "termine", phrase: messageTermine(sujetLisible(sujet) ?? undefined) };
      return { wsId: w.id, etat: "repos", phrase: ligneDepot({ branch: w.branche ?? undefined, dirty: false, ports: [] }) };
    })
    .sort((a, b) => ORDRE_LIGNES[a.etat] - ORDRE_LIGNES[b.etat]);
}

/** Un titre « Terminal N » ne dit rien du travail en cours. */
function sujetLisible(titre: string | undefined): string | null {
  return titre && !/^Terminal \d+$/.test(titre) ? titre : null;
}

/**
 * Objet d'une demande d'autorisation, à lire après « attend une » : « Claude demande
 * l'autorisation d'utiliser Bash » → « autorisation : utiliser Bash » ; une question
 * (« Autoriser npm run migrate ? ») → « autorisation : npm run migrate ».
 */
export function autorisationLisible(message: string): string {
  const m = message.trim().replace(/\s*[.?]$/, "");
  const reste = m
    .replace(/^Claude demande l['’]autorisation (d['’]|de |pour )?/i, "")
    .replace(/^autoriser\s+/i, "");
  return reste ? `autorisation : ${reste}` : "autorisation";
}

// --- Écriture dans un terminal ---

/**
 * Texte qui sera tapé dans un terminal : retours chariot ramenés à \n, tous les autres
 * caractères de contrôle retirés (C0 hors \n et \t, DEL, C1). Un texte venu du modèle ne
 * doit jamais pouvoir glisser une séquence d'échappement dans le terminal, ni fermer le
 * collage entre crochets avant l'heure.
 */
export function nettoyerTexte(t: string): string {
  return t
    .replace(/\r\n?/g, "\n")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/g, "");
}

/**
 * Octets envoyés pour un texte déjà nettoyé : multiligne, il est entouré du collage entre
 * crochets (`ESC[200~ … ESC[201~`), sinon chaque \n validerait une ligne à part dans
 * Claude Code ou le shell. L'Entrée éventuelle part À PART, après un court délai : collée
 * au texte, elle serait prise pour une fin de ligne du collage.
 */
export function sequenceEcriture(texte: string): string {
  return texte.includes("\n") ? `\x1b[200~${texte}\x1b[201~` : texte;
}

/** Délai entre le texte et l'Entrée qui le valide. */
export const DELAI_ENTREE_MS = 60;

// --- Libellés du fil et des cartes ---

/** Extrait d'un texte sur une ligne, pour la ligne d'outil du fil. */
export function extrait(texte: string, max = 140): string {
  const t = texte.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1)}…` : t;
}

/** « api-paiements › claude » : où un outil lit ou écrit. */
export function cibleAffichee(nomEspace: string, titreOngletVise: string): string {
  return `${nomEspace} › ${titreOngletVise}`;
}

/**
 * Arguments affichés à côté du nom de l'outil dans le fil (maquette) : la cible et
 * l'essentiel, jamais le JSON brut. `noms` donne le nom d'un espace déjà résolu ; `cible`
 * est « espace › onglet » pour les outils qui lisent ou écrivent un terminal.
 */
export function argsAffiches(
  outil: OutilId,
  args: Record<string, unknown>,
  ctx: { nomEspace?: string; cible?: string },
): string {
  const s = (k: string) => (typeof args[k] === "string" ? (args[k] as string) : "");
  const nom = ctx.nomEspace ?? s("espace");
  switch (outil) {
    case "espaces.etat":
      return nom || "--tous";
    case "terminal.lire":
      return `${ctx.cible ?? nom}  --lignes ${nombreLignes(args.lignes)}`;
    case "notifier":
      // En entier : c'est le seul endroit du fil où le message apparaît.
      return `« ${extrait(s("texte"), 600)} »`;
    case "demander":
      return `${nom ? `${nom}  ` : ""}« ${extrait(s("question"))} »`;
    case "espace.creer":
      return [s("nom"), s("dossier"), s("groupe") ? `--groupe ${s("groupe")}` : ""].filter(Boolean).join("  ");
    case "espace.renommer":
      return `${nom} → ${s("nom")}`;
    case "espace.deplacer": {
      const g = args.groupe === "" ? "hors groupe" : s("groupe");
      const pos = typeof args.position === "number" ? `rang ${args.position + 1}` : "";
      return `${nom} → ${[g, pos].filter(Boolean).join(", ") || "même place"}`;
    }
    case "espace.fermer":
      return nom;
    case "groupe.creer": {
      const membres = Array.isArray(args.espaces) ? args.espaces.filter((x) => typeof x === "string") : [];
      return membres.length ? `${s("nom")} ← ${membres.join(", ")}` : s("nom");
    }
    case "onglet.ouvrir":
      return s("dossier") ? `${nom}  ${s("dossier")}` : nom;
    case "espace.focus":
      return ctx.cible ?? nom;
    case "terminal.ecrire": {
      const t = s("texte");
      const entree = args.entree !== false;
      return `${ctx.cible ?? nom}  ${t ? `« ${extrait(t)} »` : ""}${t && entree ? " + Entrée" : entree ? "Entrée" : ""}`;
    }
    case "session.demander":
    case "session.repondre":
      return `${ctx.cible ?? ""}  « ${extrait(s("texte"))} »`.trim();
  }
}

/** Nom affiché d'un outil (« espace.créer »). */
export function nomOutil(outil: OutilId): string {
  return NOMS_OUTILS[outil] ?? outil;
}

/**
 * Titre d'une carte « À valider » (maquette) selon ce qu'elle écrit : une question
 * transmise, une réponse rendue (par une autre session, ou par le superviseur lui-même),
 * la réponse à une demande d'autorisation, ou une écriture libre.
 */
export function titreDemande(
  outil: "terminal.ecrire" | "session.demander" | "session.repondre",
  nomCible: string,
  o: { bloquee: boolean; deSuperviseur?: boolean },
): string {
  if (outil === "session.demander") return `Transmettre la question à ${nomCible}`;
  if (outil === "session.repondre") return o.deSuperviseur ? `Répondre à ${nomCible}` : `Transmettre la réponse à ${nomCible}`;
  return o.bloquee ? `Répondre à ${nomCible}` : `Écrire dans ${nomCible}`;
}

/** « Sans validation : échanges autorisés entre A et B. » */
export function texteSansValidation(nomA: string, nomB: string): string {
  return `Sans validation : échanges autorisés entre ${nomA} et ${nomB}.`;
}

/** Nom d'un bout de paire : le superviseur, l'espace ouvert sur ce dossier, sinon le
    dernier segment du dossier. */
export function nomBoutPaire(
  bout: string,
  espaces: readonly { name: string; cwd: string }[],
  nomSuperviseur: string,
  superviseur: Interlocuteur = "superviseur",
): string {
  if (bout === superviseur) return nomSuperviseur;
  const ws = espaces.find((w) => w.cwd === bout);
  if (ws) return ws.name;
  const segments = bout.replace(/\/+$/, "").split("/");
  return segments[segments.length - 1] || bout;
}

/** `~` et `~/…` → dossier personnel. */
export function developperDossier(dossier: string, home: string): string {
  const d = dossier.trim();
  if (!home) return d;
  if (d === "~") return home;
  if (d.startsWith("~/")) return `${home.replace(/\/+$/, "")}/${d.slice(2)}`;
  return d;
}
