# terminials

Terminal desktop Linux pour faire tourner des **agents de code en parallèle** (Claude Code, Codex, …), clone homemade de [cmux](https://cmux.com) (le terminal macOS de manaflow-ai). Construit en **Tauri v2 + React + xterm.js**.

Le but : rendre le travail des agents *observable*. Sidebar verticale de workspaces affichant branche git, répertoire et ports en écoute ; anneau visuel + badge quand un agent attend une entrée ; notifications desktop ; CLI/socket pour piloter l'app.

## Fonctionnalités

- **Terminaux** xterm.js (rendu WebGL avec repli DOM) sur PTY natifs (`portable-pty`). Chaque shell reçoit `TERM=xterm-256color` et `COLORTERM=truecolor`, déclarés par l'émulateur et jamais hérités (lancée depuis un raccourci .desktop, l'app n'a aucun `TERM` — et sans `TERM`, dircolors, git & co passent en monochrome). Les workspaces restent montés en arrière-plan : changer de workspace ne tue pas les shells.
- **Workspaces** : chaque espace a un **nom** et un **dossier**, tous deux modifiables. Le bouton + de la sidebar (`Ctrl+Shift+N`) ouvre un formulaire inline *nom + dossier* (le `…` appelle le dialog GTK, dossier vide = `~`, `Entrée` valide, `Échap` annule) ; le bouton 📂 (`Ctrl+Shift+O`) reste le chemin rapide « choisir un dossier ». Sur un espace existant, le même formulaire s'ouvre par le bouton **✎** de la pile d'actions (révélée au survol de la ligne, sous le `×`) ou avec `Ctrl+Shift+R` — jamais au clic ni au double-clic sur la ligne, pour ne pas surgir à chaque fois qu'on sélectionne un espace — changer le dossier **relance les shells** du workspace (`TerminalPane` dépend de `cwd`). Le dossier saisi est validé côté Rust (`dir_exists`) avant création. La liste des workspaces (dossier, nom, couleur, nombre de terminaux) est restaurée au démarrage (un dossier disparu est ignoré avec un toast).
- **Onglets** : les terminaux d'un workspace sont des **onglets** (barre en haut de la zone terminal, un seul terminal visible à la fois, nombre libre). `Ctrl+Shift+T` ouvre un onglet, `Ctrl+Shift+W` ferme l'actif (fermer le dernier ferme le workspace), `Alt+←/→` navigue, `Ctrl+Shift+PageUp/PageDown` ou un glisser réordonne, le clic milieu ferme. Le titre est celui envoyé par le shell (OSC 0/2), sinon « Terminal n ». Tous les onglets restent montés (keep-alive) : un process long survit au changement d'onglet.
- **Groupes** : la sidebar se découpe en **groupes** repliables (nom + couleur, bouton `+▾` ou `Ctrl+Shift+G`, `Ctrl+Shift+E` replie/déplie celui du workspace actif). On glisse un workspace dans un groupe (sur son en-tête = en fin de groupe, ou entre deux membres) ; les en-têtes se glissent entre eux. Dissoudre un groupe (`×`) libère ses workspaces sans rien fermer. Un nouveau workspace naît dans le groupe du workspace actif. `Ctrl+1..9` et `Ctrl+PageUp/Down` suivent l'ordre visible en sautant les groupes repliés. Groupes et appartenances sont persistés.
- **Sidebar riche** : branche git (+ indicateur dirty), ports TCP en écoute du sous-arbre de process, répertoire abrégé (`~/…`), dernière notification, status pills et barre de progression. Un clic sur la ligne git ouvre le diff viewer ; `Ctrl+Shift+B` masque la sidebar. Une **pastille bleue** s'allume sur la ligne quand un agent du workspace a notifié (session Claude terminée via le hook `Stop`, ou en attente d'une entrée) et s'éteint à l'activation du workspace — ou, pour une notification émise par un onglet précis (OSC), au focus de cet onglet. Un groupe replié dont un membre réclame l'attention porte le même halo bleu. Les workspaces se **réordonnent au glisser-déposer** (appui n'importe où sur la ligne, un trait indique la position de dépôt) ou avec `Ctrl+Shift+↑/↓` ; l'ordre est persisté.
- **Diff viewer** (`Ctrl+Shift+D`, copie du diff viewer cmux) : colonne « Files » (statut coloré, stats +/− par fichier), diff unifié concaténé avec en-têtes sticky et numéros de ligne, filtre `/`, navigation `j`/`k`/`g g`/`Shift+G`, `Échap` ferme.
- **Notifications agents** : capture des séquences `OSC 9 / 99 / 777` dans le flux du terminal → **point bleu** sur l'onglet émetteur (l'anneau cmux de l'ancienne grille), rail bleu dans la sidebar, notification desktop D-Bus + demande d'attention de la fenêtre. Aussi déclenchables par la CLI et par un hook Claude Code ; les commandes lancées dans un onglet ciblent leur workspace d'origine (`TERMINIALS_WORKSPACE_ID` injecté dans l'environnement du shell).
- **Images & fichiers dans le prompt de l'agent** : `Ctrl+V` colle une image du presse-papier directement dans Claude Code (qui la lit via `xclip`, cf. Prérequis) ; `Ctrl+Shift+V` avec une image au presse-papier l'écrit dans `$TMPDIR/terminials-images/` et injecte son chemin dans le terminal ; un glisser-déposer de fichiers injecte leurs chemins (quotés) dans le terminal survolé. Sans image au presse-papier, `Ctrl+Shift+V` reste le collage texte du terminal.
- **CLI + socket Unix** (`$XDG_RUNTIME_DIR/terminials.sock`, JSON-par-ligne) pour scripter l'app.

