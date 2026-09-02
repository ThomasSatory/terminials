# terminials

Terminal desktop Linux pour faire tourner des **agents de code en parallèle** (Claude Code, Codex, …), clone homemade de [cmux](https://cmux.com) (le terminal macOS de manaflow-ai). Construit en **Tauri v2 + React + xterm.js**.

Le but : rendre le travail des agents *observable*. Sidebar verticale de workspaces affichant branche git, répertoire et ports en écoute ; anneau visuel + badge quand un agent attend une entrée ; notifications desktop ; CLI/socket pour piloter l'app.

## Fonctionnalités

- **Terminaux** xterm.js (rendu WebGL avec repli DOM) sur PTY natifs (`portable-pty`). Chaque shell reçoit `TERM=xterm-256color` et `COLORTERM=truecolor`, déclarés par l'émulateur et jamais hérités (lancée depuis un raccourci .desktop, l'app n'a aucun `TERM` — et sans `TERM`, dircolors, git & co passent en monochrome). Les workspaces restent montés en arrière-plan : changer de workspace ne tue pas les shells.
- **Workspaces sur dossier réel** : le bouton + de la sidebar et `Ctrl+Shift+O` ouvrent un dialog GTK natif ; la liste des workspaces (dossier, nom, couleur, nombre de terminaux) est restaurée au démarrage (un dossier disparu est ignoré avec un toast).
- **Splits** : grille fixe de 1 à 4 terminaux par workspace (`Ctrl+Shift+T`), focus directionnel `Alt+←→↑↓`.
- **Sidebar riche** : branche git (+ indicateur dirty), ports TCP en écoute du sous-arbre de process, répertoire abrégé (`~/…`), dernière notification, status pills et barre de progression. Un clic sur la ligne git ouvre le diff viewer ; `Ctrl+Shift+B` masque la sidebar.
- **Diff viewer** (`Ctrl+Shift+D`, copie du diff viewer cmux) : colonne « Files » (statut coloré, stats +/− par fichier), diff unifié concaténé avec en-têtes sticky et numéros de ligne, filtre `/`, navigation `j`/`k`/`g g`/`Shift+G`, `Échap` ferme.
- **Notifications agents** : capture des séquences `OSC 9 / 99 / 777` dans le flux du terminal → **anneau bleu** autour du pane émetteur (signature cmux), rail bleu dans la sidebar, notification desktop D-Bus + demande d'attention de la fenêtre. Aussi déclenchables par la CLI et par un hook Claude Code ; les commandes lancées dans un pane ciblent leur workspace d'origine (`TERMINIALS_WORKSPACE_ID` injecté dans l'environnement du shell).
- **CLI + socket Unix** (`$XDG_RUNTIME_DIR/terminials.sock`, JSON-par-ligne) pour scripter l'app.

Hors périmètre : onglets/surfaces par pane, navigateur intégré, splits libres redimensionnables, command palette.

## Prérequis (Ubuntu / Debian)

```bash
sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev
# Rust : https://rustup.rs   |   Node >= 20.19
```

## Développement

```bash
npm install
npm run tauri dev      # lance l'app en mode dev
npm run test           # tests front (Vitest)
cargo test --workspace # tests Rust
```

## Build release

```bash
npm run tauri build              # produit target/release/terminials-app + le .deb dans target/release/bundle/deb/
./scripts/install-cli.sh         # compile et installe la CLI `terminials` dans ~/.local/bin
```

> **Toujours passer par `npm run tauri build`, jamais par `cargo build --release` seul.**
> Seul le CLI Tauri exécute `beforeBuildCommand` (`npm run build`) et embarque `dist/` dans le
> binaire. Un `cargo build --release` nu produit un binaire sans frontend, qui retombe sur le
> `devUrl` : fenêtre blanche affichant `Could not connect to localhost: Connection refused`.

## CLI

| Commande | Effet |
|---|---|
| `terminials ping` | Vérifie que l'app répond |
| `terminials notify --title T --body B` | Notification desktop |
| `terminials new-workspace --cwd /chemin` | Crée un workspace |
| `terminials set-status --label L [--color #rrggbb]` | Status pill du workspace actif |
| `terminials set-progress --value 0.6 [--label L]` | Barre de progression du workspace actif |
| `terminials hooks setup` | Installe le hook de notification Claude Code |

Notifications depuis un terminal (sans la CLI), via séquences OSC :

```bash
printf '\e]777;notify;Titre;Corps du message\a'   # OSC 777 (RXVT)
printf '\e]9;Tache terminee\a'                      # OSC 9 (iTerm2)
```

## Raccourcis

Couche `Ctrl+Shift` (convention gnome-terminal), matching par touche physique (`e.code`, compatible AZERTY). Aucun `Ctrl+lettre` nu n'est intercepté — `Ctrl+N/T/W…` vont au shell (readline intact) — et `Ctrl+Shift+C/V` restent le copier/coller du terminal.

| Raccourci | Action |
|---|---|
| `Ctrl+Shift+O` ou `Ctrl+Shift+N` | Ouvrir un dossier (nouveau workspace) |
| `Ctrl+Shift+T` | Nouveau terminal (pane) |
| `Ctrl+Shift+W` | Fermer le pane actif |
| `Ctrl+Shift+Q` | Fermer le workspace actif |
| `Ctrl+Shift+R` | Renommer le workspace (édition inline) |
| `Ctrl+Shift+D` | Ouvrir/fermer le diff viewer |
| `Ctrl+Shift+B` | Afficher/masquer la sidebar |
| `Ctrl+PageUp` / `Ctrl+PageDown` | Workspace précédent / suivant |
| `Ctrl+1` … `Ctrl+9` | Sélection directe de workspace |
| `Alt+←` `Alt+→` `Alt+↑` `Alt+↓` | Focus directionnel de pane |
| `Échap` | Ferme le diff viewer (quand il est ouvert) |

Conflits assumés : `Ctrl+PageUp/Down` (navigation de fenêtres tmux) et `Ctrl+2..8` (codes de contrôle rarissimes) sont capturés par l'app.

## Architecture

Workspace Cargo : `src-tauri` (app Tauri), `crates/protocol` (types socket partagés), `crates/cli` (binaire `terminials`), `crates/core` (logique pure OSC/git/ports, testable sans GUI). Front React dans `src/`. Voir `docs/superpowers/specs/` et `docs/superpowers/plans/`.
