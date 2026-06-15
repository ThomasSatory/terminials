# terminials — Workspaces nommés/colorés + grille de terminaux — Design

> Évolution v1 : donner une **identité** (nom + couleur) à chaque workspace, et passer du
> modèle de splits libres à une **grille auto-arrangée par nombre de terminaux** (1→4).

**Date** : 2026-06-15
**Statut** : design validé, prêt pour le plan d'implémentation
**Auteur** : ThomasSatory
**Spec parente** : [2026-06-15-terminials-design.md](./2026-06-15-terminials-design.md)

---

## 1. Objectif & cadrage

Trois besoins, formulés par l'utilisateur :

1. **Nommer** un workspace (« environnement »).
2. Lui donner une **couleur** d'identité.
3. Ouvrir **plusieurs terminaux par workspace**, auto-arrangés selon leur nombre :
   - **1** → plein écran
   - **2** → split vertical (gauche | droite)
   - **3** → 2 en haut (gauche, droite) + 1 en bas pleine largeur
   - **4** → un dans chaque coin (grille 2×2)

```
   1 terminal        2 terminals        3 terminals        4 terminals
┌───────────────┐ ┌───────┬───────┐ ┌───────┬───────┐ ┌───────┬───────┐
│               │ │       │       │ │   1   │   2   │ │   1   │   2   │
│       1       │ │   1   │   2   │ ├───────┴───────┤ ├───────┼───────┤
│               │ │       │       │ │       3       │ │   3   │   4   │
└───────────────┘ └───────┴───────┘ └───────────────┘ └───────┴───────┘
```

### Décisions de cadrage
- **Maximum 4 terminaux** par workspace. Ajouter un 5e est **bloqué** (toast « max 4 terminaux »).
- On **remplace** les splits libres directionnels (Ctrl+D / Ctrl+Shift+D) par cette grille fixe.
  Les arrangements arbitraires ne sont plus possibles (YAGNI : pas demandés).
- Les séparateurs restent **redimensionnables à la souris** (défaut Allotment, comme cmux).
- **Persistance** nom + couleur via **localStorage** (les terminaux eux-mêmes ne sont pas restaurés —
  cohérent avec « pas de session restore » de la spec parente).

### Hors périmètre
- ❌ Drag-and-drop pour réordonner les panes.
- ❌ Layouts personnalisés au-delà des 4 arrangements fixes.
- ❌ Restauration des terminaux/processus au redémarrage.

---

## 2. Modèle de données (store Zustand)

Changement central : la liste **plate ordonnée** de panes remplace l'arbre binaire `PaneNode`.

```ts
interface Workspace {
  id: string;
  cwd: string;
  name: string;                 // NEW — défaut = basename(cwd)
  color: string;                // NEW — hex de la palette, round-robin à la création
  panes: string[];              // NEW — remplace `root: PaneNode`, longueur 1..4
  activePaneId: string | null;  // NEW — pane focus (close + futur auto-dismiss notif)
  // inchangés :
  branch?: string;
  dirty?: boolean;
  ports: number[];
  unread: boolean;
  lastNotification?: Notification;
  status?: { label: string; color?: string };
  progress?: { value: number; label?: string };
}
```

### Types supprimés
`PaneNode`, la fonction `splitNode`, `firstLeafPaneId`, l'action `splitPane`.

### Actions du store
| Action | Comportement |
|---|---|
| `addWorkspace(cwd)` | name = `basename(cwd)` (ou override localStorage), color = override localStorage sinon round-robin palette ; `panes = [unNouveauPaneId]` ; `activePaneId` = ce pane. |
| `addPane(wsId): boolean` | append un paneId si `panes.length < 4` (retourne `true`), sinon no-op (`false` → déclenche un toast côté UI). Le nouveau pane devient actif. |
| `closePane(wsId, paneId)` | retire le pane (re-flow auto via la fonction de layout). **Minimum 1 pane** : fermer le dernier est un no-op. Si le pane actif est fermé, `activePaneId` retombe sur `panes[0]`. |
| `setActivePane(wsId, paneId)` | met à jour `activePaneId`. |
| `renameWorkspace(wsId, name)` | met à jour `name` + écrit dans localStorage (clé = cwd). Un nom vide retombe sur le basename. |
| `setColor(wsId, color)` | met à jour `color` + écrit dans localStorage (clé = cwd). |

Actions inchangées : `setNotification`, `markRead`, `setActive`, `setGit`, `setPorts`,
`setStatus`, `setProgress`, `setPanePty`, `removePanePty`, `reset`.

---

## 3. Layout par nombre — `PaneTree.tsx`

Réécriture autour d'une fonction pure `renderLayout(panes, ws)`. Mapping count → Allotment
(rappel : `<Allotment>` sans `vertical` = colonnes côte à côte ; `<Allotment vertical>` = lignes empilées) :

| N | Structure |
|---|---|
| 1 | `<TerminalPane p0>` plein |
| 2 | `<Allotment>` `[p0, p1]` (2 colonnes) |
| 3 | `<Allotment vertical>` `[ <Allotment>[p0, p1] (ligne haut), p2 (ligne bas) ]` |
| 4 | `<Allotment vertical>` `[ <Allotment>[p0, p1], <Allotment>[p2, p3] ]` |

- Chaque pane est enveloppé d'un conteneur cliquable qui appelle `setActivePane` (focus) et
  affiche un **bouton X au survol** (close).
- Le pane actif reçoit un fin liseré de la **couleur du workspace** (identité). L'anneau
  d'unread/notification utilise la **couleur d'alerte ambre** (voir §5), indépendante.

