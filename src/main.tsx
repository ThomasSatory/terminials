import ReactDOM from "react-dom/client";
import App from "./App";

// Pas de StrictMode : le double-montage des effets en dev ouvrirait deux PTY par pane
// (le spawn PTY n'est pas idempotent et le thread lecteur Rust ne s'annule pas).
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
