import { useCallback, useEffect, useRef, useState } from "react";
import { useWorkspaceStore, navigableOrder } from "../store/workspace";
import { useUiStore } from "../store/ui";
import { useDashboardStore } from "../store/dashboard";
import { focusTab } from "../lib/tabFocus";
import {
  choisirBulle,
  memeBulle,
  raccourciEspace,
  suivreArrivees,
  type Arrivees,
  type Bulle,
} from "../lib/agentBubble";
import { usePlacementAncre } from "../hooks/usePlacementAncre";
import { useReglagesStore } from "../store/reglages";
import { Avatar } from "./ui/Avatar";
import { Kbd } from "./ui/Kbd";
import { IconeFermer } from "./ui/icons";
import "../styles/accueil.css";

/**
 * Bulle « un agent vous attend », posée au-dessus de l'avatar [data-ws-id] de l'espace
 * concerné : nom, onglet, dernier message de l'agent, bouton « Aller ». Une seule à la
 * fois, la plus récente ; elle disparaît quand l'espace est consulté ou qu'on la ferme.
 * Tant qu'elle est affichée, elle le signale par `useUiStore.setBulleEspace(wsId)` (le
 * dock tait l'infobulle de cet avatar) et repasse à null en disparaissant. Elle flotte
 * par-dessus la zone terminal sans la retailler (lib/reserveBasse).
 *
 * Les styles sont dans accueil.css (préfixe `bul-`), la logique de choix dans
 * lib/agentBubble. Toujours monté par App.
 */

const LARGEUR = 292;
/** Écart entre le haut du bouton d'avatar (44 px) et le bas de la bulle, comme la maquette. */
const ECART = 22;
/** Durée de l'animation de sortie (bubOut) avant de démonter la bulle. */
const SORTIE_MS = 210;

type Rendu = { bulle: Bulle; sortant: boolean };

