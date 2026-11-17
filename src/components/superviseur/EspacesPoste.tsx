import { useMemo, type ReactNode } from "react";
import { useShallow } from "zustand/react/shallow";
import { useReglagesStore } from "../../store/reglages";
import { useSuperviseurStore, espaceEnRelais, interlocuteurRelais, SUPERVISEUR, type DemandeValidation } from "../../store/superviseur";
import { useWorkspaceStore } from "../../store/workspace";
import { allerA } from "../../lib/executeurSuperviseur";
import { fermerPanneauSuperviseur } from "../../lib/shortcutDispatch";
import { peutValider } from "../../lib/gardeFou";
import { etatVisuelAvatar, messageTermine, type EtatAgent } from "../../lib/etatAgent";
import { texteNotification } from "../../lib/dockInfo";
import {
  MARGE_CADRE_SAISIE,
  etiquetteTemps,
  ilYA,
  ligneBranche,
  sansCadreSaisie,
  sujetTermine,
  titreSansGlyphe,
} from "../../lib/mosaique";
import { cartesParEspace, repliResume, resumeAffiche, typeAttente, type GroupePoste } from "../../lib/posteSuperviseur";
import { depuisLibelle, texteMasque } from "../../lib/superviseurLibelles";
import { useGroupesPoste, type InfoEspaceSuperviseur } from "../../hooks/useEtatSuperviseur";
import { useDernieresLignes } from "../../hooks/useDernieresLignes";
import { useEtatEspace } from "../../hooks/useEtatAgent";
import { demarrerSuiviEtats, useMaintenant, useSuiviEtat } from "../mosaique/suivi";
import { Avatar } from "../ui/Avatar";
import { IconeFleche } from "../ui/icons";
import { CarteValidation } from "./CarteValidation";

/**
 * Colonne gauche du poste de suivi : les espaces rangés par état (maquette « poste de
 * suivi »). « Vous attendent » porte, sur la carte de chaque espace, le texte exact de
 * ce qu'il demande et, quand il y en a, les cartes « À valider » qui le visent ;
 * « Au travail » donne en une phrase où en est l'agent ; « Au repos » tient sur une ligne.
 *
 * Aucune écriture dans une session ici : la validation passe par `CarteValidation`
 * (garde-fou), un espace en attente sans carte n'offre que « Aller au terminal ».
 * Cliquer la tête d'une carte filtre le fil sur l'espace (`basculerFiltre`).
 */

// Le suivi « depuis quand » tourne dès l'import, comme pour la mosaïque.
demarrerSuiviEtats();

/** Dernières lignes lues pour montrer la demande d'un espace en attente sans carte. */
const LIGNES_DEMANDE = 6;

interface PropsEspaces {
  filtre: string | null;
  basculerFiltre: (wsId: string) => void;
  espaces: Map<string, InfoEspaceSuperviseur>;
  nom: string;
}

