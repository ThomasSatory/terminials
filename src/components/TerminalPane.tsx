import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { spawnPty, closePty, type Pty } from "../lib/pty";
import { useWorkspaceStore } from "../store/workspace";
import { terminalGardeTouche } from "../lib/shortcuts";
import { OPTIONS_TERMINAL } from "../lib/terminalTheme";
import { enregistrerTerminal, desenregistrerTerminal } from "../lib/terminalRegistry";
import { registerTabFocus, unregisterTabFocus } from "../lib/tabFocus";
import { injectPaths, savePastedImage } from "../lib/injectFiles";
import { resumeCommand } from "../lib/claudeResume";
import { forget, noteInput, noteOutput, setBusy } from "../lib/agentBusy";
import { estEchapSeul, retourArme, saisieReelle } from "../lib/retourMosaique";
import { dispatchShortcut } from "../lib/shortcutDispatch";
import { useUiStore } from "../store/ui";
import { useDashboardStore } from "../store/dashboard";
import { useReglagesStore } from "../store/reglages";
import { optionsTerminal } from "../lib/apparence";
import { shellEffectif } from "../lib/reglages";
import { oublierWebgl, reserverWebgl } from "../lib/webglPool";
import { ouvrirMenuTerminal } from "./MenuTerminal";

/** Calme exigé avant de refaire la grille après un redimensionnement : une réserve qui
    s’anime (dock) ou une fenêtre qu'on tire changent la taille à
    chaque image. Refaire la grille à chaque fois, c'est un resize du PTY et un SIGWINCH par
    image, que les agents en plein écran (TUI) redessinent en entier ; on attend que la
    taille se pose (une image dure ~16 ms, l'attente la dépasse largement). */
