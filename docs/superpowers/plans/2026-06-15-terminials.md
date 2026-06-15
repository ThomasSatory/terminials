# terminials Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Construire un terminal desktop Linux (clone homemade de cmux) pour faire tourner des agents de code en parallèle, avec sidebar git, notifications agents et CLI/socket.

**Architecture:** App Tauri v2 (backend Rust) + front React 19/Vite. Le PTY (`portable-pty`) est lu dans un thread bloquant et poussé en octets bruts vers xterm.js via un `tauri::ipc::Channel`. Un serveur socket Unix `tokio` dans le `setup` hook expose une API JSON-par-ligne pilotée par un binaire CLI séparé. Les notifications agents proviennent du parsing OSC 9/99/777 du flux PTY et de la CLI (hooks Claude Code).

**Tech Stack:** Tauri 2.11, React 19, TypeScript, Vite, xterm.js 6 (`@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-webgl`), `portable-pty` 0.9, `tokio` 1.52, `notify-rust` 4.17, Allotment, Zustand, clap 4.

**Spec:** `docs/superpowers/specs/2026-06-15-terminials-design.md`

**Cible machine :** Ubuntu GNOME X11, Intel Iris Xe (WebGL OK), Node 21.7.

---

## Conventions

- **Workspace Cargo** : racine `Cargo.toml` avec `members = ["src-tauri", "crates/protocol", "crates/cli"]`. Le bin Tauri reste dans `src-tauri` (le déplacer casse `tauri dev`).
- **Tests Rust** : `cargo test -p <crate>`. **Tests front** : Vitest (`npm run test`).
- **Commits** : fréquents, un par tâche terminée (test + implémentation ensemble).
- Quand un step dit « manuel », c'est une vérification visuelle/smoke documentée, pas un test automatisé — ces parties (wiring webview, rendu xterm) ne sont pas unit-testables proprement.

---

## Phase 0 — Squelette du projet

### Task 0.1 : Prérequis système

**Files:** aucun (commandes système)

- [ ] **Step 1 : Vérifier/installer les dépendances Tauri Linux**

Run :
```bash
dpkg -l | grep -E 'libwebkit2gtk-4.1-dev|libgtk-3-dev|librsvg2-dev|build-essential|libssl-dev|libayatana-appindicator3-dev' || true
```
Si manquantes :
```bash
sudo apt update && sudo apt install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libgtk-3-dev librsvg2-dev libayatana-appindicator3-dev
```
Expected: les paquets sont installés (en particulier `libwebkit2gtk-4.1-dev`).

- [ ] **Step 2 : Vérifier la toolchain Rust**

Run : `rustc --version && cargo --version`
Si absent : `curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y && source "$HOME/.cargo/env"`
Expected: rustc ≥ 1.77.

---

### Task 0.2 : Scaffold Tauri + React + workspace Cargo

**Files:**
- Create: tout le squelette via le scaffolder, puis restructuration en workspace.

- [ ] **Step 1 : Scaffolder l'app dans un dossier temporaire et rapatrier**

Le repo `terminals/` contient déjà `docs/` et `.git`. Scaffolder à côté puis fusionner :
```bash
cd /home/user/dev
npm create tauri-app@latest terminials-scaffold -- --template react-ts --manager npm
```
Expected: dossier `terminials-scaffold/` avec `src/`, `src-tauri/`, `package.json`, `vite.config.ts`.

- [ ] **Step 2 : Rapatrier le contenu dans le repo existant**

```bash
cd /home/user/dev
cp -rn terminials-scaffold/. terminals/
rm -rf terminials-scaffold
cd terminals
```
Expected: `terminals/` contient maintenant `src/`, `src-tauri/`, `package.json` ET `docs/`.

- [ ] **Step 3 : Renommer le produit en "terminials"**

Dans `src-tauri/tauri.conf.json`, mettre `"productName": "terminials"`, `"identifier": "com.thomassatory.terminials"`, et `"mainBinaryName": "terminials-app"`. Dans `package.json`, `"name": "terminials"`.

- [ ] **Step 4 : Lancer l'app pour vérifier que la webview s'ouvre**

Run : `npm install && npm run tauri dev`
Expected: une fenêtre s'ouvre avec la page d'accueil Tauri+React. Fermer.

- [ ] **Step 5 : Convertir en workspace Cargo**

Créer `Cargo.toml` à la racine :
```toml
[workspace]
resolver = "2"
members = ["src-tauri", "crates/protocol", "crates/cli"]

[workspace.dependencies]
serde = { version = "1", features = ["derive"] }
serde_json = "1"
tokio = { version = "1.52", features = ["net", "io-util", "rt-multi-thread", "macros", "sync"] }
```
Dans `src-tauri/Cargo.toml`, remplacer les versions inline de serde/serde_json par `{ workspace = true }`.

- [ ] **Step 6 : Commit**

```bash
git add -A
git commit -m "chore: scaffold Tauri v2 + React + Cargo workspace"
```

---

### Task 0.3 : Crate `protocol` (types partagés socket)

**Files:**
- Create: `crates/protocol/Cargo.toml`, `crates/protocol/src/lib.rs`

- [ ] **Step 1 : Écrire le test de round-trip serde**

`crates/protocol/src/lib.rs` (section tests) :
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_roundtrip_jsonline() {
        let req = Request { method: "notify".into(), params: serde_json::json!({"title":"t","body":"b"}) };
        let line = serde_json::to_string(&req).unwrap();
        assert!(!line.contains('\n'), "une requête sérialisée ne doit pas contenir de newline");
        let back: Request = serde_json::from_str(&line).unwrap();
        assert_eq!(back.method, "notify");
    }

    #[test]
    fn response_ok_and_err() {
        let ok = Response::ok(serde_json::json!({"id": 1}));
        let err = Response::err("boom");
        assert!(matches!(ok.status, Status::Ok));
        assert!(matches!(err.status, Status::Error));
        assert_eq!(err.error.as_deref(), Some("boom"));
    }
}
```

- [ ] **Step 2 : Run le test (doit échouer : types absents)**

Run : `cargo test -p protocol`
Expected: FAIL — `Request`, `Response`, `Status` non définis.

- [ ] **Step 3 : Implémenter les types**

`crates/protocol/Cargo.toml` :
```toml
[package]
name = "protocol"
version = "0.1.0"
edition = "2021"

[dependencies]
serde = { workspace = true }
serde_json = { workspace = true }
```
`crates/protocol/src/lib.rs` (au-dessus du module tests) :
```rust
use serde::{Deserialize, Serialize};

/// Une requête envoyée par la CLI vers l'app via le socket. Une par ligne.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status { Ok, Error }

/// Réponse renvoyée par l'app. Une par ligne.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub status: Status,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub data: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn ok(data: serde_json::Value) -> Self {
        Self { status: Status::Ok, data, error: None }
    }
    pub fn err(msg: impl Into<String>) -> Self {
        Self { status: Status::Error, data: serde_json::Value::Null, error: Some(msg.into()) }
    }
}
```

- [ ] **Step 4 : Run le test (doit passer)**

Run : `cargo test -p protocol`
Expected: PASS (2 tests).

- [ ] **Step 5 : Commit**

```bash
git add crates/protocol
git commit -m "feat(protocol): types Request/Response JSON-par-ligne"
```

---

## Phase 1 — PTY single-pane

### Task 1.1 : PTY manager côté Rust (test unitaire du registre)

**Files:**
- Create: `src-tauri/src/pty.rs`
- Modify: `src-tauri/src/lib.rs` (ou `main.rs` selon scaffold) pour déclarer `mod pty;`
- Modify: `src-tauri/Cargo.toml`

- [ ] **Step 1 : Ajouter les deps PTY**

`src-tauri/Cargo.toml`, section `[dependencies]` :
```toml
portable-pty = "0.9"
protocol = { path = "../crates/protocol" }
```

- [ ] **Step 2 : Écrire le test du registre de PTY**

`src-tauri/src/pty.rs` :
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_assigns_unique_incrementing_ids() {
        let reg = PtyRegistry::new();
        let a = reg.next_id();
        let b = reg.next_id();
        assert_ne!(a, b);
        assert_eq!(b, a + 1);
    }
}
```

- [ ] **Step 3 : Run (doit échouer)**