export function EspacesPoste({ filtre, basculerFiltre, espaces, nom }: PropsEspaces) {
  const groupes = useGroupesPoste();
  const demandes = useSuperviseurStore((s) => s.demandes);
  const superviseur = useReglagesStore((s) => s.reglages.superviseur);
  const cartes = useMemo(() => cartesParEspace(demandes), [demandes]);
  const nbOuvertes = useMemo(() => demandes.filter((d) => d.statut === "ouverte").length, [demandes]);
  const visibles = superviseur.niveau === "agir" && !superviseur.pause && peutValider(superviseur).ok;

  if (espaces.size === 0) {
    return (
      <div className="sup-poste-vide sup-ent">
        <p className="sup-poste-vide-titre">Aucun espace ouvert.</p>
        <button type="button" className="sup-sec" onClick={() => fermerPanneauSuperviseur()}>
          Retour à l’accueil
        </button>
      </div>
    );
  }

  const commun = { filtre, basculerFiltre, espaces, nom };
  return (
    <div className="sup-poste-espaces">
      {groupes.attendent.length > 0 && (
        <Section
          groupe="attendent"
          libelle="Vous attendent"
          label="Espaces qui vous attendent"
          nombre={groupes.attendent.length}
        >
          {nbOuvertes > 0 && !visibles && (
            <div className="sup-masque sup-ent">
              <span className="sup-masque-point" aria-hidden="true" />
              <span className="sup-masque-texte">{texteMasque(nbOuvertes, superviseur.pause)}</span>
              <button
                type="button"
                className="sup-chip sup-masque-action"
                onClick={() =>
                  superviseur.pause
                    ? useReglagesStore.getState().setPause(false)
                    : useReglagesStore.getState().setNiveau("agir")
                }
              >
                {superviseur.pause ? "Reprendre" : "Passer en Agir"}
              </button>
            </div>
          )}
          <div className="sup-poste-grille" data-genre="attente">
            {groupes.attendent.map((id) => (
              <CarteAttente key={id} id={id} cartes={cartes.get(id) ?? []} masquee={!visibles} {...commun} />
            ))}
          </div>
        </Section>
      )}

      <Section groupe="travail" libelle="Au travail" label="Espaces au travail" nombre={groupes.travail.length}>
        {groupes.travail.length === 0 ? (
          <p className="sup-poste-rien">Personne ne travaille.</p>
        ) : (
          <div className="sup-poste-grille" data-genre="travail">
            {groupes.travail.map((id) => (
              <CarteTravail key={id} id={id} {...commun} />
            ))}
          </div>
        )}
      </Section>

      <Section groupe="repos" libelle="Au repos" label="Espaces au repos" nombre={groupes.repos.length}>
        {groupes.repos.length === 0 ? (
          <p className="sup-poste-rien">Personne au repos.</p>
        ) : (
          <div className="sup-poste-repos">
            {groupes.repos.map((id) => (
              <LigneRepos key={id} id={id} {...commun} />
            ))}
          </div>
        )}
      </Section>
    </div>
  );
}

function Section({
  groupe,
  libelle,
  label,
  nombre,
  children,
}: {
  groupe: GroupePoste;
  libelle: string;
  label: string;
  nombre: number;
  children: ReactNode;
}) {
  return (
    <section className="sup-poste-section" data-groupe={groupe} aria-label={label}>
      <h2 className="sup-poste-titre sup-intertitre">
        {libelle} · {nombre}
      </h2>
      {children}
    </section>
  );
}

// ---------- Ce que montre une carte, lu dans le store ----------

/** Ce qu'une carte d'espace montre, aplati en primitives : elle ne se re-rend que si l'un
    de ces champs change, pas à chaque tour des sondes. */
function useInfosEspace(wsId: string) {
  return useWorkspaceStore(
    useShallow((s) => {
      const ws = s.workspaces.find((x) => x.id === wsId);
      if (!ws) return null;
      const occupe = ws.tabs.find((t) => {
        const pty = s.tabPtys[t.id];
        return pty !== undefined && pty in s.busyPtys;
      });
      const fini = ws.tabs.find((t) => t.id in s.tabsTermines);
      const actif = ws.activeTabId ?? ws.tabs[0]?.id ?? null;
      return {
        branche: ligneBranche({ ...ws, gitConnu: ws.gitConnu === true }),
        tabActif: actif,
        // Onglet qui vous attend (le premier non lu), sinon l'actif.
        tabAttente: ws.unreadTabs[0] ?? actif,
        tabsNonLus: ws.unreadTabs,
        // Onglet qui travaille, sinon l'actif.
        tabOccupe: occupe?.id ?? actif,
        titreTravail: titreSansGlyphe(occupe?.title),
        termine: sujetTermine(ws.lastNotification, fini?.title),
        notification: texteNotification(ws.lastNotification),
        nbModifies: ws.nbModifies,
      };
    }),
  );
}

/** Tête d'une carte : un bouton, pour que cliquer l'espace filtre le fil sur lui. */
function Tete({
  info,
  etat,
  taille,
  filtre,
  aria,
  onClick,
  relais,
  children,
}: {
  info: InfoEspaceSuperviseur;
  etat: EtatAgent;
  taille: number;
  filtre: boolean;
  aria: string;
  onClick: () => void;
  relais: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className="sup-poste-tete" aria-pressed={filtre} aria-label={aria} onClick={onClick}>
      <Avatar
        monogramme={info.mono}
        couleur={info.couleur}
        etat={etat}
        actif={etat !== "repos"}
        taille={taille}
        sautille={false}
        relais={relais}
      />
      {children}
    </button>
  );
}