const CALME_REFIT_MS = 90;

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
  // Prise d'un contexte WebGL (lib/webglPool), rappelée à chaque révélation.
  const webglRef = useRef<() => void>(() => {});
  // Police changée pendant que le terminal était caché, appliquée à sa révélation.
  const policeRef = useRef<() => void>(() => {});
  // Visibilité courante, lue au montage par l'effet principal (qui ne dépend pas d'elle).
  const visibleRef = useRef(visible);
  visibleRef.current = visible;

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    // Réglages lus au montage (taille, police, défilement, accent), puis suivis en direct
    // plus bas. Le shell, lui, n'est lu qu'ici : il ne change que pour les terminaux neufs.
    const reglages = useReglagesStore.getState();
    const term = new Terminal({ ...OPTIONS_TERMINAL, ...optionsTerminal(reglages.reglages) });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);

    // Couche terminal des raccourcis : return false = xterm n'avale pas la
    // combinaison (rien ne part au PTY). Pas de dispatch ici : le keydown
    // bulle jusqu'au listener window (useShortcuts) qui fait l'unique
    // preventDefault + dispatch. Ctrl+W nu ne matche pas → part au shell
    // (kill-word readline préservé). Ctrl+Shift+C/V ne matchent jamais.
    // Seule exception : Échap, quand cet espace vient d'être ouvert depuis la mosaïque
    // et qu'on n'y a encore rien tapé (variante « retour » de la barre du haut,
    // lib/retourMosaique) — il y ramène au lieu de partir au shell.
    term.attachCustomKeyEventHandler((e) => {
      if (estEchapSeul(e)) {
        const ui = useUiStore.getState();
        const s = useWorkspaceStore.getState();
        const ws = s.workspaces.find((w) => w.id === wsId);
        const vues = { recapOuvert: useDashboardStore.getState().open, diffOuvert: ws?.diffOpen === true };
        if (s.activeId === wsId && retourArme(ui, wsId, vues)) {
          e.preventDefault();
          dispatchShortcut({ type: "toggle-mosaique" });
          return false;
        }
      }
      return terminalGardeTouche(e);
    });

    // Registre en lecture seule (mosaïque) : n'influe pas sur le cycle de vie ci-dessous.
    enregistrerTerminal(tabId, term);

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

    // Clic droit : le menu de l'app (Copier, Coller, Tout sélectionner) au lieu du menu
    // natif de WebKitGTK.
    const onMenu = (e: MouseEvent) => {
      e.preventDefault();
      ouvrirMenuTerminal(e.clientX, e.clientY, {
        selection: () => term.getSelection(),
        toutSelectionner: () => term.selectAll(),
        focus: () => term.focus(),
      });
    };
    host.addEventListener("contextmenu", onMenu);

    // Renderer WebGL avec fallback DOM (xterm 6 : le renderer canvas a été supprimé).
    // Pris quand le terminal se montre, en nombre borné (lib/webglPool) : un terminal resté
    // caché rend son contexte au profit d'un plus récent et repasse au rendu DOM.
    let webgl: WebglAddon | null = null;
    const rendreWebgl = () => {
      const a = webgl;
      webgl = null;
      a?.dispose();
    };
    const prendreWebgl = () => {
      if (webgl) {
        reserverWebgl(tabId, rendreWebgl);
        return;
      }
      try {
        const a = new WebglAddon();
        a.onContextLoss(() => {
          oublierWebgl(tabId);
          if (webgl === a) rendreWebgl();
        });
        term.loadAddon(a);
        webgl = a;
        reserverWebgl(tabId, rendreWebgl);
      } catch {
        /* fallback DOM implicite */
      }
    };
    webglRef.current = prendreWebgl;
    if (visibleRef.current) prendreWebgl();

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

    const shell = shellEffectif(reglages.reglages, reglages.infos?.shellSession);
    spawnPty({ workspaceId: wsId, shell, cwd, cols: term.cols, rows: term.rows }, (bytes) => {
      if (pty) noteOutput(pty.id);
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
      const st = useWorkspaceStore.getState();
      st.setTabPty(tabId, p.id);
      // Onglet restauré avec une session Claude : la commande est tapée dans le shell, comme
      // cmux. Le shell la lit dès qu'il est prêt et survit à la sortie de Claude.
      const tab = st.workspaces.find((w) => w.id === wsId)?.tabs.find((t) => t.id === tabId);
      if (tab?.pendingResume) {
        // Réglage « Reprendre les sessions Claude » coupé : la reprise est consommée
        // sans être tapée.
        const cmd = resumeCommand(tab.pendingResume);
        if (cmd && useReglagesStore.getState().reglages.terminal.reprendreSessions) p.write(cmd);
        st.consumePendingResume(wsId, tabId);
      }
      term.onData((d) => {
        noteInput(p.id, d);
        // Première vraie saisie : on travaille dans ce terminal, Échap redevient au shell.
        if (saisieReelle(d)) useUiStore.getState().desarmerRetourMosaique();
        p.write(d);
      });
      // Le shell est mort : on l'indique au lieu de laisser un terminal figé.
      listen<{ id: number }>("pty-exit", (e) => {
        if (e.payload.id !== p.id) return;
        term.write("\r\n[Processus terminé]\r\n");
        // Shell mort : rien n'a été « terminé » par un agent.
        setBusy(p.id, false, Date.now(), false);
        forget(p.id);
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

    // Redimensionnements en rafale : un seul refit, quand la taille s'est posée.
    let attenteRefit: number | undefined;
    const ro = new ResizeObserver(() => {
      window.clearTimeout(attenteRefit);
      attenteRefit = window.setTimeout(refit, CALME_REFIT_MS);
    });
    ro.observe(host);

    // Réglages en direct : taille, police, défilement, curseur et sélection à l'accent.
    // Une taille ou une police neuve change la grille : on refait le fit (PTY compris).
    // C'est cher (atlas de glyphes, rendu complet, SIGWINCH) : seul un terminal affiché
    // l'applique tout de suite ; un terminal caché (autre onglet, autre espace, vue des
    // Paramètres par-dessus) l'applique à sa révélation. Une dizaine de terminaux
    // retaillés à chaque pas de « + » figeait sinon l'interface plusieurs secondes.
    let policeEnAttente = false;
    const appliquerPolice = () => {
      policeEnAttente = false;
      const o = optionsTerminal(useReglagesStore.getState().reglages);
      if (term.options.fontSize === o.fontSize && term.options.fontFamily === o.fontFamily) return;
      term.options.fontSize = o.fontSize;
      term.options.fontFamily = o.fontFamily;
      refit();
    };
    policeRef.current = () => {
      if (policeEnAttente) appliquerPolice();
    };
    const desabonnerReglages = useReglagesStore.subscribe((s, prev) => {
      if (s.reglages.terminal === prev.reglages.terminal && s.reglages.apparence.accent === prev.reglages.apparence.accent) {
        return;
      }
      const o = optionsTerminal(s.reglages);
      if (term.options.scrollback !== o.scrollback) term.options.scrollback = o.scrollback;
      // Thème (curseur et sélection) : ne dépend que de l'accent ; le réécrire redessine.
      if (s.reglages.apparence.accent !== prev.reglages.apparence.accent) term.options.theme = o.theme;
      if (term.options.fontSize !== o.fontSize || term.options.fontFamily !== o.fontFamily) {
        if (visibleRef.current) appliquerPolice();
        else policeEnAttente = true;
      }
    });

    // « Copier à la sélection » : la sélection part au presse-papier dès qu'elle est
    // faite (Ctrl+Maj+C reste disponible).
    const selectionSub = term.onSelectionChange(() => {
      if (!useReglagesStore.getState().reglages.terminal.copierSelection || !term.hasSelection()) return;
      void navigator.clipboard?.writeText(term.getSelection()).catch(() => {});
    });

    return () => {
      disposed = true;
      refitRef.current = () => {};
      webglRef.current = () => {};
      policeRef.current = () => {};
      ro.disconnect();
      window.clearTimeout(attenteRefit);
      oublierWebgl(tabId);
      desabonnerReglages();
      selectionSub.dispose();
      host.removeEventListener("paste", onPaste, true);
      host.removeEventListener("contextmenu", onMenu);
      unlistenExit?.();
      titleSub.dispose();
      if (pty) {
        closePty(pty.id);
        forget(pty.id);
        useWorkspaceStore.getState().removeTabPty(tabId);
      }
      unregisterTabFocus(tabId);
      desenregistrerTerminal(tabId, term);
      term.dispose();
    };
  }, [wsId, tabId, cwd]);

  // Révélation de l'onglet (visibility hidden → visible, par changement d'onglet ou de
  // workspace) : les dimensions ont pu changer pendant la période masquée → refit
  // explicite (le garde-fou dans refit rend l'appel inoffensif si le conteneur n'est
  // pas encore dimensionné).
  useEffect(() => {
    if (!visible) return;
    webglRef.current();
    policeRef.current();
    refitRef.current();
  }, [visible]);

  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}
