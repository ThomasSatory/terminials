import ReactDOM from "react-dom/client";
import "./styles/tokens.css";
import App from "./App";
import { POLICE_TERMINAL } from "./lib/terminalTheme";
import { neutraliserMenuNatif } from "./lib/menuNatif";

/** Polices embarquées chargées AVANT le premier rendu : xterm mesure ses cellules à
    l'ouverture du terminal ; mesurées avec la police de repli, elles resteraient
    fausses (texte qui déborde ou se chevauche). Fichiers locaux : quelques ms. */
async function chargerPolices(): Promise<void> {
  if (typeof document === "undefined" || !document.fonts) return;
  await Promise.all([
    document.fonts.load(`13px ${POLICE_TERMINAL}`),
    document.fonts.load(`500 13px ${POLICE_TERMINAL}`),
    document.fonts.load(`13px "Inter Variable"`),
  ]).catch(() => {
    /* police indisponible : le repli s'affiche, l'app démarre quand même */
  });
}

// Menu natif de la webview (Back / Forward / Reload) : jamais hors des champs de texte et
// du terminal (lib/menuNatif). Posé avant le premier rendu, pour toute la vie de la page.
neutraliserMenuNatif();

// Pas de StrictMode : le double-montage des effets en dev ouvrirait deux PTY par pane
// (le spawn PTY n'est pas idempotent et le thread lecteur Rust ne s'annule pas).
void chargerPolices().then(() =>
  ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />),
);
