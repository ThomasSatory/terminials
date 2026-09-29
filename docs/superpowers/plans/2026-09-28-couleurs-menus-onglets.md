# Couleur par workspace, clic droit dans la sidebar, onglet dans le dossier courant — plan d'implémentation

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Trois évolutions :
- une couleur propre facultative par workspace, avec les 16 couleurs nommées de cmux pour les
  workspaces et les groupes ;
- un menu du clic droit dans la zone vide de la sidebar, pour créer un workspace ou un groupe ;
- un nouvel onglet qui démarre dans le dossier courant du shell de l'onglet actif.

**Architecture:**
- Front seul pour les couleurs et le menu : store zustand, persistance v5, nouvelle entrée
  « grille de couleurs » dans `ContextMenu`.
- Le dossier courant se lit dans `/proc/<pid>/cwd`. La fonction pure vit dans `crates/core`, une
  commande Tauri `pty_cwd` la câble, et le front la consomme dans `src/lib/newTab.ts`.

**Tech Stack:** React 19, zustand 5, vitest 4 (environnement node), Rust 2021, Tauri v2.

**Spec:** `docs/superpowers/specs/2026-09-28-couleurs-menus-onglets-design.md`

## Global Constraints

- Branche `feat/parite-cmux` uniquement. Jamais de push, rien sur master. Un commit par lot, et
  seulement après accord.
- Le dépôt est public : aucun nom interne (entreprise, produit, ticket, hôte, chemin de poste) dans
  le code, les tests, les commits.
- Invariants à garder :
  - keep-alive : jamais de démontage d'un `TerminalPane` tant que son onglet existe, jamais de
    `display:none` ;
  - raccourcis matchés sur `e.code` ;
  - notifications routées par `tabIdForPty` ;
  - `TERMINIALS_WORKSPACE_ID` et `TERMINIALS_PTY_ID` ;
  - un seul protocole, en JSON par ligne, que ce chantier ne touche pas.
- Tests d'abord : on écrit le test, on le voit échouer, puis on code. Noms de tests en français.
- Commandes :
  - front : `npx vitest run` et `npx tsc --noEmit` ;
  - Rust, sous Linux : `cargo test -p terminials-core cwd` et `cargo check -p terminials`.
- Base de départ : `npx vitest run`, 32 fichiers et 408 tests verts.
- Commentaires : peu, seulement le pourquoi. Ceux de l'auteur d'origine restent intacts, sauf ceux
  que ce chantier rend faux (spec §5).
- Libellés : « Ctrl+Maj+… » dans les menus, « Ctrl+Shift+… » dans le README et les `title=`.
- Couleurs de la sidebar : hex en majuscules, comme dans cmux. Comparaisons insensibles à la casse.

## Structure des fichiers

| Fichier | Rôle dans ce chantier |
|---|---|
| `src/lib/palette.ts` (modif) | `NamedColor`, `SIDEBAR_COLORS`, `defaultGroupColor`, `identityColor` |
| `src/store/workspace.ts` (modif) | `Workspace.color`, `setWorkspaceColor`, persistance v5, `Tab.cwd`, `addTab(wsId, cwd?)`, `setCwd` |
| `src/components/ContextMenu.tsx` (modif) | entrée `swatches`, `menuHeight` exporté |
| `src/components/Sidebar.tsx` (modif) | pastille, menus, clic droit dans la zone vide, mode de création |
| `src/components/GroupForm.tsx` (modif) | 16 couleurs |
| `src/components/TabbedTerminals.tsx` (modif) | accent de l'onglet, `cwd` par onglet, `+` → `openTab` |
| `src/lib/workspacePalette.ts` (modif) | un commentaire devenu faux |
| `src/lib/pty.ts` (modif) | `ptyCwd` |
| `src/lib/newTab.ts` (nouveau) | `newTabCwd`, `openTab` |
| `src/lib/shortcutDispatch.ts` (modif) | `new-tab` → `openTab` |
| `crates/core/src/cwd.rs` (nouveau), `crates/core/src/lib.rs` (modif) | `process_cwd` |
| `src-tauri/src/lib.rs` (modif) | commande `pty_cwd` |
| `README.md` (modif) | Workspaces, Onglets, Groupes, Sidebar riche, raccourcis |
| tests voisins | `palette.test.ts`, `workspace.test.ts`, `ContextMenu.test.tsx`, `newTab.test.ts` (nouveau), `shortcutDispatch.test.ts` |

Ordre : lot 1 (tâches 1 à 6), lot 2 (tâches 7 et 8), lot 3 (tâches 9 à 14). Chaque lot laisse
`npx vitest run` et `npx tsc --noEmit` verts.

---

## Lot 1 — Couleurs

### Task 1 : Palette de la sidebar

**Files:**
- Modify: `src/lib/palette.ts`, `src/lib/palette.test.ts`

**Interfaces:**
- Produces:
  - `type NamedColor = { name: string; hex: string }` ;
  - `SIDEBAR_COLORS: readonly NamedColor[]` ;
  - `defaultGroupColor(n: number): string` ;
  - `identityColor(w: { color?: string }, group?: { color: string }): string | undefined`.

- [ ] **Step 1 : Écrire les tests** (à la fin de `palette.test.ts`, imports complétés)

