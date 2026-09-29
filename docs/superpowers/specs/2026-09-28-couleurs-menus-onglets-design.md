# Couleur par workspace, clic droit dans la sidebar, onglet dans le dossier courant — design

Date : 2026-09-28. Branche : `feat/parite-cmux`, partie de master (e55d2ad).

## Objectif

Trois évolutions, réalisées dans cet ordre :

1. **Couleurs** : chaque workspace peut porter sa propre couleur, facultative. Les groupes gardent
   la leur. Les deux se choisissent parmi les 16 couleurs nommées de cmux.
2. **Clic droit dans la zone vide de la sidebar** : un menu *Nouveau workspace* / *Nouveau groupe*.
3. **Nouvel onglet dans le dossier courant** : un onglet ouvert depuis un terminal démarre dans le
   dossier où se trouve le shell de ce terminal, et non plus dans le dossier du workspace.

Hors périmètre : la CLI (`set-color` et le reste, chantier suivant), la couleur des workspaces dans
le dashboard, la persistance du dossier de chaque onglet, l'insertion d'un onglet à droite de
l'actif, le point 3 sous macOS.

## Ce qui revient sur un choix antérieur

- f2b2306 avait retiré la couleur propre du workspace (README : « un workspace n'a pas de couleur
  propre »). Elle revient, **facultative** : un workspace sans couleur propre s'affiche comme
  aujourd'hui.
- La palette des groupes passe de 8 couleurs vives aux 16 couleurs de cmux. Les groupes existants
  gardent leur couleur, même si elle n'est plus dans la palette.
- Le test « un workspace ne porte plus de couleur d'identité » est remplacé. Les commentaires
  devenus faux sont corrigés, eux seuls (liste au §5).

## 1. Couleurs

### Palette (`src/lib/palette.ts`)

`SIDEBAR_COLORS: readonly NamedColor[]`, avec `NamedColor = { name: string; hex: string }`. Ce
sont les valeurs par défaut de `workspaceColors.colors` dans le schéma de réglages de cmux, dans
son ordre :

| Nom | Hex | Nom | Hex | Nom | Hex | Nom | Hex |
|---|---|---|---|---|---|---|---|
| Red | `#C0392B` | Olive | `#4A5C18` | Blue | `#1565C0` | Magenta | `#AD1457` |
| Crimson | `#922B21` | Green | `#196F3D` | Navy | `#1A5276` | Rose | `#880E4F` |
| Orange | `#A04000` | Teal | `#006B6B` | Indigo | `#283593` | Brown | `#7B3F00` |
| Amber | `#7D6608` | Aqua | `#0E6B8C` | Purple | `#6A1B9A` | Charcoal | `#3E4B5E` |

- `PALETTE`, les 8 couleurs vives, ne change pas : le dashboard la consomme
  (`src/lib/workspacePalette.ts`), et il n'est pas touché.
- `defaultGroupColor(n)` renvoie `SIDEBAR_COLORS[(n * 5) % 16].hex`. Le pas de 5, premier avec 16,
  parcourt les 16 couleurs sans donner des teintes voisines à deux groupes créés à la suite (Red,
  Green, Indigo, Charcoal, Olive…).
- `identityColor(w, group)` renvoie `w.color ?? group?.color`, ou `undefined` si aucun des deux
  n'a de couleur.

### Modèle (`src/store/workspace.ts`)

- `Workspace.color?: string` : absent, le workspace n'a pas de couleur propre.
- `setWorkspaceColor(wsId, color: string | null)` : `null` retire la couleur. Persiste.
- `duplicateWorkspace` copie la couleur, comme le dossier et le groupe.
- `addWorkspace` ne pose pas de couleur.
- `addGroup(name, color?)` prend par défaut `defaultGroupColor(colorIndex)` au lieu de `PALETTE`.

### Affichage

