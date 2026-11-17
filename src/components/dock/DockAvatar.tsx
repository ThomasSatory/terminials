import { memo, type CSSProperties, type MouseEvent } from "react";
import { useWorkspaceStore, type Workspace } from "../../store/workspace";
import { useEtatEspace } from "../../hooks/useEtatAgent";
import { Avatar } from "../ui/Avatar";
import type { EtatAgent } from "../../lib/etatAgent";
import { geometrieAvatars, melangeOpaque } from "../../lib/dockLayout";
import { infobulleEspace, libelleAvatar } from "../../lib/dockInfo";
import { titreSansGlyphe } from "../../lib/mosaique";
import { monogramme } from "../../lib/monogram";
import { couleurEspace } from "../../lib/couleurEspace";
import { useSuperviseurStore, espaceEnRelais, interlocuteurRelais, SUPERVISEUR } from "../../store/superviseur";
import { useReglagesStore } from "../../store/reglages";
import type { Poignee } from "./useGlisserDock";

/**
 * Avatar d'un espace dans le dock : bouton (disque + 4 px, 44 en densité normale) qui
 * porte le disque (lib/ui Avatar),
 * se soulève et grossit au survol, et montre son infobulle (survol ET focus clavier).
 * Placé en absolu dans la boîte de son segment : la rangée et la pile d'un groupe replié
 * ne sont que deux jeux de décalages, ce qui fait glisser les avatars de l'une à l'autre.
 *
 * Il s'abonne LUI-MÊME au store (son espace, l'état de son agent) : une sonde qui touche
 * un espace ne re-rend que son avatar. Mémoïsé : ses autres props sont des primitives ou
 * des rappels stables, un rendu du dock ne le re-rend pas.
 *
 * Fantôme : un espace qui vient d'être fermé (déjà retiré du store, ses PTY fermés) reste
 * dessiné, d'après son dernier instantané, le temps de son animation de disparition ; il
 * n'est alors ni cliquable, ni focalisable, ni ancre de calque.
 */
export interface DockAvatarProps {
  wsId: string;
  /** Diamètre du disque (densité du dock : 32, 40 ou 48). */
  taille: number;
  /** Instantané d'un espace fermé qu'on anime en disparition (absent : espace vivant). */
  fantome?: Workspace;
  /** État imposé dans une pile (le représentant porte celui du groupe, les autres rien) ;
      null : l'état réel de l'agent. */
  etatPile: EtatAgent | null;
  /** Espace ouvert (terminal affiché) : fond dense, liseré, clic = menu de l'espace. */
  ouvert: boolean;
  /** Menu ou modification de cet espace ouvert (aria-expanded). */
  menuOuvert: boolean;
  /** Une bulle « vous attend » est posée au-dessus : pas d'infobulle, elle la masquerait. */
  sousBulle: boolean;
  /** Membre d'un groupe : fond opaque (une pile ne laisse pas voir ses voisins). */
  dansGroupe: boolean;
  /** Dans une pile repliée : ni focus, ni clic, ni saut (c'est la pile qui sautille). */
  replie: boolean;
  x: number;
  z: number;
  visible: boolean;
  /** En-tête de l'infobulle : groupe de l'espace (null sans groupe dans le dock). */
  groupeNom: string | null;
  groupeCouleur: string | null;
  raccourci: string;
  /** Tiré en ce moment (glisser-déposer) : à demi effacé. */
  glisse: boolean;
  /** Vient d'apparaître : rebond d'en bas (création), ou chute d'en haut pour le premier
      espace ouvert depuis l'accueil. */
  apparition: "rebond" | "chute" | null;
  /** Rappels stables (identiques d'un rendu à l'autre) : ils reçoivent l'id de l'espace. */
  onChoisir: (wsId: string) => void;
  onMenu: (e: MouseEvent<HTMLButtonElement>, wsId: string) => void;
  poignee: Poignee;
}

