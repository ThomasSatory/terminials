import { useCallback, useEffect, useRef, useState } from "react";
import { useReglagesStore } from "../../store/reglages";
import { useSuperviseurStore, demandesOuvertes } from "../../store/superviseur";
import { useWorkspaceStore, hasAttention } from "../../store/workspace";
import { useUiStore } from "../../store/ui";
import { useEspacesSuperviseur, type InfoEspaceSuperviseur } from "../../hooks/useEtatSuperviseur";
import { usePlacementSuperviseur, type PlacementMarque } from "../../hooks/usePlacementSuperviseur";
import { allerA } from "../../lib/executeurSuperviseur";
import { autorisationLisible } from "../../lib/outilsSuperviseur";
import { texteNotification } from "../../lib/dockInfo";
import { signatureBulle, texteBulle } from "../../lib/superviseurLibelles";
import { Kbd } from "../ui/Kbd";
import { CLE_BULLE_SUPERVISEUR, IconeCroix, MiniAvatar, ViseurPoint } from "./elements";
import "../../styles/superviseur.css";

/**
 * Bulle de résumé du superviseur (maquette Superviseur), posée au-dessus de sa marque
 * dans le dock (`--z-bulle`), panneau fermé : « N agents vous attendent », une ligne par
 * espace (cliquable), « dont N écritures à valider », « Ouvrir ». Elle paraît peu après
 * qu'une situation change ou que le panneau se referme (le temps que l'on voie le dock
 * bouger), et se retire seule au bout de DUREE_AFFICHAGE_MS : elle reviendra à la
 * prochaine fermeture du panneau. Seuls le × et le clic d'une ligne l'écartent pour la
 * situation, jusqu'à la suivante (`useSuperviseurStore.bulleEcartee`). Quand elle est
 * permise, la bulle d'agent (AgentBubble) se tait : une seule bulle à la fois.
 */

const LARGEUR = 300;
/** Délai entre le changement de situation (ou la fermeture du panneau) et la bulle. */
export const DELAI_APPARITION_MS = 2000;
/** Durée d'affichage avant retrait automatique. */
export const DUREE_AFFICHAGE_MS = 10000;
const SORTIE_MS = 200;

export function BulleSuperviseur() {
  const actif = useReglagesStore((s) => s.reglages.superviseur.actif);
  const pause = useReglagesStore((s) => s.reglages.superviseur.pause);
  const nom = useReglagesStore((s) => s.reglages.superviseur.nom);
  const agir = useReglagesStore((s) => s.reglages.superviseur.niveau === "agir");
  const permise = useReglagesStore((s) => s.reglages.notifications.bulle);
  const ouvert = useSuperviseurStore((s) => s.panneauOuvert);
  const ecartee = useSuperviseurStore((s) => s.bulleEcartee);
  const dockVisible = useUiStore((s) => s.dockVisible);
  // Chaînes : des sélecteurs à valeur stable, la bulle ne se recalcule qu'au changement.
  const attente = useWorkspaceStore((s) => s.workspaces.filter(hasAttention).map((w) => w.id).join(","));
  const cartes = useSuperviseurStore((s) => demandesOuvertes(s).map((d) => d.id).join(","));
  const idsAttente = attente ? attente.split(",") : [];
  const idsCartes = agir && cartes ? cartes.split(",") : [];
  const signature = signatureBulle(idsAttente, idsCartes);
  const eligible =
    actif && !pause && permise && !ouvert && dockVisible && (idsAttente.length > 0 || idsCartes.length > 0) && signature !== ecartee;

  const [rendu, setRendu] = useState<string | null>(null);
  const [sortant, setSortant] = useState(false);
  const sortie = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /** Retire la bulle ; `ecarter` (× ou ligne choisie) la fait taire pour cette situation.
      Le retrait automatique n'écarte rien : la bulle revient à la prochaine fermeture du
      panneau (maquette : 2 s ≤ t − max(fermeture, changement) ≤ 12 s). */
  const retirer = useCallback((sig: string, ecarter: boolean) => {
    setSortant(true);
    clearTimeout(sortie.current);
    sortie.current = setTimeout(() => {
      if (ecarter) useSuperviseurStore.getState().ecarterBulle(sig);
      setRendu(null);
      setSortant(false);
    }, SORTIE_MS);
  }, []);

  useEffect(() => {
    if (!eligible) {
      // Panneau ouvert, situation résolue : la bulle s'efface sans être « écartée ».
      setSortant(true);
      clearTimeout(sortie.current);
      sortie.current = setTimeout(() => {
        setRendu(null);
        setSortant(false);
      }, SORTIE_MS);
      return;
    }
    const apparition = setTimeout(() => {
      clearTimeout(sortie.current);
      setRendu(signature);
      setSortant(false);
    }, DELAI_APPARITION_MS);
    const retrait = setTimeout(() => retirer(signature, false), DELAI_APPARITION_MS + DUREE_AFFICHAGE_MS);
    return () => {
      clearTimeout(apparition);
      clearTimeout(retrait);
    };
  }, [eligible, signature, retirer]);

  useEffect(() => () => clearTimeout(sortie.current), []);

  const place = usePlacementSuperviseur(actif && dockVisible, LARGEUR);
  const posee = rendu !== null && place !== null;

  // Bulle posée : la zone terminal garde sa marge basse, comme pour une bulle d'agent. On
  // ne libère la place que si c'est bien la nôtre (la bulle d'agent a pu la reprendre).
  useEffect(() => {
    if (!posee) return;
    useUiStore.getState().setBulleEspace(CLE_BULLE_SUPERVISEUR);
    return () => {
      if (useUiStore.getState().bulleEspace === CLE_BULLE_SUPERVISEUR) useUiStore.getState().setBulleEspace(null);
    };
  }, [posee]);

  const espaces = useEspacesSuperviseur();
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const bloquees = useSuperviseurStore((s) => s.sessionsBloquees);
  const texte = texteBulle(idsAttente.length, idsCartes.length);

  const annonce = (
    <div className="sup-annonce" role="status" aria-live="polite">
      {rendu && !sortant ? `${nom} : ${texte.titre}` : ""}
    </div>
  );
  if (!posee || !place) return annonce;

  const lignes: LigneBulle[] = idsAttente.slice(0, 3).flatMap((id) => {
    const ws = workspaces.find((w) => w.id === id);
    const info = espaces.get(id);
    if (!ws || !info) return [];
    const bloque = ws.tabs.map((t) => bloquees[t.id]).find((m) => m !== undefined);
    const raison = bloque ? autorisationLisible(bloque) : texteNotification(ws.lastNotification) || "vous attend";
    const tabId = ws.tabs.find((t) => t.id in bloquees)?.id ?? ws.unreadTabs[0];
    return [{ info, raison, ...(tabId ? { tabId } : {}) }];
  });

  return (
    <>
      {annonce}
      <CarteBulle
        place={place}
        sortant={sortant}
        nom={nom}
        titre={texte.titre}
        note={texte.note}
        noteAccent={texte.accent}
        lignes={lignes}
        fermer={() => retirer(rendu!, true)}
        aller={(l) => {
          allerA(l.info.id, l.tabId);
          retirer(rendu!, true);
        }}
      />
    </>
  );
}

