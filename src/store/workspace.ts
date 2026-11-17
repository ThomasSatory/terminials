import { create } from "zustand";
import { nextCopyName } from "../lib/copyName";
import { basename, defaultGroupColor } from "../lib/palette";
import { stripTrailingSlash } from "../lib/paths";
import { moveItem } from "../lib/reorder";
import { parseClaudeSession, type ClaudeSession } from "../lib/claudeResume";
import { DUREE_TERMINE_MS } from "../lib/etatAgent";

export interface Notification {
  title: string;
  body: string;
  /** Raison donnée par le hook (`notify --attente`) : « fin » pour une fin de tour, dont
      le corps fait le pied « Terminé : … » de la tuile de la mosaïque. */
  attente?: string;
}

/** Onglet terminal d'un workspace. `title` est poussé par xterm (OSC 0/2), jamais persisté. */
export interface Tab {
  id: string;
  title?: string;
  /** Rang de création dans l'espace (1, 2…), pour le nom par défaut « Terminal N » : il
      suit l'onglet quand on le déplace, au lieu de suivre sa position (après un glisser,
      on croirait sinon que rien n'a bougé). Non persisté : la restauration renumérote dans
      l'ordre sauvegardé. Absent (onglet construit à la main) : le rang tient lieu. */
  numero?: number;
  /** Dossier de départ, absent : celui du workspace. Persisté seulement via `claude`. */
  cwd?: string;
  /** Session Claude Code en cours dans l'onglet (hook SessionStart), persistée : elle est
      reprise au prochain lancement de l'app. */
  claude?: ClaudeSession;
  /** Id de session à reprendre au lancement du shell, posé par la restauration et
      consommé une fois (un respawn par changement de dossier ne relance pas la reprise). */
  pendingResume?: string;
}

/** Groupe de workspaces : simple étiquette repliable (nom + couleur), sans dossier. */
export interface Group {
  id: string;
  name: string;
  color: string;
  collapsed: boolean;
}

export interface Workspace {
  id: string;
  cwd: string;
  name: string;
  tabs: Tab[];
  activeTabId: string | null;
  /** Groupe d'appartenance, null = hors-groupe (affiché en tête de sidebar). */
  groupId: string | null;
  /** Couleur propre ; absente, la ligne prend celle du groupe. */
  color?: string;
  branch?: string;
  /** La sonde branche a répondu au moins une fois : sans branche, l'espace est alors
      vraiment « hors dépôt » (avant, on ne sait pas encore : rien n'est affiché). */
  gitConnu?: boolean;
  dirty?: boolean;
  /** Nombre de fichiers modifiés lu par la dernière sonde dirty (ou la vue des fichiers
      modifiés) : le compteur du bouton ± sans `git status` supplémentaire. */
  nbModifies?: number;
  ports: number[];
  /** Fallback niveau workspace : notification sans onglet identifiable. */
  unread: boolean;
  /** Onglets avec notification non lue (point bleu cmux). */
  unreadTabs: string[];
  /** Overlay diff ouvert sur ce workspace (état UI, jamais persisté). */
  diffOpen: boolean;
  lastNotification?: Notification;
  status?: { label: string; color?: string };
  progress?: { value: number; label?: string };
}

/** Entrées de persistance v5 : listes ORDONNÉES réécrites en bloc à chaque mutation
    (pas de clé par cwd : deux workspaces sur le même dossier — worktrees — coexistent).
    `groupIndex` indexe `groups` ; null = hors-groupe. `color` est omis quand le workspace
    n'a pas de couleur propre. */
export type SavedGroup = { name: string; color: string; collapsed: boolean };
export type SavedWorkspace = {
  cwd: string;
  name: string;
  tabCount: number;
  groupIndex: number | null;
  color?: string;
  /** Session Claude de chaque onglet, dans l'ordre des onglets (null = aucune). Omis quand
      aucun onglet n'en porte : la sauvegarde reste celle des builds antérieurs. */
  claudeSessions?: (ClaudeSession | null)[];
};
export type SavedState = { groups: SavedGroup[]; workspaces: SavedWorkspace[] };

