import { useCallback, useEffect, useRef, useState, type PointerEvent, type RefObject } from "react";
import { useWorkspaceStore } from "../../store/workspace";
import { finalIndex, resolveDrop, type DropTarget, type SidebarRow } from "../../lib/reorder";
import { pasDefilementBord } from "../../lib/dockLayout";
import { memeVisee, type Visee } from "../../lib/dockGlisser";

export type { Visee };

/**
 * Réordonnancement des espaces et des groupes du dock par glisser-déposer : même logique
 * que l'ancienne barre latérale (lib/reorder), couchée à l'horizontale. Les « lignes »
 * sont les éléments marqués `data-dock-row` dans l'ordre du DOM (hors-groupe, puis chaque
 * groupe : étiquette puis membres dépliés) ; leur gauche et leur largeur tiennent le rôle
 * du haut et de la hauteur.
 *
 * Quand la bande défile (dernier recours du dock), approcher un de ses bords pendant le
 * geste la fait défiler, pour atteindre une place hors de vue.
 *
 * PAS de HTML5 `draggable` : le dépôt de fichiers de Tauri (injection des chemins dans le
 * terminal) rend le DnD HTML5 interne peu fiable sous WebKitGTK. Les pointer events ne
 * dépendent pas de ce handler système.
 */

/** Distance minimale avant qu'un appui devienne un glissement : en dessous, c'est un clic. */
const SEUIL = 4;

type Appui = { id: string; kind: "ws" | "group"; x0: number; y0: number; glisse: boolean };

/** Gestionnaires de pointeur posés sur un avatar ou une étiquette de groupe. */
export interface Poignee {
  onPointerDown: (e: PointerEvent<HTMLElement>) => void;
  onPointerMove: (e: PointerEvent<HTMLElement>) => void;
  onPointerUp: (e: PointerEvent<HTMLElement>) => void;
  onPointerCancel: () => void;
  onLostPointerCapture: () => void;
}

/** Clé d'une poignée dans le cache : `ws:<id>` ou `group:<id>`. */
export const clePoignee = (id: string, kind: "ws" | "group") => `${kind}:${id}`;

/** Poignée sans effet, pour un avatar qui ne se tire pas (fantôme d'un espace fermé). */
export const POIGNEE_INERTE: Poignee = {
  onPointerDown: () => {},
  onPointerMove: () => {},
  onPointerUp: () => {},
  onPointerCancel: () => {},
  onLostPointerCapture: () => {},
};