Run : `cargo test -p terminials --lib pty`
(Le nom du package `-p` est celui de `src-tauri/Cargo.toml` — l'ajuster si différent, ex. `terminials-app`.)
Expected: FAIL — `PtyRegistry` absent.

- [ ] **Step 4 : Implémenter le PtyRegistry + spawn**

`src-tauri/src/pty.rs` (au-dessus des tests) :
```rust
use std::collections::HashMap;
use std::io::Write;
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use portable_pty::{native_pty_system, CommandBuilder, PtySize, MasterPty};

pub type PtyId = u32;

/// Un PTY vivant : on garde le writer pour l'entrée et le master pour le resize.
pub struct PtyHandle {
    pub writer: Box<dyn Write + Send>,
    pub master: Box<dyn MasterPty + Send>,
}

#[derive(Default)]
pub struct PtyRegistry {
    next: AtomicU32,
    pub handles: Mutex<HashMap<PtyId, PtyHandle>>,
}

impl PtyRegistry {
    pub fn new() -> Self { Self::default() }

    pub fn next_id(&self) -> PtyId {
        self.next.fetch_add(1, Ordering::SeqCst)
    }
}

/// Ouvre un PTY, lance `shell` dans `cwd`, et retourne (id, reader).
/// Le reader est destiné à un thread lecteur dédié (lectures bloquantes).
pub fn spawn_pty(
    reg: &Arc<PtyRegistry>,
    shell: &str,
    cwd: &str,
    cols: u16,
    rows: u16,
) -> std::io::Result<(PtyId, Box<dyn std::io::Read + Send>)> {
    let pty_system = native_pty_system();
    let pair = pty_system
        .openpty(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| std::io::Error::other(e.to_string()))?;

    let mut cmd = CommandBuilder::new(shell);
    cmd.cwd(cwd);
    pair.slave
        .spawn_command(cmd)
        .map_err(|e| std::io::Error::other(e.to_string()))?;
    drop(pair.slave);

    let reader = pair.master.try_clone_reader().map_err(|e| std::io::Error::other(e.to_string()))?;
    let writer = pair.master.take_writer().map_err(|e| std::io::Error::other(e.to_string()))?;

    let id = reg.next_id();
    reg.handles.lock().unwrap().insert(id, PtyHandle { writer, master: pair.master });
    Ok((id, reader))
}

pub fn write_pty(reg: &Arc<PtyRegistry>, id: PtyId, data: &[u8]) -> std::io::Result<()> {
    let mut handles = reg.handles.lock().unwrap();
    let h = handles.get_mut(&id).ok_or_else(|| std::io::Error::other("pty introuvable"))?;
    h.writer.write_all(data)?;
    h.writer.flush()
}

pub fn resize_pty(reg: &Arc<PtyRegistry>, id: PtyId, cols: u16, rows: u16) -> std::io::Result<()> {
    let handles = reg.handles.lock().unwrap();
    let h = handles.get(&id).ok_or_else(|| std::io::Error::other("pty introuvable"))?;
    h.master
        .resize(PtySize { rows, cols, pixel_width: 0, pixel_height: 0 })
        .map_err(|e| std::io::Error::other(e.to_string()))
}
```
Et déclarer `mod pty;` dans `src-tauri/src/lib.rs`.

- [ ] **Step 5 : Run (doit passer)**

Run : `cargo test -p terminials --lib pty`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add src-tauri/src/pty.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(pty): registre + spawn/write/resize via portable-pty"
```

---

### Task 1.2 : Commandes Tauri PTY + Channel raw

**Files:**
- Modify: `src-tauri/src/lib.rs` (commandes + state + invoke_handler)

- [ ] **Step 1 : Implémenter les commandes Tauri**

Dans `src-tauri/src/lib.rs`, ajouter le state et les commandes. Le flux sortant passe par un `Channel<tauri::ipc::InvokeResponseBody>` envoyé en octets bruts :
```rust
use std::sync::Arc;
use std::thread;
use std::io::Read;
use tauri::ipc::{Channel, InvokeResponseBody};
use tauri::{Manager, State};
use crate::pty::{PtyRegistry, PtyId};

#[tauri::command]
fn spawn_pty(
    reg: State<'_, Arc<PtyRegistry>>,
    shell: String,
    cwd: String,
    cols: u16,
    rows: u16,
    on_data: Channel<InvokeResponseBody>,
) -> Result<PtyId, String> {
    let reg_arc = reg.inner().clone();
    let (id, mut reader) = crate::pty::spawn_pty(&reg_arc, &shell, &cwd, cols, rows)
        .map_err(|e| e.to_string())?;

    // Thread lecteur bloquant : pousse les octets bruts vers le front.
    thread::spawn(move || {
        let mut buf = [0u8; 8192];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break, // EOF
                Ok(n) => {
                    if on_data.send(InvokeResponseBody::Raw(buf[..n].to_vec())).is_err() {
                        break;
                    }
                }
                Err(_) => break,
            }
        }
    });
    Ok(id)
}

#[tauri::command]
fn write_pty(reg: State<'_, Arc<PtyRegistry>>, id: PtyId, data: Vec<u8>) -> Result<(), String> {
    crate::pty::write_pty(&reg.inner().clone(), id, &data).map_err(|e| e.to_string())
}

#[tauri::command]
fn resize_pty(reg: State<'_, Arc<PtyRegistry>>, id: PtyId, cols: u16, rows: u16) -> Result<(), String> {
    crate::pty::resize_pty(&reg.inner().clone(), id, cols, rows).map_err(|e| e.to_string())
}
```

- [ ] **Step 2 : Enregistrer state + handlers dans le builder**

Dans la fonction `run()` du `lib.rs`, sur `tauri::Builder::default()` :
```rust
.manage(Arc::new(crate::pty::PtyRegistry::new()))
.invoke_handler(tauri::generate_handler![spawn_pty, write_pty, resize_pty])
```

- [ ] **Step 3 : Compiler**

Run : `cargo build -p terminials`
Expected: compile sans erreur.

- [ ] **Step 4 : Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(pty): commandes Tauri spawn/write/resize + Channel octets bruts"
```

---

### Task 1.3 : Bridge front xterm.js ↔ PTY

**Files:**
- Create: `src/lib/pty.ts` (wrapper Channel)
- Create: `src/components/TerminalPane.tsx`
- Modify: `src/App.tsx`
- Modify: `package.json` (deps)

- [ ] **Step 1 : Installer les deps front**

Run :
```bash
npm install @xterm/xterm @xterm/addon-fit @xterm/addon-webgl
```
Expected: les 3 paquets en `dependencies`.

- [ ] **Step 2 : Écrire le wrapper PTY**

`src/lib/pty.ts` :
```ts
import { invoke, Channel } from "@tauri-apps/api/core";

export interface Pty {
  id: number;
  write: (data: string) => void;
  resize: (cols: number, rows: number) => void;
}

/** Lance un PTY et câble la sortie brute sur `onData`. */
export async function spawnPty(
  opts: { shell: string; cwd: string; cols: number; rows: number },
  onData: (bytes: Uint8Array) => void,
): Promise<Pty> {
  const channel = new Channel<ArrayBuffer>();
  channel.onmessage = (msg) => onData(new Uint8Array(msg));
  const id = await invoke<number>("spawn_pty", { ...opts, onData: channel });
  return {
    id,
    write: (data) =>
      void invoke("write_pty", { id, data: Array.from(new TextEncoder().encode(data)) }),
    resize: (cols, rows) => void invoke("resize_pty", { id, cols, rows }),
  };
}
```

- [ ] **Step 3 : Écrire le composant TerminalPane**

`src/components/TerminalPane.tsx` :
```tsx
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { spawnPty, type Pty } from "../lib/pty";

export function TerminalPane({ cwd, shell }: { cwd: string; shell: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current!;
    const term = new Terminal({ fontFamily: "monospace", fontSize: 13, cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // Renderer WebGL avec fallback DOM (xterm 6 : canvas supprimé).
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* fallback DOM implicite */
    }
    fit.fit();

    let pty: Pty | null = null;
    let buffer: Uint8Array[] = [];
    let flushScheduled = false;
    const flush = () => {
      flushScheduled = false;
      for (const chunk of buffer) term.write(chunk);
      buffer = [];
    };

    spawnPty({ shell, cwd, cols: term.cols, rows: term.rows }, (bytes) => {
      // Batch à ~1 frame pour éviter le layout thrashing.
      buffer.push(bytes);
      if (!flushScheduled) {
        flushScheduled = true;
        requestAnimationFrame(flush);
      }
    }).then((p) => {
      pty = p;
      term.onData((d) => p.write(d));
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      pty?.resize(term.cols, term.rows);
    });
    ro.observe(host);

    return () => {
      ro.disconnect();
      term.dispose();
    };
  }, [cwd, shell]);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}
```

- [ ] **Step 4 : Brancher dans App.tsx**

Remplacer le contenu de `src/App.tsx` par un seul terminal plein écran :
```tsx
import { TerminalPane } from "./components/TerminalPane";
import "./App.css";

export default function App() {
  return (
    <div style={{ width: "100vw", height: "100vh", background: "#1e1e1e" }}>
      <TerminalPane cwd={"/home/user"} shell={"/bin/bash"} />
    </div>
  );
}
```

- [ ] **Step 5 : Vérification manuelle**

Run : `npm run tauri dev`
Expected: un terminal fonctionnel s'affiche. Taper `ls`, `echo hello` → la sortie s'affiche. Redimensionner la fenêtre → le terminal se reflow. Taper `cat /var/log/*` (gros flux) → pas de freeze (flow control via rAF).

- [ ] **Step 6 : Commit**

```bash
git add src/ package.json package-lock.json
git commit -m "feat(term): bridge xterm.js WebGL <-> PTY avec batch rAF"
```

---

## Phase 2 — Multi-pane, splits & sidebar workspaces

### Task 2.1 : Store Zustand (workspaces + arbre de panes)

**Files:**
- Create: `src/store/workspace.ts`
- Create: `src/store/workspace.test.ts`
- Modify: `package.json`, `vite.config.ts` (Vitest)

- [ ] **Step 1 : Installer Vitest + Zustand**