export const DockAvatar = memo(function DockAvatar(p: DockAvatarProps) {
  const vivant = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === p.wsId));
  // Sujet du tour que l'agent vient de finir : titre de l'onglet « terminé » (chaîne).
  const sujetTermine = useWorkspaceStore((s) => {
    const w = s.workspaces.find((x) => x.id === p.wsId);
    return titreSansGlyphe(w?.tabs.find((t) => t.id in s.tabsTermines)?.title);
  });
  const etatStore = useEtatEspace(p.wsId);
  // Question posée à une autre session, réponse pas encore rendue (superviseur).
  const relais = useSuperviseurStore((s) => espaceEnRelais(s, p.wsId));
  // Celui dont la réponse est attendue : un espace (son nom) ou le superviseur.
  const attendDe = useSuperviseurStore((s) => interlocuteurRelais(s, p.wsId));
  const nomAttendu = useWorkspaceStore((s) =>
    attendDe === null ? undefined : (s.workspaces.find((x) => x.id === attendDe)?.name ?? undefined),
  );
  const nomSuperviseur = useReglagesStore((s) => s.reglages.superviseur.nom);
  const w = vivant ?? p.fantome;
  if (!w) return null;
  const fantome = !vivant;
  const etatReel: EtatAgent = fantome ? "repos" : etatStore;
  const etat = p.etatPile ?? etatReel;
  const couleur = couleurEspace(w);
  const attendNom = relais && attendDe !== null ? (attendDe === SUPERVISEUR ? nomSuperviseur : nomAttendu) : undefined;
  const info = infobulleEspace({ ...w, sujetTermine, attendDe: attendNom }, etatReel);
  // Fond d'un membre de groupe : sa couleur à 9,4 % (repos) ou 22 % (ouvert) sur le fond
  // du segment, opaque ; liseré de la couleur si ouvert, anneau du fond dans une pile
  // pour détacher les disques superposés.
  const styleGroupe: CSSProperties | undefined = p.dansGroupe
    ? {
        background: melangeOpaque(couleur, p.ouvert ? 0.22 : 0.094),
        boxShadow: `inset 0 0 0 1.5px ${p.ouvert ? couleur : "transparent"}, 0 0 0 ${p.replie ? 2 : 0}px #1d1e22`,
      }
    : undefined;
  const inerte = p.replie || fantome;
  return (
    <button
      type="button"
      className="dock-btn"
      // Un fantôme n'est l'ancre d'aucun calque ni une ligne du glisser-déposer.
      data-ws-id={fantome ? undefined : w.id}
      data-dock-row={inerte ? undefined : "ws"}
      data-group-id={inerte ? undefined : (w.groupId ?? "")}
      data-glisse={p.glisse || undefined}
      aria-label={libelleAvatar(w.name, etatReel, p.ouvert)}
      aria-haspopup={p.ouvert ? "dialog" : undefined}
      aria-expanded={p.ouvert ? p.menuOuvert : undefined}
      aria-hidden={inerte || undefined}
      tabIndex={inerte ? -1 : 0}
      style={{
        transform: `translateX(${p.x}px)`,
        zIndex: p.z,
        opacity: p.visible ? 1 : 0,
        pointerEvents: inerte ? "none" : undefined,
      }}
      onClick={fantome ? undefined : () => p.onChoisir(w.id)}
      onContextMenu={fantome ? undefined : (e) => p.onMenu(e, w.id)}
      // Annuler le mousedown : pas de sélection de texte étendue pendant un glissement
      // (WebKitGTK), pas de défilement automatique ni de collage X11 au clic molette (qui
      // n'a pas d'autre effet sur un avatar), et le focus reste au terminal. Le click,
      // lui, est toujours émis.
      onMouseDown={(e) => {
        if (e.button === 0 || e.button === 1) e.preventDefault();
      }}
      {...p.poignee}
    >
      <span
        className="dock-entree"
        data-apparition={(!fantome && p.apparition) || undefined}
        data-disparition={fantome || undefined}
      >
        <Avatar
          monogramme={monogramme(w.name)}
          couleur={couleur}
          etat={etat}
          actif={p.ouvert}
          taille={p.taille}
          sautille={!p.replie && !fantome}
          relais={relais && !fantome && p.etatPile === null}
          className="dock-av"
          style={styleGroupe}
        />
      </span>
      {!p.sousBulle && !fantome && (
        <span className="ui-tip" aria-hidden="true" style={{ bottom: geometrieAvatars(p.taille).infobulle }}>
          {p.groupeNom !== null && (
            <span className="dock-tip-groupe">
              <span className="dock-carre" style={{ width: 7, height: 7, background: p.groupeCouleur ?? undefined }} />
              {p.groupeNom}
            </span>
          )}
          <span className="ui-tip-titre">
            {w.name}
            {p.raccourci && <span className="ui-kbd">{p.raccourci}</span>}
          </span>
          <span className="ui-tip-detail dock-tip-ligne" data-ton={info.ton}>
            {info.detail}
          </span>
          {info.lignes.map((l, i) => (
            <span key={i} className="ui-tip-detail dock-tip-ligne">
              {l}
            </span>
          ))}
          {info.progression !== null && (
            <span className="dock-tip-progression">
              <span style={{ transform: `scaleX(${info.progression})` }} />
            </span>
          )}
        </span>
      )}
    </button>
  );
});
