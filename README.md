# terminials

Terminal desktop Linux pour faire tourner des **agents de code en parallèle** (Claude Code, Codex, …), clone homemade de [cmux](https://cmux.com) (le terminal macOS de manaflow-ai). Construit en **Tauri v2 + React + xterm.js**.

Le but : rendre le travail des agents *observable*. Un **dock** flottant en bas de la fenêtre porte un avatar par espace de travail (état de l'agent, groupes repliables) ; au-dessus, la barre de l'espace actif (branche git, ports, onglets) et son terminal plein cadre. Halo et bulle quand un agent attend une entrée, mosaïque de tous les agents, palette de commandes, notifications desktop, CLI/socket pour piloter l'app.

## Fonctionnalités

- **Terminaux** xterm.js (rendu WebGL avec repli DOM) sur PTY natifs (`portable-pty`). Chaque shell reçoit `TERM=xterm-256color` et `COLORTERM=truecolor`, déclarés par l'émulateur et jamais hérités (lancée depuis un raccourci .desktop, l'app n'a aucun `TERM` — et sans `TERM`, dircolors, git & co passent en monochrome). Les workspaces restent montés en arrière-plan : changer de workspace ne tue pas les shells.
- **Interface « Dock »** : un dock flottant en bas de la fenêtre porte un **avatar par espace** (monogramme sur la couleur de l'espace), puis le **+** (nouvel espace), la **mosaïque**, l'**activité** et la **palette** (`Ctrl K`). Un clic sur un avatar ouvre le terminal de l'espace (et referme récap et mosaïque) ; un clic sur l'avatar de l'espace ouvert, ou un clic droit sur n'importe lequel, ouvre son **menu** (renommer, dupliquer, couleur, groupe, fermer) ; le **clic molette** le ferme. L'infobulle d'un avatar donne son groupe, son raccourci `Ctrl 1…9`, la branche, les ports et l'état de l'agent. Un indicateur d'accent glisse sous l'espace ouvert. `Ctrl+Shift+B` masque le dock ; la zone terminal récupère alors la place qu'il réservait (le terminal est redimensionné, jamais démonté). Les avatars se **réordonnent au glisser** (un trait indique la position de dépôt, et la bande défile quand on approche de son bord) ou avec `Ctrl+Shift+↑/↓` ; l'ordre est persisté.
- **Espaces** : chaque espace a un **nom**, un **dossier**, une **couleur** et un groupe facultatif, tous modifiables. Le **+** du dock (`Ctrl+Shift+N`) ouvre un popover ancré au dock (nom, dossier avec « Parcourir… », couleur parmi les 16 de cmux ou automatique, groupe) ; `Ctrl+Shift+R` ouvre le même popover sur l'espace actif. Le dossier est validé côté Rust (`dir_exists`) ; changer le dossier **relance les shells** de l'espace (`TerminalPane` dépend de `cwd`). `Ctrl+Shift+O` reste le chemin rapide « choisir un dossier », `Ctrl+Shift+Entrée` crée d'un coup un espace sur `~` (nommé « ~ », puis « ~ 2 »…). *Dupliquer* crée une copie (même dossier, même groupe, un onglet neuf, nom incrémenté « app 2 »). Sans aucun espace, un **accueil** propose d'en créer un, d'ouvrir un dossier ou de rouvrir un espace récent. La liste des espaces (dossier, nom, groupe, couleur, nombre de terminaux) est restaurée au démarrage (un dossier disparu est ignoré avec un toast).
- **Barre de l'espace** : en haut, la pastille, le nom, la branche git (`•` = modifications non commitées) et les ports TCP en écoute du sous-arbre de process de l'espace actif, puis ses **onglets**, et un bouton **± N fichiers** quand le dépôt a des modifications (il ouvre la vue des fichiers modifiés).
- **Onglets** : les terminaux d'un espace sont des **onglets** (un seul terminal visible à la fois, nombre libre). `Ctrl+Shift+T` (ou le `+` de la barre) ouvre un onglet **dans le dossier courant du terminal actif** : après un `cd`, le nouvel onglet démarre au même endroit (lu dans `/proc`, Linux et WSL ; si le shell est terminé ou le dossier supprimé, il démarre dans le dossier de l'espace, comme tous les onglets au redémarrage). `Ctrl+Shift+W` ferme l'actif (fermer le dernier ferme l'espace), `Alt+←/→` navigue, `Ctrl+Shift+PageUp/PageDown` ou un glisser réordonne, le clic milieu ferme. Le titre est celui envoyé par le shell (OSC 0/2), sinon « Terminal n ». Tous les onglets restent montés (keep-alive) : un process long survit au changement d'onglet comme à l'ouverture d'une vue.
- **Groupes** : dans le dock, les espaces d'un groupe se rangent derrière son **étiquette** (nom + couleur). Un clic sur l'étiquette replie le groupe en **pile d'avatars** qui remonte l'état de ses membres (`Ctrl+Shift+E` replie/déplie celui de l'espace actif) ; quand la largeur manque, les groupes les moins récemment consultés se replient d'eux-mêmes, et en dernier recours la bande défile. Le **clic droit sur une étiquette** ouvre son menu : *Nouvel espace dans le groupe*, *Renommer…*, replier/déplier, la couleur, *Supprimer le groupe* (ses espaces passent hors groupe, aucun terminal n'est fermé). `Ctrl+Shift+G` crée un groupe. On glisse un avatar dans un groupe ou entre deux membres ; les étiquettes se glissent entre elles. Un nouvel espace naît dans le groupe de l'espace actif. `Ctrl+1..9` et `Ctrl+PageUp/Down` suivent l'ordre du dock en sautant les groupes repliés. Groupes et appartenances sont persistés.
- **État des agents** : un **halo** à l'accent et un petit saut de l'avatar signalent qu'un agent **vous attend** (session Claude terminée via le hook `Stop`, ou en attente d'une entrée) ; il s'éteint à l'activation de l'espace — ou, pour une notification émise par un onglet précis (OSC), au focus de cet onglet. Une **bulle** « vous attend » se pose au-dessus de l'avatar avec le dernier message de l'agent et un bouton **Aller**. Tant qu'un agent **travaille**, un **arc cyan tournant** entoure l'avatar (et l'onglet concerné, et la pile d'un groupe replié) ; l'attente reste prioritaire. L'arc est piloté par les hooks Claude Code `UserPromptSubmit` et `PostToolUse` (allumage) puis `Stop`, `Notification` et `SessionEnd` (extinction) ; Échap ou `Ctrl+C` tapés dans l'onglet l'éteignent aussi (aucun hook ne signale une interruption), et il s'éteint seul après 2 min sans sortie du terminal.
- **Mosaïque des agents** (`Ctrl+Shift+M`, ou le bouton du dock) : une tuile par espace, rangées par groupe et filtrables, avec l'état de l'agent et les dernières lignes de son terminal. Choisir une tuile (clic, flèches + `Entrée`) ouvre son terminal ; `Échap` revient à l'espace actif.
- **Palette de commandes** (`Ctrl K`, ou le bouton du dock) : recherche floue dans les espaces (ceux qui vous attendent en tête), les onglets et les actions de l'app, chacune avec son raccourci. `Entrée` exécute, `Échap` ferme et rend la main au terminal.
- **Fichiers modifiés** (`Ctrl+Shift+D`, ou le bouton ± de la barre) : liste des fichiers (statut coloré, stats +/− par fichier) et diff unifié du fichier choisi, avec numéros de ligne, filtre, navigation au clavier et rappel des autres espaces qui ont des changements à relire ; `Échap` revient au terminal.
- **Notifications agents** : capture des séquences `OSC 9 / 99 / 777` dans le flux du terminal → point d'attente sur l'onglet émetteur, halo et bulle sur l'avatar de l'espace, notification desktop D-Bus + demande d'attention de la fenêtre. Aussi déclenchables par la CLI et par un hook Claude Code ; les commandes lancées dans un onglet ciblent leur espace d'origine (`TERMINIALS_WORKSPACE_ID` injecté dans l'environnement du shell).
- **Reprise des sessions Claude Code** : à la fermeture de l'app, chaque onglet où tournait une session Claude Code la retrouve au relancement, comme dans cmux. L'onglet rouvre dans le dossier de la session et son shell lance `claude --resume <id>`, si bien que quitter Claude rend la main au shell. La session est signalée par les hooks Claude Code `SessionStart` et `SessionEnd` (installés par `terminials hooks setup` ou Paramètres › Agents). Une session quittée volontairement (`/exit`, `Ctrl+D`, `/logout`) n'est pas reprise, une session tuée par la fermeture de l'app l'est. Les sessions `claude -p` sont ignorées. Si le dossier d'une session a disparu, l'onglet repart sans reprise.
- **Images & fichiers dans le prompt de l'agent** : `Ctrl+V` colle une image du presse-papier directement dans Claude Code (qui la lit via `xclip`, cf. Prérequis) ; `Ctrl+Shift+V` avec une image au presse-papier l'écrit dans `$TMPDIR/terminials-images/` et injecte son chemin dans le terminal ; un glisser-déposer de fichiers injecte leurs chemins (quotés) dans le terminal survolé. Sans image au presse-papier, `Ctrl+Shift+V` reste le collage texte du terminal.
- **CLI + socket Unix** (`$XDG_RUNTIME_DIR/terminials.sock`, JSON-par-ligne) pour scripter l'app.
- **Activité** (`Ctrl+Shift+H`, ou le bouton du dock) : vue globale (pas liée à un espace) de ce qui a été fait — commits, prompts et sessions Claude Code, commandes shell, changements ClickUp — en deux onglets : le **récap** (chiffres du jour ou de la semaine, rythme empilé par projet, bilan par projet, réunions, temps à saisir) et la **chronologie** détaillée, filtrable. Le bilan quotidien et le bilan hebdomadaire sont rédigés **uniquement par le CLI `claude -p` local** (modèle sonnet, aucun appel HTTP, aucune clé à configurer), automatiquement à 07:00 les jours ouvrés ou à la demande (« Rédiger le bilan » / « Régénérer ») ; une pastille sur le bouton Activité du dock signale un bilan fraîchement rédigé. Les réglages (planification, ClickUp, tickets, etc.) se configurent dans Paramètres › Activité (le bouton ⚙ du récap y mène) et sont persistés dans `~/.config/terminials/settings.json`. L'intégration shell (captation des commandes bash/zsh) ne voit que la **première commande simple** d'une ligne composée (pipes/`&&`/`;` non décomposés) — une limite assumée plutôt qu'un parseur shell complet. Elle ignore aussi les lignes de commande **très longues** : le marqueur OSC transporte la commande en base64 sous une borne de 4 096 octets, soit environ **3 000 caractères** de ligne de commande, au-delà desquels la commande n'apparaît pas dans la chronologie. La synthèse hebdomadaire est produite **le lundi** pour la semaine écoulée (et rangée sous la date de ce lundi), afin de couvrir le vendredi précédent.
- **Paramètres** (`Ctrl+Shift+,`, ou l'icône à droite de la barre du haut) : apparence (accent, densité du dock, réduire les animations), terminal (police, taille, shell, dossier de départ, défilement, copier à la sélection, reprise des sessions), agents et notifications (hooks Claude Code installables en un clic, notification système, bulle, son), superviseur, activité, raccourcis (générés depuis la table de l'app) et à propos. Recherche avec compteurs par section ; la palette trouve aussi chaque réglage. Tout s'applique en direct et s'enregistre dans le même `~/.config/terminials/settings.json` (clé `app`, fichier 0600, écriture atomique) ; une valeur illisible dans le fichier reprend son défaut sans faire perdre le reste.
- **Superviseur** (`Ctrl+Shift+Espace`, ou sa marque à gauche du dock) : un agent qui veille sur tous les espaces, dans un panneau à droite (la zone terminal lui laisse la place). Il dit où en sont vos agents, range les espaces, et fait passer une question d'une session à l'autre (un agent tape `terminials demander api "…"`). **Désactivé par défaut** : tant qu'il n'est pas activé dans Paramètres › Superviseur, ou pendant une pause, aucun processus ne tourne et aucun jeton n'est consommé. Activé, c'est une session du CLI `claude` local (`claude -p --output-format stream-json`, reprise par `--resume`), réveillée quand un agent attend ou termine et quand vous lui écrivez — réveils regroupés (4 s), espacés (30 s mini) et plafonnés (20 tours automatiques par heure), un seul tour à la fois. Son seul outil est la CLI `terminials` ; ses hooks et serveurs MCP sont coupés. Trois niveaux d'autonomie : **Observer** (lire, prévenir), **Réorganiser** (+ créer, renommer, ranger, fermer un espace inactif, ouvrir un onglet, afficher un espace), **Agir** (+ écrire dans une session, toujours après validation). Les écritures en attente forment une pile de cartes « À valider » qui montrent le texte exact (`Ctrl+Entrée` autorise celle du dessus).

### Garde-fou du superviseur

Le niveau d'autonomie est appliqué par le code de l'app, jamais par la seule consigne donnée au modèle :

- **Origine décidée par l'app** : la CLI joint le jeton de 128 bits que l'app ne remet qu'au `claude` du superviseur (variable d'environnement, jamais écrite ni montrée). Sans ce jeton, un appel vient d'un terminal d'espace ou de l'extérieur : il n'a droit qu'aux outils d'observation et à `demander`. Créer, ranger, écrire sont réservés au superviseur.
- **Chaque appel passe par une seule porte** (`src/lib/gardeFou.ts`) : désactivé ou en pause, tout est refusé ; puis la classe de l'outil est comparée au niveau. Écrire dans une session demande le niveau Agir **et** votre validation, sauf un échange (question transmise, réponse rendue) entre deux espaces que vous avez autorisés à échanger sans validation. Une session bloquée sur une demande d'autorisation de Claude Code ne reçoit jamais rien sans votre accord, paire autorisée ou non. Un espace où un agent travaille ou attend n'est pas fermé.
- **Revérifié au clic** : « Autoriser » repasse par le garde-fou (niveau baissé ou pause entre-temps : rien n'est écrit) ; une carte dont l'onglet a disparu est annulée.
- Le socket n'a aucune méthode qui écrive dans un terminal : seul le front écrit dans un PTY, après le garde-fou. Le superviseur n'a pas accès aux méthodes historiques (`notify`, `new-workspace`…) ni à `terminials hooks setup`.

Hors périmètre : splits (la grille 1→4 a été remplacée par les onglets), navigateur intégré.

## Installation depuis une release (sans build)

Chaque tag `v*` publie sur [les releases GitHub](https://github.com/ThomasSatory/terminials/releases) un `.deb` (GUI `terminials-app` + CLI `terminials`) et une archive des deux binaires bruts, buildés sous Ubuntu 22.04 :

```bash
sudo apt install ./terminials_<version>_amd64.deb   # installe aussi les dépendances (webkit2gtk…)
```

Pour publier une version : monter `version` dans `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml` et `package.json`, puis `git tag v<version> && git push origin v<version>`.

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
   - Installe le hook Claude Code : `terminials hooks setup` (il déclare lui-même les events Stop,
     Notification, SessionStart, SessionEnd, UserPromptSubmit et PostToolUse dans
     ~/.claude/settings.json, sans toucher au reste), puis vérifie avec `terminials hooks etat`.

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
  de `notify-rust` échouent silencieusement. Le point sur l'onglet, le halo et la bulle sur
  l'avatar du dock continuent de fonctionner — seul le toast système manque (installer `dunst` ou équivalent
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
| `terminials claude-session --session-id ID [--cwd D] [--ended]` | Retient (ou oublie) la session Claude de l'onglet, appelé par le hook |
| `terminials notify … --attente autorisation\|question\|fin` | Dit pourquoi l'agent s'arrête (le hook l'ajoute) : une demande d'autorisation bloque la session pour le superviseur |
| `terminials hooks setup` / `terminials hooks etat` | Installe le script de hook et déclare ses six événements dans `~/.claude/settings.json` (sans toucher au reste, original sauvegardé) / en donne l'état |
| `terminials busy` / `terminials idle` | Allume / éteint l'indicateur « au travail » de l'onglet courant |

Outils du superviseur, aussi utilisables depuis un terminal d'espace dans la limite du garde-fou (sortie lisible, ou `--json` pour la donnée brute ; code 1 sur un refus). Un espace se désigne par son id, son nom ou un début de nom unique ; un onglet par son id, son titre ou son rang.

| Commande | Classe | Effet |
|---|---|---|
| `terminials espaces [espace]` | observer | Espaces, onglets et état de leurs agents |
| `terminials lire <espace> [--onglet O] [--lignes N]` | observer | Dernières lignes du terminal (40 par défaut, 200 au plus) |
| `terminials prevenir "<texte>" [--titre T] [--espace E]` | observer | Prévient l'utilisateur (fil du superviseur, notification) |
| `terminials demander [<espace>] "<question>"` | observer | Depuis un terminal d'espace : pose une question à un autre espace, ou au superviseur sans espace |
| `terminials creer --dossier D [--nom N] [--groupe G] [--couleur C]` | réorganiser | Crée un espace |
| `terminials renommer <espace> <nom>` | réorganiser | Renomme un espace |
| `terminials deplacer <espace> [--groupe G \| --hors-groupe] [--position N]` | réorganiser | Range un espace |
| `terminials fermer <espace>` | réorganiser | Ferme un espace (refusé si un agent y travaille ou attend) |
| `terminials groupe <nom> [--couleur C] [--espaces a,b]` | réorganiser | Crée un groupe et y range des espaces |
| `terminials onglet <espace> [--dossier D]` | réorganiser | Ouvre un onglet |
| `terminials aller <espace> [--onglet O]` | réorganiser | Affiche un espace |
| `terminials ecrire <espace> "<texte>" [--onglet O] [--sans-entree] --pourquoi P` | écrire | Écrit dans un terminal (carte « À valider ») |
| `terminials transmettre <echange> "<texte>" --pourquoi P` | écrire | Transmet la question d'un échange à l'espace interrogé |
| `terminials repondre <echange> "<texte>" --pourquoi P` | écrire | Rend la réponse d'un échange à l'espace qui a demandé |

Notifications depuis un terminal (sans la CLI), via séquences OSC :

```bash
printf '\e]777;notify;Titre;Corps du message\a'   # OSC 777 (RXVT)
printf '\e]9;Tache terminee\a'                      # OSC 9 (iTerm2)
```

## Raccourcis

Couche `Ctrl+Shift` (convention gnome-terminal), matching par touche physique (`e.code`, compatible AZERTY), dans une table unique (`src/lib/shortcuts.ts`) que la palette relit pour afficher ses raccourcis. Un seul `Ctrl+lettre` nu est intercepté, `Ctrl+K` (palette) — `Ctrl+N/T/W…` vont au shell (readline intact) — et `Ctrl+Shift+C/V` restent le copier/coller du terminal.

| Raccourci | Action |
|---|---|
| `Ctrl+K` | Ouvrir/fermer la palette de commandes |
| `Ctrl+Shift+N` | Nouvel espace : popover nom, dossier, couleur, groupe ancré au dock |
| `Ctrl+Shift+O` | Ouvrir un dossier (nouvel espace) |
| `Ctrl+Shift+Entrée` | Nouvel espace sur `~`, sans formulaire |
| `Ctrl+Shift+T` | Nouvel onglet terminal, dans le dossier du terminal actif |
| `Ctrl+Shift+W` | Fermer l'onglet actif (le dernier ferme l'espace) |
| `Ctrl+Shift+Q` | Fermer l'espace actif |
| `Ctrl+Shift+R` | Modifier l'espace actif (nom, dossier, couleur, groupe) |
| `Ctrl+Shift+D` | Ouvrir/fermer les fichiers modifiés |
| `Ctrl+Shift+M` | Ouvrir/fermer la mosaïque des agents (referme l'activité et les fichiers modifiés) |
| `Ctrl+Shift+H` | Ouvrir/fermer l'activité (récap et chronologie) |
| `Ctrl+Shift+B` | Afficher/masquer le dock |
| `Ctrl+Shift+,` | Ouvrir/fermer les Paramètres |
| `Ctrl+Shift+Espace` | Ouvrir/fermer le panneau du superviseur (désactivé : ouvre son réglage) |
| `Ctrl+Shift+G` | Nouveau groupe (nom + couleur, ancré au dock) |
| `Ctrl+Shift+E` | Replier/déplier le groupe de l'espace actif |
| `Ctrl+Shift+PageUp` / `Ctrl+Shift+PageDown` | Déplacer l'onglet actif dans la barre (sans wrap) |
| `Ctrl+Shift+↑` / `Ctrl+Shift+↓` | Déplacer l'espace actif dans son groupe (sans wrap) |
| `Ctrl+PageUp` / `Ctrl+PageDown` | Espace précédent / suivant (ordre du dock, groupes repliés sautés), terminal affiché |
| `Ctrl+1` … `Ctrl+9` | Aller à l'espace n (ordre du dock), terminal affiché |
| `Alt+←` / `Alt+→` | Onglet précédent / suivant |
| `Échap` | Ferme le calque ou la vue qui a le focus (palette, popover, menu, panneau du superviseur, Paramètres, mosaïque, fichiers modifiés, activité), un seul à la fois, et rend la saisie à ce qui est dessous ; jamais intercepté dans le terminal, où il appartient à l'agent |
| `Ctrl+Entrée` | Dans le panneau du superviseur : autorise la carte « À valider » du dessus |

Conflits assumés : `Ctrl+K` (kill-line de readline), `Ctrl+PageUp/Down` (navigation de fenêtres tmux) et `Ctrl+2..8` (codes de contrôle rarissimes) sont capturés par l'app.

`Ctrl+V` n'est pas un raccourci de l'app : xterm l'envoie tel quel (`\x16`) au PTY, ce qui est exactement ce qu'attend Claude Code pour aller lire l'image du presse-papier avec `xclip`. Le collage d'image sur `Ctrl+Shift+V` ne dévie pas la touche non plus : il se branche sur l'event `paste` et ne s'active que si le presse-papier contient une image.

## Architecture

Workspace Cargo : `src-tauri` (app Tauri), `crates/protocol` (types socket partagés, outils et leurs classes), `crates/cli` (binaire `terminials`), `crates/core` (logique pure OSC/git/ports, réglages, hooks, moteur du superviseur, testable sans GUI).

Chaîne du superviseur : moteur (`crates/core/src/superviseur`, branché par `src-tauri/src/superviseur.rs`) → `claude -p` → CLI `terminials <outil>` → socket (`src-tauri/src/socket.rs`, qui décide l'origine) → pont (`src-tauri/src/pont.rs`, événement `outil-requete`) → front (`src/lib/executeurSuperviseur.ts` : garde-fou, exécution ou carte « À valider ») → `outil_repondre` → sortie de la CLI. Les tests la parcourent avec un faux `claude` (script shell, aucun jeton) : `crates/cli/tests/superviseur_bout_en_bout.rs` côté processus, `src/lib/chaineSuperviseur.test.tsx` côté front. Front React dans `src/`. Voir `docs/superpowers/specs/` et `docs/superpowers/plans/`.
