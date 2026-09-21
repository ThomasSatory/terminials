import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { spawnPty, closePty, type Pty } from "../lib/pty";
import { useWorkspaceStore } from "../store/workspace";
import { matchShortcut } from "../lib/shortcuts";
import { registerTabFocus, unregisterTabFocus } from "../lib/tabFocus";
import { injectPaths, savePastedImage } from "../lib/injectFiles";

const SHELL = "/bin/bash";

/**
 * Un terminal xterm + son PTY, monté une fois pour toute la vie de l'onglet.
 * NE JAMAIS le démonter tant que l'onglet existe : le cleanup ferme le PTY.
 */
export function TerminalPane({
  wsId,
  tabId,
  cwd,
  visible,
}: {
  wsId: string;
  tabId: string;
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

    // Couche terminal des raccourcis : return false = xterm n'avale pas la
    // combinaison (rien ne part au PTY). Pas de dispatch ici : le keydown
    // bulle jusqu'au listener window (useShortcuts) qui fait l'unique
    // preventDefault + dispatch. Ctrl+W nu ne matche pas → part au shell
    // (kill-word readline préservé). Ctrl+Shift+C/V ne matchent jamais.
    term.attachCustomKeyEventHandler((e) => matchShortcut(e) === null);

    // Focus programmatique (Alt+←/→, clic d'onglet via focusTab) : cet onglet expose son focus.
    registerTabFocus(tabId, () => term.focus());

    // Titre d'onglet : OSC 0/2 envoyés par le shell/programme (bash PROMPT_COMMAND, vim,
    // Claude Code…). Front pur, rien côté Rust. Le store court-circuite les répétitions.
    const titleSub = term.onTitleChange((title) =>
      useWorkspaceStore.getState().setTabTitle(wsId, tabId, title.trim()),
    );

    // Collage d'une image (Ctrl+Shift+V) : xterm ne sait coller que du texte. On écoute
    // en CAPTURE sur le host, donc avant les listeners xterm — mais on ne dévie que si
    // le presse-papier contient une image. Sans image, l'event poursuit sa route et le
    // collage texte reste celui du terminal : la touche n'est jamais interceptée
    // (invariant « Ctrl+Shift+C/V = copier/coller du terminal », README).
    const onPaste = (e: ClipboardEvent) => {
      const files = e.clipboardData?.files;
      const image = files && Array.from(files).find((f) => f.type.startsWith("image/"));
      if (!image) return;
      e.preventDefault();
      e.stopImmediatePropagation();
      savePastedImage(image)
        .then((path) => {
          if (!injectPaths(tabId, [path])) {
            useWorkspaceStore.getState().showToast("terminal indisponible pour l'image collée");
          }
        })
        .catch((err) =>
          useWorkspaceStore.getState().showToast(`échec du collage d'image : ${String(err)}`),
        );
    };
    host.addEventListener("paste", onPaste, true);

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
      useWorkspaceStore.getState().setTabPty(tabId, p.id);
      term.onData((d) => p.write(d));
      // Le shell est mort : on l'indique au lieu de laisser un terminal figé.
      listen<{ id: number }>("pty-exit", (e) => {
        if (e.payload.id === p.id) term.write("\r\n[Processus terminé]\r\n");
      }).then((un) => {
        if (disposed) un();
        else unlistenExit = un;
      });
    }).catch((err) => {
      // L'onglet a pu être démonté avant la résolution de la promesse : ne pas
      // écrire dans un terminal déjà disposé (même garde que le .then voisin).
      if (disposed) return;
      // Échec du spawn (shell introuvable, cwd disparu…) : visible dans le
      // terminal plutôt qu'un onglet muet.
      term.write(`\r\n\x1b[31m[terminials] échec du lancement du shell : ${String(err)}\x1b[0m\r\n`);
    });

    const ro = new ResizeObserver(refit);
    ro.observe(host);

    return () => {
      disposed = true;
      refitRef.current = () => {};
      ro.disconnect();
      host.removeEventListener("paste", onPaste, true);
      unlistenExit?.();
      titleSub.dispose();
      if (pty) {
        closePty(pty.id);
        useWorkspaceStore.getState().removeTabPty(tabId);
      }
      unregisterTabFocus(tabId);
      term.dispose();
    };
  }, [wsId, tabId, cwd]);

  // Révélation de l'onglet (visibility hidden → visible, par changement d'onglet ou de
  // workspace) : les dimensions ont pu changer pendant la période masquée → refit
  // explicite (le garde-fou dans refit rend l'appel inoffensif si le conteneur n'est
  // pas encore dimensionné).
  useEffect(() => {
    if (visible) refitRef.current();
  }, [visible]);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}