export function AgentBubble() {
  // Bulle voulue par le store ; `rendu` la garde affichée le temps de l'animation de sortie.
  const [cible, setCible] = useState<Bulle | null>(null);
  const [rendu, setRendu] = useState<Rendu | null>(null);
  const ecarteJusqua = useRef(0);
  const reevaluer = useRef<() => void>(() => {});
  const dockVisible = useUiStore((s) => s.dockVisible);
  // Réglage « Bulle au-dessus du dock » ; et superviseur actif hors pause : sa propre bulle
  // résume les agents qui attendent, une seule bulle à la fois.
  const permise = useReglagesStore(
    (s) => s.reglages.notifications.bulle && !(s.reglages.superviseur.actif && !s.reglages.superviseur.pause),
  );
  // Mosaïque ouverte : chaque tuile porte déjà l'attente et son bouton Aller (maquette
  // Mosaique/01, aucune bulle).
  const enMosaique = useUiStore((s) => s.vue === "mosaique");

  // Suivi des notifications : le rang d'arrivée vit hors React (le store n'horodate pas).
  useEffect(() => {
    let arrivees: Arrivees = new Map();
    let compteur = 0;
    // Seuls les espaces et l'espace actif comptent : les autres mutations du store (PTY,
    // occupation, toast…) n'ont rien à recalculer.
    let vusEspaces: unknown = null;
    let vuActif: string | null | undefined;
    const evaluer = (force = true) => {
      const s = useWorkspaceStore.getState();
      if (!force && s.workspaces === vusEspaces && s.activeId === vuActif) return;
      vusEspaces = s.workspaces;
      vuActif = s.activeId;
      const suivi = suivreArrivees(arrivees, compteur, s.workspaces);
      arrivees = suivi.arrivees;
      compteur = suivi.compteur;
      const choix = choisirBulle(s.workspaces, s.activeId, arrivees, ecarteJusqua.current);
      setCible((prev) => (memeBulle(prev, choix) ? prev : choix));
    };
    // La croix force le calcul : `ecarteJusqua` a changé sans que le store bouge.
    reevaluer.current = () => evaluer(true);
    evaluer(true);
    return useWorkspaceStore.subscribe(() => evaluer(false));
  }, []);

  useEffect(() => {
    if (cible) {
      setRendu({ bulle: cible, sortant: false });
      return;
    }
    setRendu((r) => (r && !r.sortant ? { ...r, sortant: true } : r));
    const t = setTimeout(() => setRendu(null), SORTIE_MS);
    return () => clearTimeout(t);
  }, [cible]);

  const wsId = rendu?.bulle.wsId ?? null;
  const place = usePlacementAncre(wsId ? { type: "espace", wsId } : null, LARGEUR, ECART, dockVisible);
  const raccourci = useWorkspaceStore((s) =>
    wsId ? raccourciEspace(navigableOrder(s.workspaces, s.groups).findIndex((w) => w.id === wsId)) : null,
  );

  // Pas d'avatar à montrer (dock masqué, espace dans un groupe replié) : pas de bulle.
  const posee = permise && !enMosaique && rendu !== null && place !== null ? rendu.bulle.wsId : null;
  useEffect(() => {
    useUiStore.getState().setBulleEspace(posee);
    return () => useUiStore.getState().setBulleEspace(null);
  }, [posee]);

  const ecarter = useCallback((b: Bulle) => {
    // La croix écarte cette notification et les plus anciennes : fermer une bulle ne doit
    // pas en faire surgir une autre aussitôt.
    ecarteJusqua.current = Math.max(ecarteJusqua.current, b.rang);
    // La croix avait le focus et va disparaître : sans relais, il tombait sur <body> et la
    // frappe suivante n'allait nulle part. Il revient au terminal affiché.
    if (document.activeElement?.closest(".bul")) {
      const s = useWorkspaceStore.getState();
      const tabId = s.workspaces.find((w) => w.id === s.activeId)?.activeTabId;
      if (tabId) focusTab(tabId);
    }
    reevaluer.current();
  }, []);

  const aller = useCallback((b: Bulle) => {
    const s = useWorkspaceStore.getState();
    // Les vues plein écran (récap, mosaïque) masqueraient l'espace : on les quitte.
    useDashboardStore.getState().close();
    useUiStore.getState().setVue("terminal");
    // L'onglet d'abord : setActive ne marque lu que l'onglet affiché au moment de l'appel.
    if (b.tabId) s.setActiveTab(b.wsId, b.tabId);
    s.setActive(b.wsId);
    // Le terminal redevient visible au rendu suivant : on lui rend le focus après.
    const tabId = b.tabId;
    if (tabId) requestAnimationFrame(() => requestAnimationFrame(() => focusTab(tabId)));
  }, []);

  // Région d'annonce toujours montée, vide au repos : un lecteur d'écran ne lit pas une
  // région live insérée déjà remplie, seulement le texte qui change dans une région existante.
  const annonce = (
    <div className="bul-annonce" role="status" aria-live="polite">
      {cible ? `${cible.nom} vous attend : ${cible.question}` : ""}
    </div>
  );

  if (!rendu || !place || !permise || enMosaique) return annonce;
  const { bulle: b, sortant } = rendu;

  return (
    <>
      {annonce}
      <div
        key={`${b.wsId}:${b.rang}`}
        className="bul"
        data-sortant={sortant}
        style={{ left: place.left, bottom: place.bottom, width: place.largeur }}
      >
        <span className="bul-pointe" aria-hidden="true" style={{ left: place.pointe - 6 }} />
        <div className="bul-carte">
          <div className="bul-tete">
            <Avatar monogramme={b.mono} couleur={b.couleur} taille={26} sautille={false} style={{ fontSize: 10.5 }} />
            <span className="bul-identite">
              <span className="bul-nom">
                {b.nom}
                <span className="bul-attend">
                  <span className="bul-attend-point" aria-hidden="true" />
                  vous attend
                </span>
              </span>
              <span className="bul-contexte">{b.contexte}</span>
            </span>
            <button type="button" className="hov bul-fermer" aria-label="Fermer la notification" onClick={() => ecarter(b)}>
              <IconeFermer taille={12} />
            </button>
          </div>
          <div className="bul-question">{b.question}</div>
          <div className="bul-pied">
            <span className="bul-detail">{b.detail}</span>
            <button
              type="button"
              className="bul-aller"
              data-avec-touche={raccourci !== null}
              aria-label={`Aller à ${b.nom}`}
              onClick={() => aller(b)}
            >
              Aller
              {raccourci && <Kbd variante="sur-accent">{raccourci}</Kbd>}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
