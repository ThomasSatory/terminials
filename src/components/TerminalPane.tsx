import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { spawnPty, closePty, type Pty } from "../lib/pty";
import { useWorkspaceStore } from "../store/workspace";

const SHELL = "/bin/bash";

export function TerminalPane({
  wsId,
  paneId,
  cwd,
  visible,
}: {
  wsId: string;
  paneId: string;
  cwd: string;
  visible: boolean;
}) {
  const hostRef = useRef<HTMLDivElement>(null);
  // Refit courant, rempli par l'effet principal ; rappelé à la révélation du workspace.
  const refitRef = useRef<() => void>(() => {});

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const term = new Terminal({ fontFamily: "monospace", fontSize: 13, cursorBlink: true });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // Renderer WebGL avec fallback DOM (xterm 6 : le renderer canvas a été supprimé).
    try {
      const webgl = new WebglAddon();
      webgl.onContextLoss(() => webgl.dispose());
      term.loadAddon(webgl);
    } catch {
      /* fallback DOM implicite */
    }

    let pty: Pty | null = null;
    // Garde-fou keep-alive : ne jamais fit/resize un conteneur sans dimensions
    // (fit() à 0×0 → resize_pty(0) → reflow du shell cassé).
    const refit = () => {
      if (host.clientWidth === 0 || host.clientHeight === 0) return;
      fit.fit();
      pty?.resize(term.cols, term.rows);
    };
    refitRef.current = refit;
    refit();

    let disposed = false;
    let unlistenExit: UnlistenFn | null = null;
    let buffer: Uint8Array[] = [];
    let flushScheduled = false;
    const flush = () => {
      flushScheduled = false;
      for (const chunk of buffer) term.write(chunk);
      buffer = [];
    };

    spawnPty({ workspaceId: wsId, shell: SHELL, cwd, cols: term.cols, rows: term.rows }, (bytes) => {
      // Batch à ~1 frame pour éviter le layout thrashing.
      buffer.push(bytes);
      if (!flushScheduled) {
        flushScheduled = true;
        requestAnimationFrame(flush);
      }
    }).then((p) => {
      if (disposed) {
        closePty(p.id);
        return;
      }
      pty = p;
      useWorkspaceStore.getState().setPanePty(paneId, p.id);
      term.onData((d) => p.write(d));
      // Le shell est mort : on l'indique au lieu de laisser un terminal figé.
      listen<{ id: number }>("pty-exit", (e) => {
        if (e.payload.id === p.id) term.write("\r\n[Processus terminé]\r\n");
      }).then((un) => {
        if (disposed) un();
        else unlistenExit = un;
      });
    }).catch((err) => {
      // Échec du spawn (shell introuvable, cwd disparu…) : visible dans le
      // terminal plutôt qu'un pane muet.
      term.write(`\r\n\x1b[31m[terminials] échec du lancement du shell : ${String(err)}\x1b[0m\r\n`);
    });

    const ro = new ResizeObserver(refit);
    ro.observe(host);

    return () => {
      disposed = true;
      refitRef.current = () => {};
      ro.disconnect();
      unlistenExit?.();
      if (pty) {
        closePty(pty.id);
        useWorkspaceStore.getState().removePanePty(paneId);
      }
      term.dispose();
    };
  }, [wsId, paneId, cwd]);

  // Révélation du workspace (visibility hidden → visible) : les dimensions ont pu
  // changer pendant la période masquée → refit explicite (le garde-fou dans refit
  // rend l'appel inoffensif si le conteneur n'est pas encore dimensionné).
  useEffect(() => {
    if (visible) refitRef.current();
  }, [visible]);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}
