import { useEffect } from "react";
import type { Workspace } from "../store/workspace";
import { focusTab } from "../lib/tabFocus";
import { TerminalPane } from "./TerminalPane";
// Entrée des panneaux (.terminal-panneau) : rangée avec la barre d'onglets qui la déclenche.
import "../styles/topbar.css";

/** Identifiants partagés avec la barre du haut (TopBar) : chaque onglet (`role=tab`)
    désigne le panneau qu'il contrôle, et chaque panneau l'onglet qui le nomme. */
export const idOnglet = (tabId: string) => `onglet-${tabId}`;
export const idPanneau = (tabId: string) => `panneau-${tabId}`;

/**
 * Pile des terminaux d'un espace. Les onglets eux-mêmes sont dans la barre du haut
 * (TopBar) : ici, uniquement les TerminalPane, empilés.
 *
 * Keep-alive : TOUS les onglets restent montés, l'inactif en `visibility:hidden` —
 * JAMAIS display:none (un conteneur 0×0 ferait fit() → resize_pty(0) → reflow shell
 * cassé), JAMAIS de démontage tant que l'onglet existe (son cleanup ferme le PTY).
 * `visible` = l'espace lui-même est affiché ; un onglet n'est visible que si son espace
 * l'est ET qu'il est l'onglet actif.
 */
export function TabbedTerminals({ ws, visible }: { ws: Workspace; visible: boolean }) {
  // Focus du terminal quand l'onglet actif change (clic dans la barre du haut, Alt+←/→,
  // nouvel onglet) ou quand l'espace réapparaît : le TerminalPane d'un onglet tout neuf
  // n'est enregistré qu'après son montage, d'où l'effet plutôt qu'un appel direct dans
  // le gestionnaire du clic.
  useEffect(() => {
    if (visible && ws.activeTabId) focusTab(ws.activeTabId);
  }, [visible, ws.activeTabId]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      {ws.tabs.map((tab) => {
        const shown = visible && tab.id === ws.activeTabId;
        return (
          <div
            key={tab.id}
            id={idPanneau(tab.id)}
            role="tabpanel"
            aria-labelledby={idOnglet(tab.id)}
            /* Cible du glisser-déposer de fichiers : resolvePaneId remonte jusqu'ici
               depuis l'élément xterm survolé (cf. lib/dropTarget). Seul l'onglet visible
               peut être survolé, donc le fichier tombe dans le bon terminal. */
            data-pane-id={tab.id}
            /* Entrée de la maquette (inA) rejouée à chaque fois que ce panneau devient
               celui qu'on voit (onglet ou espace choisi, retour d'une vue) : l'animation
               n'est posée que tant que data-affiche vaut true, donc la reposer la relance,
               sans remonter le terminal. */
            data-affiche={shown}
            className="terminal-panneau"
            style={{
              position: "absolute",
              inset: 0,
              visibility: shown ? "visible" : "hidden",
            }}
          >
            <TerminalPane wsId={ws.id} tabId={tab.id} cwd={tab.cwd ?? ws.cwd} visible={shown} />
          </div>
        );
      })}
    </div>
  );
}
