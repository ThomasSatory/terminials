import { useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore, getLastFolder, setLastFolder } from "../store/workspace";
import { resolveDraft, type ResolvedDraft } from "../lib/workspaceDraft";
import { abbreviateHome } from "../lib/paths";

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
 * Formulaire inline nom + dossier de la Sidebar, partagé par la création
 * (bouton +, Ctrl+Shift+N) et l'édition d'un workspace existant (double-clic
 * sur le nom, clic sur la ligne de chemin, Ctrl+Shift+R).
 *
 * Le dossier est affiché abrégé (`~/…`) et réexpansé par resolveDraft : ce que
 * l'utilisateur voit est ce qu'il peut retaper. Validation en deux temps —
 * resolveDraft (chemin absolu déterminable) puis `dir_exists` côté Rust ; un
 * dossier inexistant laisse le formulaire ouvert plutôt que de créer un
 * workspace dont les shells échoueraient au spawn.
 */
export function WorkspaceForm({
  initialName,
  initialFolder,
  home,
  focusField,
  onCommit,
  onCancel,
}: {
  initialName: string;
  /** Chemin absolu, ou "" pour laisser le placeholder « ~ » (= $HOME). */
  initialFolder: string;
  home: string;
  focusField: "name" | "folder";
  onCommit: (resolved: ResolvedDraft) => void;
  onCancel: () => void;
}) {
  const [name, setName] = useState(initialName);
  const [folder, setFolder] = useState(initialFolder ? abbreviateHome(initialFolder, home) : "");
  // Le dialog GTK vole le focus (relatedTarget null) : sans ce garde, l'ouverture
  // du sélecteur annulerait le formulaire. Sert aussi d'anti double-ouverture.
  const dialogOpen = useRef(false);

  const commit = async () => {
    const resolved = resolveDraft({ name, folder }, home);
    if (!resolved) {
      // Deux causes possibles, cf. resolveDraft : chemin relatif saisi, ou $HOME
      // pas encore résolu par Tauri alors que le champ dossier s'appuie sur lui.
      useWorkspaceStore
        .getState()
        .showToast(home ? "chemin absolu attendu (ex. ~/dev/app)" : "home pas encore résolu");
      return;
    }
    const exists = await invoke<boolean>("dir_exists", { path: resolved.cwd }).catch(() => false);
    if (!exists) {
      useWorkspaceStore.getState().showToast(`dossier introuvable : ${resolved.cwd}`);
      return;
    }
    onCommit(resolved);
  };

  const browse = async () => {
    if (dialogOpen.current) return;
    dialogOpen.current = true;
    try {
      const path = await open({ directory: true, defaultPath: getLastFolder() });
      if (typeof path !== "string") return; // annulation
      setFolder(abbreviateHome(path, home));
      setLastFolder(path);
    } finally {
      dialogOpen.current = false;
    }
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      e.preventDefault();
      void commit();
    } else if (e.key === "Escape") {
      e.preventDefault();
      onCancel();
    }
  };

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      onKeyDown={onKeyDown}
      onBlur={(e) => {
        // relatedTarget null = focus sorti de la fenêtre (dialog GTK) : on garde
        // le formulaire. Sinon on n'annule que si le focus quitte le formulaire.
        const next = e.relatedTarget as Node | null;
        if (!next || dialogOpen.current) return;
        if (!e.currentTarget.contains(next)) onCancel();
      }}
      style={{ display: "flex", flexDirection: "column", gap: 3, flex: 1, minWidth: 0 }}
    >
      <input
        autoFocus={focusField === "name"}
        onFocus={(e) => e.target.select()}
        value={name}
        placeholder="nom"
        onChange={(e) => setName(e.target.value)}
        style={INPUT}
      />
      <div style={{ display: "flex", gap: 3, minWidth: 0 }}>
        <input
          autoFocus={focusField === "folder"}
          onFocus={(e) => e.target.select()}
          value={folder}
          placeholder="~"
          onChange={(e) => setFolder(e.target.value)}
          style={{ ...INPUT, flex: 1 }}
        />
        <button className="icon-btn icon-btn-sm" onClick={() => void browse()} title="Choisir un dossier">
          …
        </button>
        <button className="icon-btn icon-btn-sm" onClick={() => void commit()} title="Valider (Entrée)">
          ✓
        </button>
      </div>
      <div style={{ fontSize: 10, color: "#6f6f6f" }}>Entrée valide · Échap annule</div>
    </div>
  );
}