| Élément | Couleur |
|---|---|
| Pastille de la ligne de workspace (`Sidebar.tsx`) | `identityColor(w, group) ?? NO_GROUP_DOT` |
| Filet gauche de la ligne | inchangé : couleur du groupe, transparent hors groupe, bleu d'attention prioritaire |
| Bordure basse de l'onglet actif (`TabbedTerminals.tsx`) | `identityColor(ws, group) ?? "#5a5a5a"` |
| En-tête de groupe | inchangé |

Un workspace coloré hors groupe a donc une pastille colorée et pas de filet.

### Choisir une couleur

- `ContextMenu` gagne un type d'entrée
  `{ swatches: readonly NamedColor[]; current?: string; pick: (hex: string) => void }`. Il affiche
  une grille de pastilles, deux rangées de 8. Le survol affiche le nom (`title`) et la couleur
  courante est entourée (comparaison insensible à la casse). Un clic applique la couleur et ferme
  le menu.
- **Menu d'un workspace** : Renommer…, Dupliquer, ─, *grille*, *Retirer la couleur* (seulement si
  le workspace a une couleur propre), ─, Fermer.
- **Menu d'un groupe** : Nouveau workspace, Renommer / recolorer…, ─, *grille*, ─, Dissoudre le
  groupe. On change ainsi la couleur d'un groupe du même geste que celle d'un workspace.
