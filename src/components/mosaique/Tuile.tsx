import { memo, type CSSProperties, type MouseEvent } from "react";
import { useShallow } from "zustand/react/shallow";
import { useWorkspaceStore } from "../../store/workspace";
import { useDernieresLignes } from "../../hooks/useDernieresLignes";
import { useHome } from "../../hooks/useHome";
import { couleurEspace } from "../../lib/couleurEspace";
import { monogramme } from "../../lib/monogram";
import { etatVisuelAvatar, type EtatAgent } from "../../lib/etatAgent";
import {
  LIBELLE_ETAT,
  ariaTuile,
  cadenceBalayage,
  cheminCourt,
  derniereCommande,
  etiquetteTemps,
  ligneBranche,
  messageTermine,
  sujetTermine,
  titreSansGlyphe,
  tonLigne,
} from "../../lib/mosaique";
import { Avatar } from "../ui/Avatar";
import { IconeCoche, IconeFleche } from "../ui/icons";
import { useClesLignes, useMaintenant, useSuiviEtat } from "./suivi";

export interface TuileProps {
  wsId: string;
  etat: EtatAgent;
  /** Lignes de terminal montrées (6 sur « Tous », 11 ou 12 filtré). */
  nbLignes: number;
  /** Corps du mini-terminal en px. */
  taillePolice: number;
  /** Nom du keyframe d'entrée (inA/inB alternés : changer de nom rejoue l'entrée). */
  entree: string;
  /** Décalage d'entrée en ms (cascade de la grille). */
  delai: number;
  /** Espace qu'on vient de quitter : éclair « vu » au retour sur la mosaïque. */
  eclair: boolean;
  /** Seule tuile atteinte par Tab (tabindex itinérant) ; les flèches mènent aux autres. */
  tabulable: boolean;
  onOuvrir: (wsId: string, tuile: HTMLElement | null) => void;
}

/**
 * Tuile d'un espace : en-tête (avatar, nom, branche, état et depuis quand), trait de
 * balayage quand l'agent travaille, mini-terminal VIVANT (dernières lignes de l'onglet
 * actif, lues dans le registre au rythme limité de l'abonnement) et pied d'état.
 * Toute la tuile est un bouton qui ouvre le terminal de l'espace ; en attente, « Aller »
 * fait de même, posé au-dessus.
 */
export const Tuile = memo(function Tuile({
  wsId,
  etat,
  nbLignes,
  taillePolice,
  entree,
  delai,
  eclair,
  tabulable,
  onOuvrir,
}: TuileProps) {
  // Sélecteur aplati en primitives : la tuile ne se re-rend que si ce qu'elle montre change.
  const w = useWorkspaceStore(
    useShallow((s) => {
      const ws = s.workspaces.find((x) => x.id === wsId);
      if (!ws) return null;
      const occupe = ws.tabs.find((t) => {
        const pty = s.tabPtys[t.id];
        return pty !== undefined && pty in s.busyPtys;
      });
      // Onglet dont l'agent vient de finir : le message de fin de tour (ou, à défaut, le
      // titre de l'onglet, sujet du tour) fait le pied « Terminé : … ».
      const fini = ws.tabs.find((t) => t.id in s.tabsTermines);
      return {
        nom: ws.name,
        couleur: couleurEspace(ws),
        cwd: ws.cwd,
        branche: ligneBranche({ ...ws, gitConnu: ws.gitConnu === true }),
        tabId: ws.activeTabId ?? ws.tabs[0]?.id ?? null,
        travail: titreSansGlyphe(occupe?.title),
        termine: sujetTermine(ws.lastNotification, fini?.title),
        attente: ws.lastNotification?.body || ws.lastNotification?.title || "",
      };
    }),
  );
  const home = useHome();
  const lignes = useDernieresLignes(w?.tabId ?? null, nbLignes);
  const cles = useClesLignes(lignes);
  if (!w) return null;

  const repos = etat === "repos";
  const detail =
    etat === "travail"
      ? w.travail || "Au travail…"
      : etat === "attente"
        ? w.attente || "Un agent vous attend"
        : etat === "termine"
          ? messageTermine(w.termine)
          : (derniereCommande(lignes) ?? cheminCourt(w.cwd, home));
  const balayage = cadenceBalayage(w.nom);
  const ouvrir = (e: MouseEvent<HTMLElement>) =>
    onOuvrir(wsId, e.currentTarget.closest<HTMLElement>(".mos-tuile"));

  return (
    <div
      className="mos-cellule"
      style={{ animation: `${entree} .34s var(--courbe-glisse) ${delai}ms both` }}
    >
      <article aria-label={w.nom} className="mos-tuile" data-etat={etat} data-eclair={eclair || undefined}>
        <button
          type="button"
          className="mos-tuile-ouvrir"
          data-mos-ws={wsId}
          tabIndex={tabulable ? 0 : -1}
          aria-label={ariaTuile(w.nom, etat, detail)}
          onClick={ouvrir}
        />

        <div className="mos-tuile-tete">
          <Avatar
            monogramme={monogramme(w.nom)}
            couleur={w.couleur}
            etat={etatVisuelAvatar(etat)}
            actif={!repos}
            taille={28}
            sautille={false}
            className="mos-avatar"
            // Pas de liseré dans la tuile : seul le fond se densifie hors repos.
            style={{ boxShadow: "none" }}
          />
          <span className="mos-tuile-ident">
            <span className="mos-tuile-nom">{w.nom}</span>
            <span className="mos-tuile-branche">{w.branche}</span>
          </span>
          <span className="mos-tuile-etat">
            <span className="mos-tuile-libelle">{LIBELLE_ETAT[etat]}</span>
            <TempsEtat wsId={wsId} etat={etat} />
          </span>
        </div>

        <div className="mos-balayage" aria-hidden="true">
          {etat === "travail" && (
            <span style={{ animationDuration: balayage.duree, animationDelay: balayage.delai }} />
          )}
        </div>

        <div
          className="mos-corps"
          aria-hidden="true"
          style={
            {
              height: `${(nbLignes * 1.6).toFixed(1)}em`,
              fontSize: taillePolice,
              justifyContent: lignes.length >= nbLignes ? "flex-end" : "flex-start",
            } as CSSProperties
          }
        >
          {lignes.map((l, i) => (
            <div key={cles[i]} className="mos-ligne" data-ton={repos ? "discret" : tonLigne(l)}>
              {l}
            </div>
          ))}
        </div>

        <div className="mos-pied">
          {etat === "travail" && <span className="mos-pied-travail">{detail}</span>}
          {etat === "attente" && (
            <span className="mos-pied-attente">
              <span className="mos-pied-question">{detail}</span>
              <button type="button" className="mos-aller" aria-label={`Aller répondre à ${w.nom}`} onClick={ouvrir}>
                Aller
                <IconeFleche taille={12} />
              </button>
            </span>
          )}
          {etat === "termine" && (
            <span className="mos-pied-termine">
              <IconeCoche taille={13} />
              <span className="mos-pied-termine-texte">{detail}</span>
            </span>
          )}
          {repos && <span className="mos-pied-repos">{detail}</span>}
        </div>
      </article>
    </div>
  );
});

/** Repère de temps sous l'état : seul ce texte suit l'horloge, pas toute la tuile. */
function TempsEtat({ wsId, etat }: { wsId: string; etat: EtatAgent }) {
  const suivi = useSuiviEtat(wsId);
  const maintenant = useMaintenant();
  const depuis = suivi && suivi.etat === etat ? suivi.depuis : null;
  return <span className="mos-tuile-temps">{etiquetteTemps(etat, depuis, maintenant)}</span>;
}

