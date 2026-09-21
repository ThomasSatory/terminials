import { useState } from "react";
import { PALETTE } from "../lib/palette";

const INPUT: React.CSSProperties = {
  minWidth: 0,
  background: "#111",
  color: "#eee",
  border: "1px solid #444",
  borderRadius: 3,
  padding: "1px 3px",
  font: "inherit",
};

/**
 * Formulaire inline nom + couleur d'un groupe, partagé par la création (bouton
 * « + groupe », Ctrl+Shift+G) et l'édition (✎ sur l'en-tête). Même protocole que
 * WorkspaceForm : Entrée valide, Échap annule, le blur hors du formulaire annule.
 */
export function GroupForm({
  initialName,
  initialColor,
  onCommit,
  onCancel,
}: {
  initialName: string;
  initialColor: string;
  onCommit: (r: { name: string; color: string }) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [color, setColor] = useState(initialColor);

  const commit = () => onCommit({ name: name.trim() || "Groupe", color });

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
      onBlur={(e) => {
        const next = e.relatedTarget as Node | null;
        if (next && !e.currentTarget.contains(next)) onCancel();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1, minWidth: 0 }}
    >
      <div style={{ display: "flex", gap: 3, minWidth: 0 }}>
        <input
          autoFocus
          onFocus={(e) => e.target.select()}
          value={name}
          placeholder="nom du groupe"
          onChange={(e) => setName(e.target.value)}
          style={{ ...INPUT, flex: 1 }}
        />
        <button className="icon-btn icon-btn-sm" onClick={commit} title="Valider (Entrée)">
          ✓
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 4 }}>
        {PALETTE.map((c) => (
          <span
            key={c}
            onClick={() => setColor(c)}
            style={{
              width: 14,
              height: 14,
              borderRadius: 3,
              background: c,
              cursor: "pointer",
              outline: c === color ? "2px solid #fff" : "none",
            }}
          />
        ))}
      </div>
      <div style={{ fontSize: 10, color: "#6f6f6f" }}>Entrée valide · Échap annule</div>
    </div>
  );
}