```ts
describe("couleurs de la sidebar", () => {
  it("reprend les 16 couleurs nommées de cmux, dans son ordre", () => {
    expect(SIDEBAR_COLORS.map((c) => c.name)).toEqual([
      "Red", "Crimson", "Orange", "Amber", "Olive", "Green", "Teal", "Aqua",
      "Blue", "Navy", "Indigo", "Purple", "Magenta", "Rose", "Brown", "Charcoal",
    ]);
    for (const c of SIDEBAR_COLORS) expect(c.hex).toMatch(/^#[0-9A-F]{6}$/);
    expect(SIDEBAR_COLORS.find((c) => c.name === "Amber")?.hex).toBe("#7D6608");
    expect(SIDEBAR_COLORS.find((c) => c.name === "Charcoal")?.hex).toBe("#3E4B5E");
  });

  it("aucune ne se confond avec le bleu d'attention", () => {
    expect(SIDEBAR_COLORS.map((c) => c.hex.toLowerCase())).not.toContain(ATTENTION_COLOR);
  });

  it("defaultGroupColor parcourt les 16 couleurs sans donner deux voisines à la suite", () => {
    const seq = Array.from({ length: 16 }, (_, i) => defaultGroupColor(i));
    expect(new Set(seq).size).toBe(16);
    expect(seq.slice(0, 3)).toEqual(["#C0392B", "#196F3D", "#283593"]); // Red, Green, Indigo
    expect(defaultGroupColor(16)).toBe(seq[0]);
  });

  it("identityColor : la couleur du workspace d'abord, puis celle du groupe", () => {
    expect(identityColor({ color: "#111111" }, { color: "#222222" })).toBe("#111111");
    expect(identityColor({}, { color: "#222222" })).toBe("#222222");
    expect(identityColor({}, undefined)).toBeUndefined();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** : `npx vitest run src/lib/palette.test.ts`. Attendu : échec à
  l'import (`SIDEBAR_COLORS` n'existe pas).

- [ ] **Step 3 : Implémenter** dans `palette.ts`, sous `PALETTE`, sans toucher à `PALETTE` ni à son
  commentaire :

```ts
export type NamedColor = { name: string; hex: string };

/** Couleurs des workspaces et des groupes : les 16 couleurs nommées de cmux. */
export const SIDEBAR_COLORS: readonly NamedColor[] = [
  { name: "Red", hex: "#C0392B" },
  { name: "Crimson", hex: "#922B21" },
  { name: "Orange", hex: "#A04000" },
  { name: "Amber", hex: "#7D6608" },
  { name: "Olive", hex: "#4A5C18" },
  { name: "Green", hex: "#196F3D" },
  { name: "Teal", hex: "#006B6B" },
  { name: "Aqua", hex: "#0E6B8C" },
  { name: "Blue", hex: "#1565C0" },
  { name: "Navy", hex: "#1A5276" },
  { name: "Indigo", hex: "#283593" },
  { name: "Purple", hex: "#6A1B9A" },
  { name: "Magenta", hex: "#AD1457" },
  { name: "Rose", hex: "#880E4F" },
  { name: "Brown", hex: "#7B3F00" },
  { name: "Charcoal", hex: "#3E4B5E" },
];

/** Pas de 5, premier avec 16 : deux groupes créés à la suite ne reçoivent pas deux teintes voisines. */
export function defaultGroupColor(n: number): string {
  return SIDEBAR_COLORS[(n * 5) % SIDEBAR_COLORS.length].hex;
}

export function identityColor(w: { color?: string }, group?: { color: string }): string | undefined {
  return w.color ?? group?.color;
}
```

- [ ] **Step 4 : Vérifier** : `npx vitest run src/lib/palette.test.ts`, tout est vert.

### Task 2 : Couleur propre dans le store

**Files:**
- Modify: `src/store/workspace.ts`, `src/store/workspace.test.ts`

**Interfaces:**
- Consumes: `defaultGroupColor` (Task 1).
- Produces: `Workspace.color?: string` et `setWorkspaceColor(wsId: string, color: string | null): void`.

- [ ] **Step 1 : Écrire les tests**
  - Remplacer le test « un workspace ne porte plus de couleur d'identité (c'est le groupe qui la
    porte) » par :

```ts
  it("un workspace naît sans couleur propre", () => {
    expect(ws(store().addWorkspace("/a"))).not.toHaveProperty("color");
  });

  it("setWorkspaceColor pose puis retire la couleur propre", () => {
    const id = store().addWorkspace("/a");
    store().setWorkspaceColor(id, "#7D6608");
    expect(ws(id).color).toBe("#7D6608");
    store().setWorkspaceColor(id, null);
    expect(ws(id)).not.toHaveProperty("color");
  });
```

  - Dans « création dans un groupe et duplication », ajouter :

```ts
  it("duplicateWorkspace copie la couleur propre", () => {
    const a = store().addWorkspace("/a");
    store().setWorkspaceColor(a, "#1565C0");
    expect(ws(store().duplicateWorkspace(a)!).color).toBe("#1565C0");
  });