- `GroupForm` (création et édition d'un groupe) propose les 16 couleurs au lieu des 8.
- Pas de saisie `#hex` libre dans l'interface. La future CLI l'acceptera.

### Persistance v5

Clé `terminials:workspaces:v5` :

```json
{
  "groups": [{ "name": "…", "color": "#…", "collapsed": false }],
  "workspaces": [{ "cwd": "…", "name": "…", "tabCount": 2, "groupIndex": 0, "color": "#7D6608" }]
}
```

- `color` est omis quand le workspace n'a pas de couleur propre. Il n'est relu que si c'est une
  chaîne.
- Lecture en cascade : v5, sinon v4, puis v3, puis v2. Seule la v5 fournit la couleur des
  workspaces. Celle des entrées v3, qui venait de l'ancienne attribution automatique, reste
  ignorée comme depuis la v4.
- Les anciennes clés ne sont jamais écrites ni supprimées. Un build antérieur lancé après
  celui-ci repart donc de sa clé v4 et ne voit pas les changements faits depuis. C'est le même
  compromis qu'au passage de v3 à v4.
- `restoreState` reprend la couleur.

**Identifiant Tauri.** Le dossier de données de la webview, où vit le localStorage, dépend de
l'identifiant de l'application (`com.thomassatory.terminials`, `src-tauri/tauri.conf.json:5`).
Une installation construite avec un identifiant antérieur garde sa sauvegarde dans un autre
dossier. La cascade v5 → v2 ne la voit pas, et ce chantier ne la migre pas : l'utilisateur
repart d'une sidebar vide.

## 2. Clic droit dans la zone vide de la sidebar

- La racine de la sidebar reçoit un `onContextMenu`. Les lignes de workspace et les en-têtes de
  groupe arrêtent déjà la propagation (`openMenu`). Le nouveau menu s'ouvre donc sur l'espace libre
  sous la liste, sur la barre de boutons du bas et sur l'entrée Dashboard.
- Exception : dans un `input` ou un `textarea` (formulaire ouvert), pas de menu maison. Le menu
  natif du champ reste disponible pour couper et coller.
- Entrées :
  - *Nouveau workspace* ouvre le formulaire nom + dossier en bas de liste. Le workspace naît
    **hors groupe**. Aucun raccourci n'est affiché, parce que `Ctrl+Shift+N` crée dans le groupe du
    workspace actif.
  - *Nouveau groupe* (`Ctrl+Maj+G`) ouvre `GroupForm`, comme le bouton `+▾`.
- L'état `creating` de la Sidebar devient `false | "groupe-actif" | "hors-groupe"`. Le formulaire
  appelle `addWorkspace(cwd, name, null)` en mode hors groupe, et `addWorkspace(cwd, name)` sinon.
- Sans changement : le bouton `+`, `Ctrl+Shift+N`, 📂 et ~ créent dans le groupe du workspace
  actif.

## 3. Nouvel onglet dans le dossier du terminal actif

### Comportement

- `Ctrl+Shift+T` et le `+` de la barre d'onglets ouvrent un onglet qui démarre dans le dossier
  courant du shell de l'onglet actif, `cd` compris.
- Si ce dossier est illisible, on se replie sur le dossier de départ de l'onglet actif, puis sur
  celui du workspace. C'est le cas sans onglet actif, avec un PTY pas encore lancé, un shell
  terminé, un dossier supprimé, sans `/proc` (macOS) ou en cas d'erreur.
- C'est le dossier du **shell**, pas celui du programme au premier plan : si Claude Code tourne
  dans l'onglet, c'est le dossier depuis lequel le shell l'a lancé.

### Rust

- `crates/core/src/cwd.rs` : `pub fn process_cwd(pid: u32) -> Option<PathBuf>` lit le lien
  `/proc/<pid>/cwd`. Il renvoie `None` si le lien est illisible ou si sa cible n'est pas un dossier
  existant : un dossier supprimé se lit « … (deleted) ».
- `src-tauri/src/lib.rs` : commande `pty_cwd(pty_id) -> Option<String>`, sur le modèle de
  `workspace_ports`. Elle prend le PID dans le registre, relâche le verrou, puis lit `/proc`. Un
  chemin non UTF-8 donne `None`.
- Le protocole du socket ne change pas.

### Front

- `Tab.cwd?: string` : dossier de départ de l'onglet ; absent, c'est celui du workspace. Il n'est
  pas persisté : au redémarrage, les onglets repartent du dossier du workspace.
- `addTab(wsId, cwd?)`.
- `setCwd(wsId, cwd)` efface le `cwd` des onglets. Tous repartent dans le nouveau dossier, comme
  aujourd'hui (toast « terminaux relancés »).
- `TabbedTerminals` passe `cwd={tab.cwd ?? ws.cwd}` au `TerminalPane`.
- `src/lib/pty.ts` : `ptyCwd(id): Promise<string | null>`.
- `src/lib/newTab.ts` :
  - `newTabCwd(ws, tabPtys, readCwd)` est une fonction pure, avec un lecteur injecté. Elle renvoie
    le dossier choisi, ou `undefined` s'il est égal au dossier du workspace.
  - `openTab(wsId)` attend ce dossier, vérifie que le workspace existe encore, puis appelle
    `addTab` et `focusTab`.
- Appelants : le `+` de `TabbedTerminals` et l'action `new-tab` de `shortcutDispatch`.
- Keep-alive : `tab.cwd` est fixé à la création et ne change qu'avec `setCwd`, qui relance déjà
  les terminaux par design. Aucun démontage imprévu.

## 4. Tests

### vitest (environnement node)

- **palette** :
  - 16 couleurs aux noms uniques, au format `#RRGGBB`, avec les valeurs de cmux ;
  - `defaultGroupColor` donne les 16 couleurs en 16 appels ;
  - `identityColor` fait passer le workspace avant le groupe, puis `undefined`.
- **store, couleur** :
  - `setWorkspaceColor` pose et retire la couleur ;
  - `duplicateWorkspace` la copie ;
  - `addGroup` prend `defaultGroupColor(0)` par défaut.
- **store, onglets** :
  - `addTab(id, cwd)` garde le dossier ;
  - `addTab(id)` n'ajoute pas de clé `cwd` ;
  - `setCwd` efface les `cwd` des onglets.
- **persistance** :
  - v5 écrit `color`, et l'omet quand il n'y en a pas ;
  - v4 est relue quand v5 est absente, sans couleur ;
  - la couleur v3 reste ignorée ;
  - une v5 présente, même vide, prime ;
  - `restoreState` reprend la couleur ;
  - une couleur qui n'est pas une chaîne est ignorée.
- **ContextMenu** : pastilles rendues avec leur nom en `title`, couleur courante entourée, hauteur
  estimée comptant la grille.
- **newTab** :
  - `newTabCwd` renvoie le dossier lu ;
  - il se replie sur `tab.cwd` puis sur `undefined` quand il n'y a pas d'onglet actif, pas de PTY,
    une lecture `null` ou une lecture rejetée ;
  - un dossier égal à celui du workspace donne `undefined`.
- **shortcutDispatch** : `new-tab` ouvre l'onglet dans le dossier lu (mock de `ptyCwd`). Les tests
  existants de `new-tab` attendent la promesse.

Les composants branchés sur le store ne se testent pas par `renderToStaticMarkup` : en rendu
serveur, zustand sert l'état initial. La Sidebar et la barre d'onglets se vérifient donc à la main
(§6).

### cargo test (`crates/core/src/cwd.rs`, Linux seulement)

- process courant = `std::env::current_dir()` ;
- enfant lancé dans un dossier temporaire → ce dossier ;
- dossier supprimé → `None` ;
- PID inexistant → `None`.

### Tests existants modifiés

- « un workspace ne porte plus de couleur d'identité » est remplacé par « un workspace naît sans
  couleur propre ».
- Le bloc « persistance v4 » passe en « persistance v5 » : la clé lue par `saved()`, et les tests
  « une fois v4 écrite… » et « un v4 présent prime… » adaptés à v5. On y ajoute un test de
  migration v4 → v5.
- `addGroup` par défaut attend `defaultGroupColor(0)` au lieu de `PALETTE[0]`.
- `shortcutDispatch.test.ts` : le mock de `./pty` gagne `ptyCwd`, et `new-tab` devient asynchrone.

## 5. Commentaires et documentation devenus faux

- **Commentaires** : `SavedWorkspace` (« Seul le groupe porte une couleur »), `NO_GROUP_DOT` et la
  pastille dans `Sidebar.tsx`, l'accent de l'onglet dans `TabbedTerminals.tsx`, et « celle des
  groupes de la sidebar » dans `workspacePalette.ts`.
- **README** :
  - Workspaces : couleur propre facultative, clic droit ;
  - Onglets : dossier du terminal actif ;
  - Groupes : 16 couleurs, clic droit dans la zone vide ;
  - Sidebar riche : liste des actions du clic droit.

## 6. Vérifications manuelles (Linux ou WSLg)

1. **Couleur d'un workspace dans un groupe** : pastille à la couleur du workspace, filet à celle du
   groupe, bordure de l'onglet actif à celle du workspace. *Retirer la couleur* rend la couleur du
   groupe.
2. **Workspace coloré hors groupe** : pastille colorée, pas de filet.
3. **Groupe recoloré par le menu** : l'en-tête et les pastilles de ses workspaces sans couleur
   propre changent ensemble.
4. **Redémarrage** : les couleurs des workspaces et des groupes sont conservées. Premier lancement
   sur une sauvegarde v4 existante : la liste est restaurée, sans couleur de workspace.
5. **Clic droit dans la zone vide** → Nouveau workspace : il naît hors groupe même si l'actif est
   groupé. Nouveau groupe : le formulaire s'ouvre. Dans le champ d'un formulaire, le clic droit ne
   l'ouvre pas.
6. **Nouvel onglet après un `cd sous-dossier`** : `Ctrl+Shift+T`, puis `pwd` affiche le
   sous-dossier. Pareil avec le `+`.
7. **Après `exit` du shell de l'onglet actif**, un nouvel onglet démarre dans le dossier du
   workspace. Pareil quand le dossier courant vient d'être supprimé.
8. **Changer le dossier du workspace** : tous les onglets repartent dans le nouveau dossier.
9. **Keep-alive** : un `sleep 999` lancé dans un onglet survit à l'ouverture d'autres onglets et au
   changement de workspace.

## Mise en œuvre

Trois lots. Chacun se termine par la mise à jour du README, un récapitulatif et une proposition de
commit.

- **Lot 1, couleurs** (§1).
- **Lot 2, clic droit dans la zone vide** (§2).
- **Lot 3, onglet dans le dossier courant** (§3). La partie Rust est vérifiée sous Linux (§6, 6 à
  8) si `cargo` n'est pas disponible sur le poste de développement.