export function useGlisserDock(bandeRef: RefObject<HTMLElement | null>) {
  const appuiRef = useRef<Appui | null>(null);
  // Un dépôt ne doit pas activer l'élément tiré : le click qui suit le pointerup est avalé
  // une fois (remis à false au pointerdown suivant, jamais laissé armé).
  const avaler = useRef(false);
  const [glisseId, setGlisseId] = useState<string | null>(null);
  const [visee, setViseeBrute] = useState<Visee | null>(null);
  // Le pointeur bouge à chaque image, la visée seulement en franchissant une frontière :
  // garder l'objet en place évite un rendu complet du dock par pointermove.
  const setVisee = useCallback((v: Visee | null) => setViseeBrute((p) => (memeVisee(p, v) ? p : v)), []);
  // Défilement automatique au bord : dernière abscisse du pointeur et boucle d'images.
  const dernierX = useRef(0);
  const boucle = useRef<number | null>(null);

  /** Lignes dans l'ordre du DOM. Aucun réordonnancement n'a lieu pendant le geste :
      les rects lus à chaque pointermove sont stables. */
  const lignes = (): { rows: SidebarRow[]; els: HTMLElement[] } => {
    const els = [...(bandeRef.current?.querySelectorAll<HTMLElement>("[data-dock-row]") ?? [])];
    const rows = els.map((el): SidebarRow => {
      const r = el.getBoundingClientRect();
      const gid = el.dataset.groupId;
      return { top: r.left, height: r.width, kind: el.dataset.dockRow === "group" ? "group" : "ws", groupId: gid ? gid : null };
    });
    return { rows, els };
  };

  /** Abscisse du trait pour une frontière : à mi-écart avant la ligne visée (avant tout son
      segment quand c'est une étiquette de groupe), ou après la dernière. */
  const abscisseTrait = (els: HTMLElement[], frontiere: number): number | null => {
    const bande = bandeRef.current;
    if (!bande || els.length === 0) return null;
    const repere = (el: HTMLElement) =>
      (el.dataset.dockRow === "group" ? el.closest<HTMLElement>("[data-dock-segment]") : null) ?? el;
    const x =
      frontiere < els.length
        ? repere(els[frontiere]).getBoundingClientRect().left - 4
        : (() => {
            const dernier = els[els.length - 1];
            // Dernier membre d'un groupe : après le segment entier (sa marge droite comprise).
            const seg = dernier.closest<HTMLElement>("[data-dock-segment][data-groupe]") ?? dernier;
            return seg.getBoundingClientRect().right + 4;
          })();
    return x - bande.getBoundingClientRect().left + bande.scrollLeft;
  };

  const viser = (x: number, kind: "ws" | "group"): Visee => {
    const { rows, els } = lignes();
    const cible = resolveDrop(rows, x, kind);
    return { cible, trait: cible.kind === "into-group" ? null : abscisseTrait(els, cible.boundary) };
  };

  const arreterDefilement = () => {
    if (boucle.current !== null) cancelAnimationFrame(boucle.current);
    boucle.current = null;
  };
  useEffect(() => arreterDefilement, []);

  /** Une image de défilement : tant que le pointeur reste dans une zone de bord, la bande
      avance et la visée suit (le pointeur est immobile, c'est la bande qui passe dessous). */
  const defiler = () => {
    boucle.current = null;
    const a = appuiRef.current;
    const b = bandeRef.current;
    if (!a?.glisse || !b || b.scrollWidth <= b.clientWidth) return;
    const r = b.getBoundingClientRect();
    const pas = pasDefilementBord(dernierX.current, r.left, r.right);
    const avant = b.scrollLeft;
    b.scrollLeft += pas;
    if (b.scrollLeft === avant) return; // au bout, ou hors zone
    setVisee(viser(dernierX.current, a.kind));
    boucle.current = requestAnimationFrame(defiler);
  };

  const finir = () => {
    arreterDefilement();
    appuiRef.current = null;
    setGlisseId(null);
    setVisee(null);
  };

  const deposer = (a: Appui, t: DropTarget) => {
    const s = useWorkspaceStore.getState();
    if (a.kind === "group") {
      if (t.kind !== "group") return;
      const from = s.groups.findIndex((g) => g.id === a.id);
      if (from !== -1) s.moveGroup(a.id, finalIndex(from, t.index));
      return;
    }
    const w = s.workspaces.find((x) => x.id === a.id);
    if (!w) return; // fermé entre l'appui et le dépôt
    if (t.kind === "into-group") {
      s.assignToGroup(a.id, t.groupId); // en fin de groupe
      return;
    }
    if (t.kind !== "workspace") return;
    // Même appartenance : l'élément tiré quitte d'abord sa place (finalIndex) ;
    // appartenance différente : l'index vise directement la nouvelle liste.
    let index = t.index;
    if (t.groupId === w.groupId) {
      const from = s.workspaces.filter((x) => x.groupId === w.groupId).indexOf(w);
      index = finalIndex(from, t.index);
    }
    s.assignToGroup(a.id, t.groupId, index);
  };

  /** Gestionnaires à poser sur un avatar (`ws`) ou une étiquette de groupe (`group`). */
  const creerPoignee = (id: string, kind: "ws" | "group"): Poignee => ({
    onPointerDown: (e: PointerEvent<HTMLElement>) => {
      avaler.current = false;
      if (e.button !== 0) return;
      appuiRef.current = { id, kind, x0: e.clientX, y0: e.clientY, glisse: false };
      // Capture dès l'appui : un geste vif sort de l'avatar (44 px) avant d'avoir franchi
      // le seuil, et ses pointermove partiraient alors au voisin, qui les ignore — le
      // glissement ne démarrait jamais. Le click, lui, reste sur l'élément capturé.
      try {
        e.currentTarget.setPointerCapture(e.pointerId);
      } catch {
        /* pointeur déjà relâché (ou environnement sans capture) : sans effet */
      }
    },
    onPointerMove: (e: PointerEvent<HTMLElement>) => {
      const a = appuiRef.current;
      if (!a || a.id !== id) return;
      if (!a.glisse) {
        if (Math.hypot(e.clientX - a.x0, e.clientY - a.y0) < SEUIL) return;
        a.glisse = true;
        // Capture : le geste survit à la sortie de l'avatar d'origine.
        e.currentTarget.setPointerCapture(e.pointerId);
        setGlisseId(id);
      }
      setVisee(viser(e.clientX, a.kind));
      dernierX.current = e.clientX;
      if (boucle.current === null) boucle.current = requestAnimationFrame(defiler);
    },
    onPointerUp: (e: PointerEvent<HTMLElement>) => {
      const a = appuiRef.current;
      if (a?.glisse) {
        avaler.current = true;
        deposer(a, viser(e.clientX, a.kind).cible);
      }
      finir();
    },
    // Geste annulé par le système : on annule sans déplacer.
    onPointerCancel: finir,
    // Filet : capture perdue autrement qu'au pointerup (finir est idempotent).
    onLostPointerCapture: finir,
  });

  // Une poignée par élément, créée une fois et gardée : des gestionnaires stables laissent
  // les avatars mémoïsés (DockAvatar) sauter les rendus du dock. Les fermetures du premier
  // rendu restent justes : elles ne lisent que des refs, des setters et le store.
  const poignees = useRef(new Map<string, Poignee>());
  const poignee = (id: string, kind: "ws" | "group"): Poignee => {
    const cle = clePoignee(id, kind);
    let p = poignees.current.get(cle);
    if (!p) {
      p = creerPoignee(id, kind);
      poignees.current.set(cle, p);
    }
    return p;
  };

  /** Oublie les poignées des espaces et groupes disparus (`vivants` : clés `ws:<id>` et
      `group:<id>`). Sans cette purge, le cache garderait une poignée par espace jamais
      rouvert pour toute la session. */
  const purger = useCallback((vivants: ReadonlySet<string>) => {
    for (const cle of [...poignees.current.keys()]) if (!vivants.has(cle)) poignees.current.delete(cle);
  }, []);

  /** À appeler en tête d'un onClick : vrai si ce click suit un dépôt et doit être ignoré. */
  const clicAvale = (): boolean => {
    if (!avaler.current) return false;
    avaler.current = false;
    return true;
  };

  return { glisseId, visee, poignee, clicAvale, purger };
}