```

  - Dans « groupes », le test qui attend `color: PALETTE[0]` attend désormais
    `color: defaultGroupColor(0)`. Importer `defaultGroupColor` et retirer `PALETTE` de l'import
    s'il n'est plus utilisé.

- [ ] **Step 2 : Vérifier l'échec** : `npx vitest run src/store/workspace.test.ts`. Attendu :
  `setWorkspaceColor is not a function`, et une couleur de groupe différente.

- [ ] **Step 3 : Implémenter**
  - `Workspace` : ajouter `color?: string` avec la doc « Couleur propre ; absente, la ligne prend
    celle du groupe ».
  - `newWorkspace(cwd, name, tabCount, groupId, color?)` : ajoute `...(color ? { color } : {})`.
  - `duplicateWorkspace` : passe `src.color`.
  - Action :

```ts
    setWorkspaceColor: (wsId, color) => {
      updateWs(wsId, (w) => {
        const { color: _old, ...rest } = w;
        return color ? { ...rest, color } : rest;
      });
      persistNow();
    },
```

  - `addGroup` : remplacer `PALETTE[colorIndex % PALETTE.length]` par
    `defaultGroupColor(colorIndex)`. Retirer `PALETTE` de l'import de `palette`.

- [ ] **Step 4 : Vérifier** : `npx vitest run src/store/workspace.test.ts`, tout est vert.

### Task 3 : Persistance v5

**Files:**
- Modify: `src/store/workspace.ts`, `src/store/workspace.test.ts`

**Interfaces:**
- Produces: `SavedWorkspace.color?: string`, la clé `terminials:workspaces:v5` et la cascade de
  lecture v5 → v4 → v3 → v2.

- [ ] **Step 1 : Adapter et compléter les tests** (bloc `describe("persistance v4")`)
  - Renommer le bloc en `persistance v5`. Ajouter `const V5_KEY = "terminials:workspaces:v5";`.
    `saved()` lit `V5_KEY`.
  - « les anciennes clés v1/v2/v3 ne sont plus écrites » devient « … v1 à v4 … », et vérifie aussi
    `localStorage.getItem(V4_KEY)` à `null`.
  - « une fois v4 écrite, un v3 résiduel modifié n'est plus relu » devient « une fois v5 écrite, un
    v4 résiduel n'est plus relu ». Le résidu est écrit sous `V4_KEY`, au format v4 sans `color`.
  - Dans « loadSavedState relit la sauvegarde et filtre le JSON invalide », remplacer les
    `setItem(V4_KEY, …)` par `V5_KEY`.
  - « migration v3 → v4 … » devient « migration v3 → v5 … » et « migration v2 → v4 … » devient
    « migration v2 → v5 … ». Les contenus ne changent pas : la couleur v3 reste ignorée.
  - « un v4 présent (même vide) prime » devient « un v5 présent (même vide) prime sur les clés
    antérieures ». On ajoute un résidu v4 non vide, qui doit être ignoré.
  - Nouveaux tests :

```ts
  it("la couleur propre est écrite en v5, et omise sans couleur", () => {
    const a = store().addWorkspace("/a");
    store().addWorkspace("/b");
    store().setWorkspaceColor(a, "#7D6608");
    const raw = JSON.parse(localStorage.getItem(V5_KEY)!) as SavedState;
    expect(raw.workspaces[0]).toEqual({ cwd: "/a", name: "a", tabCount: 1, groupIndex: null, color: "#7D6608" });
    expect(raw.workspaces[1]).not.toHaveProperty("color");
  });

  it("migration v4 → v5 : v4 relue si v5 absente, sans couleur, clé v4 laissée en place", () => {
    localStorage.setItem(
      V4_KEY,
      JSON.stringify({
        groups: [{ name: "g", color: "#0000ff", collapsed: false }],
        workspaces: [{ cwd: "/a", name: "a", tabCount: 2, groupIndex: 0 }],
      }),
    );
    const state = loadSavedState();
    expect(state.workspaces).toEqual([{ cwd: "/a", name: "a", tabCount: 2, groupIndex: 0 }]);
    expect(state.workspaces[0]).not.toHaveProperty("color");
    store().restoreState(state);
    expect(saved().workspaces).toHaveLength(1);
    expect(localStorage.getItem(V4_KEY)).not.toBeNull();
  });

  it("une couleur v5 qui n'est pas une chaîne est ignorée", () => {
    localStorage.setItem(
      V5_KEY,
      JSON.stringify({ groups: [], workspaces: [{ cwd: "/a", name: "a", tabCount: 1, groupIndex: null, color: 42 }] }),
    );
    expect(loadSavedState().workspaces[0]).not.toHaveProperty("color");
  });

  it("restoreState reprend la couleur propre", () => {
    store().restoreState({
      groups: [],
      workspaces: [{ cwd: "/a", name: "a", tabCount: 1, groupIndex: null, color: "#1565C0" }],
    });
    expect(store().workspaces[0].color).toBe("#1565C0");
  });
