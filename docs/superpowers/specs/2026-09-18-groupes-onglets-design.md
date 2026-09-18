# Groupes de workspaces et terminaux en onglets — design

Date : 2026-09-18. Branche de réalisation prévue : `feat-tabs` (worktree), à partir de master.

## Objectif

Réorganiser la navigation de terminials sur deux points :

1. La sidebar accueille des **groupes** : des sections nommées, colorées et repliables qui
   rassemblent plusieurs workspaces. Un workspace peut aussi vivre hors de tout groupe.
2. Dans un workspace, les terminaux deviennent des **onglets** : un seul terminal visible à la
   fois, nombre d'onglets libre. La grille 1→4 (`PaneTree`) disparaît, ainsi que `MAX_PANES`.

Hors périmètre : split dans un onglet, groupe portant un dossier racine, fusion avec la branche
`feat-dashboard` (décision séparée de Thomas), changement du protocole CLI/socket.

## 1. Modèle et persistance

### Types du store (`src/store/workspace.ts`)

```ts
interface Tab { id: string; title?: string }          // title poussé par xterm onTitleChange (OSC 0/2)
interface Group { id: string; name: string; color: string; collapsed: boolean }

interface Workspace {
  id: string; cwd: string; name: string; color: string;
  tabs: Tab[];                 // remplace panes: string[]
  activeTabId: string | null;  // remplace activePaneId
  unreadTabs: string[];        // remplace unreadPanes
  groupId: string | null;      // nouveau
  // branch, dirty, ports, unread, diffOpen, lastNotification, status, progress : inchangés
}
```

Le store gagne `groups: Group[]` (tableau **ordonné**).

### Actions

- Groupes : `addGroup(name, color?) → id`, `renameGroup(id, name)`, `setGroupColor(id, color)`,
  `toggleGroupCollapsed(id)`, `removeGroup(id)` (ses workspaces passent `groupId = null`, aucun
  terminal fermé), `moveGroup(id, toIndex)`.
- Assignation : `assignToGroup(wsId, groupId | null, index)` place le workspace à `index` dans la
  liste de sa nouvelle appartenance. `moveWorkspace(wsId, toIndex)` réordonne **au sein de son
  appartenance courante** uniquement.
- Onglets : `addTab(wsId) → tabId` (ne refuse jamais), `closeTab(wsId, tabId)`,
  `setActiveTab(wsId, tabId)`, `moveTab(wsId, tabId, toIndex)`, `setTabTitle(wsId, tabId, title)`.
  Fermer le **dernier** onglet ferme le workspace (comme Ctrl+Shift+Q : sans confirmation).
- `addWorkspace(cwd, name?)` crée dans le groupe du workspace actif (`null` si l'actif est
  hors-groupe ou s'il n'y a pas d'actif).
- `setNotification(wsId, n, tabId?)` : le `ptyId` de l'event `agent-notification` est résolu en
  `tabId` via `panePtys` (renommé `tabPtys`), exactement comme aujourd'hui pour les panes.

### Ordre visible

Fonction pure `sidebarOrder(workspaces, groups): Workspace[]` : hors-groupe d'abord (dans l'ordre
du tableau `workspaces`), puis pour chaque groupe dans l'ordre de `groups`, ses workspaces (idem).
Une variante `navigableOrder` exclut les workspaces des groupes repliés : Ctrl+1..9,
Ctrl+PageUp/PageDown et le compteur affiché la consomment. Le tableau `workspaces` reste la
source de vérité de l'ordre relatif ; les groupes ne font que partitionner.

### Persistance localStorage v3

Clé `terminials:workspaces:v3` :

```json
{
  "groups": [{ "name": "…", "color": "#…", "collapsed": false }],
  "workspaces": [{ "cwd": "…", "name": "…", "color": "#…", "tabCount": 2, "groupIndex": 0 }]
}
```

`groupIndex` est l'index dans `groups`, ou `null`. Migration au chargement : si v3 absent et v2
(`terminials:workspaces:v2`) présent, chaque entrée v2 devient `{…, tabCount: paneCount,
groupIndex: null}`, `groups = []`, puis v2 est supprimé. `tabCount` est clampé à `≥ 1` (plus de
borne haute). Les titres d'onglet et l'onglet actif ne sont pas persistés. La restauration au boot
(`restoreWorkspaces`) conserve la logique actuelle (`dir_exists`, concaténation) et recrée
d'abord les groupes, puis les workspaces avec leur `groupId`.

## 2. Sidebar et groupes (`src/components/Sidebar.tsx`)

- **Structure** : liste verticale inchangée, découpée en sections. Les hors-groupe apparaissent
  en tête sans en-tête. Chaque groupe = une ligne d'en-tête (chevron ▸/▾, pastille couleur, nom
  en ellipsis, compteur `n`, pile d'actions ✎/× au survol) puis ses workspaces indentés de 12 px,
  reliés par un filet vertical de 2 px de la couleur du groupe.
- **Repli** : clic sur l'en-tête (ou Ctrl+Shift+E pour le groupe du workspace actif). Groupe
  replié = une seule ligne. Si un de ses workspaces `hasAttention` ou a `unread`, l'en-tête porte
  le halo bleu `ATTENTION_COLOR` déjà utilisé pour les lignes de workspace. Replier le groupe du
  workspace actif ne change rien à la zone terminal.
- **Création/édition** : bouton « + groupe » à côté du « + » en bas de sidebar (Ctrl+Shift+G).
  Formulaire inline nom + couleur de `PALETTE`, sur le modèle de `WorkspaceForm` (nouveau
  `GroupForm`). ✎ rouvre le même formulaire. × dégroupe les workspaces et supprime le groupe.