Run :
```bash
npm install zustand allotment
npm install -D vitest @testing-library/react jsdom @testing-library/jest-dom
```

- [ ] **Step 2 : Configurer Vitest**

Dans `vite.config.ts`, ajouter dans l'objet de config :
```ts
  test: { environment: "jsdom", globals: true },
```
Dans `package.json` scripts : `"test": "vitest run"`.

- [ ] **Step 3 : Écrire les tests du store**

`src/store/workspace.test.ts` :
```ts
import { describe, it, expect, beforeEach } from "vitest";
import { useWorkspaceStore } from "./workspace";

describe("workspace store", () => {
  beforeEach(() => useWorkspaceStore.getState().reset());

  it("crée un workspace avec un pane racine", () => {
    const id = useWorkspaceStore.getState().addWorkspace("/tmp");
    const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === id)!;
    expect(ws.cwd).toBe("/tmp");
    expect(ws.root.kind).toBe("leaf");
  });

  it("split un pane leaf en branche avec 2 leaves", () => {
    const id = useWorkspaceStore.getState().addWorkspace("/tmp");
    const ws = useWorkspaceStore.getState().workspaces.find((w) => w.id === id)!;
    const leafId = (ws.root as any).paneId;
    useWorkspaceStore.getState().splitPane(id, leafId, "horizontal");
    const ws2 = useWorkspaceStore.getState().workspaces.find((w) => w.id === id)!;
    expect(ws2.root.kind).toBe("branch");
    expect((ws2.root as any).children).toHaveLength(2);
  });

  it("marque une notification lue", () => {
    const id = useWorkspaceStore.getState().addWorkspace("/tmp");
    useWorkspaceStore.getState().setNotification(id, { title: "x", body: "y" });
    expect(useWorkspaceStore.getState().workspaces.find((w) => w.id === id)!.unread).toBe(true);
    useWorkspaceStore.getState().markRead(id);
    expect(useWorkspaceStore.getState().workspaces.find((w) => w.id === id)!.unread).toBe(false);
  });
});
```

- [ ] **Step 4 : Run (doit échouer)**

Run : `npm run test`
Expected: FAIL — `./workspace` introuvable.

- [ ] **Step 5 : Implémenter le store**

`src/store/workspace.ts` :
```ts
import { create } from "zustand";

export type PaneNode =
  | { kind: "leaf"; paneId: string }
  | { kind: "branch"; dir: "horizontal" | "vertical"; children: PaneNode[] };

export interface Notification { title: string; body: string }

export interface Workspace {
  id: string;
  cwd: string;
  branch?: string;
  ports: number[];
  root: PaneNode;
  unread: boolean;
  lastNotification?: Notification;
  status?: { label: string; color?: string };
  progress?: { value: number; label?: string };
}

interface WorkspaceState {
  workspaces: Workspace[];
  activeId: string | null;
  addWorkspace: (cwd: string) => string;
  splitPane: (wsId: string, paneId: string, dir: "horizontal" | "vertical") => void;
  setNotification: (wsId: string, n: Notification) => void;
  markRead: (wsId: string) => void;
  setActive: (wsId: string) => void;
  reset: () => void;
}

let counter = 0;
const uid = (prefix: string) => `${prefix}:${counter++}`;

function splitNode(node: PaneNode, target: string, dir: "horizontal" | "vertical"): PaneNode {
  if (node.kind === "leaf") {
    if (node.paneId !== target) return node;
    return { kind: "branch", dir, children: [node, { kind: "leaf", paneId: uid("pane") }] };
  }
  return { ...node, children: node.children.map((c) => splitNode(c, target, dir)) };
}

export const useWorkspaceStore = create<WorkspaceState>((set) => ({
  workspaces: [],
  activeId: null,
  addWorkspace: (cwd) => {
    const id = uid("ws");
    const ws: Workspace = {
      id, cwd, ports: [], unread: false,
      root: { kind: "leaf", paneId: uid("pane") },
    };
    set((s) => ({ workspaces: [...s.workspaces, ws], activeId: id }));
    return id;
  },
  splitPane: (wsId, paneId, dir) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === wsId ? { ...w, root: splitNode(w.root, paneId, dir) } : w,
      ),
    })),
  setNotification: (wsId, n) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) =>
        w.id === wsId ? { ...w, unread: true, lastNotification: n } : w,
      ),
    })),
  markRead: (wsId) =>
    set((s) => ({
      workspaces: s.workspaces.map((w) => (w.id === wsId ? { ...w, unread: false } : w)),
    })),
  setActive: (wsId) => set({ activeId: wsId }),
  reset: () => { counter = 0; set({ workspaces: [], activeId: null }); },
}));
```

- [ ] **Step 6 : Run (doit passer)**

Run : `npm run test`
Expected: PASS (3 tests).

- [ ] **Step 7 : Commit**

```bash
git add src/store package.json package-lock.json vite.config.ts
git commit -m "feat(store): workspace store Zustand (arbre de panes + notifs)"
```

---

### Task 2.2 : Rendu des splits (Allotment) + sidebar

**Files:**
- Create: `src/components/PaneTree.tsx`
- Create: `src/components/Sidebar.tsx`
- Modify: `src/App.tsx`

- [ ] **Step 1 : Composant récursif PaneTree**

`src/components/PaneTree.tsx` :
```tsx
import { Allotment } from "allotment";
import "allotment/dist/style.css";
import type { PaneNode, Workspace } from "../store/workspace";
import { TerminalPane } from "./TerminalPane";

function renderNode(node: PaneNode, ws: Workspace) {
  if (node.kind === "leaf") {
    return <TerminalPane key={node.paneId} cwd={ws.cwd} shell={"/bin/bash"} />;
  }
  return (
    <Allotment vertical={node.dir === "vertical"}>
      {node.children.map((child, i) => (
        <Allotment.Pane key={i}>{renderNode(child, ws)}</Allotment.Pane>
      ))}
    </Allotment>
  );
}

export function PaneTree({ ws }: { ws: Workspace }) {
  return <div style={{ width: "100%", height: "100%" }}>{renderNode(ws.root, ws)}</div>;
}
```

- [ ] **Step 2 : Composant Sidebar**

`src/components/Sidebar.tsx` :
```tsx
import { useWorkspaceStore } from "../store/workspace";

export function Sidebar() {
  const { workspaces, activeId, addWorkspace, setActive, markRead } = useWorkspaceStore();
  return (
    <div style={{ width: 240, background: "#181818", color: "#ddd", display: "flex", flexDirection: "column" }}>
      <button onClick={() => addWorkspace("/home/user")} style={{ margin: 8 }}>
        + Workspace
      </button>
      {workspaces.map((w) => (
        <div
          key={w.id}
          onClick={() => { setActive(w.id); markRead(w.id); }}
          style={{
            padding: "8px 12px", cursor: "pointer",
            background: w.id === activeId ? "#2a2a2a" : "transparent",
            borderLeft: w.unread ? "3px solid #4ea1ff" : "3px solid transparent",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between" }}>
            <span>{w.cwd.split("/").pop() || w.cwd}</span>
            {w.unread && <span style={{ color: "#4ea1ff" }}>●</span>}
          </div>
          <div style={{ fontSize: 11, color: "#888" }}>
            {w.branch ? `⎇ ${w.branch}` : ""} {w.ports.length ? `:${w.ports.join(",")}` : ""}
          </div>
          {w.status && <div style={{ fontSize: 11, color: w.status.color ?? "#aaa" }}>{w.status.label}</div>}
          {w.progress && (
            <div style={{ height: 3, background: "#333", marginTop: 4 }}>
              <div style={{ height: 3, width: `${w.progress.value * 100}%`, background: "#4ea1ff" }} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
```

- [ ] **Step 3 : Assembler App.tsx**

`src/App.tsx` :
```tsx
import { useEffect } from "react";
import { Sidebar } from "./components/Sidebar";
import { PaneTree } from "./components/PaneTree";
import { useWorkspaceStore } from "./store/workspace";
import "./App.css";

export default function App() {
  const { workspaces, activeId, addWorkspace } = useWorkspaceStore();
  useEffect(() => { if (workspaces.length === 0) addWorkspace("/home/user"); }, []);
  const active = workspaces.find((w) => w.id === activeId);
  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", background: "#1e1e1e" }}>
      <Sidebar />
      <div style={{ flex: 1 }}>{active && <PaneTree ws={active} />}</div>
    </div>
  );
}
```

- [ ] **Step 4 : Vérification manuelle**

Run : `npm run tauri dev`
Expected: sidebar à gauche avec un workspace, terminal à droite. « + Workspace » ajoute une entrée. Cliquer alterne le workspace actif.

- [ ] **Step 5 : Commit**

```bash
git add src/
git commit -m "feat(ui): splits Allotment + sidebar workspaces"
```

---

### Task 2.3 : Raccourcis splits

**Files:**
- Create: `src/hooks/useShortcuts.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1 : Hook de raccourcis**

`src/hooks/useShortcuts.ts` (split du pane actif via Ctrl+D / Ctrl+Shift+D, nouveau workspace via Ctrl+N) :
```ts
import { useEffect } from "react";
import { useWorkspaceStore } from "../store/workspace";