```

- [ ] **Step 2 : Vérifier l'échec** : `npx vitest run src/store/workspace.test.ts`. Attendu :
  `saved()` est vide, puisque la clé v5 n'est jamais écrite.

- [ ] **Step 3 : Implémenter**
  - `SavedWorkspace` : `color?: string`. Le commentaire du bloc devient « Entrées de persistance
    v5 » ; la phrase « Seul le groupe porte une couleur » est remplacée par « `color` est omis
    quand le workspace n'a pas de couleur propre ».
  - `STORAGE_KEY = "terminials:workspaces:v5"` et `V4_KEY = "terminials:workspaces:v4"`. Le
    commentaire d'en-tête « Persistance localStorage v4… v3 puis v2… » passe à v5 et à la cascade
    v4, v3, v2.
  - `parseSavedWorkspace(e, groupCount, withColor = false)` ajoute
    `...(withColor && typeof e.color === "string" ? { color: e.color } : {})`.
  - `parseSavedState(raw, withColor = false)` transmet le drapeau. Sa doc indique que seule la v5
    fournit la couleur des workspaces.
  - `loadSavedState` lit v5 avec `withColor = true`, sinon v4, v3 puis v2, sans couleur.
  - `persist` ajoute `...(w.color ? { color: w.color } : {})`.
  - `restoreState` passe `e.color` à `newWorkspace`.

- [ ] **Step 4 : Vérifier** : `npx vitest run src/store/workspace.test.ts` et `npx tsc --noEmit`.

### Task 4 : Grille de couleurs dans le menu contextuel

**Files:**
- Modify: `src/components/ContextMenu.tsx`, `src/components/ContextMenu.test.tsx`

**Interfaces:**
- Consumes: `NamedColor`, `SIDEBAR_COLORS` (Task 1).
- Produces:
  - `MenuItem` gagne
    `{ swatches: readonly NamedColor[]; current?: string; pick: (hex: string) => void }` ;
  - `menuHeight(items)` exporté (l'ancienne fonction `height`, renommée).

- [ ] **Step 1 : Écrire les tests**

```tsx
describe("ContextMenu, grille de couleurs", () => {
  const html = renderToStaticMarkup(
    <ContextMenu
      x={10}
      y={10}
      items={[
        { label: "Dupliquer", run: noop },
        { swatches: SIDEBAR_COLORS, current: "#7d6608", pick: noop },
      ]}
      onClose={noop}
    />,
  );

  it("rend une pastille par couleur, nommée au survol", () => {
    expect(html.match(/data-swatch=/g)).toHaveLength(16);
    expect(html).toContain('title="Amber"');
    expect(html).toContain('title="Charcoal"');
  });

  it("entoure la seule couleur courante, sans tenir compte de la casse", () => {
    expect(html.match(/data-current=/g)).toHaveLength(1);
    expect(html).toMatch(/data-swatch="#7D6608"[^>]*data-current="true"/);
  });

  it("la hauteur estimée compte les deux rangées de pastilles", () => {
    // 8 (marges du menu) + 4 + 16 + 6 + 16 + 4
    expect(menuHeight([{ swatches: SIDEBAR_COLORS, pick: noop }])).toBe(54);
  });
});
```

  L'ordre des attributs dans le rendu React suit celui du JSX : `data-swatch` d'abord, puis
  `data-current`.

- [ ] **Step 2 : Vérifier l'échec** : `npx vitest run src/components/ContextMenu.test.tsx`.

- [ ] **Step 3 : Implémenter**
  - Constantes `SWATCH = 16`, `SWATCH_GAP = 6`, `SWATCH_COLS = 8`, `SWATCH_PAD = 4`. Hauteur d'une
    grille : `2 * SWATCH_PAD + rows * SWATCH + (rows - 1) * SWATCH_GAP`, avec
    `rows = Math.ceil(n / SWATCH_COLS)`.
  - `menuHeight` : `"separator" in i ? SEP_H : "swatches" in i ? swatchesHeight(i.swatches.length) : ITEM_H`.
  - Rendu d'une entrée `swatches` : une `div` avec la clé `swatches:${i}`, en
    `display: grid`, `gridTemplateColumns: repeat(8, 16px)`, `gap: 6`, `padding: "4px 10px"`.
    Chaque couleur est un `<button>` avec `data-swatch={c.hex}`, `title={c.name}`,
    `aria-label={c.name}`, `data-current={isCurrent || undefined}`, un fond `c.hex`, un
    `borderRadius: 3` et, pour la courante, un `outline: "2px solid #fff"`. Au `onClick` :
    `item.pick(c.hex); onClose();`.
  - Le commentaire de l'en-tête parle toujours du « clic droit sur un workspace ou un en-tête de
    groupe » : il sera complété à la Task 7.

- [ ] **Step 4 : Vérifier** : `npx vitest run src/components/ContextMenu.test.tsx`, puis
  `npx tsc --noEmit`. `Sidebar.tsx` compile encore, puisque les entrées existantes n'ont pas
  changé.

### Task 5 : Câblage de l'interface

**Files:**
- Modify: `src/components/Sidebar.tsx`, `src/components/TabbedTerminals.tsx`,
  `src/components/GroupForm.tsx`, `src/lib/workspacePalette.ts`

Pas de test unitaire : zustand sert l'état initial au rendu serveur, donc `renderToStaticMarkup`
ne voit pas le store peuplé. Vérification manuelle au §6 du spec, points 1 à 4.

- [ ] **Step 1 : Sidebar**
  - Imports : `SIDEBAR_COLORS`, `defaultGroupColor` et `identityColor` au lieu de `PALETTE`.
    Extraire `setWorkspaceColor` du store.
  - Pastille : `background: identityColor(w, group) ?? NO_GROUP_DOT`.
  - Commentaire de `NO_GROUP_DOT` : « Pastille d'identité d'un workspace sans couleur propre ni
    groupe. » Commentaire de la pastille : « couleur propre du workspace, sinon celle du groupe,
    grise hors groupe ».
  - `workspaceMenu(w)` :

```ts
    { separator: true },
    { swatches: SIDEBAR_COLORS, current: w.color, pick: (hex) => setWorkspaceColor(w.id, hex) },
    ...(w.color ? [{ label: "Retirer la couleur", run: () => setWorkspaceColor(w.id, null) }] : []),
    { separator: true },
    { label: "Fermer", shortcut: "Ctrl+Maj+Q", run: () => closeWs(w) },
