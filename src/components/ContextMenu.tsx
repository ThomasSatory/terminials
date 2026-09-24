import { useEffect } from "react";
import { menuPosition } from "../lib/contextMenu";

/** Entrée de menu : une action, ou un simple filet de séparation. */
export type MenuItem = { label: string; shortcut?: string; run: () => void } | { separator: true };

const WIDTH = 210;
const ITEM_H = 26;
const SEP_H = 9;
const PAD = 8;

/** Hauteur estimée (les entrées ont une hauteur fixe) : sert au recalage contre
    les bords, avant que le menu ne soit monté — donc sans mesure ni scintillement. */
function height(items: MenuItem[]): number {
  return PAD + items.reduce((h, i) => h + ("separator" in i ? SEP_H : ITEM_H), 0);
}

/**
 * Menu contextuel de la sidebar (clic droit sur un workspace ou un en-tête de
 * groupe). Seul point d'entrée des actions : il n'y a plus de boutons au survol
 * sur les lignes.
 *
 * Le voile plein écran ferme au clic à côté (et avale le clic pour qu'il
 * n'active pas la ligne qui se trouve dessous) ; Échap ferme aussi.
 */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  // `window` est absent au rendu statique (tests) : une fenêtre immense laisse
  // alors le menu au point demandé.
  const viewport =
    typeof window === "undefined"
      ? { width: Number.MAX_SAFE_INTEGER, height: Number.MAX_SAFE_INTEGER }
      : { width: window.innerWidth, height: window.innerHeight };
  const { left, top } = menuPosition(x, y, { width: WIDTH, height: height(items) }, viewport);

  return (
    <div
      onPointerDown={(e) => {
        e.stopPropagation();
        onClose();
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
      style={{ position: "fixed", inset: 0, zIndex: 1000 }}
    >
      <div
        onPointerDown={(e) => e.stopPropagation()}
        style={{
          position: "fixed",
          left,
          top,
          width: WIDTH,
          padding: "4px 0",
          background: "#1e1e1e",
          border: "1px solid #333",
          borderRadius: 6,
          boxShadow: "0 8px 24px #000a",
          color: "#ddd",
          fontSize: 12,
          userSelect: "none",
        }}
      >
        {items.map((item, i) =>
          "separator" in item ? (
            <div
              key={`sep:${i}`}
              data-separator
              style={{ height: 1, margin: "4px 8px", background: "#333" }}
            />
          ) : (
            <button
              key={item.label}
              className="ctx-item"
              onClick={() => {
                item.run();
                onClose();
              }}
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                height: ITEM_H,
                padding: "0 10px",
                border: "none",
                background: "transparent",
                color: "inherit",
                font: "inherit",
                textAlign: "left",
                cursor: "pointer",
              }}
            >
              <span style={{ flex: 1, minWidth: 0 }}>{item.label}</span>
              {item.shortcut && <span style={{ color: "#6f6f6f" }}>{item.shortcut}</span>}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