interface WorkspaceState {
  workspaces: Workspace[];
  groups: Group[];
  activeId: string | null;
  /** tabId -> id du PTY backend (pour interroger les ports, cibler un terminal). */
  tabPtys: Record<string, number>;
  /** PTY où un agent travaille (hooks Claude Code UserPromptSubmit/PostToolUse), jamais
      persisté. Clé PTY et non onglet : un onglet respawné repart idle de lui-même. */
  busyPtys: Record<number, true>;
  /** Onglets dont l'agent vient de finir son tour (fin de travail signalée par un hook, sans
      demande en attente) : état « terminé » de la mosaïque, du dock et de la palette. Jamais
      persisté ; s'efface quand on consulte l'espace ou l'onglet, ou quand l'agent repart. */
  tabsTermines: Record<string, true>;
  toast: string | null;
  /** `name` explicite (sinon basename(cwd)) : « ~ » pour un espace sur $HOME.
      `groupId` explicite (création depuis l'en-tête d'un groupe) ; omis, le
      workspace naît dans le groupe du workspace actif. */
  addWorkspace: (cwd: string, name?: string, groupId?: string | null) => string;
  /** Copie d'un workspace : même dossier, même groupe, UN onglet neuf, nom
      incrémenté, placée juste sous l'original et activée. Les PTY ne se clonent
      pas : la copie démarre des shells neufs. null si `wsId` est inconnu. */
  duplicateWorkspace: (wsId: string) => string | null;
  /** Rouvre un espace fermé (liste « Reprendre » de l'accueil) avec ses onglets et la
      session Claude de chacun, reprise au lancement du shell comme au démarrage de l'app.
      Rangé comme un nouvel espace (groupe de l'espace actif) ; renvoie son id. */
  /** Rouvre un espace fermé. `groupe` : son groupe à la fermeture (retrouvé par son nom,
      recréé s'il a disparu) ; null : hors groupe ; absent : le groupe de l'espace actif. */
  restaurerEspace: (e: Omit<SavedWorkspace, "groupIndex"> & { groupe?: { name: string; color: string } | null }) => string;
  /** Nouvel onglet, rendu actif. Jamais refusé. */
  addTab: (wsId: string, cwd?: string) => string;
  /** Ferme un onglet ; fermer le DERNIER ferme le workspace (comme closeWorkspace). */
  closeTab: (wsId: string, tabId: string) => void;
  closeWorkspace: (wsId: string) => void;
  /** Réordonne le workspace `wsId` à l'index `toIndex` de son appartenance (groupe ou hors-groupe). */
  moveWorkspace: (wsId: string, toIndex: number) => void;
  /** Change l'appartenance et place le workspace à `index` dans sa nouvelle liste. */
  assignToGroup: (wsId: string, groupId: string | null, index?: number) => void;
  setActiveTab: (wsId: string, tabId: string) => void;
  /** Réordonne l'onglet `tabId` à l'index `toIndex` de la barre. */
  moveTab: (wsId: string, tabId: string, toIndex: number) => void;
  setTabTitle: (wsId: string, tabId: string, title: string) => void;
  /** Une session Claude démarre dans l'onglet (hook SessionStart) : la dernière l'emporte. */
  setTabClaudeSession: (wsId: string, tabId: string, session: ClaudeSession) => void;
  /** L'utilisateur a quitté la session `sessionId` : l'onglet ne la reprendra pas. Une
      autre session, démarrée depuis dans l'onglet, est conservée. */
  endTabClaudeSession: (wsId: string, tabId: string, sessionId: string) => void;
  /** Retire la reprise en attente de l'onglet, une fois la commande tapée dans son shell. */
  consumePendingResume: (wsId: string, tabId: string) => void;
  renameWorkspace: (wsId: string, name: string) => void;
  /** null retire la couleur propre. */
  setWorkspaceColor: (wsId: string, color: string | null) => void;
  /** Change le dossier d'un workspace : ses onglets respawnent (TerminalPane dépend de cwd). */
  setCwd: (wsId: string, cwd: string) => void;
  setNotification: (wsId: string, n: Notification, tabId?: string) => void;
  /** Rend l'espace actif. `garderDiff` : la vue des fichiers modifiés, ouverte sur
      l'espace quitté, passe à l'espace choisi (clic d'avatar pendant la relecture,
      maquette Diff/09) au lieu de céder la place à son terminal. */
  setActive: (wsId: string, opts?: { garderDiff?: boolean }) => void;
  /** Sonde branche (gratuite, cadence fixe) — indépendante de `setDirty`. null : hors
      dépôt ou HEAD détachée, la dernière branche connue est gardée. */
  setBranch: (wsId: string, branch: string | null) => void;
  /** Sonde dirty (chère, cadence adaptative) — indépendante de `setBranch`. `nbModifies`
      (facultatif) : nombre de fichiers modifiés lu par la même sonde. */
  setDirty: (wsId: string, dirty: boolean, nbModifies?: number) => void;
  setPorts: (wsId: string, ports: number[]) => void;
  setStatus: (wsId: string, status: { label: string; color?: string }) => void;
  setProgress: (wsId: string, progress: { value: number; label?: string }) => void;
  setTabPty: (tabId: string, ptyId: number) => void;
  /** No-op si l'état ne change pas : PostToolUse le rappelle à chaque outil. `finDeTour`
      (défaut vrai) : un passage au repos signalé par l'agent lui-même (hook Stop ou
      Notification) marque l'onglet « terminé » ; une interruption ou un garde-fou de
      silence passe `false` (rien n'a été « terminé »). */
  setPtyBusy: (ptyId: number, busy: boolean, finDeTour?: boolean) => void;
  removeTabPty: (tabId: string) => void;
  toggleDiff: (wsId: string) => void;
  // --- groupes ---
  addGroup: (name: string, color?: string) => string;
  renameGroup: (groupId: string, name: string) => void;
  setGroupColor: (groupId: string, color: string) => void;
  toggleGroupCollapsed: (groupId: string) => void;
  /** Supprime le groupe ; ses workspaces redeviennent hors-groupe, aucun terminal fermé. */
  removeGroup: (groupId: string) => void;
  moveGroup: (groupId: string, toIndex: number) => void;
  restoreState: (state: SavedState) => void;
  showToast: (msg: string) => void;
  clearToast: () => void;
  reset: () => void;
}

let counter = 0;
let colorIndex = 0;
const uid = (prefix: string) => `${prefix}:${counter++}`;

/** Numéro du prochain onglet d'un espace : un de plus que le plus grand en place (les
    numéros des onglets fermés ne reviennent pas tant qu'un plus grand existe). */
export function numeroOngletSuivant(tabs: readonly Tab[]): number {
  return tabs.reduce((max, t, i) => Math.max(max, t.numero ?? i + 1), 0) + 1;
}

// --- Persistance localStorage v5 (I/O hors réducteurs ; no-op si localStorage absent,
//     cas des tests node). Les clés antérieures sont lues une fois, dans l'ordre
//     v4, v3 puis v2, si v5 est absente — puis LAISSÉES en place : un build antérieur
//     partage le même localStorage WebKit et doit pouvoir redémarrer avec sa liste.
//     Dès que v5 existe, les anciennes ne sont plus consultées. ---
const STORAGE_KEY = "terminials:workspaces:v5";
const V4_KEY = "terminials:workspaces:v4";
const V3_KEY = "terminials:workspaces:v3";
const V2_KEY = "terminials:workspaces:v2";
const LAST_FOLDER_KEY = "terminials:lastFolder";

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null;