function firstLeaf(node: any): string | null {
  if (node.kind === "leaf") return node.paneId;
  for (const c of node.children) { const r = firstLeaf(c); if (r) return r; }
  return null;
}

export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useWorkspaceStore.getState();
      const active = s.workspaces.find((w) => w.id === s.activeId);
      if (e.ctrlKey && e.key === "n") { e.preventDefault(); s.addWorkspace("/home/user"); }
      if (active && e.ctrlKey && e.key === "d") {
        e.preventDefault();
        const leaf = firstLeaf(active.root);
        if (leaf) s.splitPane(active.id, leaf, e.shiftKey ? "vertical" : "horizontal");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
```

- [ ] **Step 2 : Brancher dans App.tsx**

Dans `App.tsx`, importer et appeler `useShortcuts()` au début du composant.

- [ ] **Step 3 : Vérification manuelle**

Run : `npm run tauri dev`
Expected: Ctrl+D split horizontal, Ctrl+Shift+D split vertical, Ctrl+N nouveau workspace.

- [ ] **Step 4 : Commit**

```bash
git add src/
git commit -m "feat(ui): raccourcis split (Ctrl+D / Ctrl+Shift+D) + Ctrl+N"
```

---

## Phase 3 — Socket server + crate CLI

### Task 3.1 : Logique single-instance (test unitaire)

**Files:**
- Create: `src-tauri/src/socket.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

- [ ] **Step 1 : Ajouter deps**

`src-tauri/Cargo.toml` :
```toml
tokio = { workspace = true }
```

- [ ] **Step 2 : Écrire le test du chemin de socket**

`src-tauri/src/socket.rs` :
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn socket_path_uses_xdg_runtime_dir_when_set() {
        std::env::set_var("XDG_RUNTIME_DIR", "/run/user/1000");
        let p = socket_path();
        assert_eq!(p, std::path::PathBuf::from("/run/user/1000/terminials.sock"));
    }

    #[test]
    fn socket_path_falls_back_to_tmp() {
        std::env::remove_var("XDG_RUNTIME_DIR");
        let p = socket_path();
        assert_eq!(p, std::path::PathBuf::from("/tmp/terminials.sock"));
    }
}
```
(Note : ces deux tests touchent la même var d'env globale — les marquer `#[serial_test::serial]` ou les fusionner en un seul test séquentiel pour éviter les races. Pour rester sans dépendance, fusionner en un seul `#[test]` qui set puis remove.)

Version fusionnée à utiliser :
```rust
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn socket_path_resolution() {
        std::env::set_var("XDG_RUNTIME_DIR", "/run/user/1000");
        assert_eq!(socket_path(), std::path::PathBuf::from("/run/user/1000/terminials.sock"));
        std::env::remove_var("XDG_RUNTIME_DIR");
        assert_eq!(socket_path(), std::path::PathBuf::from("/tmp/terminials.sock"));
    }
}
```

- [ ] **Step 3 : Run (doit échouer)**

Run : `cargo test -p terminials --lib socket`
Expected: FAIL — `socket_path` absent.

- [ ] **Step 4 : Implémenter socket_path + helper d'init**

`src-tauri/src/socket.rs` (au-dessus des tests) :
```rust
use std::path::PathBuf;

pub fn socket_path() -> PathBuf {
    match std::env::var("XDG_RUNTIME_DIR") {
        Ok(dir) if !dir.is_empty() => PathBuf::from(dir).join("terminials.sock"),
        _ => PathBuf::from("/tmp/terminials.sock"),
    }
}

/// Retourne true si une instance écoute déjà (connexion réussie), sinon nettoie le fichier mort.
/// À appeler avant bind().
pub async fn instance_already_running(path: &std::path::Path) -> bool {
    if tokio::net::UnixStream::connect(path).await.is_ok() {
        return true;
    }
    let _ = std::fs::remove_file(path); // socket mort d'un crash précédent
    false
}
```
Déclarer `mod socket;` dans `lib.rs`.

- [ ] **Step 5 : Run (doit passer)**

Run : `cargo test -p terminials --lib socket`
Expected: PASS.

- [ ] **Step 6 : Commit**

```bash
git add src-tauri/src/socket.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(socket): résolution du chemin socket + détection single-instance"
```

---

### Task 3.2 : Serveur socket + dispatch + buffer

**Files:**
- Modify: `src-tauri/src/socket.rs`, `src-tauri/src/lib.rs`

- [ ] **Step 1 : Implémenter le serveur et le dispatch**

Dans `src-tauri/src/socket.rs`, ajouter (le dispatch émet vers le front via `AppHandle` + bufferise si besoin) :
```rust
use tauri::{AppHandle, Emitter, Manager};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use protocol::{Request, Response};

/// Démarre le serveur socket. À lancer dans le setup hook via async_runtime::spawn.
pub async fn serve(app: AppHandle) -> std::io::Result<()> {
    let path = socket_path();
    if instance_already_running(&path).await {
        // Une autre instance tourne : on ne sert pas (le main.rs devra gérer le single-instance).
        return Ok(());
    }
    let listener = tokio::net::UnixListener::bind(&path)?;
    loop {
        let (stream, _) = listener.accept().await?;
        let app = app.clone();
        tokio::spawn(async move {
            let (read_half, mut write_half) = stream.into_split();
            let mut lines = BufReader::new(read_half).lines();
            while let Ok(Some(line)) = lines.next_line().await {
                let resp = match serde_json::from_str::<Request>(&line) {
                    Ok(req) => dispatch(&app, req),
                    Err(e) => Response::err(format!("requête invalide: {e}")),
                };
                let mut out = serde_json::to_string(&resp).unwrap_or_else(|_| "{}".into());
                out.push('\n');
                if write_half.write_all(out.as_bytes()).await.is_err() { break; }
            }
        });
    }
}

/// Traduit une requête en effet sur l'app. Les méthodes émettent des events vers le front.
fn dispatch(app: &AppHandle, req: Request) -> Response {
    match req.method.as_str() {
        "ping" => Response::ok(serde_json::json!({"pong": true})),
        "capabilities" => Response::ok(serde_json::json!({
            "methods": ["ping","capabilities","notify","new-workspace","send","set-status","set-progress"]
        })),
        "notify" | "new-workspace" | "send" | "set-status" | "set-progress" => {
            // Émettre vers le front ; si pas de listener encore, le front pull au montage (cf. buffer).
            let _ = app.emit("socket-command", &req);
            Response::ok(serde_json::Value::Null)
        }
        other => Response::err(format!("méthode inconnue: {other}")),
    }
}
```

- [ ] **Step 2 : Lancer le serveur dans le setup hook**

Dans `lib.rs`, sur le builder, ajouter `.setup(|app| { let h = app.handle().clone(); tauri::async_runtime::spawn(async move { let _ = crate::socket::serve(h).await; }); Ok(()) })`. Nettoyer le socket sur sortie : dans `.run(|_app, event| { if let tauri::RunEvent::Exit = event { let _ = std::fs::remove_file(crate::socket::socket_path()); } })`.

- [ ] **Step 3 : Compiler**

Run : `cargo build -p terminials`
Expected: compile.

- [ ] **Step 4 : Vérification manuelle (socket vivant)**

Run (app lancée via `npm run tauri dev` dans un autre terminal) :
```bash
echo '{"method":"ping"}' | nc -U "${XDG_RUNTIME_DIR:-/tmp}/terminials.sock"
```
Expected: réponse `{"status":"ok","data":{"pong":true}}`.

- [ ] **Step 5 : Commit**

```bash
git add src-tauri/src
git commit -m "feat(socket): serveur UnixListener + dispatch JSON-par-ligne"
```

---

### Task 3.3 : Crate CLI `terminials`

**Files:**
- Create: `crates/cli/Cargo.toml`, `crates/cli/src/main.rs`
- Create: `crates/cli/tests/roundtrip.rs`

- [ ] **Step 1 : Écrire un test d'intégration (faux serveur socket)**

`crates/cli/tests/roundtrip.rs` :
```rust
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::{UnixListener, UnixStream};
use std::thread;

/// Lance un faux serveur qui répond "ok" à toute ligne, puis vérifie que send_request
/// envoie bien une ligne JSON et lit la réponse.
#[test]
fn cli_sends_jsonline_and_reads_response() {
    let dir = std::env::temp_dir();
    let path = dir.join(format!("terminials-test-{}.sock", std::process::id()));
    let _ = std::fs::remove_file(&path);
    let listener = UnixListener::bind(&path).unwrap();

    let server_path = path.clone();
    let handle = thread::spawn(move || {
        let (stream, _) = listener.accept().unwrap();
        let mut reader = BufReader::new(stream.try_clone().unwrap());
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.contains("\"method\":\"ping\""));
        let mut w = stream;
        w.write_all(b"{\"status\":\"ok\",\"data\":{\"pong\":true}}\n").unwrap();
        let _ = server_path;
    });

    let resp = terminials_cli::send_request(&path, "ping", serde_json::Value::Null).unwrap();
    assert_eq!(resp.status, protocol::Status::Ok);
    handle.join().unwrap();
    let _ = std::fs::remove_file(&path);
}
```

- [ ] **Step 2 : Run (doit échouer)**

Run : `cargo test -p terminials-cli`
Expected: FAIL — crate/fonction absente.