Hors périmètre : splits (la grille 1→4 a été remplacée par les onglets), navigateur intégré, command palette.

## Prérequis (Ubuntu / Debian)

```bash
sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
  libxdo-dev libssl-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev
# Rust : https://rustup.rs   |   Node >= 20.19

# Collage d'images dans Claude Code (Ctrl+V) : il shelle vers xclip pour lire le
# presse-papier X11. xsel ne suffit pas, Claude Code ne s'en sert que pour le texte.
sudo apt install -y xclip   # (Wayland : wl-clipboard)
```

## Installation par Claude Code

Sur une machine Linux (ou WSL2) vierge, ouvrir Claude Code dans un dossier de travail et lui coller
ce prompt — il fait l'installation complète de bout en bout :

````text
Installe l'application terminials (https://github.com/ThomasSatory/terminials.git — ou le dossier local si le
dépôt est déjà cloné ici) sur cette machine Linux. Suis cette procédure, vérifie chaque étape avant
de passer à la suivante, et arrête-toi en me disant ce qui bloque si une commande échoue.

1. Diagnostic de l'environnement
   - Affiche `uname -a`, la distribution (`lsb_release -a` ou /etc/os-release), et dis-moi si on est
     sous WSL (`grep -qi microsoft /proc/version`).
   - Si ce n'est PAS une distribution Debian/Ubuntu, adapte les commandes apt au gestionnaire de
     paquets local (dnf, pacman…) en gardant les mêmes paquets équivalents.
   - Si on est sur Windows natif (pas WSL) : STOP, l'app ne compile pas sur Windows natif
     (socket Unix, /proc, shell /bin/bash). Dis-le-moi et propose WSL2.

2. Dépendances système
   sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file \
     libxdo-dev libssl-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev git xclip
   (sous Wayland, installe aussi wl-clipboard ; xclip sert à Claude Code pour lire les images du
   presse-papier, xsel ne suffit pas)

3. Toolchains
   - Rust : si `cargo --version` échoue, installe via rustup (https://rustup.rs, non interactif :
     `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y`) puis source
     ~/.cargo/env.
   - Node >= 20.19 : vérifie `node -v`. S'il est trop vieux ou absent, installe-le (nvm ou nodesource),
     ne casse pas une install Node existante du système.

4. Récupération et build
   - Clone le dépôt (ou place-toi dans le clone existant), puis `npm install`.
   - Build : `npm run tauri build`.
     ATTENTION : jamais `cargo build --release` seul — seul le CLI Tauri exécute `npm run build` et
     embarque dist/ dans le binaire ; un cargo build nu produit une fenêtre blanche.
   - Build du CLI : `./scripts/install-cli.sh` (symlinke `terminials` dans ~/.local/bin).

