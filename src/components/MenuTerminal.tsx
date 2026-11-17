import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../store/workspace";
import { Kbd } from "./ui/Kbd";
import "../styles/menuTerminal.css";

/**
 * Menu du clic droit dans un terminal : Copier, Coller, Tout sélectionner, dans le
 * langage de l'app. Remplace le menu natif de WebKitGTK (clair, en anglais, avec des
 * entrées sans objet dans un terminal), qui offrait le copier-coller à la souris.
 * Ouvert par TerminalPane (ouvrirMenuTerminal), rendu une seule fois par App.
 */

/** Ce que le menu demande au terminal qui l'a ouvert. */
export interface ActionsTerminal {
  selection(): string;
  toutSelectionner(): void;
  focus(): void;
}

interface EtatMenu {
  ouvert: { x: number; y: number; actions: ActionsTerminal } | null;
}

const useMenuTerminal = create<EtatMenu>(() => ({ ouvert: null }));

export function ouvrirMenuTerminal(x: number, y: number, actions: ActionsTerminal): void {
  useMenuTerminal.setState({ ouvert: { x, y, actions } });
}

function fermerMenuTerminal(): void {
  useMenuTerminal.setState({ ouvert: null });
}

/** Largeur du menu et marge minimale au bord de la fenêtre. */
const LARGEUR = 220;
const MARGE = 8;

export function MenuTerminal() {
  const ouvert = useMenuTerminal((s) => s.ouvert);
  if (!ouvert) return null;
  // Clé = position : un nouveau clic droit remonte le menu (focus, mesure).
  return <Menu key={`${ouvert.x},${ouvert.y}`} {...ouvert} />;
}

function Menu({ x, y, actions }: { x: number; y: number; actions: ActionsTerminal }) {
  const ref = useRef<HTMLDivElement>(null);
  const [selection] = useState(() => actions.selection());
  const [place, setPlace] = useState({ left: x, top: y });

  // Gardé dans la fenêtre : ouvert vers le haut ou la gauche près des bords.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const h = el.offsetHeight;
    setPlace({
      left: Math.max(MARGE, Math.min(x, window.innerWidth - LARGEUR - MARGE)),
      top: y + h + MARGE > window.innerHeight ? Math.max(MARGE, y - h) : y,
    });
    // Le menu prend le focus (Échap, flèches) sans en désigner d'élément : ouvert à la
    // souris, aucun anneau de focus ; la première flèche entre dans la liste.
    el.focus();
  }, [x, y]);

  // Fermé par un appui ailleurs, la perte du focus de la fenêtre ou un redimensionnement.
  useEffect(() => {
    const dehors = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) fermerMenuTerminal();
    };
    const fermer = () => fermerMenuTerminal();
    window.addEventListener("pointerdown", dehors, true);
    window.addEventListener("blur", fermer);
    window.addEventListener("resize", fermer);
    return () => {
      window.removeEventListener("pointerdown", dehors, true);
      window.removeEventListener("blur", fermer);
      window.removeEventListener("resize", fermer);
    };
  }, []);

  const terminer = () => {
    fermerMenuTerminal();
    actions.focus();
  };

  const copier = () => {
    if (selection) void navigator.clipboard?.writeText(selection).catch(() => {});
    terminer();
  };
  const coller = () => {
    fermerMenuTerminal();
    // Focus au terminal d'abord : la commande « Coller » de la webview vise l'élément
    // focalisé (le textarea de xterm, qui reçoit l'événement paste et l'envoie au PTY).
    actions.focus();
    invoke("coller_presse_papier").catch(() =>
      useWorkspaceStore.getState().showToast("collage impossible : utilisez Ctrl+Maj+V"),
    );
  };
  const toutSelectionner = () => {
    actions.toutSelectionner();
    terminer();
  };

  const surClavier = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "Escape") {
      e.preventDefault();
      e.stopPropagation();
      terminer();
      return;
    }
    if (e.key !== "ArrowDown" && e.key !== "ArrowUp" && e.key !== "Home" && e.key !== "End") return;
    e.preventDefault();
    const items = [...(ref.current?.querySelectorAll<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    const n = items.length;
    const j =
      e.key === "Home" || (i === -1 && e.key === "ArrowDown")
        ? 0
        : e.key === "End" || i === -1
          ? n - 1
          : (i + (e.key === "ArrowDown" ? 1 : -1) + n) % n;
    items[j]?.focus();
  };

  return (
    <div
      ref={ref}
      role="menu"
      aria-label="Terminal"
      tabIndex={-1}
      className="mt-menu"
      style={{ left: place.left, top: place.top, width: LARGEUR }}
      onKeyDown={surClavier}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Element libelle="Copier" raccourci="Ctrl+Maj+C" inactif={!selection} onClick={copier} />
      <Element libelle="Coller" raccourci="Ctrl+Maj+V" onClick={coller} />
      <div className="mt-separateur" role="separator" />
      <Element libelle="Tout sélectionner" onClick={toutSelectionner} />
    </div>
  );
}

function Element({
  libelle,
  raccourci,
  inactif = false,
  onClick,
}: {
  libelle: string;
  raccourci?: string;
  inactif?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      tabIndex={-1}
      className="mt-element"
      aria-disabled={inactif || undefined}
      onClick={() => {
        if (!inactif) onClick();
      }}
    >
      <span className="mt-libelle">{libelle}</span>
      {raccourci && <Kbd>{raccourci}</Kbd>}
    </button>
  );
}