/** Le `color` des entrées n'est lu qu'avec `withColor` (v5) : celui des entrées v3 est ignoré. */
function parseSavedWorkspace(e: unknown, groupCount: number, withColor = false): SavedWorkspace | null {
  if (!isRecord(e)) return null;
  if (typeof e.cwd !== "string" || typeof e.name !== "string") return null;
  if (typeof e.tabCount !== "number") return null;
  const gi = e.groupIndex;
  const groupIndex =
    typeof gi === "number" && Number.isInteger(gi) && gi >= 0 && gi < groupCount ? gi : null;
  const color = withColor && typeof e.color === "string" ? { color: e.color } : {};
  const sessions = Array.isArray(e.claudeSessions) ? e.claudeSessions.map(parseClaudeSession) : [];
  const claude = sessions.some((x) => x !== null) ? { claudeSessions: sessions } : {};
  return { cwd: e.cwd, name: e.name, tabCount: e.tabCount, groupIndex, ...color, ...claude };
}

function parseSavedGroup(g: unknown): SavedGroup | null {
  if (!isRecord(g) || typeof g.name !== "string" || typeof g.color !== "string") return null;
  return { name: g.name, color: g.color, collapsed: g.collapsed === true };
}

/** Migration v2 → v4 : liste plate `{cwd,name,color,paneCount}` → tout hors-groupe. */
function migrateV2(raw: unknown): SavedState | null {
  if (!Array.isArray(raw)) return null;
  const workspaces = raw.flatMap((e) => {
    if (!isRecord(e) || typeof e.paneCount !== "number") return [];
    const ws = parseSavedWorkspace({ ...e, tabCount: e.paneCount, groupIndex: null }, 0);
    return ws ? [ws] : [];
  });
  return { groups: [], workspaces };
}

/** Parse une sauvegarde `{groups, workspaces}` : v5 (`withColor`), ou v4 et v3 dont le
    `color` des workspaces est ignoré (les trois formats ne diffèrent que par ce champ). */
function parseSavedState(raw: unknown, withColor = false): SavedState {
  if (!isRecord(raw)) return { groups: [], workspaces: [] };
  const groups = Array.isArray(raw.groups)
    ? raw.groups.flatMap((g) => {
        const parsed = parseSavedGroup(g);
        return parsed ? [parsed] : [];
      })
    : [];
  const workspaces = Array.isArray(raw.workspaces)
    ? raw.workspaces.flatMap((e) => {
        const parsed = parseSavedWorkspace(e, groups.length, withColor);
        return parsed ? [parsed] : [];
      })
    : [];
  return { groups, workspaces };
}

/** État sauvegardé (pour la restauration au boot). Si v5 est absent, relit v4, v3, puis v2. */
export function loadSavedState(): SavedState {
  const empty: SavedState = { groups: [], workspaces: [] };
  if (typeof localStorage === "undefined") return empty;
  try {
    const v5 = localStorage.getItem(STORAGE_KEY);
    if (v5 !== null) return parseSavedState(JSON.parse(v5), true);
    const v4 = localStorage.getItem(V4_KEY);
    if (v4 !== null) return parseSavedState(JSON.parse(v4));
    const v3 = localStorage.getItem(V3_KEY);
    if (v3 !== null) return parseSavedState(JSON.parse(v3));
    const v2 = localStorage.getItem(V2_KEY);
    if (v2 === null) return empty;
    return migrateV2(JSON.parse(v2)) ?? empty;
  } catch {
    return empty;
  }
}

