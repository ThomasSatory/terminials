# Parité cmux + vue des fichiers modifiés — Design

> Itération « copie de cmux » : rapprocher terminials du vrai cmux (UI **et** fonctionnement général) et donner accès aux fichiers modifiés via un diff viewer fidèle à celui de cmux (présent chez cmux depuis v0.64.11 : ⌘⌃⇧D, colonne « Files », diff unifié, stats +/−).

**Date** : 2026-07-07
**Statut** : design validé (mode autonome demandé par l'utilisateur : décisions arbitrées par panel de juges — fidélité cmux / risque technique / UX quotidienne — puis synthèse ; pas de gate interactif)
**Référence cmux** : recherche sourcée du 2026-07-06 (site cmux.com, repo github.com/manaflow-ai/cmux, changelog ≤ v0.64.17)

---

## 1. Objectif

1. **Accès aux fichiers modifiés** (objectif n°1 de l'utilisateur) : diff viewer intégré, copié du diff viewer cmux.
2. **Parité de fonctionnement** : corriger les écarts P0 identifiés par l'analyse d'écart — en tête desquels un défaut critique découvert en revue : *changer de workspace tue les PTYs* (seul le PaneTree actif est monté ; `TerminalPane` fait `closePty()` au démontage — `App.tsx:87`, `TerminalPane.tsx:74-83`). Pour un produit dont la raison d'être est « des agents en parallèle », ce fix passe devant tout.
3. **Parité de signature visuelle** : anneau **bleu** cmux autour du pane émetteur d'une notification (« Panes get a blue ring when coding agents need your attention »), ligne sidebar riche (dernière notification + cwd).

## 2. Périmètre ordonné (dépendances respectées)

| # | Item | Taille |
|---|------|--------|
| 8a | Hygiène amont : commit du réglage App.css en cours (icon-btn 22→28px), retrait de la dep `allotment` inutilisée | S |
| 0 | **Keep-alive des workspaces** : tous les PaneTree montés, empilés `position:absolute; inset:0`, inactifs en `visibility:hidden` | M |
| 1 | **Workspaces sur dossier réel** : dialog GTK natif (tauri-plugin-dialog), état vide « Open folder », suppression du HOME hardcodé (3 fichiers) et de l'auto-création au boot | S |
| 3 | **Anneau bleu par pane** : event `agent-notification` enrichi du `ptyId`, unread au niveau pane, bleu #3b82f6 partout, suppression du halo de grille | M |
| 2 | **Diff viewer MVP** (détail §4) | M |
| 4 | Ligne sidebar complète : texte de la dernière notification (1 ligne ellipsée) + cwd abrégé (`~/…`) | S |
| 5 | Fermeture de workspace : action store (ferme les PTYs), bouton × au survol de la ligne, Ctrl+Shift+Q | S |
| 6 | Raccourcis navigation (table §6) + migration des Ctrl+N/T/W fautifs | S |
| 7 | Restauration de la liste des workspaces au démarrage ({cwd, name, color, paneCount}, keyé par id) | M |
| — | Compléments : routage socket vers le workspace émetteur (env vars), `.catch` sur `spawnPty`, pollers parallélisés + garde in-flight | S |
| 8b | Hygiène aval : README (raccourcis, open folder, diff) | S |

**Reportés explicitement** : surfaces/tabs par pane, arbre de splits libre + drag-resize, command palette, badge PR GitHub, browser pane, groupes/pin/drag&drop, config JSON rebindable, diff avancé (split view, Shiki, base picker, --last-turn, commentaires de revue), multi-fenêtres, palette 16 couleurs.

## 3. Item 0 — Keep-alive des workspaces (bloquant)

- `App.tsx` rend **tous** les workspaces : chaque `PaneTree` dans un conteneur `position:absolute; inset:0`, celui du workspace actif en `visibility:visible`, les autres en `visibility:hidden`. **Jamais** `display:none` (dimensions à 0 → `fit()` → `resize_pty(0)` → reflow shell cassé).
- Garde-fou dans `TerminalPane` : court-circuiter fit/resize si `host.clientWidth|Height === 0` ; refit à la révélation.
- Contexts WebGL : N workspaces × 4 panes peut dépasser la limite navigateur (~8-16). Le fallback `onContextLoss` existe déjà ; si besoin, ne charger l'addon WebGL que pour le workspace visible (extension ultérieure, pas bloquant).
- Test manuel obligatoire : un process long survit à un aller-retour de workspace.

## 4. Item 2 — Diff viewer (copie du diff viewer cmux, D1a)

**Placement** : overlay `position:absolute; inset:0` au-dessus de la **zone de grille uniquement** (sidebar et top bar restent visibles), `z-index` 500 (< toast 1000). Un booléen `diffOpen` par workspace dans le store. La grille reste montée dessous (risque PTY nul). L'option « diff = pane de la grille » redeviendra la cible quand des splits libres redimensionnables existeront.

**Ouverture/fermeture** : Ctrl+Shift+D (toggle), clic sur la ligne meta git de la sidebar, Escape ferme (écouté uniquement quand l'overlay est ouvert). À l'ouverture : blur du textarea xterm, focus sur le conteneur overlay (`tabIndex=-1`) ; à la fermeture : restaurer le focus sur le textarea du pane actif.

**Données (Rust, `crates/core/src/git.rs` étendu, via CLI git — pas de libgit2)** :
- `changed_files(cwd)` : `git status --porcelain=v1 -z` avec `GIT_OPTIONAL_LOCKS=0` → `Vec<ChangedFile { path, status: Modified|Added|Deleted|Renamed|Untracked, orig_path: Option }>`, enrichi de `git diff --numstat` + `git diff --cached --numstat` (+/− par fichier).
- `file_diff(cwd, path, staged)` : `git diff [--cached] --no-color -- <path>` ; untracked : `git diff --no-color --no-index -- /dev/null <path>` (exit code 1 = normal).
- Deux commandes Tauri : `git_changed_files(cwd)` et `git_file_diff(cwd, path, staged)` (pattern `git_info`).

**UI (fidèle au layout cmux)** :
- Toolbar 30px alignée sur la top bar : nom workspace + branche, compteur de fichiers, totaux `+N` vert / `−M` rouge, bouton reload `.icon-btn`, bouton × fermer.
- Aside « Files » ~220px : liste triée par chemin, lettre de statut colorée (M=orange, A=teal, D=rouge, R=violet, ?=gris) + stats +/− par fichier ; clic = scroll smooth vers la section du fichier ; « / » filtre la liste.
- Main scrollable : diff **unifié** concaténé par fichier, en-tête de fichier sticky, lignes `+` fond vert translucide / `−` fond rouge translucide, hunks `@@` grisés, numéros de ligne, mono 12px. Pas de Shiki ni de split view en v1. Diffs par fichier chargés lazy.
- Clavier (overlay focus uniquement) : `j`/`k` scroll, chord `g g` haut, `Shift+G` bas, `/` filtre, Escape ferme.
- Rafraîchissement : fetch à l'ouverture + bouton reload. **Jamais pollé** (git diff complet/2s sur gros repo = coût réel). Isoler l'overlay des re-renders du poller 2s (sélecteurs Zustand étroits).
- État vide (aucun fichier modifié) : message centré discret « Aucun changement ».

## 5. Item 3 — Attention bleue (D3)

- `ATTENTION_COLOR = #3b82f6` pour **toute** la sémantique « un agent attend » : anneau du pane émetteur (2px + glow `0 0 0 2px #3b82f6, 0 0 8px #3b82f680` — distinct de la bordure active 1px couleur d'identité), rail sidebar 3px, halo pastille.
- Le halo inset ambre de la grille entière (`PaneTree.tsx:94`) est **supprimé** (pas recoloré), dans le même commit.
- `ALERT_COLOR` scindé : `ATTENTION_COLOR` (#3b82f6) et `STATUS_DEFAULT_COLOR` (#f5a623, défaut du status pill et de la progress bar ; la couleur explicite de `set-status` surcharge).
- Collision d'identité : `PALETTE[0] = #5b8def` (quasi identique au bleu attention, attribué au 1er workspace) → déplacé plus loin dans la palette (le round-robin commence sur une autre couleur).
- Store : `unread` passe **au niveau pane** (`unreadPanes: Set/paneId[]` par workspace) ; `unread` workspace = dérivé (≥1 pane unread). Clear : le focus du pane émetteur efface **son** anneau ; activer le workspace ne clear plus tout. Le rail sidebar s'éteint quand tous les panes sont lus. Fallback : notification sans mapping pane (CLI hors pane, pane fermé) → unread workspace seul, cleared à l'activation du workspace (comportement actuel).
- Backend : ajouter `"ptyId": id` au payload `agent-notification` (le `id` est en scope à l'emit). Front : inversion de `panePtys`.

## 6. Items 1, 5, 6 — Dossiers réels, fermeture, raccourcis (D4, D5)

**Open folder** : `tauri-plugin-dialog` (Cargo + npm + permission minimale open dans `capabilities/default.json`), `open({ directory: true, defaultPath: dernierDossierOuvert persisté })`. Annulation (`null`) = no-op strict ; guard anti double-clic. Bouton + de la sidebar et Ctrl+Shift+O ouvrent le dialog. État vide quand `workspaces=[]` : bouton centré « Open folder (Ctrl+Shift+O) » ; suppression de l'auto-création HOME (`App.tsx:18-20`) et du HOME hardcodé (3 fichiers). `.catch` sur `spawnPty` → message d'erreur écrit dans le xterm.

**Fermeture de workspace** : `closeWorkspace(wsId)` dans le store — ferme les PTYs de tous les panes (via `panePtys`), retire le workspace, active le voisin (précédent, sinon suivant, sinon état vide). Bouton × au survol de la ligne sidebar + Ctrl+Shift+Q.

**Table des raccourcis (couche Ctrl+Shift, convention gnome-terminal ; matching par `e.code`, jamais `e.key` — AZERTY)** :

| Raccourci | Action |
|---|---|
| Ctrl+Shift+O | Open folder (nouveau workspace) |
| Ctrl+Shift+N | Nouveau workspace (= open folder) |
| Ctrl+Shift+T | Nouveau terminal (pane) |
| Ctrl+Shift+W | Ferme le pane actif |
| Ctrl+Shift+Q | Ferme le workspace actif |
| Ctrl+Shift+R | Renomme le workspace (ouvre l'édition inline) |
| Ctrl+Shift+D | Toggle diff viewer |
| Ctrl+Shift+B | Toggle sidebar |
| Ctrl+PageUp / Ctrl+PageDown | Workspace précédent / suivant |
| Ctrl+1..9 (`Digit1..9`) | Sélection directe de workspace |
| Alt+←→↑↓ | Focus directionnel de pane (preventDefault systématique — WebKitGTK mappe Alt+←/→ sur l'historique du webview) |
| Escape | Ferme l'overlay diff (uniquement quand ouvert) |

- **Migration** : les Ctrl+N/T/W nus actuels (qui cassent `next-history`, `transpose-chars`, `kill-word` de readline) sont remplacés — plus aucun Ctrl+lettre nu.
- **Implémentation en double couche obligatoire** : `attachCustomKeyEventHandler` sur chaque `Terminal` (return false pour les raccourcis app — l'interception window-level seule arrive après le forward xterm→PTY) + listener window pour le focus hors terminal. Table factorisée dans un module unique consommé par les deux couches.
- Ne **jamais** intercepter Ctrl+Shift+C/V (copier/coller terminal). Conflits assumés documentés : Ctrl+PageUp/Down (tmux window nav), Ctrl+2..8 (codes de contrôle rarissimes). Mettre à jour les `title=` des boutons.

## 7. Items 4, 7 et compléments

**Ligne sidebar** (item 4) : sous la ligne meta git, ajouter (a) le cwd abrégé (`~/dev/terminals`) en 11px gris, (b) le texte de la dernière notification (`lastNotification.title` — déjà dans le store, jamais rendu) en 1 ligne ellipsée. Ordre dans la ligne : nom / meta git / cwd / dernière notif / status / progress — fidèle à la ligne workspace cmux (branche, cwd, ports, dernière notification).

**Restauration** (item 7) : persister `{id, cwd, name, color, paneCount}` à chaque changement (localStorage, keyé **par id de workspace** — la clé par cwd actuelle fusionnerait deux workspaces sur le même dossier, cas réel avec des worktrees). Au boot : valider l'existence de chaque cwd avant de spawner (dossier disparu → skip + toast) ; ne jamais restaurer unread/status/progress/ports. Avec la grille fixe, `paneCount` **est** le layout.

**Routage socket** : `spawn_pty` injecte `TERMINIALS_WORKSPACE_ID` (et `TERMINIALS_PTY_ID`) dans l'env du shell ; la CLI les lit et les joint aux params ; le front route `notify`/`set-status`/`set-progress` vers ce workspace, fallback sur l'actif (compat CLI hors pane). Corrige : notification affichée sur le mauvais workspace si l'utilisateur a switché (`socketEvents.ts:27-33`).

**Pollers** : `git_info` parallélisé par workspace (`Promise.all`, comme le poller ports) + garde in-flight `if (running) return` sur les deux pollers (repos lents/NFS).

## 8. Gestion des erreurs

- `git_changed_files`/`git_file_diff` hors repo ou git absent → liste vide / erreur propre, overlay affiche « Pas un dépôt git ».
- `git diff --no-index` exit 1 = normal (différences trouvées), à ne pas traiter en erreur.
- Dialog annulé → no-op. cwd restauré disparu → skip + toast. `spawnPty` rejeté → message dans le xterm.
- Fichiers binaires dans le diff : `git diff` émet `Binary files … differ` → afficher tel quel, pas de crash de parsing.

## 9. Tests

- **Rust** : tests unitaires de `changed_files` (repo temporaire : fichier modifié, ajouté, supprimé, renommé, untracked ; hors repo → vide) et `file_diff` (contenu attendu, untracked via --no-index, binaire).
- **Front (vitest, pattern store existant)** : unread par pane (set/clear au focus, dérivation workspace), `closeWorkspace` (activation du voisin, purge panePtys), persistance/restauration par id (cwd disparu skippé), toggle `diffOpen`, module de raccourcis (matching e.code, table complète).
- **Manuel obligatoire** : process long survivant au switch de workspace (item 0) ; notification OSC → anneau bleu sur le bon pane ; diff viewer sur ce repo même ; dialog GTK en dev ; Ctrl+W dans bash **non intercepté** (kill-word fonctionne) ; AZERTY Ctrl+1..9.

## 10. Décisions d'arbitrage (résumé)

| Décision | Choix | Voix |
|---|---|---|
| D1 placement diff | Overlay plein-cadre zone de grille (a) ; « diff = pane » différé aux splits libres | 2/3 (dissent fidélité) |
| D2 périmètre | Set 1-8 + item 0 keep-alive + état vide + routage socket + .catch spawnPty | unanime |
| D3 couleur attente | Bleu #3b82f6 partout pour l'attention ; ambre conservé pour status/progress par défaut | unanime sur le bleu, 2/3 sur l'ambre |
| D4 open folder | tauri-plugin-dialog natif | unanime |
| D5 raccourcis | Couche Ctrl+Shift complète, migration des Ctrl+N/T/W, double couche xterm+window, e.code | 2/3 (dissent Ctrl+O littéral rejeté : casse nano/readline) |
