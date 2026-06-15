# terminials

Terminal desktop Linux pour faire tourner des **agents de code en parallèle** (Claude Code, Codex, …), clone homemade de [cmux](https://cmux.com) (le terminal macOS de manaflow-ai). Construit en **Tauri v2 + React + xterm.js**.

Le but : rendre le travail des agents *observable*. Sidebar verticale de workspaces affichant branche git, répertoire et ports en écoute ; anneau visuel + badge quand un agent attend une entrée ; notifications desktop ; CLI/socket pour piloter l'app.

## Fonctionnalités (v1)

- **Terminaux** xterm.js (rendu WebGL avec repli DOM) sur PTY natifs (`portable-pty`).
- **Workspaces** dans une sidebar verticale, **splits** horizontaux/verticaux (Allotment).
- **Sidebar riche** : branche git, ports TCP en écoute du sous-arbre de process, status pills et barre de progression.
- **Notifications agents** : capture des séquences `OSC 9 / 99 / 777` dans le flux du terminal → anneau visuel, badge non-lu, notification desktop D-Bus + demande d'attention de la fenêtre. Aussi déclenchables par la CLI et par un hook Claude Code.
- **CLI + socket Unix** (`$XDG_RUNTIME_DIR/terminials.sock`, JSON-par-ligne) pour scripter l'app.

Hors périmètre v1 : onglets dans les panes, navigateur intégré, restauration de session.

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
npm run tauri build              # produit le binaire + paquets dans src-tauri/target/release/bundle/
./scripts/install-cli.sh         # compile et installe la CLI `terminials` dans ~/.local/bin
```

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

| Raccourci | Action |
|---|---|
| `Ctrl+N` | Nouveau workspace |
| `Ctrl+D` | Split horizontal du pane |
| `Ctrl+Shift+D` | Split vertical du pane |

## Architecture

Workspace Cargo : `src-tauri` (app Tauri), `crates/protocol` (types socket partagés), `crates/cli` (binaire `terminials`), `crates/core` (logique pure OSC/git/ports, testable sans GUI). Front React dans `src/`. Voir `docs/superpowers/specs/` et `docs/superpowers/plans/`.