/** Dernier dossier ouvert via le dialog (sert de defaultPath au prochain dialog). */
export function getLastFolder(): string | undefined {
  if (typeof localStorage === "undefined") return undefined;
  try {
    return localStorage.getItem(LAST_FOLDER_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setLastFolder(path: string): void {
  if (typeof localStorage === "undefined") return;
  try {
    localStorage.setItem(LAST_FOLDER_KEY, path);
  } catch {
    /* quota dépassé ou localStorage désactivé : on ignore */
  }
}

/** `termines` sans les onglets donnés ; même référence si aucun n'y figurait (pas de
    réallocation, donc pas de rendu pour rien). */
/** Expiration de l'état « terminé » de chaque onglet (maquette Mosaique : « terminé, à
    l'instant » pendant 6 s, puis retour au repos). Reprogrammée à chaque fin de tour. */
const expirationsTermine = new Map<string, ReturnType<typeof setTimeout>>();

function sansOnglets(termines: Record<string, true>, tabs: readonly { id: string }[]): Record<string, true> {
  if (!tabs.some((t) => t.id in termines)) return termines;
  const suite = { ...termines };
  for (const t of tabs) delete suite[t.id];
  return suite;
}

/** Égalité de deux listes de ports (déjà triées côté Rust). */
function sameNumbers(a: number[], b: number[]): boolean {
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

/** Réécrit la sauvegarde complète (après chaque action qui change workspaces ou groupes). */
function persist(workspaces: Workspace[], groups: Group[]): void {
  if (typeof localStorage === "undefined") return;
  try {
    const saved: SavedState = {
      groups: groups.map((g) => ({ name: g.name, color: g.color, collapsed: g.collapsed })),
      workspaces: workspaces.map((w) => {
        const gi = groups.findIndex((g) => g.id === w.groupId);
        const sessions = w.tabs.map((t) => t.claude ?? null);
        return {
          cwd: w.cwd,
          name: w.name,
          tabCount: w.tabs.length,
          groupIndex: gi === -1 ? null : gi,
          ...(w.color ? { color: w.color } : {}),
          ...(sessions.some((x) => x !== null) ? { claudeSessions: sessions } : {}),
        };
      }),
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
  } catch {
    /* quota dépassé ou localStorage désactivé : on ignore */
  }
}

/**
 * Ordre d'affichage de la sidebar : hors-groupe d'abord (dans l'ordre de `workspaces`),
 * puis chaque groupe dans l'ordre de `groups`. Le tableau `workspaces` reste la source
 * de vérité de l'ordre RELATIF ; les groupes ne font que le partitionner.
 */
export function sidebarOrder(workspaces: Workspace[], groups: Group[]): Workspace[] {
  const out = workspaces.filter((w) => w.groupId === null);
  for (const g of groups) out.push(...workspaces.filter((w) => w.groupId === g.id));
  return out;
}

/** Ordre visible pour la navigation clavier (Ctrl+1..9, PageUp/Down) : sans les repliés. */
export function navigableOrder(workspaces: Workspace[], groups: Group[]): Workspace[] {
  const collapsed = new Set(groups.filter((g) => g.collapsed).map((g) => g.id));
  return sidebarOrder(workspaces, groups).filter((w) => !collapsed.has(w.groupId ?? ""));
}

/** Membres d'une appartenance (groupe ou hors-groupe pour null), dans l'ordre. */
function members(workspaces: Workspace[], groupId: string | null): Workspace[] {
  return workspaces.filter((w) => w.groupId === groupId);
}

/**
 * Replace `ws` (déjà retiré de `rest`) à la position `index` PARMI les membres de
 * `groupId`, en préservant l'ordre relatif de tous les autres. Insère avant le
 * membre qui occupe `index`, ou en fin de tableau si l'appartenance est plus courte.
 */
function insertAmong(rest: Workspace[], ws: Workspace, groupId: string | null, index: number): Workspace[] {
  const peers = members(rest, groupId);
  const clamped = Math.max(0, Math.min(index, peers.length));
  if (clamped === peers.length) {
    // Après le dernier membre (ou en fin de tableau si le groupe est vide).
    const last = peers[peers.length - 1];
    const at = last ? rest.indexOf(last) + 1 : rest.length;
    return [...rest.slice(0, at), ws, ...rest.slice(at)];
  }
  const at = rest.indexOf(peers[clamped]);
  return [...rest.slice(0, at), ws, ...rest.slice(at)];
}

function newWorkspace(
  cwd: string,
  name: string,
  tabCount: number,
  groupId: string | null,
  color?: string,
  claudeSessions: (ClaudeSession | null)[] = [],
): Workspace {
  // Un onglet restauré avec sa session Claude redémarre dans le dossier de la session
  // et la reprend dès que son shell est lancé.
  const tabs = Array.from({ length: tabCount }, (_, i): Tab => {
    const claude = claudeSessions[i];
    return claude
      ? { id: uid("tab"), numero: i + 1, cwd: claude.cwd, claude, pendingResume: claude.id }
      : { id: uid("tab"), numero: i + 1 };
  });
  return {
    id: uid("ws"),
    cwd,
    name,
    tabs,
    activeTabId: tabs[0].id,
    groupId,
    ...(color ? { color } : {}),
    ports: [],
    unread: false,
    unreadTabs: [],
    diffOpen: false,
  };
}

export const useWorkspaceStore = create<WorkspaceState>((set, get) => {
  const persistNow = () => {
    const s = get();
    persist(s.workspaces, s.groups);
  };
  const updateWs = (wsId: string, f: (w: Workspace) => Workspace) =>
    set((s) => ({ workspaces: s.workspaces.map((w) => (w.id === wsId ? f(w) : w)) }));
  const updateTab = (wsId: string, tabId: string, f: (t: Tab) => Tab) =>
    updateWs(wsId, (w) => ({ ...w, tabs: w.tabs.map((t) => (t.id === tabId ? f(t) : t)) }));

  /** Retire un workspace : purge ses PTY mappings, réactive un voisin dans l'ordre visible. */
  const removeWorkspace = (s: WorkspaceState, wsId: string): Partial<WorkspaceState> => {
    const closed = s.workspaces.find((w) => w.id === wsId);
    if (!closed) return {};
    const workspaces = s.workspaces.filter((w) => w.id !== wsId);
    // Purge des mappings tab→PTY : les PTYs eux-mêmes sont fermés par le
    // démontage des TerminalPane du workspace (cleanup closePty).
    const tabPtys = { ...s.tabPtys };
    for (const t of closed.tabs) delete tabPtys[t.id];
    const tabsTermines = sansOnglets(s.tabsTermines, closed.tabs);
    // Si le workspace fermé était actif : son SUIVANT dans l'ordre du dock, sinon le
    // précédent, sinon rien (maquette Creation : celui qui prend sa place sous le pointeur).
    let activeId = s.activeId;
    if (s.activeId === wsId) {
      const before = sidebarOrder(s.workspaces, s.groups);
      const idx = before.findIndex((w) => w.id === wsId);
      const after = sidebarOrder(workspaces, s.groups);
      activeId = after[idx]?.id ?? after[idx - 1]?.id ?? null;
    }
    // Fermer le dernier membre d'un groupe retire le groupe : le dock ne dessine pas
    // d'étiquette vide (aucune maquette n'en montre). Les espaces récents retiennent leur
    // groupe, recréé à la réouverture.
    const groupId = closed.groupId;
    const groups =
      groupId !== null && !workspaces.some((w) => w.groupId === groupId)
        ? s.groups.filter((g) => g.id !== groupId)
        : s.groups;
    return { workspaces, tabPtys, activeId, tabsTermines, groups };
  };

  return {
    workspaces: [],
    groups: [],
    activeId: null,
    tabPtys: {},
    busyPtys: {},
    tabsTermines: {},
    toast: null,
    addWorkspace: (cwd, name, groupId) => {
      const s = get();
      // Groupe demandé (création depuis l'en-tête d'un groupe) s'il existe encore ;
      // sinon celui du workspace actif.
      const active = s.workspaces.find((w) => w.id === s.activeId);
      const target =
        groupId !== undefined
          ? (s.groups.find((g) => g.id === groupId)?.id ?? null)
          : (active?.groupId ?? null);
      const ws = newWorkspace(cwd, name ?? basename(cwd), 1, target);
      // Inséré en fin de son appartenance : il apparaît sous ses pairs dans la sidebar.
      set((st) => ({
        workspaces: insertAmong(st.workspaces, ws, ws.groupId, Number.MAX_SAFE_INTEGER),
        activeId: ws.id,
      }));
      persistNow();
      return ws.id;
    },
    restaurerEspace: (e) => {
      const s = get();
      let groupId: string | null = s.workspaces.find((w) => w.id === s.activeId)?.groupId ?? null;
      if (e.groupe === null) groupId = null;
      else if (e.groupe) {
        const nom = e.groupe.name;
        groupId = s.groups.find((g) => g.name === nom)?.id ?? get().addGroup(nom, e.groupe.color);
      }
      // Au moins un onglet, et un par session à reprendre.
      const tabCount = Math.max(1, Math.floor(e.tabCount) || 1, e.claudeSessions?.length ?? 0);
      const ws = newWorkspace(e.cwd, e.name, tabCount, groupId, e.color, e.claudeSessions);
      set((st) => ({
        workspaces: insertAmong(st.workspaces, ws, ws.groupId, Number.MAX_SAFE_INTEGER),
        activeId: ws.id,
      }));
      persistNow();
      return ws.id;
    },
    duplicateWorkspace: (wsId) => {
      const s = get();
      const src = s.workspaces.find((w) => w.id === wsId);
      if (!src) return null;
      // Nom incrémenté parmi TOUS les workspaces : deux groupes n'ont pas à se
      // partager un même « app 2 », la sidebar les afficherait côte à côte.
      const name = nextCopyName(src.name, s.workspaces.map((w) => w.name));
      // Un onglet neuf : un PTY ne se clone pas, et l'historique du shell d'origine
      // n'appartient pas à la copie.
      const copy: Workspace = {
        ...newWorkspace(src.cwd, name, 1, src.groupId, src.color),
        // Même dossier : la copie montre d'emblée la branche et l'état git de l'original,
        // au lieu de « hors dépôt » le temps que la sonde passe.
        ...(src.branch !== undefined ? { branch: src.branch } : {}),
        ...(src.gitConnu ? { gitConnu: true } : {}),
        ...(src.dirty !== undefined ? { dirty: src.dirty } : {}),
        ...(src.nbModifies !== undefined ? { nbModifies: src.nbModifies } : {}),
      };
      const index = members(s.workspaces, src.groupId).indexOf(src) + 1;
      set((st) => ({ workspaces: insertAmong(st.workspaces, copy, copy.groupId, index), activeId: copy.id }));
      persistNow();
      return copy.id;
    },
    addTab: (wsId, cwd) => {
      const ws = get().workspaces.find((w) => w.id === wsId);
      const numero = numeroOngletSuivant(ws?.tabs ?? []);
      const tab: Tab = cwd ? { id: uid("tab"), numero, cwd } : { id: uid("tab"), numero };
      updateWs(wsId, (w) => ({ ...w, tabs: [...w.tabs, tab], activeTabId: tab.id }));
      persistNow();
      return tab.id;
    },
    closeTab: (wsId, tabId) => {
      const ws = get().workspaces.find((w) => w.id === wsId);
      if (!ws || !ws.tabs.some((t) => t.id === tabId)) return;
      if (ws.tabs.length <= 1) {
        // Dernier onglet : c'est le workspace qui se ferme (même chemin que Ctrl+Shift+Q).
        set((s) => removeWorkspace(s, wsId));
        persistNow();
        return;
      }
      set((s) => ({ tabsTermines: sansOnglets(s.tabsTermines, [{ id: tabId }]) }));
      updateWs(wsId, (w) => {
        const idx = w.tabs.findIndex((t) => t.id === tabId);
        const tabs = w.tabs.filter((t) => t.id !== tabId);
        // Si l'onglet actif est fermé : voisin de gauche, sinon celui qui prend sa place.
        const activeTabId =
          w.activeTabId === tabId ? (tabs[idx - 1]?.id ?? tabs[idx]?.id ?? tabs[0].id) : w.activeTabId;
        // Un onglet fermé ne peut plus réclamer l'attention.
        const unreadTabs = w.unreadTabs.filter((t) => t !== tabId);
        return { ...w, tabs, activeTabId, unreadTabs };
      });
      persistNow();
    },
    closeWorkspace: (wsId) => {
      set((s) => removeWorkspace(s, wsId));
      persistNow();
    },
    moveWorkspace: (wsId, toIndex) => {
      set((s) => {
        const ws = s.workspaces.find((w) => w.id === wsId);
        if (!ws) return {}; // workspace fermé entre le pointerdown et le pointerup
        const peers = members(s.workspaces, ws.groupId);
        const from = peers.indexOf(ws);
        if (toIndex < 0 || toIndex >= peers.length || from === toIndex) return {};
        const rest = s.workspaces.filter((w) => w.id !== wsId);
        return { workspaces: insertAmong(rest, ws, ws.groupId, toIndex) };
      });
      // Réordonner ne touche pas activeId : déplacer un workspace ne l'active pas.
      persistNow();
    },
    assignToGroup: (wsId, groupId, index = Number.MAX_SAFE_INTEGER) => {
      set((s) => {
        const ws = s.workspaces.find((w) => w.id === wsId);
        if (!ws) return {};
        if (groupId !== null && !s.groups.some((g) => g.id === groupId)) return {};
        const rest = s.workspaces.filter((w) => w.id !== wsId);
        return { workspaces: insertAmong(rest, { ...ws, groupId }, groupId, index) };
      });
      persistNow();
    },
    setActiveTab: (wsId, tabId) =>
      set((s) => ({
        // Consulter l'onglet, c'est avoir vu que son agent a fini.
        tabsTermines: sansOnglets(s.tabsTermines, [{ id: tabId }]),
        busyPtys: sansTravailConsulte(s, s.workspaces.find((w) => w.id === wsId)?.unreadTabs.includes(tabId) ? [tabId] : []),
        workspaces: s.workspaces.map((w) =>
          w.id === wsId && w.tabs.some((t) => t.id === tabId)
            ? {
                ...w,
                activeTabId: tabId,
                // focus = lu : le point bleu de cet onglet s'éteint
                unreadTabs: w.unreadTabs.filter((t) => t !== tabId),
              }
            : w,
        ),
      })),
    moveTab: (wsId, tabId, toIndex) => {
      set((s) => {
        const w = s.workspaces.find((x) => x.id === wsId);
        if (!w) return {};
        const from = w.tabs.findIndex((t) => t.id === tabId);
        const tabs = moveItem(w.tabs, from, toIndex);
        if (tabs === w.tabs) return {};
        return { workspaces: s.workspaces.map((x) => (x.id === wsId ? { ...x, tabs } : x)) };
      });
      // Les sessions Claude sont sauvegardées dans l'ordre des onglets.
      persistNow();
    },
    setTabTitle: (wsId, tabId, title) =>
      set((s) => {
        const w = s.workspaces.find((x) => x.id === wsId);
        const tab = w?.tabs.find((t) => t.id === tabId);
        // Le shell renvoie souvent le même titre : ne pas réallouer pour rien.
        if (!w || !tab || tab.title === title) return s;
        return {
          workspaces: s.workspaces.map((x) =>
            x.id === wsId
              ? { ...x, tabs: x.tabs.map((t) => (t.id === tabId ? { ...t, title } : t)) }
              : x,
          ),
        };
      }),
    setTabClaudeSession: (wsId, tabId, session) => {
      const tab = get().workspaces.find((w) => w.id === wsId)?.tabs.find((t) => t.id === tabId);
      if (!tab || (tab.claude?.id === session.id && tab.claude.cwd === session.cwd)) return;
      updateTab(wsId, tabId, (t) => ({ ...t, claude: session }));
      persistNow();
    },
    endTabClaudeSession: (wsId, tabId, sessionId) => {
      const tab = get().workspaces.find((w) => w.id === wsId)?.tabs.find((t) => t.id === tabId);
      // Les hooks arrivent par des connexions socket distinctes : la fin de l'ancienne
      // session (/clear) peut suivre le début de la nouvelle. On ne retire que la bonne.
      if (tab?.claude?.id !== sessionId) return;
      updateTab(wsId, tabId, ({ claude: _ended, ...t }) => t);
      persistNow();
    },
    consumePendingResume: (wsId, tabId) =>
      updateTab(wsId, tabId, ({ pendingResume: _done, ...t }) => t),
    renameWorkspace: (wsId, name) => {
      updateWs(wsId, (w) => ({ ...w, name: name.trim() || basename(w.cwd) }));
      persistNow();
    },
    setWorkspaceColor: (wsId, color) => {
      updateWs(wsId, (w) => {
        const { color: _old, ...rest } = w;
        return color ? { ...rest, color } : rest;
      });
      persistNow();
    },
    setCwd: (wsId, cwd) => {
      const next = stripTrailingSlash(cwd);
      updateWs(wsId, (w) => ({ ...w, cwd: next, tabs: w.tabs.map(({ cwd: _start, ...t }) => t) }));
      persistNow();
    },
    setNotification: (wsId, n, tabId) =>
      set((s) => ({
        workspaces: s.workspaces.map((w) => {
          if (w.id !== wsId) return w;
          if (tabId !== undefined && w.tabs.some((t) => t.id === tabId)) {
            // Onglet déjà sous les yeux (workspace actif, onglet actif) : rien à signaler.
            if (s.activeId === wsId && w.activeTabId === tabId) return { ...w, lastNotification: n };
            // point bleu sur l'onglet émetteur, pas de fallback workspace
            const unreadTabs = w.unreadTabs.includes(tabId) ? w.unreadTabs : [...w.unreadTabs, tabId];
            return { ...w, unreadTabs, lastNotification: n };
          }
          // onglet inconnu ou non fourni (CLI hors onglet, onglet fermé) : fallback workspace
          return { ...w, unread: true, lastNotification: n };
        }),
      })),
    setActive: (wsId, opts) =>
      set((s) => {
        const quitte = s.activeId !== wsId ? s.workspaces.find((w) => w.id === s.activeId) : undefined;
        const transfert = opts?.garderDiff === true && quitte?.diffOpen === true;
        const cible = s.workspaces.find((w) => w.id === wsId);
        const consulte = cible?.activeTabId && cible.unreadTabs.includes(cible.activeTabId) ? [cible.activeTabId] : [];
        return {
          activeId: wsId,
          busyPtys: sansTravailConsulte(s, consulte),
          // Consulter l'espace efface l'état « terminé » de tous ses onglets : c'est une
          // information (l'agent a fini), pas une demande qui attendrait l'onglet précis.
          tabsTermines: sansOnglets(s.tabsTermines, s.workspaces.find((w) => w.id === wsId)?.tabs ?? []),
          // Activer le workspace lit le fallback ET l'onglet affiché ; les autres
          // onglets gardent leur point tant qu'on ne les a pas ouverts.
          workspaces: s.workspaces.map((w) =>
            w.id === wsId
              ? // Arriver sur un workspace montre son TERMINAL : un diff resté ouvert
                // dessus se referme. Exception, le workspace DÉJÀ actif : le clic sur la
                // ligne méta fait setActive + toggleDiff, refermer ici annulerait la
                // fermeture par second clic.
                {
                  ...w,
                  unread: false,
                  unreadTabs: w.unreadTabs.filter((t) => t !== w.activeTabId),
                  diffOpen: transfert || (s.activeId === wsId ? w.diffOpen : false),
                }
              : transfert && w.id === quitte?.id
                ? { ...w, diffOpen: false }
                : w,
          ),
        };
      }),
    // Les deux sondes git sont séparées : la branche est gratuite et rafraîchie à
    // cadence fixe, le dirty coûte des secondes et se raréfie tout seul. Les fusionner
    // reviendrait à payer le dirty pour afficher la branche (cf. lib/pollSchedule.ts).
    setBranch: (wsId, branch) =>
      set((s) => {
        const w = s.workspaces.find((x) => x.id === wsId);
        // Sonde périodique : rendre l'état INCHANGÉ quand rien n'a bougé, sinon
        // chaque tick réalloue `workspaces` → Zustand notifie → re-render de tout
        // l'arbre pour rien.
        if (!w || ((branch === null || w.branch === branch) && w.gitConnu)) return s;
        return {
          workspaces: s.workspaces.map((x) =>
            x.id === wsId ? (branch === null ? { ...x, gitConnu: true } : { ...x, branch, gitConnu: true }) : x,
          ),
        };
      }),
    setDirty: (wsId, dirty, nbModifies) =>
      set((s) => {
        const w = s.workspaces.find((x) => x.id === wsId);
        // Compte absent : on garde le dernier connu, sauf repassé « propre » (plus rien à compter).
        const nb = nbModifies ?? (dirty ? w?.nbModifies : undefined);
        if (!w || (w.dirty === dirty && w.nbModifies === nb)) return s;
        return {
          workspaces: s.workspaces.map((x) => {
            if (x.id !== wsId) return x;
            const { nbModifies: _ancien, ...reste } = x;
            return nb === undefined ? { ...reste, dirty } : { ...reste, dirty, nbModifies: nb };
          }),
        };
      }),
    setPorts: (wsId, ports) =>
      set((s) => {
        const w = s.workspaces.find((x) => x.id === wsId);
        // Comparaison par CONTENU : la sonde reconstruit un tableau neuf à chaque tour
        // (les ports sont déjà triés côté Rust, l'ordre est donc stable).
        if (!w || sameNumbers(w.ports, ports)) return s;
        return { workspaces: s.workspaces.map((x) => (x.id === wsId ? { ...x, ports } : x)) };
      }),
    setStatus: (wsId, status) => updateWs(wsId, (w) => ({ ...w, status })),
    setProgress: (wsId, progress) => updateWs(wsId, (w) => ({ ...w, progress })),
    setTabPty: (tabId, ptyId) => set((s) => ({ tabPtys: { ...s.tabPtys, [tabId]: ptyId } })),
    setPtyBusy: (ptyId, busy, finDeTour = true) =>
      set((s) => {
        if (busy === (ptyId in s.busyPtys)) return s;
        const tabId = Object.keys(s.tabPtys).find((t) => s.tabPtys[t] === ptyId);
        if (busy) {
          // L'agent repart : l'onglet n'est plus « terminé », il travaille.
          const tabsTermines = tabId ? sansOnglets(s.tabsTermines, [{ id: tabId }]) : s.tabsTermines;
          return { busyPtys: { ...s.busyPtys, [ptyId]: true }, tabsTermines };
        }
        const { [ptyId]: _idle, ...rest } = s.busyPtys;
        // Fin de tour : l'onglet passe « terminé ». Une demande en attente (notification
        // non lue) l'emporte de toute façon à l'affichage (lib/etatAgent).
        if (!finDeTour || !tabId) return { busyPtys: rest };
        clearTimeout(expirationsTermine.get(tabId));
        expirationsTermine.set(
          tabId,
          setTimeout(() => {
            expirationsTermine.delete(tabId);
            set((x) => (tabId in x.tabsTermines ? { tabsTermines: sansOnglets(x.tabsTermines, [{ id: tabId }]) } : x));
          }, DUREE_TERMINE_MS),
        );
        return { busyPtys: rest, tabsTermines: { ...s.tabsTermines, [tabId]: true } };
      }),
    removeTabPty: (tabId) =>
      set((s) => {
        const { [tabId]: removed, ...rest } = s.tabPtys;
        // Un PTY fermé (onglet fermé, respawn) ne travaille plus, et son shell neuf n'a
        // rien « terminé ».
        const tabsTermines = sansOnglets(s.tabsTermines, [{ id: tabId }]);
        if (removed === undefined || !(removed in s.busyPtys)) return { tabPtys: rest, tabsTermines };
        const { [removed]: _idle, ...busyPtys } = s.busyPtys;
        return { tabPtys: rest, busyPtys, tabsTermines };
      }),
    toggleDiff: (wsId) => updateWs(wsId, (w) => ({ ...w, diffOpen: !w.diffOpen })),
    // Les demandes d'interface (popover de création, de modification, formulaire de
    // groupe, dock visible) vivent dans le store ui : celui-ci ne porte que les données.
    // --- groupes ---
    addGroup: (name, color) => {
      const id = uid("grp");
      const c = color ?? defaultGroupColor(colorIndex);
      if (color === undefined) colorIndex++;
      set((s) => ({
        groups: [...s.groups, { id, name: name.trim() || "Groupe", color: c, collapsed: false }],
      }));
      persistNow();
      return id;
    },
    renameGroup: (groupId, name) => {
      const trimmed = name.trim();
      if (!trimmed) return;
      set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? { ...g, name: trimmed } : g)) }));
      persistNow();
    },
    setGroupColor: (groupId, color) => {
      set((s) => ({ groups: s.groups.map((g) => (g.id === groupId ? { ...g, color } : g)) }));
      persistNow();
    },
    toggleGroupCollapsed: (groupId) => {
      set((s) => ({
        groups: s.groups.map((g) => (g.id === groupId ? { ...g, collapsed: !g.collapsed } : g)),
      }));
      persistNow();
    },
    removeGroup: (groupId) => {
      set((s) => {
        if (!s.groups.some((g) => g.id === groupId)) return {};
        // Les workspaces libérés passent hors-groupe, à leur place dans le tableau :
        // ils réapparaissent donc en tête de sidebar, dans leur ordre relatif.
        return {
          groups: s.groups.filter((g) => g.id !== groupId),
          workspaces: s.workspaces.map((w) => (w.groupId === groupId ? { ...w, groupId: null } : w)),
        };
      });
      persistNow();
    },
    moveGroup: (groupId, toIndex) => {
      set((s) => {
        const from = s.groups.findIndex((g) => g.id === groupId);
        const groups = moveItem(s.groups, from, toIndex);
        return groups === s.groups ? {} : { groups };
      });
      persistNow();
    },
    restoreState: ({ groups: savedGroups, workspaces: entries }) => {
      const groups: Group[] = savedGroups.map((g) => ({
        id: uid("grp"),
        name: g.name,
        color: g.color,
        collapsed: g.collapsed,
      }));
      const restored = entries.map((e): Workspace => {
        // tabCount vient du disque : au moins 1 (plus de borne haute, la barre est libre).
        const tabCount = Math.max(1, Math.floor(e.tabCount) || 1);
        const groupId = e.groupIndex === null ? null : (groups[e.groupIndex]?.id ?? null);
        return newWorkspace(e.cwd, e.name, tabCount, groupId, e.color, e.claudeSessions);
      });
      // Concaténation (jamais remplacement) : un workspace créé pendant la fenêtre des
      // invoke dir_exists du boot (bouton +, commande socket new-workspace) ne doit pas
      // être détruit avec son PTY. Les workspaces déjà présents gardent la priorité
      // d'activation ; sinon on active le premier restauré.
      set((s) => ({
        groups: [...s.groups, ...groups],
        workspaces: [...s.workspaces, ...restored],
        activeId: s.activeId ?? restored[0]?.id ?? null,
      }));
      persistNow();
    },
    showToast: (msg) => set({ toast: msg }),
    clearToast: () => set({ toast: null }),
    reset: () => {
      counter = 0;
      colorIndex = 0;
      set({
        workspaces: [],
        groups: [],
        activeId: null,
        tabPtys: {},
        busyPtys: {},
        tabsTermines: {},
        toast: null,
      });
    },
  };
});