```

  - `groupMenu(g)` : insérer
    `{ separator: true }, { swatches: SIDEBAR_COLORS, current: g.color, pick: (hex) => setGroupColor(g.id, hex) }`
    avant le séparateur de *Dissoudre le groupe*.
  - Formulaire de création de groupe : `initialColor={defaultGroupColor(groups.length)}`.
- [ ] **Step 2 : GroupForm** : itérer sur `SIDEBAR_COLORS`, avec `key={hex}` et `title={name}`, la
  sélection comparée en minuscules. Le `flexWrap` existant répartit les pastilles sur deux
  rangées.
- [ ] **Step 3 : TabbedTerminals**
  - Remplacer le sélecteur `accent` par un sélecteur du groupe,
    `const group = useWorkspaceStore((s) => s.groups.find((g) => g.id === ws.groupId));`, puis
    `const accent = identityColor(ws, group) ?? "#5a5a5a";`.
  - Commentaire : « couleur propre du workspace, sinon celle de son groupe, neutre sinon ».
- [ ] **Step 4 : workspacePalette.ts** : « (`PALETTE`, celle des groupes de la sidebar) » devient
  « (`PALETTE`) ». Ce n'est plus la palette des groupes.
- [ ] **Step 5 : Vérifier** : `npx tsc --noEmit` et `npx vitest run`, tout est vert.

### Task 6 : README du lot 1, puis récapitulatif

- [ ] **Step 1 : Mettre à jour `README.md`**
  - **Workspaces** : remplacer « Un workspace n'a **pas de couleur propre** : … grise
    hors-groupe. » par :

    > **Clic droit → une des 16 couleurs** (celles de cmux, nommées au survol) donne au workspace
    > sa **couleur propre**. Elle colore la pastille de sa ligne et le trait de l'onglet actif ;
    > le filet garde la couleur du groupe. *Retirer la couleur* lui rend celle de son groupe (gris
    > hors groupe).

    La liste restaurée devient « (dossier, nom, groupe, couleur, nombre de terminaux) ».
  - **Groupes** : « (nom + couleur parmi les 16 de cmux, … ) ». Le menu de l'en-tête liste la
    grille de couleurs.
  - **Sidebar riche** : « (renommer, dupliquer, colorer, fermer, et côté groupe créer / renommer /
    colorer / dissoudre) ».
- [ ] **Step 2 : Vérifier** : `npx vitest run` (408 tests d'origine, plus ceux du lot, sans
  échec) et `npx tsc --noEmit`.
- [ ] **Step 3 : Récapitulatif et proposition de commit**, sans commiter avant accord :

```
feat(sidebar): couleur propre par workspace, 16 couleurs nommées

- couleur facultative par workspace : pastille et onglet actif, le filet garde celle du groupe
- workspaces et groupes se colorent au clic droit (grille des 16 couleurs de cmux)
- persistance v5 (couleur des workspaces), relit v4, v3 puis v2
```

---

## Lot 2 — Clic droit dans la zone vide

### Task 7 : Menu de la zone vide

**Files:**
- Modify: `src/components/Sidebar.tsx`, `src/components/ContextMenu.tsx` (commentaire d'en-tête),
  `src/store/workspace.test.ts`

**Interfaces:**
- Consumes: `addWorkspace(cwd, name, null)`, qui existe déjà.

- [ ] **Step 1 : Test de garde du contrat utilisé** (dans « création dans un groupe et
  duplication ») :

```ts
  it("groupId null explicite : hors-groupe même si l'actif est groupé", () => {
    const g = store().addGroup("g");
    store().addWorkspace("/a", undefined, g);
    expect(ws(store().addWorkspace("/b", undefined, null)).groupId).toBeNull();
  });
```

  Il passe dès l'écriture : il fige un comportement existant dont le lot dépend.
- [ ] **Step 2 : Sidebar**
  - `const [creating, setCreating] = useState<false | "groupe-actif" | "hors-groupe">(false);`.
  - Les `setCreating(true)` existants (effet `newWorkspaceRequested`, bouton `+`) deviennent
    `setCreating("groupe-actif")`.
  - Validation du formulaire du bas :
    `addWorkspace(r.cwd, r.name, creating === "hors-groupe" ? null : undefined)`.
  - Sur la `div` racine (`ref={listRef}`) :

```tsx
      onContextMenu={(e) => {
        // Dans un champ de formulaire, le menu natif (couper, coller) reste le bon.
        if (e.target instanceof HTMLElement && e.target.closest("input, textarea")) return;
        openMenu(e, [
          { label: "Nouveau workspace", run: () => setCreating("hors-groupe") },
          { label: "Nouveau groupe", shortcut: "Ctrl+Maj+G", run: () => setCreatingGroup(true) },
        ]);
      }}
