import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { spawnPty, type Pty } from "../lib/pty";
import { useWorkspaceStore } from "../store/workspace";

const SHELL = "/bin/bash";

export function TerminalPane({ wsId, paneId, cwd }: { wsId: string; paneId: string; cwd: string }) {
  const hostRef = useRef<HTMLDivElement>(null);

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
    fit.fit();

    let pty: Pty | null = null;
    let disposed = false;
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
      if (disposed) return;
      pty = p;
      useWorkspaceStore.getState().setPanePty(paneId, p.id);
      term.onData((d) => p.write(d));
    });

    const ro = new ResizeObserver(() => {
      fit.fit();
      pty?.resize(term.cols, term.rows);
    });
    ro.observe(host);

    return () => {
      disposed = true;
      ro.disconnect();
      term.dispose();
    };
  }, [wsId, paneId, cwd]);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}
