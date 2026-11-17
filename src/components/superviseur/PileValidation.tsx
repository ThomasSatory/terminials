import { useMemo, useState } from "react";
import { useReglagesStore } from "../../store/reglages";
import { useSuperviseurStore, SUPERVISEUR, demandeEnTete, type DemandeValidation } from "../../store/superviseur";
import { useWorkspaceStore } from "../../store/workspace";
import { allerA, autoriserDemande, refuserDemande } from "../../lib/executeurSuperviseur";
import { nomBoutPaire, titreOnglet } from "../../lib/outilsSuperviseur";
import { apercuParlant, tonLigne } from "../../lib/mosaique";
import { deNom, depuisLibelle } from "../../lib/superviseurLibelles";
import { useMaintenantSuperviseur, type InfoEspaceSuperviseur } from "../../hooks/useEtatSuperviseur";
import { Kbd } from "../ui/Kbd";
import { IconeCoche, IconeMonter, IconeRoute, MiniAvatar, ViseurPoint } from "./elements";

/**
 * Pile « À valider » (maquette Superviseur) : la carte en tête montre ce qui sera écrit,
 * au caractère près, où, et pourquoi ; Autoriser (Ctrl+Entrée, géré par le panneau),
 * Refuser, Aller voir ; « Toujours autoriser les échanges entre ces deux espaces » pour
 * un échange. Les autres cartes attendent dessous (« Ensuite »).
 */

/** Après une décision à la souris, la carte (et le bouton cliqué) disparaît : le focus
    tombait sur <body>, hors du panneau, où Échap et Ctrl+Entrée ne portent plus. Il passe
    à la carte suivante, sinon au champ de saisie du panneau. */
function relayerFocus() {
  requestAnimationFrame(() => {
    const actif = document.activeElement;
    if (actif && actif !== document.body && actif.isConnected) return;
    document.querySelector<HTMLElement>(".sup-autoriser, .sup-champ-texte")?.focus();
  });
}

/** Une réponse courte à une demande d'autorisation (« 1 ») s'affiche en touche. */
const TOUCHE_MAX = 24;