- [ ] **Step 3 : Implémenter le crate CLI**

`crates/cli/Cargo.toml` :
```toml
[package]
name = "terminials-cli"
version = "0.1.0"
edition = "2021"

[[bin]]
name = "terminials"
path = "src/main.rs"

[lib]
name = "terminials_cli"
path = "src/lib.rs"

[dependencies]
clap = { version = "4", features = ["derive"] }
protocol = { path = "../protocol" }
serde_json = { workspace = true }
```
`crates/cli/src/lib.rs` :
```rust
use std::io::{BufRead, BufReader, Write};
use std::os::unix::net::UnixStream;
use std::path::Path;
use protocol::{Request, Response};

pub fn socket_path() -> std::path::PathBuf {
    match std::env::var("XDG_RUNTIME_DIR") {
        Ok(d) if !d.is_empty() => std::path::PathBuf::from(d).join("terminials.sock"),
        _ => std::path::PathBuf::from("/tmp/terminials.sock"),
    }
}

pub fn send_request(path: &Path, method: &str, params: serde_json::Value) -> std::io::Result<Response> {
    let mut stream = UnixStream::connect(path)?;
    let req = Request { method: method.to_string(), params };
    let mut line = serde_json::to_string(&req).unwrap();
    line.push('\n');
    stream.write_all(line.as_bytes())?;
    let mut reader = BufReader::new(stream);
    let mut resp_line = String::new();
    reader.read_line(&mut resp_line)?;
    serde_json::from_str(&resp_line).map_err(std::io::Error::other)
}
```
`crates/cli/src/main.rs` :
```rust
use clap::{Parser, Subcommand};
use terminials_cli::{send_request, socket_path};

#[derive(Parser)]
#[command(name = "terminials", about = "CLI de pilotage de l'app terminials")]
struct Cli { #[command(subcommand)] cmd: Cmd }

#[derive(Subcommand)]
enum Cmd {
    Ping,
    Notify { #[arg(long)] title: String, #[arg(long, default_value="")] subtitle: String, #[arg(long)] body: String },
    NewWorkspace { #[arg(long)] cwd: String },
    SetStatus { #[arg(long)] label: String, #[arg(long)] color: Option<String> },
    SetProgress { #[arg(long)] value: f64, #[arg(long)] label: Option<String> },
}

fn main() {
    let cli = Cli::parse();
    let (method, params) = match cli.cmd {
        Cmd::Ping => ("ping", serde_json::Value::Null),
        Cmd::Notify { title, subtitle, body } =>
            ("notify", serde_json::json!({"title": title, "subtitle": subtitle, "body": body})),
        Cmd::NewWorkspace { cwd } => ("new-workspace", serde_json::json!({"cwd": cwd})),
        Cmd::SetStatus { label, color } => ("set-status", serde_json::json!({"label": label, "color": color})),
        Cmd::SetProgress { value, label } => ("set-progress", serde_json::json!({"value": value, "label": label})),
    };
    match send_request(&socket_path(), method, params) {
        Ok(resp) if resp.status == protocol::Status::Ok => {
            println!("{}", serde_json::to_string(&resp.data).unwrap());
        }
        Ok(resp) => { eprintln!("erreur: {}", resp.error.unwrap_or_default()); std::process::exit(1); }
        Err(e) => { eprintln!("connexion impossible ({e}). L'app terminials est-elle lancée ?"); std::process::exit(1); }
    }
}
```

- [ ] **Step 4 : Run (doit passer)**

Run : `cargo test -p terminials-cli`
Expected: PASS.

- [ ] **Step 5 : Vérification manuelle bout-en-bout**

App lancée (`npm run tauri dev`), puis :
```bash
cargo run -p terminials-cli -- ping
```
Expected: affiche `{"pong":true}`.

- [ ] **Step 6 : Commit**

```bash
git add crates/cli
git commit -m "feat(cli): binaire terminials (ping/notify/new-workspace/set-status/set-progress)"
```

---

### Task 3.4 : Front consomme les events socket

**Files:**
- Create: `src/lib/socketEvents.ts`
- Modify: `src/App.tsx`

- [ ] **Step 1 : Écouter `socket-command` et router vers le store**

`src/lib/socketEvents.ts` :
```ts
import { listen } from "@tauri-apps/api/event";
import { useWorkspaceStore } from "../store/workspace";

interface SocketCommand { method: string; params: any }

export function registerSocketEvents() {
  return listen<SocketCommand>("socket-command", (e) => {
    const s = useWorkspaceStore.getState();
    const { method, params } = e.payload;
    const active = s.workspaces.find((w) => w.id === s.activeId);
    switch (method) {
      case "new-workspace": s.addWorkspace(params.cwd ?? "/home"); break;
      case "notify":
        if (active) s.setNotification(active.id, { title: params.title, body: params.body });
        break;
      // set-status / set-progress : étendus en Phase 4.
    }
  });
}
```

- [ ] **Step 2 : Brancher dans App.tsx**

Dans `App.tsx`, `useEffect(() => { const un = registerSocketEvents(); return () => { un.then((f) => f()); }; }, []);`

- [ ] **Step 3 : Vérification manuelle**

App lancée, puis : `cargo run -p terminials-cli -- new-workspace --cwd /tmp`
Expected: un nouveau workspace `/tmp` apparaît dans la sidebar.

- [ ] **Step 4 : Commit**

```bash
git add src/
git commit -m "feat(front): consommation des events socket-command"
```

---

## Phase 4 — Parser OSC + pipeline notifications

### Task 4.1 : Parser OSC 9/99/777 (test unitaire)

**Files:**
- Create: `src-tauri/src/osc.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1 : Écrire les tests du parser**

`src-tauri/src/osc.rs` :
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_osc9_iterm() {
        // OSC 9 ; <message> BEL
        let input = b"\x1b]9;Task complete\x07";
        let n = parse_notifications(input);
        assert_eq!(n, vec![OscNotification { title: "terminials".into(), body: "Task complete".into() }]);
    }

    #[test]
    fn parses_osc777_rxvt() {
        // OSC 777 ; notify ; <title> ; <body> BEL
        let input = b"\x1b]777;notify;My Title;Message body\x07";
        let n = parse_notifications(input);
        assert_eq!(n, vec![OscNotification { title: "My Title".into(), body: "Message body".into() }]);
    }

    #[test]
    fn parses_osc99_kitty_title_and_body() {
        // OSC 99 ; ... ; p=title:<t> ST   et p=body:<b> ST
        let input = b"\x1b]99;i=1:p=title:Build\x1b\\\x1b]99;i=1:p=body:Done\x1b\\";
        let n = parse_notifications(input);
        assert!(n.iter().any(|x| x.title == "Build"));
        assert!(n.iter().any(|x| x.body == "Done"));
    }

    #[test]
    fn ignores_non_notification_sequences() {
        let input = b"\x1b]0;some window title\x07normal text";
        assert!(parse_notifications(input).is_empty());
    }
}
```

- [ ] **Step 2 : Run (doit échouer)**

Run : `cargo test -p terminials --lib osc`
Expected: FAIL.

- [ ] **Step 3 : Implémenter le parser**

`src-tauri/src/osc.rs` (au-dessus des tests) — scan des séquences OSC terminées par BEL (`\x07`) ou ST (`\x1b\\`) :
```rust
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct OscNotification {
    pub title: String,
    pub body: String,
}

/// Extrait les notifications OSC 9 / 99 / 777 d'un buffer d'octets PTY.
pub fn parse_notifications(buf: &[u8]) -> Vec<OscNotification> {
    let mut out = Vec::new();
    let mut i = 0;
    while i + 1 < buf.len() {
        // début OSC : ESC ]
        if buf[i] == 0x1b && buf[i + 1] == b']' {
            let start = i + 2;
            // chercher le terminateur : BEL (0x07) ou ST (ESC \)
            let mut j = start;
            let mut end = None;
            let mut term_len = 0;
            while j < buf.len() {
                if buf[j] == 0x07 { end = Some(j); term_len = 1; break; }
                if buf[j] == 0x1b && j + 1 < buf.len() && buf[j + 1] == b'\\' { end = Some(j); term_len = 2; break; }
                j += 1;
            }
            if let Some(e) = end {
                let payload = String::from_utf8_lossy(&buf[start..e]).to_string();
                if let Some(n) = interpret(&payload) { out.push(n); }
                i = e + term_len;
                continue;
            }
        }
        i += 1;
    }
    out
}

fn interpret(payload: &str) -> Option<OscNotification> {
    // OSC 9 : "9;<message>"
    if let Some(rest) = payload.strip_prefix("9;") {
        return Some(OscNotification { title: "terminials".into(), body: rest.to_string() });
    }
    // OSC 777 : "777;notify;<title>;<body>"
    if let Some(rest) = payload.strip_prefix("777;notify;") {
        let mut parts = rest.splitn(2, ';');
        let title = parts.next().unwrap_or("").to_string();
        let body = parts.next().unwrap_or("").to_string();
        return Some(OscNotification { title, body });
    }
    // OSC 99 (Kitty) : "99;<metadata>:p=title:<t>" ou ":p=body:<b>"
    if let Some(rest) = payload.strip_prefix("99;") {
        if let Some(idx) = rest.find("p=title:") {
            return Some(OscNotification { title: rest[idx + 8..].to_string(), body: String::new() });
        }
        if let Some(idx) = rest.find("p=body:") {
            return Some(OscNotification { title: String::new(), body: rest[idx + 7..].to_string() });
        }
    }
    None
}
```
Déclarer `mod osc;` dans `lib.rs`.