```

- [ ] **Step 3 : ContextMenu** : l'en-tête « (clic droit sur un workspace ou un en-tête de
  groupe) » devient « (clic droit sur un workspace, un en-tête de groupe ou la zone vide) ».
- [ ] **Step 4 : Vérifier** : `npx tsc --noEmit` et `npx vitest run`. Vérification manuelle au §6
  du spec, point 5.

### Task 8 : README du lot 2, puis récapitulatif

- [ ] **Step 1 : README, Groupes** : ajouter « Le **clic droit dans la zone vide** de la sidebar
  propose *Nouveau workspace* (il naît hors groupe) et *Nouveau groupe*. » La phrase « Ailleurs, un
  nouveau workspace naît dans le groupe du workspace actif » devient « Avec `+`, `Ctrl+Shift+N`,
  📂 ou ~, un nouveau workspace naît dans le groupe du workspace actif ».
- [ ] **Step 2 : Récapitulatif et proposition de commit** :

```
feat(sidebar): clic droit dans la zone vide pour créer un workspace ou un groupe

- le workspace créé ainsi naît hors groupe ; +, Ctrl+Shift+N, 📂 et ~ gardent le groupe actif
- dans un champ de formulaire, le menu natif reste disponible
```

---

## Lot 3 — Onglet dans le dossier courant

### Task 9 : `process_cwd` dans `crates/core`

**Files:**
- Create: `crates/core/src/cwd.rs`
- Modify: `crates/core/src/lib.rs` (ajouter `pub mod cwd;`)

**Interfaces:**
- Produces: `terminials_core::cwd::process_cwd(pid: u32) -> Option<std::path::PathBuf>`.

- [ ] **Step 1 : Écrire les tests** (`cwd.rs`, bloc `#[cfg(all(test, target_os = "linux"))]`) :

```rust
#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn process_courant() {
        assert_eq!(process_cwd(std::process::id()), std::env::current_dir().ok());
    }

    #[test]
    fn enfant_lance_dans_un_dossier() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("sleep").arg("5").current_dir(dir.path()).spawn().unwrap();
        let got = process_cwd(child.id());
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(got, Some(dir.path().canonicalize().unwrap()));
    }

    #[test]
    fn dossier_supprime() {
        let dir = tempfile::tempdir().unwrap();
        let mut child = Command::new("sleep").arg("5").current_dir(dir.path()).spawn().unwrap();
        std::fs::remove_dir(dir.path()).unwrap();
        let got = process_cwd(child.id());
        let _ = child.kill();
        let _ = child.wait();
        assert_eq!(got, None);
    }

    #[test]
    fn pid_inexistant() {
        assert_eq!(process_cwd(u32::MAX), None);
    }
}
```

  Aucun test du crate ne change le dossier courant du process (`set_current_dir` absent) :
  `process_courant` ne dépend donc pas de l'ordre des tests.
- [ ] **Step 2 : Vérifier l'échec** (Linux) : `cargo test -p terminials-core cwd` ne compile pas,
  puisque `process_cwd` n'existe pas.
- [ ] **Step 3 : Implémenter**

```rust
//! Dossier courant d'un process, lu dans /proc (Linux, WSL).

use std::path::PathBuf;

/// `None` si le lien est illisible (process terminé, pas de /proc) ou si sa cible n'est plus un
/// dossier : le noyau suffixe « (deleted) » au chemin d'un dossier supprimé.
pub fn process_cwd(pid: u32) -> Option<PathBuf> {
    let path = std::fs::read_link(format!("/proc/{pid}/cwd")).ok()?;
    path.is_dir().then_some(path)
}
```

- [ ] **Step 4 : Vérifier** (Linux) : `cargo test -p terminials-core cwd`, 4 tests verts.

### Task 10 : Commande Tauri `pty_cwd`

**Files:**
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes: `process_cwd` (Task 9).
- Produces: `invoke<string | null>("pty_cwd", { ptyId })`.

- [ ] **Step 1 : Implémenter**, sous `workspace_ports` :

```rust
/// Dossier courant du shell d'un PTY : un nouvel onglet démarre là.
#[tauri::command]
fn pty_cwd(reg: State<'_, Arc<PtyRegistry>>, pty_id: PtyId) -> Option<String> {
    let pid = reg.handles.lock().unwrap().get(&pty_id)?.pid?;
    terminials_core::cwd::process_cwd(pid)?.into_os_string().into_string().ok()
}
```

  Ajouter `pty_cwd` à `generate_handler!`, après `workspace_ports`. Le verrou du registre tombe à
  la fin de la première instruction, avant la lecture de `/proc`.
- [ ] **Step 2 : Vérifier** (Linux) : `cargo check -p terminials`, sans avertissement nouveau.

### Task 11 : Dossier de départ par onglet dans le store

**Files:**
- Modify: `src/store/workspace.ts`, `src/store/workspace.test.ts`

**Interfaces:**
- Produces:
  - `Tab.cwd?: string` ;
  - `addTab(wsId: string, cwd?: string): string` ;
  - `setCwd`, qui efface le `cwd` des onglets.

- [ ] **Step 1 : Écrire les tests**

```ts
  it("addTab garde le dossier de départ demandé, et n'en pose pas sinon", () => {
    const id = store().addWorkspace("/a");
    const t1 = store().addTab(id, "/a/front");
    const t2 = store().addTab(id);
    expect(ws(id).tabs.find((t) => t.id === t1)?.cwd).toBe("/a/front");
    expect(ws(id).tabs.find((t) => t.id === t2)).not.toHaveProperty("cwd");
  });

  it("setCwd renvoie tous les onglets au nouveau dossier du workspace", () => {
    const id = store().addWorkspace("/a");
    store().addTab(id, "/a/front");
    store().setCwd(id, "/b");
    expect(ws(id).cwd).toBe("/b");
    for (const t of ws(id).tabs) expect(t).not.toHaveProperty("cwd");
  });
```

  Et dans le bloc « persistance v5 » :