// ---------- Vous attendent ----------

function CarteAttente({
  id,
  cartes,
  masquee,
  filtre,
  basculerFiltre,
  espaces,
  nom,
}: PropsEspaces & { id: string; cartes: DemandeValidation[]; masquee: boolean }) {
  const info = espaces.get(id);
  const w = useInfosEspace(id);
  const suivi = useSuiviEtat(id);
  const maintenant = useMaintenant();
  const relais = useSuperviseurStore((s) => espaceEnRelais(s, id));
  const resume = useSuperviseurStore((s) => s.resumes[id]);
  // Onglet bloqué sur une autorisation d'abord (parmi les non lus), sinon celui qui attend.
  const tabDemande = useSuperviseurStore((s) => {
    const bloquee = w?.tabsNonLus.find((t) => t in s.sessionsBloquees);
    return bloquee ?? w?.tabAttente ?? null;
  });
  const bloque = useSuperviseurStore((s) => (tabDemande ? (s.sessionsBloquees[tabDemande] ?? null) : null));
  const sansCarte = cartes.length === 0;
  // Sans carte, la demande exacte : l'autorisation en cours, sinon la notification, sinon
  // ce que le terminal affiche (lu seulement dans ce cas).
  const lireTerminal = sansCarte && !bloque && !w?.notification;
  const brutes = useDernieresLignes(lireTerminal ? tabDemande : null, LIGNES_DEMANDE + MARGE_CADRE_SAISIE);
  const lignes = useMemo(() => sansCadreSaisie(brutes).slice(-LIGNES_DEMANDE), [brutes]);
  if (!info || !w) return null;

  const type = typeAttente(cartes, bloque);
  const depuis = cartes.length
    ? depuisLibelle(Math.min(...cartes.map((d) => d.depuis)), maintenant)
    : etiquetteTemps("attente", suivi?.depuis ?? null, maintenant);
  const citation = bloque ?? (w.notification || lignes.join("\n"));
  const avis = resumeAffiche(resume, "attendent", "");

  return (
    <article className="sup-poste-carte sup-ent" data-etat="attente" data-filtre={filtre === id || undefined}>
      <Tete
        info={info}
        etat="attente"
        taille={34}
        filtre={filtre === id}
        relais={relais}
        aria={`${info.nom}, vous attend, ${type}. Filtrer le fil sur cet espace`}
        onClick={() => basculerFiltre(id)}
      >
        <span className="sup-poste-ident">
          <span className="sup-poste-nom">{info.nom}</span>
          <span className="sup-poste-branche">{w.branche}</span>
        </span>
        <span className="sup-poste-meta">
          <span className="sup-poste-type">{type}</span>
          {depuis && <span className="sup-poste-depuis">{depuis}</span>}
        </span>
      </Tete>

      {sansCarte ? (
        <>
          {citation && <div className="sup-poste-citation">{citation}</div>}
          {avis.source === "superviseur" && (
            <p className="sup-poste-avis">
              <span className="sup-intertitre">Avis de {nom}</span>
              {avis.texte}
            </p>
          )}
          <div className="sup-carte-actions">
            <span style={{ flex: 1 }} />
            <button type="button" className="sup-ghost" onClick={() => allerA(id, tabDemande ?? undefined)}>
              Aller au terminal
              <IconeFleche taille={12} />
            </button>
          </div>
        </>
      ) : (
        cartes.map((d) => (
          <CarteValidation key={d.id} d={d} espaces={espaces} nom={nom} maintenant={maintenant} masquee={masquee} />
        ))
      )}
    </article>
  );
}

// ---------- Au travail ----------

