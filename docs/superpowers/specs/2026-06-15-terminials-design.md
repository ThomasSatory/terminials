# terminials — Design

> Un terminal desktop pour Linux pensé pour faire tourner des agents de code (Claude Code & co) en parallèle, inspiré de [cmux](https://cmux.com) (terminal macOS de manaflow-ai). « terminials » = clone Linux homemade.

**Date** : 2026-06-15
**Statut** : design validé, prêt pour le plan d'implémentation
**Auteur** : ThomasSatory

---

## 1. Objectif & cadrage

### But
Outil **quotidien personnel** : devenir le terminal principal pour bosser avec des agents de code en parallèle sur Linux. Priorité à la fiabilité et aux fonctionnalités qui servent réellement, pas à la parité exhaustive avec cmux.

### Le problème que ça résout
Quand on lance plusieurs agents (Claude Code, Codex…) en parallèle, on perd le fil : on ne sait pas lequel attend une entrée, lequel a fini, lequel est bloqué. Les notifications génériques (« Claude is waiting for your input ») et les titres d'onglets qui se ressemblent rendent le suivi pénible. terminials rend le travail des agents **observable** : sidebar de workspaces avec métadonnées git, anneaux visuels + badges quand un agent attend, notifications desktop ciblées.

### Cible technique (machine de dev)
- Ubuntu GNOME, **session X11**
- GPU **Intel Iris Xe** (pas de NVIDIA → WebGL xterm.js OK, pas de workarounds DMABUF nécessaires)
- Node 21.7, `claude` CLI installé
- À vérifier au build : `libwebkit2gtk-4.1-dev` (requis Tauri v2, probablement absent)

### Hors périmètre v1 (explicite)
- ❌ Tabs (« surfaces ») à l'intérieur des panes
- ❌ Navigateur intégré scriptable
- ❌ Session restore / relance auto de `claude --resume`
- ❌ Diff viewer, command palette, workspace groups, SSH, browser automation
- ❌ Multi-fenêtres

Ces fonctionnalités sont des candidates v2+ mais ne doivent pas influencer l'architecture v1 au-delà de laisser des points d'extension propres.

---

## 2. Stack technique

| Couche | Choix | Justification |
|---|---|---|
| Shell desktop | **Tauri v2** (2.11.x) | RAM faible, app native Linux, front web |
| Front | **React 19** + TypeScript + Vite | Stack demandée par l'utilisateur |
| Terminal | **xterm.js 6.x** + `@xterm/addon-webgl` + `@xterm/addon-fit` | Standard de fait ; WebGL OK sur Intel |
| PTY | **portable-pty 0.9** (wezterm) | Seul crate avec écosystème Tauri prouvé |
| Transport PTY→front | **`tauri::ipc::Channel<InvokeResponseBody::Raw>`** | Events Tauri inadaptés au débit (JSON) ; les Channels sont le mécanisme interne de Tauri pour la sortie de process |
| Socket / IPC externe | **`tokio::net::UnixListener`**, JSON-par-ligne | Dans `$XDG_RUNTIME_DIR` |
| Notifications | **`notify-rust 4.17`** (D-Bus) + `request_user_attention` | Urgency Critical + urgency hint X11 |
| Splits (UI) | **Allotment** | Lib utilisée par ptrcode (seul clone cmux Tauri) |
| État front | **Zustand** | Arbre de panes + métadonnées sidebar |
| Git/ports | `git` CLI (ou `git2`) + lecture `/proc` | Poller léger |

### Renderer xterm.js — stratégie
xterm 6 n'offre que **webgl** ou **dom** (le renderer canvas a été supprimé en 6.0.0). Sur Intel Iris Xe, WebGL est le défaut. Fallback : try/catch à l'init de `@xterm/addon-webgl`, écoute de `onContextLoss` → `dispose()` de l'addon → bascule sur le renderer DOM. Pas de variable d'environnement WebKit à positionner (réservé aux cas NVIDIA, non applicable ici).

---

## 3. Architecture — 4 couches isolées

```
┌──────────────────────────────────────────────────────────────┐
│  Renderer (React + xterm.js)                                   │
│  ┌────────────┐  ┌──────────────────────────────────────────┐ │
│  │ Sidebar    │  │ Zone principale : splits (Allotment)      │ │
│  │ workspaces │  │  ┌────────┐ ┌────────┐                    │ │
│  │ - branche  │  │  │ pane   │ │ pane   │  ← anneau si notif  │ │
│  │ - cwd      │  │  │ xterm  │ │ xterm  │                    │ │
│  │ - ports    │  │  └────────┘ └────────┘                    │ │
│  │ - badges   │  └──────────────────────────────────────────┘ │
│  └────────────┘   État : Zustand (workspace-store)             │
└───────────▲────────────────────────▲──────────────────────────┘
            │ Channel (octets bruts)  │ events (notif, git, status)
┌───────────┴────────────────────────┴──────────────────────────┐
│  Backend Rust (src-tauri)                                       │
│  ┌──────────────┐ ┌───────────────┐ ┌────────────────────────┐ │
│  │ PTY manager  │ │ OSC parser    │ │ Git/Port poller        │ │
│  │ portable-pty │ │ 9/99/777      │ │ git CLI + /proc        │ │
│  └──────────────┘ └───────────────┘ └────────────────────────┘ │
│  ┌────────────────────────────────────────────────────────────┐│
│  │ Socket server : UnixListener (XDG_RUNTIME_DIR/terminials.sock)││
│  │ JSON-par-ligne → dispatch → emit vers front (+ buffer)       ││
│  └────────────────────────────────────────────────────────────┘│
│  ┌────────────────────────────────────────────────────────────┐│
│  │ Notifications : notify-rust + request_user_attention         ││
│  └────────────────────────────────────────────────────────────┘│
└───────────▲────────────────────────────────────────────────────┘
            │ JSON-par-ligne
┌───────────┴────────────────────┐
│  CLI `terminials` (crates/cli) │  ← appelée par hooks Claude Code,
│  clap → UnixStream             │     scripts, l'utilisateur
└────────────────────────────────┘
```

### Workspace Cargo
```
terminials/
├── Cargo.toml                  # [workspace] members
├── src-tauri/                  # app Tauri (GARDER le bin ici — déplacer casse `tauri dev`)
│   ├── Cargo.toml
│   ├── tauri.conf.json
│   └── src/
│       ├── main.rs
│       ├── pty.rs              # PTY manager + thread lecteur → Channel
│       ├── osc.rs             # parser OSC 9/99/777
│       ├── socket.rs           # UnixListener + dispatch
│       ├── notify.rs           # notify-rust + request_user_attention
│       └── git.rs              # poller branche/cwd/ports
├── crates/
│   ├── protocol/               # types serde partagés (messages socket)
│   └── cli/                     # binaire clap `terminials`
└── src/                         # front React (Vite)
    ├── store/                   # Zustand workspace-store
    ├── components/              # Sidebar, PaneTree, TerminalPane…
    └── lib/                     # bridge Channel ↔ xterm
```

---

## 4. Flux de données détaillés

### 4.1 PTY → terminal
1. Front demande un nouveau pane → commande Tauri `spawn_pty(workspace_id, cwd, shell)`.
2. Backend : `portable-pty` ouvre un PTY, lance le shell. Un **thread lecteur bloquant** (`try_clone_reader`) lit les chunks.
3. Chaque chunk part vers le front via `Channel<InvokeResponseBody::Raw(bytes)>` (octets bruts, pas de JSON).
4. Front : `channel.onmessage → term.write(Uint8Array)`, **batché à ~16ms** (1 frame) pour éviter le layout thrashing.
5. Saisie : `term.onData → invoke('write_pty', { id, data })`.
6. Resize : `FitAddon` au resize du pane → `invoke('resize_pty', { id, cols, rows })`.
7. **Flow control** : callbacks de write xterm tous les ~100KB ; si watermark haut (~500KB) atteint, pause du reader Rust, resume après drain. Protège contre `cat bigfile` (xterm plafonne à 5–35 MB/s en parsing).

### 4.2 Notifications agents (cœur du produit)
Trois déclencheurs convergent vers un même pipeline :
- **OSC dans le flux PTY** : le parser repère `OSC 9` (iTerm2), `OSC 99` (Kitty, avec id/titre/corps), `OSC 777;notify;titre;corps` (RXVT). Le parser tape le flux *avant* `term.write` (côté Rust, dans le thread lecteur, ou via un addon xterm `parser.registerOscHandler`).
- **CLI** : `terminials notify --title … --body …` via socket.
- **Hook Claude Code** : script `~/.claude/hooks/terminials-notify.sh` qui lit l'event JSON sur stdin (`hook_event_name` `Stop`/`Notification`) et appelle la CLI.

Pipeline unique → état `notification{ workspace_id, pane_id, title, body, read: false }` :
1. **Anneau visuel** autour du pane émetteur (bordure colorée).
2. **Badge non-lu** sur l'entrée de sidebar du workspace.
3. **Notification desktop** D-Bus via `notify-rust` (urgency `Critical`, `replace_id` pour ne pas spammer).
4. **`request_user_attention(Critical)`** : sous GNOME X11 → urgency hint (notification « Window is ready » + surbrillance dash). Couplé à la notif D-Bus car GNOME n'a pas de taskbar clignotante.
5. **Auto-dismiss** : `read = true` quand la fenêtre est focus **et** le pane émetteur a le focus.

Suppression : pas de notif desktop si la fenêtre terminials a déjà le focus sur le pane émetteur.

### 4.3 Sidebar git / ports
- **Poller Rust** par workspace, toutes les ~2s : `git rev-parse --abbrev-ref HEAD` (branche), `git status --porcelain` (dirty), cwd courant du pane (via `/proc/<pid>/cwd`).
- **Ports** : process tree du PTY (`/proc/<pid>/task/*/children` récursif) croisé avec `/proc/net/tcp` (sockets LISTEN) pour lister les ports ouverts par les enfants.
- Émis vers le front par events Tauri (faible débit, JSON acceptable ici).

### 4.4 Socket / CLI
- **Serveur** : dans le `.setup()` hook, `tauri::async_runtime::spawn` (= tokio) bind `$XDG_RUNTIME_DIR/terminials.sock`. Avant bind : tenter `connect()` (instance vivante ?), sinon `remove_file` puis `bind`. Nettoyage sur `RunEvent::Exit`. Sert aussi de garde **single-instance**.
- **Protocole** : une requête JSON par ligne `{ "method": "...", "params": {...} }`, réponse JSON par ligne. Types dans `crates/protocol`.
- **Méthodes v1** : `new-workspace`, `list-workspaces`, `send` (texte), `send-key`, `read-screen`, `notify`, `set-status` (pill), `set-progress`, `ping`, `capabilities`.
- **Buffer** : si le front n'est pas encore monté quand un message arrive, bufferiser dans un state Rust ; le front fait un « pull » initial au montage.
- **CLI** (`crates/cli`) : clap, ouvre `UnixStream`, écrit `to_string(&msg) + "\n"`, lit la réponse. Symlinkée/installée dans le PATH.

---

## 5. Gestion des erreurs
- **PTY mort** : le thread lecteur détecte EOF/erreur → émet `pty-exit{ id, code }` → front marque le pane fermé, propose réouverture.
- **WebGL context lost** : `onContextLoss` → fallback DOM, log, pas de crash.
- **Socket déjà pris** : connect-test puis remove ; si une instance vit, refuser le second lancement proprement (single-instance).
- **CLI sans serveur** : si le socket n'existe pas / refuse, la CLI sort en erreur claire (exit ≠ 0), le hook Claude Code sort silencieusement (`[ -S "$SOCK" ] || exit 0`).
- **git absent** (cwd hors repo) : sidebar masque la branche, pas d'erreur.

---

## 6. Tests
- **Rust** : tests unitaires du parser OSC (vecteurs 9/99/777, cas malformés), du framing JSON-par-ligne du protocole, de la logique single-instance (connect-then-bind).
- **Protocole** : round-trip serde des messages (`protocol` crate).
- **CLI ↔ socket** : test d'intégration qui lance un faux serveur socket et vérifie l'aller-retour des méthodes.
- **Front** : tests du `workspace-store` Zustand (ajout/split/fermeture de pane, marquage notif lue), du bridge Channel→xterm (mock de Channel).
- **Manuel / smoke** : lancer un `claude` dans un pane, vérifier anneau + badge + notif desktop quand il attend ; `cat` d'un gros fichier pour valider le flow control.

---

## 7. Séquence de build suggérée (pour le plan)
1. Squelette workspace Cargo + Tauri + Vite/React qui démarre (fenêtre vide, `libwebkit2gtk-4.1-dev` installé).
2. PTY single-pane : spawn shell, Channel raw → xterm WebGL, saisie + resize + flow control.
3. Multi-pane : splits Allotment + store Zustand + sidebar workspaces basique.
4. Socket server + crate protocol + CLI minimale (`ping`, `new-workspace`, `send`).
5. Parser OSC + pipeline notifications (anneau, badge, D-Bus, attention).
6. Sidebar git/ports (poller) + status pills / progress via CLI.
7. Hook Claude Code (`terminials hooks setup`) + polish.

---

## 8. Décisions tranchées
- **Tauri v2 + React** (vs Electron) — demandé par l'utilisateur ; RAM plus faible.
- **Channel raw** (vs events/WebSocket) — débit + sécurité (pas de port ouvert).
- **Allotment** (vs arbre custom) — réutilise le précédent ptrcode, moins de code.
- **portable-pty** (vs pty-process) — garde la porte cross-platform, écosystème Tauri prouvé.
- **v1 = socle + notifs + CLI** — pas de tabs/browser/session-restore.
- **Nom** : `terminials`.