```ts
  it("le dossier de départ d'un onglet n'est pas persisté", () => {
    const id = store().addWorkspace("/a");
    store().addTab(id, "/a/front");
    expect(JSON.parse(localStorage.getItem(V5_KEY)!).workspaces[0]).toEqual({
      cwd: "/a", name: "a", tabCount: 2, groupIndex: null,
    });
  });
```

- [ ] **Step 2 : Vérifier l'échec** : `npx vitest run src/store/workspace.test.ts`.
- [ ] **Step 3 : Implémenter**
  - `Tab` : `cwd?: string`, avec la doc « Dossier de départ, jamais persisté ; absent, celui du
    workspace ».
  - `addTab: (wsId, cwd) => { const tab: Tab = cwd ? { id: uid("tab"), cwd } : { id: uid("tab") }; … }`.
    Signature dans `WorkspaceState` : `addTab: (wsId: string, cwd?: string) => string;`.
  - `setCwd` :
    `updateWs(wsId, (w) => ({ ...w, cwd: next, tabs: w.tabs.map(({ cwd: _start, ...t }) => t) }))`.
- [ ] **Step 4 : Vérifier** : `npx vitest run src/store/workspace.test.ts`.

### Task 12 : `ptyCwd` et `newTab.ts`

**Files:**
- Modify: `src/lib/pty.ts`
- Create: `src/lib/newTab.ts`, `src/lib/newTab.test.ts`

**Interfaces:**
- Consumes: `pty_cwd` (Task 10), `addTab(wsId, cwd?)` (Task 11), `focusTab`.
- Produces:
  - `ptyCwd(id: number): Promise<string | null>` ;
  - `newTabCwd(ws: Workspace, tabPtys: Record<string, number>, readCwd: (ptyId: number) => Promise<string | null>): Promise<string | undefined>` ;
  - `openTab(wsId: string): Promise<void>`.

- [ ] **Step 1 : Écrire les tests** (`newTab.test.ts`)

```ts
import { describe, it, expect, vi } from "vitest";

vi.mock("./pty", () => ({ ptyCwd: vi.fn(), closePty: vi.fn() }));

import { newTabCwd } from "./newTab";
import type { Workspace } from "../store/workspace";

const ws = (over: Partial<Workspace> = {}): Workspace => ({
  id: "ws:0",
  cwd: "/repo",
  name: "repo",
  tabs: [{ id: "tab:0" }],
  activeTabId: "tab:0",
  groupId: null,
  ports: [],
  unread: false,
  unreadTabs: [],
  diffOpen: false,
  ...over,
});

describe("newTabCwd", () => {
  it("prend le dossier courant du shell de l'onglet actif", async () => {
    const read = vi.fn(async () => "/repo/front");
    expect(await newTabCwd(ws(), { "tab:0": 7 }, read)).toBe("/repo/front");
    expect(read).toHaveBeenCalledWith(7);
  });

  it("sans PTY pour l'onglet actif : son dossier de départ, sinon celui du workspace", async () => {
    const read = vi.fn();
    expect(await newTabCwd(ws(), {}, read)).toBeUndefined();
    expect(await newTabCwd(ws({ tabs: [{ id: "tab:0", cwd: "/repo/api" }] }), {}, read)).toBe("/repo/api");
    expect(read).not.toHaveBeenCalled();
  });

  it("lecture vide ou rejetée : même repli", async () => {
    expect(await newTabCwd(ws(), { "tab:0": 7 }, async () => null)).toBeUndefined();
    expect(await newTabCwd(ws(), { "tab:0": 7 }, () => Promise.reject(new Error("pty introuvable")))).toBeUndefined();
  });

  it("sans onglet actif : dossier du workspace", async () => {
    expect(await newTabCwd(ws({ activeTabId: null }), { "tab:0": 7 }, async () => "/x")).toBeUndefined();
  });

  it("un dossier égal à celui du workspace n'est pas retenu", async () => {
    expect(await newTabCwd(ws(), { "tab:0": 7 }, async () => "/repo")).toBeUndefined();
  });
});
```

- [ ] **Step 2 : Vérifier l'échec** : `npx vitest run src/lib/newTab.test.ts`.
- [ ] **Step 3 : Implémenter**
  - Dans `pty.ts` :

```ts
/** Dossier courant du shell d'un PTY ; null s'il est illisible (shell terminé, pas de /proc). */
export function ptyCwd(id: number): Promise<string | null> {
  return invoke<string | null>("pty_cwd", { ptyId: id });
}
```

  - Créer `newTab.ts` :