function CarteTravail({ id, filtre, basculerFiltre, espaces }: PropsEspaces & { id: string }) {
  const info = espaces.get(id);
  const w = useInfosEspace(id);
  const suivi = useSuiviEtat(id);
  const maintenant = useMaintenant();
  const relais = useSuperviseurStore((s) => espaceEnRelais(s, id));
  const resume = useSuperviseurStore((s) => s.resumes[id]);
  const brutes = useDernieresLignes(w?.tabOccupe ?? null, 1 + MARGE_CADRE_SAISIE);
  const derniere = useMemo(() => sansCadreSaisie(brutes).slice(-1)[0] ?? "", [brutes]);
  const interlocuteur = useSuperviseurStore((s) => interlocuteurRelais(s, id));
  const nomSuperviseur = useReglagesStore((s) => s.reglages.superviseur.nom);
  const relaisVers = interlocuteur === null ? null : interlocuteur === SUPERVISEUR ? nomSuperviseur : (espaces.get(interlocuteur)?.nom ?? "un espace fermé");
  if (!info || !w) return null;

  const depuis = etiquetteTemps("travail", suivi?.depuis ?? null, maintenant);
  const phrase = resumeAffiche(
    resume,
    "travail",
    repliResume({ etat: "travail", relaisVers, titreTravail: w.titreTravail }),
  );

  return (
    <article className="sup-poste-carte sup-poste-travail sup-ent" data-etat="travail" data-filtre={filtre === id || undefined}>
      <Tete
        info={info}
        etat="travail"
        taille={34}
        filtre={filtre === id}
        relais={relais}
        aria={`${info.nom}, au travail : ${phrase.texte}. Filtrer le fil sur cet espace`}
        onClick={() => basculerFiltre(id)}
      >
        <span className="sup-poste-ident">
          <span className="sup-poste-nom">{info.nom}</span>
          <span className="sup-poste-branche">{w.branche}</span>
        </span>
        <span className="sup-poste-meta">
          <span className="sup-poste-duree">
            <span className="sup-poste-arc" aria-hidden="true" />
            {depuis}
          </span>
        </span>
      </Tete>
      <p className="sup-poste-resume">{phrase.texte}</p>
      {derniere && <div className="sup-poste-derniere">{derniere}</div>}
      <div className="sup-poste-pied">
        {w.nbModifies !== undefined ? (
          <span className="sup-poste-fichiers">
            <span aria-hidden="true">±</span> {w.nbModifies} {w.nbModifies > 1 ? "fichiers" : "fichier"}
          </span>
        ) : (
          <span />
        )}
        <button type="button" className="sup-ghost" onClick={() => allerA(id, w.tabOccupe ?? undefined)}>
          Aller au terminal
          <IconeFleche taille={12} />
        </button>
      </div>
    </article>
  );
}

// ---------- Au repos ----------

/** Ligne compacte : ne lit jamais le terminal (rien n'y change). */
function LigneRepos({ id, filtre, basculerFiltre, espaces }: PropsEspaces & { id: string }) {
  const info = espaces.get(id);
  const w = useInfosEspace(id);
  const suivi = useSuiviEtat(id);
  const maintenant = useMaintenant();
  const resume = useSuperviseurStore((s) => s.resumes[id]);
  const etat = useEtatEspace(id);
  if (!info || !w) return null;

  const repli = etat === "termine" ? messageTermine(w.termine) : "Au repos";
  const phrase = resumeAffiche(resume, "repos", repli);
  const depuis = suivi ? ilYA(maintenant - suivi.depuis) : "";

  return (
    <div className="sup-poste-ligne" data-filtre={filtre === id || undefined}>
      <button
        type="button"
        className="sup-poste-tete sup-poste-tete-repos"
        aria-pressed={filtre === id}
        aria-label={`${info.nom}, ${phrase.texte}. Filtrer le fil sur cet espace`}
        onClick={() => basculerFiltre(id)}
      >
        <Avatar
          monogramme={info.mono}
          couleur={info.couleur}
          etat={etatVisuelAvatar(etat)}
          actif={false}
          taille={28}
          sautille={false}
        />
        <span className="sup-poste-nom">{info.nom}</span>
        <span className="sup-poste-resume-repos">{phrase.texte}</span>
        {depuis && <span className="sup-poste-depuis">{depuis}</span>}
      </button>
      <button
        type="button"
        className="sup-ghost sup-poste-aller"
        aria-label={`Aller au terminal de ${info.nom}`}
        title="Aller au terminal"
        onClick={() => allerA(id, w.tabActif ?? undefined)}
      >
        <IconeFleche taille={12} />
      </button>
    </div>
  );
}