export interface LigneBulle {
  info: InfoEspaceSuperviseur;
  raison: string;
  tabId?: string;
}

/** Bulle elle-même (présentation pure), posée en `fixed` au-dessus de la marque. */
export function CarteBulle({
  place,
  sortant,
  nom,
  titre,
  note,
  noteAccent,
  lignes,
  fermer,
  aller,
}: {
  place: PlacementMarque;
  sortant: boolean;
  nom: string;
  titre: string;
  note: string;
  noteAccent: boolean;
  lignes: LigneBulle[];
  fermer: () => void;
  aller: (l: LigneBulle) => void;
}) {
  return (
    <div className="sup-bulle" data-sortant={sortant} style={{ left: place.left, bottom: place.bottom, width: place.largeur }}>
      <span className="sup-bulle-pointe" aria-hidden="true" style={{ left: place.pointe - 6 }} />
      <div className="sup-bulle-carte">
        <div className="sup-bulle-tete">
          <ViseurPoint taille={15} couleur="var(--accent)" epaisseur={1.7} />
          <span className="sup-bulle-titre">
            <span className="sup-bulle-nom">{nom} :</span> {titre}
          </span>
          <button type="button" className="hov sup-bulle-fermer" aria-label="Fermer la notification" onClick={fermer}>
            <IconeCroix taille={11} />
          </button>
        </div>
        {lignes.length > 0 && (
          <div className="sup-bulle-lignes">
            {lignes.map((l) => (
              <button
                key={l.info.id}
                type="button"
                className="sup-ligne-survol sup-bulle-ligne"
                aria-label={`Aller à ${l.info.nom} : ${l.raison}`}
                onClick={() => aller(l)}
              >
                <MiniAvatar mono={l.info.mono} couleur={l.info.couleur} taille={20} />
                <span className="sup-bulle-ligne-nom">{l.info.nom}</span>
                <span className="sup-bulle-ligne-raison">{l.raison}</span>
              </button>
            ))}
          </div>
        )}
        <div className="sup-bulle-pied">
          <span className="sup-bulle-note" data-accent={noteAccent}>
            {note}
          </span>
          <button type="button" className="sup-prim sup-bulle-ouvrir" onClick={() => useSuperviseurStore.getState().ouvrirPanneau()}>
            Ouvrir
            <Kbd variante="sur-accent">Ctrl+Maj+Espace</Kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