export function PileValidation({ espaces, nom }: { espaces: Map<string, InfoEspaceSuperviseur>; nom: string }) {
  const demandes = useSuperviseurStore((s) => s.demandes);
  const focus = useSuperviseurStore((s) => s.demandeFocus);
  const ouvertes = useMemo(() => demandes.filter((d) => d.statut === "ouverte"), [demandes]);
  const tete = demandeEnTete({ demandes, demandeFocus: focus });
  const maintenant = useMaintenantSuperviseur(15000);
  if (!tete) return null;
  const suivantes = ouvertes.filter((d) => d !== tete);

  return (
    <div className="sup-pile">
      <Carte key={tete.id} d={tete} rang={ouvertes.indexOf(tete) + 1} total={ouvertes.length} espaces={espaces} nom={nom} maintenant={maintenant} />
      {suivantes.length > 0 && (
        <div className="sup-ensuite">
          {suivantes.map((d) => {
            const w = espaces.get(d.cible.wsId);
            return (
              <button
                key={d.id}
                type="button"
                className="sup-ligne-survol sup-ensuite-ligne sup-ent"
                aria-label={`Afficher : ${d.titre}`}
                onClick={() => useSuperviseurStore.getState().focaliserDemande(d.id)}
              >
                <span className="sup-intertitre">Ensuite</span>
                {w && <MiniAvatar mono={w.mono} couleur={w.couleur} taille={18} />}
                <span className="sup-ensuite-titre">{d.titre}</span>
                <span className="sup-ensuite-depuis">{depuisLibelle(d.depuis, maintenant)}</span>
                <IconeMonter />
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Carte en tête de pile ; Ctrl+Entrée (panneau) appelle `autoriserEnTete`. */
function Carte({
  d,
  rang,
  total,
  espaces,
  nom,
  maintenant,
}: {
  d: DemandeValidation;
  rang: number;
  total: number;
  espaces: Map<string, InfoEspaceSuperviseur>;
  nom: string;
  maintenant: number;
}) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const paires = useReglagesStore((s) => s.reglages.superviseur.paires);
  const [erreur, setErreur] = useState<string | null>(null);
  const cible = espaces.get(d.cible.wsId);
  const ws = workspaces.find((w) => w.id === d.cible.wsId);
  const rangOnglet = ws ? ws.tabs.findIndex((t) => t.id === d.cible.tabId) : -1;
  const onglet = ws && rangOnglet !== -1 ? titreOnglet(ws.tabs[rangOnglet], rangOnglet) : "onglet fermé";
  const nomCible = cible?.nom ?? "espace fermé";
  const de = d.de && d.de !== SUPERVISEUR ? espaces.get(d.de) : undefined;

  const sous =
    d.de === SUPERVISEUR
      ? `question posée à ${nom}`
      : de
        ? d.outil === "session.repondre"
          ? `réponse ${deNom(de.nom)}`
          : deNom(de.nom)
        : `onglet ${onglet}`;

  const court = !d.texte.includes("\n") && [...d.texte].length <= TOUCHE_MAX;
  const enTouches = d.bloquee && court;
  const touches = [...(enTouches && d.texte ? [d.texte] : []), ...(d.entree ? ["Entrée"] : [])];
  const libelleEnvoi = enTouches ? "Sera envoyé" : d.entree ? "Sera envoyé : ce texte, puis" : "Sera envoyé : ce texte, sans Entrée";

  const nomsPaire = d.paire ? d.paire.map((b) => nomBoutPaire(b, workspaces, nom)) : null;
  const dejaAutorisee = d.paire ? paires.some((p) => (p.a === d.paire![0] && p.b === d.paire![1]) || (p.a === d.paire![1] && p.b === d.paire![0])) : false;

  const autoriser = () => {
    setErreur(autoriserDemande(d.id));
    relayerFocus();
  };

  return (
    <div className="sup-carte" role="group" aria-label={`${d.titre}, à valider`}>
      <div className="sup-carte-tete">
        <span className="sup-carte-route">
          {d.de === SUPERVISEUR ? (
            <span className="sup-carte-sup" aria-hidden="true">
              <ViseurPoint taille={15} epaisseur={1.7} />
            </span>
          ) : de ? (
            <MiniAvatar mono={de.mono} couleur={de.couleur} taille={28} fond="38" label={`Aller à ${de.nom}`} onClick={() => allerA(de.id)} />
          ) : null}
          {d.de !== null && (de || d.de === SUPERVISEUR) && (
            <span className="sup-discret-couleur">
              <IconeRoute />
            </span>
          )}
          {cible && (
            <MiniAvatar mono={cible.mono} couleur={cible.couleur} taille={28} fond="38" label={`Aller à ${cible.nom}`} onClick={() => allerA(cible.id, d.cible.tabId)} />
          )}
        </span>
        <span className="sup-carte-identite">
          <span className="sup-carte-titre-ligne">
            <span className="sup-carte-titre">{d.titre}</span>
            <span className="sup-a-valider">
              <span aria-hidden="true" />à valider
            </span>
          </span>
          <span className="sup-carte-sous">
            {sous}
            {"  ·  "}
            {depuisLibelle(d.depuis, maintenant)}
          </span>
        </span>
        {total > 1 && (
          <span className="sup-carte-compte">
            {rang} sur {total}
          </span>
        )}
      </div>

      <div className="sup-carte-boite">
        {d.bloquee && d.apercu && apercuParlant(d.apercu) && (
          <div className="sup-carte-apercu">
            {d.apercu.map((l, i) => (
              <div key={i} className="sup-carte-ligne" data-ton={tonLigne(l)}>
                {l}
              </div>
            ))}
          </div>
        )}
        {!enTouches && d.texte && (
          <>
            <div className="sup-intertitre sup-carte-label">Texte exact</div>
            {d.texte.split("\n").map((l, i, toutes) => (
              <div key={i} className="sup-carte-ligne" data-ton={tonTexteExact(d, i, toutes.length)}>
                {l || " "}
              </div>
            ))}
          </>
        )}
        <div className="sup-carte-envoi">
          {libelleEnvoi}
          {touches.map((k, i) => (
            <span key={i} className="sup-carte-touche">
              {k}
            </span>
          ))}
          <span className="sup-carte-vers">→ {nomCible} › {onglet}</span>
        </div>
      </div>

      {d.pourquoi && <div className="sup-carte-pourquoi">{d.pourquoi}</div>}

      {d.paire && nomsPaire && !dejaAutorisee && (
        <button
          type="button"
          className="sup-fl sup-toujours"
          role="checkbox"
          aria-checked={d.toujours}
          onClick={() => useSuperviseurStore.getState().basculerToujours(d.id)}
        >
          <span className="sup-case" aria-hidden="true">
            {d.toujours && (
              <span className="sup-mk">
                <IconeCoche taille={10} couleur="var(--texte-sur-accent)" epaisseur={2.4} />
              </span>
            )}
          </span>
          <span className="sup-tronque">
            Toujours autoriser les échanges entre {nomsPaire[0]} et {nomsPaire[1]}
          </span>
        </button>
      )}

      <div className="sup-carte-actions">
        <button type="button" className="sup-prim sup-autoriser" onClick={autoriser}>
          Autoriser
          <Kbd variante="sur-accent">Ctrl+Entrée</Kbd>
        </button>
        <button type="button" className="sup-sec" onClick={() => {
            refuserDemande(d.id);
            relayerFocus();
          }}>
          Refuser
        </button>
        <span style={{ flex: 1 }} />
        {cible && (
          <button type="button" className="sup-ghost" onClick={() => allerA(cible.id, d.cible.tabId)}>
            Aller voir
            {cible.raccourci && <Kbd variante="puce">{cible.raccourci}</Kbd>}
          </button>
        )}
      </div>
      {erreur && (
        <div className="sup-carte-erreur" role="alert">
          {erreur}
        </div>
      )}
    </div>
  );
}

/** Ton d'une ligne du texte exact (maquette) : pour un relais, l'en-tête « Question de …,
    transmise par … : » en discret, la consigne finale d'une question en texte, le reste
    (le message lui-même) en fort. */
function tonTexteExact(d: DemandeValidation, i: number, n: number): "fort" | "texte" | "discret" {
  if (d.brut === undefined) return "fort";
  if (i === 0) return "discret";
  if (d.outil === "session.demander" && i === n - 1) return "texte";
  return "fort";
}