/** Vrai si le workspace réclame l'attention : fallback workspace OU ≥ 1 onglet non lu. */
export function hasAttention(w: Workspace): boolean {
  return w.unread || w.unreadTabs.length > 0;
}

/** Vrai si un workspace du groupe réclame l'attention (halo sur l'en-tête replié). */
export function groupHasAttention(workspaces: Workspace[], groupId: string): boolean {
  return workspaces.some((w) => w.groupId === groupId && hasAttention(w));
}

/**
 * Occupation des onglets dont on vient de consulter l'attente (question, autorisation) :
 * l'agent attend la réponse affichée, il ne travaille pas. Sans cela l'avatar retrouvait
 * l'arc « au travail » sous la question (maquette Accueil/09 : aucun arc). Le hook suivant
 * (PostToolUse une fois la réponse donnée) rallume l'arc. Même objet rendu si rien ne change.
 */
function sansTravailConsulte(s: Pick<WorkspaceState, "tabPtys" | "busyPtys">, tabIds: readonly string[]): Record<number, true> {
  let busyPtys = s.busyPtys;
  for (const tabId of tabIds) {
    const pty = s.tabPtys[tabId];
    if (pty === undefined || !(pty in busyPtys)) continue;
    const { [pty]: _attend, ...reste } = busyPtys;
    busyPtys = reste;
  }
  return busyPtys;
}

type BusyState = Pick<WorkspaceState, "tabPtys" | "busyPtys">;

/** Vrai si un agent travaille dans l'onglet `tabId`. */
export function isTabBusy(s: BusyState, tabId: string): boolean {
  const pty = s.tabPtys[tabId];
  return pty !== undefined && pty in s.busyPtys;
}

/** Vrai si un agent travaille dans au moins un onglet du workspace. */
export function isWorkspaceBusy(s: BusyState, w: Workspace): boolean {
  return w.tabs.some((t) => isTabBusy(s, t.id));
}

/** Vrai si un workspace du groupe travaille (arc sur l'en-tête replié). */
export function groupHasBusy(s: BusyState, workspaces: Workspace[], groupId: string): boolean {
  return workspaces.some((w) => w.groupId === groupId && isWorkspaceBusy(s, w));
}