- **Drag** : le drag pointer-events existant (seuil 4 px, `suppressClick`, `dropBoundary`/
  `finalIndex` dans `lib/reorder.ts`) se généralise :
  - un workspace tiré peut être déposé à toute frontière entre lignes de workspace (hors-groupe
    ou dans un groupe déplié) ; déposé « sur » un en-tête de groupe, il est inséré en fin de ce
    groupe (déplié ou replié) ;
  - un en-tête de groupe tiré se déplace entre les autres groupes uniquement (jamais dans un
    groupe, jamais parmi les hors-groupe) ; ses workspaces suivent ;
  - `reorder.ts` expose une fonction pure `resolveDrop(rows, y)` retournant
    `{ kind: "workspace", groupId, index } | { kind: "group", index } | { kind: "into-group", groupId }`,
    testable sans DOM à partir des rectangles des lignes.
- **Nouveau workspace** (Ctrl+Shift+N, Ctrl+Shift+O, « + », CLI `new-workspace`) : naît dans le
  groupe du workspace actif.

## 3. Zone terminal et onglets (`src/components/TabbedTerminals.tsx`)

Remplace `PaneTree`. Monté dans la pile existante de `App.tsx` (un par workspace, tous montés,
`visibility:hidden` pour les inactifs). Invariant **keep-alive** conservé : jamais de
`display:none`, jamais de démontage d'un `TerminalPane` tant que son onglet existe (son cleanup
ferme le PTY).

- **Barre d'onglets** (28 px, en haut) : un onglet par `tab`, dans l'ordre. Onglet = point bleu
  d'attention à gauche si `unreadTabs` le contient (remplace l'anneau ; focus = lu), titre en
  ellipsis (`tab.title` sinon « Terminal n », n = position 1-based), × au survol. L'onglet actif
  porte une bordure basse 2 px de `ws.color`. Bouton « + » en fin de barre. Clic milieu ferme.
  Réordonnancement par drag horizontal (mêmes pointer events que la sidebar, `finalIndex`
  réutilisé sur l'axe X).
- **Pile de terminaux** : tous les `TerminalPane` du workspace sont montés ; seul l'actif est
  `visible`. Le conteneur de chaque onglet garde `data-pane-id={tab.id}` pour `resolvePaneId`
  (glisser-déposer de fichiers) : l'élément survolé étant forcément dans l'onglet visible, le
  fichier tombe dans le bon terminal.
- **Titre** : `TerminalPane` s'abonne à `term.onTitleChange` et appelle `setTabTitle`. Front pur,
  aucune modification Rust.
- `DiffOverlay` et le futur dashboard couvrent toute la zone, barre incluse : inchangés.
- `lib/paneFocus.ts` est renommé `lib/tabFocus.ts`, logique identique (registre `tabId → focus`).

## 4. Clavier, CLI, tests

### Raccourcis (`src/lib/shortcuts.ts`, matching `e.code` uniquement)

| Touche | Action |
|---|---|
| Ctrl+Shift+T | nouvel onglet dans le workspace actif |
| Ctrl+Shift+W | ferme l'onglet actif (ferme le workspace si dernier) |
| Alt+← / Alt+→ | onglet précédent / suivant |
| Ctrl+Shift+PageUp / PageDown | déplace l'onglet actif |
| Ctrl+Shift+G | nouveau groupe (ouvre `GroupForm`) |
| Ctrl+Shift+E | replie/déplie le groupe du workspace actif (no-op hors-groupe) |
| Ctrl+1..9, Ctrl+PageUp/PageDown | navigation dans `navigableOrder` (groupes repliés sautés) |
| Ctrl+Shift+↑/↓ | déplace le workspace dans son appartenance |

Retirés : Alt+↑/↓ (`focus-pane` disparaît). Toujours absents : Ctrl+Shift+C/V.
`ShortcutAction` gagne `new-tab`, `close-tab`, `prev-tab`, `next-tab`, `move-tab`, `new-group`,
`toggle-group` ; `new-pane`, `close-pane`, `focus-pane` disparaissent.

### CLI et socket

Aucun changement de protocole (`crates/protocol`). `new-workspace` crée dans le groupe du
workspace actif. Hook Claude Code, OSC 9/99/777, `TERMINIALS_WORKSPACE_ID` : inchangés.

### Tests (vitest, env node, pas de DOM)

- Store : addGroup/removeGroup (dégroupe sans fermer), assignToGroup, moveWorkspace confiné à
  l'appartenance, moveGroup, addTab sans limite, closeTab du dernier onglet ferme le workspace,
  setNotification par tabId, addWorkspace hérite du groupe actif, restoreWorkspaces avec groupes.
- Persistance : sérialisation v3, migration v2 → v3, clamp `tabCount ≥ 1`.
- `sidebarOrder` / `navigableOrder`.
- `reorder.ts` : `resolveDrop` sur des rectangles synthétiques (frontières, en-tête, groupe replié).
- `shortcuts.ts` : nouvelle table, absence de Ctrl+Shift+C/V et d'Alt+↑/↓.
- Rust : aucun test ne bouge.

### Vérification manuelle en fin de chantier

Process long survivant au changement d'onglet et de workspace ; point bleu sur le bon onglet à la
réception d'une notification OSC ; drag d'un workspace entre deux groupes et sur un en-tête
replié ; restauration au boot avec groupes et migration depuis un v2 existant ; Ctrl+1..9 en
AZERTY avec un groupe replié.

## Mise en œuvre

Worktree `feat-tabs` créé depuis master **après** avoir committé les modifications en attente de
master (sondes git adaptatives `pollSchedule.ts`, nouvelle icône), car le chantier touche
`App.tsx` et `workspace.ts`. Pas de fusion avec `feat-dashboard` dans ce chantier.