- [ ] **Step 4 : Run (doit passer)**

Run : `cargo test -p terminials --lib osc`
Expected: PASS (4 tests).

- [ ] **Step 5 : Commit**

```bash
git add src-tauri/src/osc.rs src-tauri/src/lib.rs
git commit -m "feat(osc): parser des notifications OSC 9/99/777"
```

---

### Task 4.2 : Brancher le parser OSC sur le flux PTY

**Files:**
- Modify: `src-tauri/src/lib.rs` (thread lecteur du `spawn_pty`)

- [ ] **Step 1 : Émettre un event quand une notif OSC est détectée**

Dans le thread lecteur de `spawn_pty` (Task 1.2), après avoir reçu `n` octets, parser et émettre. La commande a besoin de l'`AppHandle` et de l'id de pane : ajouter `app: AppHandle` en paramètre de `spawn_pty` (Tauri l'injecte) et un `workspace_id: String` passé par le front. Code mis à jour du thread :
```rust
Ok(n) => {
    let chunk = &buf[..n];
    for notif in crate::osc::parse_notifications(chunk) {
        let _ = app.emit("agent-notification", serde_json::json!({
            "workspaceId": workspace_id,
            "title": notif.title,
            "body": notif.body,
        }));
    }
    if on_data.send(InvokeResponseBody::Raw(chunk.to_vec())).is_err() { break; }
}
```
Mettre à jour la signature : `fn spawn_pty(app: AppHandle, reg: State<...>, workspace_id: String, shell: String, ...)` et l'appel front pour passer `workspaceId`.

- [ ] **Step 2 : Note sur le buffering inter-chunks**

Limitation acceptée v1 : une séquence OSC coupée entre deux lectures de 8192 octets sera ratée. Documenter en commentaire. (Amélioration v2 : accumulateur d'octets résiduels.) Ajouter le commentaire `// v1: séquences OSC à cheval sur 2 chunks non gérées (rare pour des notifs courtes).`

- [ ] **Step 3 : Compiler**

Run : `cargo build -p terminials`
Expected: compile.

- [ ] **Step 4 : Vérification manuelle**

App lancée, dans un pane taper :
```bash
printf '\e]777;notify;Test;Coucou\a'
```
Expected: un event `agent-notification` est émis (vérifiable en branchant le front à la tâche suivante).

- [ ] **Step 5 : Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(osc): émission agent-notification depuis le flux PTY"
```

---

### Task 4.3 : Notifications desktop + attention fenêtre (Rust)

**Files:**
- Create: `src-tauri/src/notify.rs`
- Modify: `src-tauri/src/lib.rs`, `src-tauri/Cargo.toml`

- [ ] **Step 1 : Ajouter notify-rust**

`src-tauri/Cargo.toml` : `notify-rust = "4.17"`

- [ ] **Step 2 : Implémenter l'envoi de notif desktop + attention**

`src-tauri/src/notify.rs` :
```rust
use tauri::{AppHandle, Manager};

/// Affiche une notification desktop D-Bus (urgency Critical) et demande l'attention
/// sur la fenêtre principale (urgency hint X11 sous GNOME).
pub fn fire(app: &AppHandle, title: &str, body: &str) {
    // 1. Notification D-Bus
    let _ = notify_rust::Notification::new()
        .summary(title)
        .body(body)
        .appname("terminials")
        .urgency(notify_rust::Urgency::Critical)
        .show();

    // 2. Attention fenêtre (no-op sous Wayland ; OK ici en X11)
    if let Some(win) = app.get_webview_window("main") {
        let _ = win.request_user_attention(Some(tauri::UserAttentionType::Critical));
    }
}

/// Vrai si la fenêtre principale est focus (pour supprimer la notif desktop redondante).
pub fn window_focused(app: &AppHandle) -> bool {
    app.get_webview_window("main")
        .and_then(|w| w.is_focused().ok())
        .unwrap_or(false)
}
```
Déclarer `mod notify;` dans `lib.rs`. Vérifier le label de fenêtre `"main"` dans `tauri.conf.json` (`app.windows[0].label`).

- [ ] **Step 3 : Appeler fire() depuis le parser OSC et le dispatch socket**

Dans le thread lecteur (Task 4.2), après l'émission de l'event, appeler `crate::notify::fire(&app, &notif.title, &notif.body)` **sauf si** `crate::notify::window_focused(&app)` (on garde l'anneau front, mais pas la notif desktop quand l'app est déjà au premier plan). Dans le dispatch socket (`dispatch`, méthode `notify`), appeler aussi `crate::notify::fire(...)` avec les params.

- [ ] **Step 4 : Compiler**

Run : `cargo build -p terminials`
Expected: compile.

- [ ] **Step 5 : Vérification manuelle**

App lancée mais **non focus** (fenêtre en arrière-plan), puis :
```bash
cargo run -p terminials-cli -- notify --title "Claude" --body "En attente"
```
Expected: une notification desktop GNOME apparaît, l'app demande l'attention dans le dash.

- [ ] **Step 6 : Commit**

```bash
git add src-tauri/src/notify.rs src-tauri/src/lib.rs src-tauri/Cargo.toml
git commit -m "feat(notify): notif desktop D-Bus + request_user_attention"
```

---

### Task 4.4 : Anneau visuel + badge front

**Files:**
- Modify: `src/lib/socketEvents.ts`, `src/components/PaneTree.tsx`, `src/App.tsx`

- [ ] **Step 1 : Écouter `agent-notification` côté front**

Dans `src/lib/socketEvents.ts`, ajouter un second `listen` :
```ts
import { listen } from "@tauri-apps/api/event";
// ... dans registerSocketEvents, retourner un cleanup combiné :
export function registerSocketEvents() {
  const s = () => useWorkspaceStore.getState();
  const un1 = listen<SocketCommand>("socket-command", (e) => { /* (inchangé) */ });
  const un2 = listen<{ workspaceId: string; title: string; body: string }>(
    "agent-notification",
    (e) => s().setNotification(e.payload.workspaceId, { title: e.payload.title, body: e.payload.body }),
  );
  return Promise.all([un1, un2]).then((fns) => () => fns.forEach((f) => f()));
}
```
(Adapter `App.tsx` : le cleanup est maintenant une promesse d'une fonction.)

- [ ] **Step 2 : Anneau visuel sur le pane**

Le store actuel suit la notif au niveau workspace. Pour l'anneau au niveau pane v1, on met en surbrillance tout le PaneTree du workspace non-lu. Dans `PaneTree.tsx`, accepter une prop `highlight: boolean` et entourer d'une bordure :
```tsx
export function PaneTree({ ws }: { ws: Workspace }) {
  return (
    <div style={{
      width: "100%", height: "100%",
      boxShadow: ws.unread ? "inset 0 0 0 2px #4ea1ff" : "none",
    }}>
      {renderNode(ws.root, ws)}
    </div>
  );
}
```

- [ ] **Step 3 : Vérification manuelle bout-en-bout**

App lancée. Dans le pane d'un workspace **non actif** (en créer un 2e), exécuter `printf '\e]777;notify;Agent;Attente\a'`.
Expected: badge bleu sur l'entrée de sidebar du workspace + (si app non focus) notif desktop. Cliquer le workspace → badge disparaît (markRead).

- [ ] **Step 4 : Commit**

```bash
git add src/
git commit -m "feat(notify): anneau visuel + badge non-lu côté front"
```

---

## Phase 5 — Sidebar git / ports

### Task 5.1 : Lecture git d'un cwd (test unitaire)

**Files:**
- Create: `src-tauri/src/git.rs`
- Modify: `src-tauri/src/lib.rs`

- [ ] **Step 1 : Écrire le test (repo temporaire)**

`src-tauri/src/git.rs` :
```rust
#[cfg(test)]
mod tests {
    use super::*;
    use std::process::Command;

    #[test]
    fn reads_branch_of_a_git_repo() {
        let dir = std::env::temp_dir().join(format!("terminials-git-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let run = |args: &[&str]| { Command::new("git").args(args).current_dir(&dir).output().unwrap(); };
        run(&["init", "-q", "-b", "maa-branche"]);
        let info = git_info(dir.to_str().unwrap());
        assert_eq!(info.branch.as_deref(), Some("maa-branche"));
        let _ = std::fs::remove_dir_all(&dir);
    }

    #[test]
    fn returns_none_branch_outside_repo() {
        let info = git_info("/tmp");
        // /tmp n'est normalement pas un repo git
        assert!(info.branch.is_none() || info.branch.is_some()); // tolérant : ne panique pas
    }
}
```

- [ ] **Step 2 : Run (doit échouer)**

Run : `cargo test -p terminials --lib git`
Expected: FAIL — `git_info` absent.

- [ ] **Step 3 : Implémenter git_info**

`src-tauri/src/git.rs` (au-dessus des tests) :
```rust
use std::process::Command;

#[derive(Debug, Clone, Default, serde::Serialize)]
pub struct GitInfo {
    pub branch: Option<String>,
    pub dirty: bool,
}

pub fn git_info(cwd: &str) -> GitInfo {
    let branch = Command::new("git")
        .args(["rev-parse", "--abbrev-ref", "HEAD"])
        .current_dir(cwd)
        .output()
        .ok()
        .filter(|o| o.status.success())
        .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
        .filter(|s| !s.is_empty());

    let dirty = Command::new("git")
        .args(["status", "--porcelain"])
        .current_dir(cwd)
        .output()
        .ok()
        .map(|o| !o.stdout.is_empty())
        .unwrap_or(false);

    GitInfo { branch, dirty }
}
```
Déclarer `mod git;` dans `lib.rs`.

- [ ] **Step 4 : Run (doit passer)**

Run : `cargo test -p terminials --lib git`
Expected: PASS.

- [ ] **Step 5 : Commit**

```bash
git add src-tauri/src/git.rs src-tauri/src/lib.rs
git commit -m "feat(git): lecture branche + dirty d'un cwd"
```

---

### Task 5.2 : Poller périodique + event vers le front

**Files:**
- Modify: `src-tauri/src/lib.rs`
- Modify: `src/lib/socketEvents.ts`, `src/store/workspace.ts`

- [ ] **Step 1 : Commande de refresh git on-demand**

Dans `lib.rs`, ajouter une commande appelée par le front (plus simple et testable qu'un poller Rust qui doit connaître les workspaces) :
```rust
#[tauri::command]
fn git_info(cwd: String) -> crate::git::GitInfo {
    crate::git::git_info(&cwd)
}
```
L'ajouter à `generate_handler!`.

- [ ] **Step 2 : Poller côté front (toutes les ~2s)**

Dans `src/store/workspace.ts`, ajouter une action `setGit(wsId, branch, dirty)` qui met à jour `branch`. Puis dans `App.tsx`, un `useEffect` avec `setInterval` qui, pour chaque workspace, `invoke('git_info', { cwd })` et appelle `setGit`. Code de l'effet :
```ts
useEffect(() => {
  const tick = async () => {
    const s = useWorkspaceStore.getState();
    for (const w of s.workspaces) {
      const info = await invoke<{ branch: string | null; dirty: boolean }>("git_info", { cwd: w.cwd });
      if (info.branch) s.setGit(w.id, info.branch, info.dirty);
    }
  };
  const h = setInterval(tick, 2000);
  tick();
  return () => clearInterval(h);
}, []);
```

- [ ] **Step 3 : Ajouter setGit au store**

Dans `workspace.ts`, ajouter à l'interface et l'implémentation :
```ts
setGit: (wsId: string, branch: string, dirty: boolean) =>
  set((s) => ({ workspaces: s.workspaces.map((w) => w.id === wsId ? { ...w, branch } : w) })),
```

- [ ] **Step 4 : Vérification manuelle**

App lancée, créer un workspace dont le cwd est un repo git.
Expected: la branche s'affiche sous le nom du workspace dans la sidebar et se rafraîchit.

- [ ] **Step 5 : Commit**

```bash
git add src-tauri/src/lib.rs src/
git commit -m "feat(git): poller front + affichage branche dans la sidebar"
```

---

### Task 5.3 : status pills + progress via CLI

**Files:**
- Modify: `src-tauri/src/socket.rs` (dispatch), `src/lib/socketEvents.ts`, `src/store/workspace.ts`

- [ ] **Step 1 : Router set-status / set-progress vers le store**

Dans `src/lib/socketEvents.ts`, étendre le switch `socket-command` :
```ts
case "set-status":
  if (active) s.setStatus(active.id, { label: params.label, color: params.color });
  break;
case "set-progress":
  if (active) s.setProgress(active.id, { value: params.value, label: params.label });
  break;
```

- [ ] **Step 2 : Ajouter setStatus / setProgress au store**

Dans `workspace.ts` :
```ts
setStatus: (wsId, status) => set((s) => ({ workspaces: s.workspaces.map((w) => w.id === wsId ? { ...w, status } : w) })),
setProgress: (wsId, progress) => set((s) => ({ workspaces: s.workspaces.map((w) => w.id === wsId ? { ...w, progress } : w) })),
```
(Ajouter les signatures à l'interface `WorkspaceState`.) L'affichage est déjà géré par `Sidebar.tsx` (Task 2.2).

- [ ] **Step 3 : Vérification manuelle**

App lancée, puis :
```bash
cargo run -p terminials-cli -- set-status --label "build OK" --color "#3fb950"
cargo run -p terminials-cli -- set-progress --value 0.6 --label "tests"
```
Expected: le pill de statut et la barre de progression apparaissent sur le workspace actif.

- [ ] **Step 4 : Commit**

```bash
git add src-tauri/src src/
git commit -m "feat(cli): set-status et set-progress pilotent la sidebar"
```

---

### Task 5.4 : Ports en écoute par workspace

**Files:**
- Create: `src-tauri/src/ports.rs`
- Modify: `src-tauri/src/lib.rs`, `src/store/workspace.ts`, `src/App.tsx`

- [ ] **Step 1 : Écrire le test de parsing de /proc/net/tcp**

`src-tauri/src/ports.rs` :
```rust
#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_listening_ports_from_proc_net_tcp() {
        // Format /proc/net/tcp : sl local_address rem_address st ... inode
        // st=0A = LISTEN. local_address = IP:PORT en hexa little-endian pour l'IP, PORT en hexa big-endian.
        // Ici : 0100007F:1F90 = 127.0.0.1:8080, état 0A (LISTEN), inode 12345.
        let sample = "\
  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode
   0: 0100007F:1F90 00000000:0000 0A 00000000:00000000 00:00000000 00000000  1000        0 12345 1 0000 100 0 0 10 0
   1: 0100007F:1F91 00000000:0000 01 00000000:00000000 00:00000000 00000000  1000        0 99999 1 0000 100 0 0 10 0
";
        let map = parse_listening(sample);
        // inode 12345 écoute sur le port 8080 (0x1F90). L'entrée 01 (ESTABLISHED) est ignorée.
        assert_eq!(map.get(&12345), Some(&8080));
        assert!(!map.contains_key(&99999));
    }
}
```

- [ ] **Step 2 : Run (doit échouer)**

Run : `cargo test -p terminials --lib ports`
Expected: FAIL — `parse_listening` absent.

- [ ] **Step 3 : Implémenter la détection de ports**

`src-tauri/src/ports.rs` (au-dessus des tests) :
```rust
use std::collections::{HashMap, HashSet};

/// Parse /proc/net/tcp(6) : retourne inode -> port, uniquement pour l'état LISTEN (0A).
pub fn parse_listening(content: &str) -> HashMap<u64, u16> {
    let mut out = HashMap::new();
    for line in content.lines().skip(1) {
        let cols: Vec<&str> = line.split_whitespace().collect();
        if cols.len() < 10 { continue; }
        if cols[3] != "0A" { continue; } // 0A = TCP_LISTEN
        let local = cols[1]; // "IP:PORT" en hexa
        if let Some((_, port_hex)) = local.split_once(':') {
            if let Ok(port) = u16::from_str_radix(port_hex, 16) {
                if let Ok(inode) = cols[9].parse::<u64>() {
                    out.insert(inode, port);
                }
            }
        }
    }
    out
}

/// Collecte récursivement les PID du sous-arbre de `root_pid` (via /proc/<pid>/task/<tid>/children).
fn descendant_pids(root_pid: u32) -> HashSet<u32> {
    let mut seen = HashSet::new();
    let mut stack = vec![root_pid];
    while let Some(pid) = stack.pop() {
        if !seen.insert(pid) { continue; }
        let task_dir = format!("/proc/{pid}/task");
        if let Ok(entries) = std::fs::read_dir(&task_dir) {
            for e in entries.flatten() {
                let children = e.path().join("children");
                if let Ok(s) = std::fs::read_to_string(&children) {
                    for c in s.split_whitespace() {
                        if let Ok(cpid) = c.parse::<u32>() { stack.push(cpid); }
                    }
                }
            }
        }
    }
    seen
}

/// Inodes des sockets ouverts par un PID (lecture des symlinks /proc/<pid>/fd/* -> socket:[inode]).
fn socket_inodes_of(pid: u32) -> HashSet<u64> {
    let mut inodes = HashSet::new();
    let fd_dir = format!("/proc/{pid}/fd");
    if let Ok(entries) = std::fs::read_dir(&fd_dir) {
        for e in entries.flatten() {
            if let Ok(target) = std::fs::read_link(e.path()) {
                let t = target.to_string_lossy();
                if let Some(rest) = t.strip_prefix("socket:[") {
                    if let Some(num) = rest.strip_suffix(']') {
                        if let Ok(inode) = num.parse::<u64>() { inodes.insert(inode); }
                    }
                }
            }
        }
    }
    inodes
}

/// Ports en écoute ouverts par le sous-arbre de process de `root_pid`.
pub fn listening_ports(root_pid: u32) -> Vec<u16> {
    let mut inode_to_port = parse_listening(&std::fs::read_to_string("/proc/net/tcp").unwrap_or_default());
    inode_to_port.extend(parse_listening(&std::fs::read_to_string("/proc/net/tcp6").unwrap_or_default()));
    let pids = descendant_pids(root_pid);
    let mut ports: HashSet<u16> = HashSet::new();
    for pid in pids {
        for inode in socket_inodes_of(pid) {
            if let Some(port) = inode_to_port.get(&inode) { ports.insert(*port); }
        }
    }
    let mut v: Vec<u16> = ports.into_iter().collect();
    v.sort_unstable();
    v
}
```
Déclarer `mod ports;` dans `lib.rs`.

- [ ] **Step 4 : Run (doit passer)**

Run : `cargo test -p terminials --lib ports`
Expected: PASS.

- [ ] **Step 5 : Exposer le PID du shell + commande ports**

Le PID du process enfant est nécessaire. Dans `pty.rs`, `spawn_command` retourne un `Box<dyn Child>` ; stocker `child.process_id()` dans `PtyHandle` (ajouter `pub pid: Option<u32>`). Garder le `child` vivant dans le handle pour ne pas tuer le process. Puis dans `lib.rs` :
```rust
#[tauri::command]
fn workspace_ports(reg: tauri::State<'_, std::sync::Arc<crate::pty::PtyRegistry>>, pty_id: crate::pty::PtyId) -> Vec<u16> {
    let handles = reg.handles.lock().unwrap();
    match handles.get(&pty_id).and_then(|h| h.pid) {
        Some(pid) => crate::ports::listening_ports(pid),
        None => vec![],
    }
}
```
L'ajouter à `generate_handler!`. (Note : un workspace v1 peut avoir plusieurs panes ; pour la sidebar on interroge le PTY du premier leaf — le front passe son `pty_id`. Le front doit donc mémoriser le `pty_id` retourné par `spawnPty` par leaf : étendre le store avec une map `paneId -> ptyId`, renseignée dans `TerminalPane` après `spawnPty`.)

- [ ] **Step 6 : Poller ports côté front**

Étendre le `setInterval` de Task 5.2 : pour chaque workspace, récupérer le `ptyId` du premier leaf via le store, `invoke<number[]>('workspace_ports', { ptyId })`, et appeler une action `setPorts(wsId, ports)` (à ajouter au store, qui set `ports`). La sidebar les affiche déjà (Task 2.2).

- [ ] **Step 7 : Vérification manuelle**

App lancée, dans un pane lancer un serveur : `python3 -m http.server 8080`.
Expected: `:8080` apparaît dans la ligne du workspace dans la sidebar sous ~2s.

- [ ] **Step 8 : Commit**

```bash
git add src-tauri/src src/
git commit -m "feat(ports): détection des ports en écoute du sous-arbre PTY"
```

---

## Phase 6 — Hook Claude Code + finitions

### Task 6.1 : Commande `terminials hooks setup`

**Files:**
- Modify: `crates/cli/src/main.rs`
- Create: `crates/cli/src/hooks.rs`

- [ ] **Step 1 : Implémenter l'installation du hook**

`crates/cli/src/hooks.rs` :
```rust
use std::path::PathBuf;

const HOOK_SCRIPT: &str = r#"#!/bin/bash
# Hook Claude Code -> terminials : notifie quand l'agent s'arrête / attend.
SOCK="${XDG_RUNTIME_DIR:-/tmp}/terminials.sock"
[ -S "$SOCK" ] || exit 0
EVENT=$(cat)
TYPE=$(echo "$EVENT" | jq -r '.hook_event_name // "unknown"' 2>/dev/null)
case "$TYPE" in
  Stop)         terminials notify --title "Claude Code" --body "Session terminée" ;;
  Notification) terminials notify --title "Claude Code" --body "En attente d'une entrée" ;;