```ts
import { ptyCwd } from "./pty";
import { focusTab } from "./tabFocus";
import { useWorkspaceStore, type Workspace } from "../store/workspace";

/** Dossier de départ d'un nouvel onglet ; undefined = celui du workspace. */
export async function newTabCwd(
  ws: Workspace,
  tabPtys: Record<string, number>,
  readCwd: (ptyId: number) => Promise<string | null>,
): Promise<string | undefined> {
  const active = ws.tabs.find((t) => t.id === ws.activeTabId);
  if (!active) return undefined;
  const ptyId = tabPtys[active.id];
  const current = ptyId === undefined ? null : await readCwd(ptyId).catch(() => null);
  const dir = current ?? active.cwd;
  return dir === ws.cwd ? undefined : dir;
}

/** Nouvel onglet dans le dossier du terminal actif du workspace. */
export async function openTab(wsId: string): Promise<void> {
  const s = useWorkspaceStore.getState();
  const ws = s.workspaces.find((w) => w.id === wsId);
  if (!ws) return;
  const cwd = await newTabCwd(ws, s.tabPtys, ptyCwd);
  // Le workspace a pu être fermé pendant la lecture du dossier.
  const st = useWorkspaceStore.getState();
  if (!st.workspaces.some((w) => w.id === wsId)) return;
  // Le TerminalPane n'existe pas encore : le focus se fera à son montage
  // (TabbedTerminals focus l'onglet actif quand il change).
  focusTab(st.addTab(wsId, cwd));
}
```

  Le dernier commentaire est celui de `shortcutDispatch.ts`, déplacé tel quel avec le code.
- [ ] **Step 4 : Vérifier** : `npx vitest run src/lib/newTab.test.ts`.

### Task 13 : Brancher `openTab` et le `cwd` par onglet

**Files:**
- Modify: `src/lib/shortcutDispatch.ts`, `src/lib/shortcutDispatch.test.ts`,
  `src/components/TabbedTerminals.tsx`

- [ ] **Step 1 : Adapter les tests de `shortcutDispatch.test.ts`**
  - Mock :
    `vi.mock("./pty", () => ({ closePty: vi.fn(), ptyCwd: vi.fn(() => Promise.resolve(null)) }));`,
    et importer `ptyCwd`.
  - « new-tab ajoute un onglet actif au workspace actif, sans limite » devient `async`. Après les
    5 dispatchs : `await vi.waitFor(() => expect(ws(id).tabs).toHaveLength(6));`, puis les mêmes
    attentes.
  - Nouveau test :

```ts
  it("new-tab ouvre l'onglet dans le dossier courant du shell de l'onglet actif", async () => {
    const id = store().addWorkspace("/a");
    store().setTabPty(tabIds(id)[0], 3);
    vi.mocked(ptyCwd).mockResolvedValueOnce("/a/sous-dossier");
    dispatchShortcut({ type: "new-tab" });
    await vi.waitFor(() => expect(ws(id).tabs).toHaveLength(2));
    expect(ws(id).tabs[1].cwd).toBe("/a/sous-dossier");
    expect(ptyCwd).toHaveBeenCalledWith(3);
  });
```

- [ ] **Step 2 : Vérifier l'échec** : `npx vitest run src/lib/shortcutDispatch.test.ts`. Le
  nouveau test échoue, parce que `new-tab` n'appelle pas encore `ptyCwd`.
- [ ] **Step 3 : Implémenter**
  - `shortcutDispatch.ts` : le cas `new-tab` devient
    `if (active) void openTab(active.id); return;`. Importer `openTab`. Retirer l'import de
    `focusTab` s'il ne sert plus.
  - `TabbedTerminals.tsx` : le bouton `+` fait `onClick={() => void openTab(ws.id)}`, le
    `TerminalPane` reçoit `cwd={tab.cwd ?? ws.cwd}`, et le sélecteur `addTab` devenu inutile est
    retiré.
- [ ] **Step 4 : Vérifier** : `npx vitest run` et `npx tsc --noEmit`, tout est vert.

### Task 14 : README du lot 3, vérifications Linux, récapitulatif

- [ ] **Step 1 : README**
  - **Onglets** : « `Ctrl+Shift+T` (ou le `+` de la barre) ouvre un onglet **dans le dossier
    courant du terminal actif**. Après un `cd`, le nouvel onglet démarre au même endroit. Si le
    shell est terminé ou le dossier supprimé, il démarre dans le dossier du workspace (lecture de
    `/proc`, Linux et WSL). Au redémarrage, les onglets repartent du dossier du workspace. »
  - Table des raccourcis : `Ctrl+Shift+T` devient « Nouvel onglet terminal, dans le dossier du
    terminal actif ».
- [ ] **Step 2 : Vérifications sous Linux** (spec §6, points 6 à 9) :

```bash
cargo test -p terminials-core cwd      # 4 tests verts
cargo check -p terminials              # pty_cwd compile, pas d'avertissement nouveau
npm run tauri dev
# dans un onglet : cd src && Ctrl+Shift+T → pwd affiche …/src ; idem avec le +
# exit dans l'onglet actif, puis Ctrl+Shift+T → dossier du workspace
# mkdir /tmp/x && cd /tmp/x && rmdir /tmp/x, puis Ctrl+Shift+T → dossier du workspace
# clic droit → Renommer… → changer le dossier → tous les onglets repartent dans le nouveau dossier
# sleep 999 dans un onglet, ouvrir deux onglets, changer de workspace, revenir : sleep tourne encore
```

- [ ] **Step 3 : Récapitulatif et proposition de commit** :

```
feat(front): nouvel onglet dans le dossier courant du terminal actif

- le dossier du shell se lit dans /proc/<pid>/cwd (core::cwd, commande pty_cwd)
- repli sur le dossier de départ de l'onglet, puis sur celui du workspace
- changer le dossier du workspace relance tous les onglets dans le nouveau dossier
```