---

## 4. Sidebar — `Sidebar.tsx`

- Affiche `w.name` (au lieu de `cwd.split("/").pop()`).
- **Pastille** ronde + **accent gauche** (`border-left`) à la couleur `w.color`.
- **Double-clic** sur le nom → `<input>` inline ; **Enter**/blur valide, **Escape** annule.
  Champ pré-rempli avec le nom courant, focus + sélection au montage.
- Clic sur la **pastille** → petit **popover** affichant la palette de 8 couleurs ; clic sur
  une couleur appelle `setColor` et ferme le popover.
- Bouton **+ Workspace** conservé.

---

## 5. Couleurs

### Palette d'identité (8, round-robin à la création)
```
#5b8def  #2ecc71  #1abc9c  #9b59b6  #e91e8c  #e67e22  #f1c40f  #95a5a6
 bleu     vert     teal    violet    rose     orange   jaune    gris
```

### Couleur d'alerte (notification / unread)
**Ambre `#f5a623`**, fixe, distincte de la palette. Remplace le `#4ea1ff` actuel utilisé pour :
- l'accent gauche « unread » de la sidebar,
- le point ● « unread »,
- l'`inset boxShadow` de l'anneau de notification dans `PaneTree`,
- la barre de progression (`progress`).

→ La couleur d'identité (palette) et la couleur d'alerte (ambre) ne se confondent jamais.

---

## 6. Interactions / raccourcis — `useShortcuts.ts`

| Raccourci | Action |
|---|---|
| **Ctrl+N** | nouveau workspace (inchangé) |
| **Ctrl+T** | + terminal dans le workspace actif (bloqué à 4 → toast) |
| **Ctrl+W** | ferme le terminal actif du workspace actif (min 1) |

On **retire** la logique Ctrl+D / Ctrl+Shift+D (splits libres).

**Toast** : petit composant léger (state local dans `App` ou store) affichant un message
transitoire (~2 s) ; utilisé pour « max 4 terminaux ». Pas de lib externe.

---

## 7. Persistance localStorage

- Clé : `terminials:workspaces` → `Record<cwd, { name: string; color: string }>`.
- **Lecture** dans `addWorkspace(cwd)` : si une entrée existe pour ce cwd, on reprend son
  nom/couleur ; sinon défauts (basename + round-robin).
- **Écriture** dans `renameWorkspace` et `setColor`.
- Limite assumée : deux workspaces ouverts sur le **même cwd** partagent l'entrée sauvegardée
  (edge case acceptable en v1).
- Les `panes` / processus ne sont **pas** persistés.

---

## 8. Ajustements induits

- **Poller ports** (`App.tsx`) : aujourd'hui n'interroge que le premier pane via
  `firstLeafPaneId`. Désormais → **itère tous les `ws.panes`**, récupère le `ptyId` de chacun,
  fait l'**union** des ports retournés avant `setPorts`.
- Toute référence à `firstLeafPaneId` / `splitPane` / `PaneNode` est mise à jour ou supprimée
  (`App.tsx`, `useShortcuts.ts`, `PaneTree.tsx`, tests).

---

## 9. Tests

`workspace.test.ts` (Vitest) réécrit pour le nouveau modèle :
- `addWorkspace` : `panes` longueur 1, `name` = basename, `color` ∈ palette.
- `addPane` : ajoute jusqu'à 4 ; le 5e retourne `false` et ne change pas `panes`.
- `closePane` : re-flow, refuse de descendre sous 1 ; recalcule `activePaneId` si le pane actif est fermé.
- `renameWorkspace` / `setColor` : mettent à jour le workspace (mock de localStorage).
- Round-robin couleur sur plusieurs `addWorkspace`.
- (Optionnel) fonction de layout testée comme fonction pure : `paneCount → forme` attendue.

**Smoke manuel** : créer un workspace, le renommer (double-clic), changer sa couleur,
ouvrir 2/3/4 terminaux (vérifier les arrangements), fermer un pane (re-flow), tenter un 5e (toast),
redémarrer l'app (nom + couleur conservés via localStorage).

---

## 10. Fichiers touchés

| Fichier | Nature |
|---|---|
| `src/store/workspace.ts` | refonte modèle (flat panes, name, color, activePane), actions, localStorage |
| `src/components/PaneTree.tsx` | réécriture layout par count + focus/close pane |
| `src/components/Sidebar.tsx` | nom, pastille/accent couleur, rename inline, popover palette |
| `src/components/TerminalPane.tsx` | hook focus (clic → setActivePane), bouton X au survol |
| `src/hooks/useShortcuts.ts` | Ctrl+T / Ctrl+W, suppression des splits |
| `src/App.tsx` | poller ports multi-panes, bouton + Terminal, toast |
| `src/store/workspace.test.ts` | tests du nouveau modèle |
| `src/lib/palette.ts` *(nouveau)* | palette + couleur d'alerte + helpers (basename, round-robin) |

---

## 11. Décisions tranchées

- **Grille fixe par count** (vs arbre de splits libre) — colle au besoin, plus simple.
- **Max 4** terminaux, 5e bloqué par toast.
- **Palette curatée** de 8 couleurs (vs picker libre) — cohérence visuelle.
- **Renommage inline** (vs dialog à la création) — zéro friction.
- **Alerte = ambre fixe** (vs bleu) — jamais confondue avec l'identité.
- **Persistance localStorage** nom + couleur (vs mémoire seule) — keyed par cwd.