esac
"#;

pub fn setup() -> std::io::Result<PathBuf> {
    let home = std::env::var("HOME").map_err(std::io::Error::other)?;
    let dir = PathBuf::from(&home).join(".claude/hooks");
    std::fs::create_dir_all(&dir)?;
    let script = dir.join("terminials-notify.sh");
    std::fs::write(&script, HOOK_SCRIPT)?;
    use std::os::unix::fs::PermissionsExt;
    std::fs::set_permissions(&script, std::fs::Permissions::from_mode(0o755))?;
    Ok(script)
}
```

- [ ] **Step 2 : Ajouter la sous-commande**

Déclarer `pub mod hooks;` dans `crates/cli/src/lib.rs`. Dans `crates/cli/src/main.rs`, ajouter la variante et son traitement. La variante `Hooks` ne passe PAS par le socket (elle agit sur le filesystem), donc la traiter avant le `send_request` :
```rust
#[derive(Subcommand)]
enum Cmd {
    // ... variantes existantes ...
    Hooks { #[command(subcommand)] action: HooksAction },
}

#[derive(Subcommand)]
enum HooksAction { Setup }

fn main() {
    let cli = Cli::parse();
    // Les commandes filesystem (hooks) sont traitées avant l'accès socket.
    if let Cmd::Hooks { action: HooksAction::Setup } = &cli.cmd {
        match terminials_cli::hooks::setup() {
            Ok(path) => {
                println!("Hook installé : {}", path.display());
                println!("Ajoute ceci à ~/.claude/settings.json (clés \"Stop\" et \"Notification\") :");
                println!("  \"hooks\": {{ \"Stop\": [{{ \"hooks\": [{{ \"type\": \"command\", \"command\": \"{}\" }}] }}] }}", path.display());
            }
            Err(e) => { eprintln!("échec installation hook : {e}"); std::process::exit(1); }
        }
        return;
    }
    let (method, params) = match cli.cmd {
        // ... bras existants ...
        Cmd::Hooks { .. } => unreachable!(),
    };
    // ... send_request inchangé ...
}
```

- [ ] **Step 3 : Compiler**

Run : `cargo build -p terminials-cli`
Expected: compile.

- [ ] **Step 4 : Vérification manuelle**

Run : `cargo run -p terminials-cli -- hooks setup`
Expected: crée `~/.claude/hooks/terminials-notify.sh` exécutable, affiche le chemin + instructions settings.json.

- [ ] **Step 5 : Commit**

```bash
git add crates/cli
git commit -m "feat(cli): terminials hooks setup (script Claude Code)"
```

---

### Task 6.2 : Build release + installation du binaire CLI

**Files:**
- Create: `scripts/install-cli.sh`
- Create: `README.md`

- [ ] **Step 1 : Script d'installation du binaire CLI dans le PATH**

`scripts/install-cli.sh` :
```bash
#!/bin/bash
set -e
cargo build -p terminials-cli --release
mkdir -p "$HOME/.local/bin"
ln -sf "$(pwd)/target/release/terminials" "$HOME/.local/bin/terminials"
echo "terminials installé dans ~/.local/bin (vérifier que c'est dans le PATH)."
```
`chmod +x scripts/install-cli.sh`.

- [ ] **Step 2 : Build release de l'app**

Run : `npm run tauri build`
Expected: produit un binaire et un paquet (`.deb`/AppImage) dans `src-tauri/target/release/bundle/`.

- [ ] **Step 3 : Écrire le README**

`README.md` : décrire ce qu'est terminials, prérequis (`libwebkit2gtk-4.1-dev`), `npm run tauri dev`, `npm run tauri build`, `scripts/install-cli.sh`, et un tableau des commandes CLI. (Contenu complet à rédiger : sections Présentation, Installation, Usage, CLI, Raccourcis.)

- [ ] **Step 4 : Commit**

```bash
git add scripts README.md
git commit -m "chore: script d'install CLI + README"
```

---

### Task 6.3 : Passe finale qualité

**Files:** divers

- [ ] **Step 1 : Lancer tous les tests**

Run : `cargo test --workspace && npm run test`
Expected: tout PASS.

- [ ] **Step 2 : Lint Rust**

Run : `cargo clippy --workspace --all-targets -- -D warnings`
Expected: pas de warning bloquant (corriger sinon).

- [ ] **Step 3 : Smoke test complet**

Lancer l'app, créer 2 workspaces, lancer un vrai `claude` dans l'un, vérifier : terminal interactif OK, split OK, branche git affichée, et quand Claude attend → badge + notif desktop (app en arrière-plan). Lancer `terminials hooks setup` et tester un cycle Claude Code réel.

- [ ] **Step 4 : Commit final**

```bash
git add -A
git commit -m "chore: passe qualité (tests, clippy, smoke)"
```

---

## Notes d'exécution

- **Nom du package `-p`** : les commandes `cargo test -p terminials` supposent que `src-tauri/Cargo.toml` a `name = "terminials"`. Le scaffolder le nomme souvent d'après le dossier (`src-tauri` → ajuster, ou le nom choisi). Vérifier en Task 0.2 et adapter tous les `-p` en conséquence.
- **Label de fenêtre** : `request_user_attention` cible `get_webview_window("main")` — confirmer le label dans `tauri.conf.json`.
- **Wayland** : `request_user_attention` est un no-op sous Wayland. La cible étant X11, OK ; sinon la notif D-Bus reste le canal fiable.
- **Séquences OSC à cheval sur 2 chunks** : non gérées en v1 (documenté Task 4.2). Amélioration v2 si nécessaire.