5. Installation
   - Symlinke la GUI : `ln -sf "$PWD/target/release/terminials-app" ~/.local/bin/terminials-app`.
     (`terminials-app` = l'application graphique, `terminials` = la CLI de pilotage — ne pas les
     confondre.)
   - Vérifie que ~/.local/bin est dans le PATH, ajoute-le au ~/.bashrc ou ~/.zshrc sinon.
   - Crée le lanceur ~/.local/share/applications/terminials.desktop :
       [Desktop Entry]
       Type=Application
       Name=terminials
       Comment=Terminal pour agents de code en parallèle
       Exec=<chemin absolu de ~/.local/bin/terminials-app>
       Icon=<chemin absolu du dépôt>/src-tauri/icons/128x128.png
       Terminal=false
       Categories=Development;System;TerminalEmulator;
       StartupNotify=true
     puis `update-desktop-database ~/.local/share/applications` si la commande existe.
   - Installe le hook Claude Code : `terminials hooks setup`, et dis-moi quoi ajouter dans
     ~/.claude/settings.json pour le brancher sur les events Stop et Notification.

6. Si on est sous WSL2
   - Vérifie que WSLg est actif (`echo $DISPLAY` non vide, ou /mnt/wslg existe). Sinon, dis-moi de
     faire `wsl --update` côté Windows.
   - Si la fenêtre de l'app reste blanche, exporte `WEBKIT_DISABLE_DMABUF_RENDERER=1` (et au besoin
     `WEBKIT_DISABLE_COMPOSITING_MODE=1`) dans le ~/.bashrc, et mets-le aussi dans l'Exec= du .desktop
     via `env WEBKIT_DISABLE_DMABUF_RENDERER=1 <binaire>`.
   - Préviens-moi que les dépôts doivent vivre dans le système de fichiers WSL (~/dev/...) et jamais
     sous /mnt/c : la sonde git dirty y devient catastrophiquement lente.

7. Vérification finale — ne me dis pas que c'est installé sans avoir exécuté ces contrôles :
   - `cargo test --workspace` et `npm run test` passent.
   - `ls -l ~/.local/bin/terminials ~/.local/bin/terminials-app` et `terminials --help` répondent.
   - Lance `terminials-app` en arrière-plan, attends 5 s, puis `terminials ping` doit répondre pong
     (ça prouve que le socket $XDG_RUNTIME_DIR/terminials.sock est bien servi). Tue le process ensuite.
   - Fais-moi un récapitulatif : ce qui est installé, où, et ce qui reste à faire manuellement.
````

## Plateformes

| Cible | État | Détail |
|---|---|---|
| **Linux natif** (X11 / Wayland) | ✅ supporté | Cible de développement. |
| **Windows + WSL2** (WSLg) | ⚠️ utilisable, dégradé | C'est le build Linux tel quel — voir réserves ci-dessous. |
| **Windows natif** | ❌ ne compile pas | Blocages structurels, voir ci-dessous. |

### Windows + WSL2

L'app tourne sous WSL2 avec WSLg (Windows 11, ou Windows 10 21H2+ après `wsl --update`) : PTY,
`/proc` pour les ports, socket Unix dans `$XDG_RUNTIME_DIR`, `git`, `xclip` via le pont
presse-papier WSLg — tout est là. Les réserves :

- **Fenêtre blanche** : le renderer DMABUF de webkit2gtk ≥ 2.44 ne fonctionne pas sous WSLg ; lancer
  avec `WEBKIT_DISABLE_DMABUF_RENDERER=1` (et au besoin `WEBKIT_DISABLE_COMPOSITING_MODE=1`).
- **Notifications desktop** : WSLg ne fait pas tourner de démon de notifications ; les appels D-Bus
  de `notify-rust` échouent silencieusement. Le point bleu sur l'onglet et la pastille de la
  sidebar continuent de fonctionner — seul le toast système manque (installer `dunst` ou équivalent
  dans la distro pour le récupérer).
- **Performance git** : ne jamais placer les dépôts sous `/mnt/c` (9P). La sonde dirty (`git status`)
  y devient inutilisable. Les dépôts vivent dans le système de fichiers WSL (`~/dev/…`).
- **Rendu** : GPU émulé (Mesa/D3D12) ; l'addon WebGL de xterm.js peut retomber sur le rendu DOM.

### Windows natif — ce qui bloque

Trois fichiers empêchent la compilation, et aucun usage unix du dépôt n'est protégé par un `#[cfg]` :

- `src-tauri/src/socket.rs` et `crates/cli/src/lib.rs` : sockets Unix (`tokio::net::UnixListener`,
  `std::os::unix::net::UnixStream`) + `PermissionsExt`. À remplacer par un named pipe Windows.
- `crates/cli/src/hooks.rs` : `PermissionsExt`, `$HOME`, script hook en bash + `jq`.

Et, même une fois que ça compile, quatre points cassent à l'exécution :

- `src/components/TerminalPane.tsx` : shell figé sur `/bin/bash`.
- `src/lib/workspaceDraft.ts` : `resolveDraft` rejette tout chemin ne commençant pas par `/`, donc
  aucun `C:\…` — plus aucun workspace créable. Idem `abbreviateHome` / `palette.ts`, qui découpent
  sur `/`.
- `crates/core/src/ports.rs` : lecture de `/proc` — la détection de ports renverrait toujours vide.
- `src-tauri/tauri.conf.json` : `targets: ["deb"]` uniquement, à étendre à `nsis`/`msi`.

Le reste est portable en l'état : `portable-pty` gère ConPTY, `git.rs` shelle vers le binaire `git`,
`images.rs` passe par `std::env::temp_dir()`, et `notify-rust` a bien une implémentation Windows
(toasts). Le portage est donc réaliste — compter une journée — mais il n'est pas fait.

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
| `Ctrl+Shift+N` | Nouvel espace : formulaire nom + dossier dans la sidebar |
| `Ctrl+Shift+O` | Ouvrir un dossier (nouveau workspace) |
| `Ctrl+Shift+T` | Nouvel onglet terminal |
| `Ctrl+Shift+W` | Fermer l'onglet actif (le dernier ferme le workspace) |
| `Ctrl+Shift+Q` | Fermer le workspace actif |
| `Ctrl+Shift+R` | Modifier le nom / le dossier du workspace (édition inline) |
| `Ctrl+Shift+D` | Ouvrir/fermer le diff viewer |
| `Ctrl+Shift+B` | Afficher/masquer la sidebar |
| `Ctrl+Shift+G` | Nouveau groupe (formulaire nom + couleur dans la sidebar) |
| `Ctrl+Shift+E` | Replier/déplier le groupe du workspace actif |
| `Ctrl+Shift+PageUp` / `Ctrl+Shift+PageDown` | Déplacer l'onglet actif dans la barre (sans wrap) |
| `Ctrl+Shift+↑` / `Ctrl+Shift+↓` | Déplacer le workspace actif dans son groupe (sans wrap) |
| `Ctrl+PageUp` / `Ctrl+PageDown` | Workspace précédent / suivant (ordre visible, groupes repliés sautés) |
| `Ctrl+1` … `Ctrl+9` | Sélection directe de workspace (ordre visible) |
| `Alt+←` / `Alt+→` | Onglet précédent / suivant |
| `Échap` | Ferme le diff viewer (quand il est ouvert) |

Conflits assumés : `Ctrl+PageUp/Down` (navigation de fenêtres tmux) et `Ctrl+2..8` (codes de contrôle rarissimes) sont capturés par l'app.

`Ctrl+V` n'est pas un raccourci de l'app : xterm l'envoie tel quel (`\x16`) au PTY, ce qui est exactement ce qu'attend Claude Code pour aller lire l'image du presse-papier avec `xclip`. Le collage d'image sur `Ctrl+Shift+V` ne dévie pas la touche non plus : il se branche sur l'event `paste` et ne s'active que si le presse-papier contient une image.

## Architecture

Workspace Cargo : `src-tauri` (app Tauri), `crates/protocol` (types socket partagés), `crates/cli` (binaire `terminials`), `crates/core` (logique pure OSC/git/ports, testable sans GUI). Front React dans `src/`. Voir `docs/superpowers/specs/` et `docs/superpowers/plans/`.
