import { useMemo } from "react";
import { useReglagesStore } from "../../store/reglages";
import { useSuperviseurStore, SUPERVISEUR, type EntreeFil, type PartieFil } from "../../store/superviseur";
import { allerA, executerActionFil } from "../../lib/executeurSuperviseur";
import { nomOutil } from "../../lib/outilsSuperviseur";
import { filtrerFil } from "../../lib/posteSuperviseur";
import { LIBELLES_ETAT_LIGNE, comptesEtats, heureFil } from "../../lib/superviseurLibelles";
import type { InfoEspaceSuperviseur } from "../../hooks/useEtatSuperviseur";
import { Kbd } from "../ui/Kbd";
import { IconeCoche, IconeCroix, IconeRoute, MiniAvatar, Viseur, ViseurPoint } from "./elements";

/**
 * Fil horodaté du superviseur, façon terminal (maquette Superviseur) : ❯ pour ce que
 * vous écrivez, lignes signées de son nom, appels d'outils en mono (arc qui tourne, puis
 * coche), messages routés d'une session à l'autre (expéditeur → destinataire, avatars
 * cliquables), observations, tableau « où en sont mes agents », boutons d'action.
 * `role="log"` en `column-reverse` : le plus récent reste en bas, collé à la saisie,
 * sans script de défilement.
 */
export function FilSuperviseur({
  espaces,
  ouvrirPaires,
  wsId,
}: {
  espaces: Map<string, InfoEspaceSuperviseur>;
  ouvrirPaires: () => void;
  /** Espace sur lequel le fil est filtré (poste de suivi) ; null ou absent : tout. */
  wsId?: string | null;
}) {
  const fil = useSuperviseurStore((s) => s.fil);
  const nom = useReglagesStore((s) => s.reglages.superviseur.nom);
  // Filtré AVANT le map : l'heure n'est répétée que d'une entrée visible à l'autre.
  const visibles = useMemo(() => filtrerFil(fil, wsId ?? null), [fil, wsId]);

  let heurePrecedente = "";
  return (
    <div className="sup-fil" role="log" aria-live="polite" aria-label={`Fil de ${nom}`}>
      <div className="sup-fil-pile">
        {fil.length === 0 && <FilVide nom={nom} nbEspaces={espaces.size} />}
        {fil.length > 0 && visibles.length === 0 && wsId && (
          <p className="sup-fil-rien">Rien au fil pour {espaces.get(wsId)?.nom ?? "cet espace"} pour l’instant.</p>
        )}
        {visibles.map((e, i) => {
          const heure = heureFil(e.a);
          const montrer = heure !== heurePrecedente;
          heurePrecedente = heure;
          return (
            <Entree
              key={e.id}
              e={e}
              heure={montrer ? heure : ""}
              premiere={i === 0}
              nom={nom}
              espaces={espaces}
              ouvrirPaires={ouvrirPaires}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Premier lancement, ou fil vide après un redémarrage : ce qu'il fait, comment lui parler. */
function FilVide({ nom, nbEspaces }: { nom: string; nbEspaces: number }) {
  const pause = useReglagesStore((s) => s.reglages.superviseur.pause);
  return (
    <div className="sup-vide sup-ent">
      <span className="sup-tete-viseur sup-vide-viseur" data-mode={pause ? "pause" : "observe"} aria-hidden="true">
        <Viseur mode={pause ? "pause" : "observe"} taille="tete" />
      </span>
      <div className="sup-vide-titre">
        {pause
          ? `${nom} est en pause.`
          : nbEspaces
            ? `${nom} suit vos ${nbEspaces > 1 ? `${nbEspaces} espaces` : "espace"}.`
            : `${nom} attend votre premier espace.`}
      </div>
      <p className="sup-vide-texte">
        Il vous prévient quand un agent vous attend ou termine, et répond à vos questions : où en sont vos agents, ranger
        vos espaces, faire passer une question d’une session à l’autre.
      </p>
      <p className="sup-vide-texte">
        Depuis un terminal, un agent peut lui confier une question pour une autre session :
        <code className="sup-vide-code">terminials demander &lt;espace&gt; "…"</code>
      </p>
    </div>
  );
}

function Entree({
  e,
  heure,
  premiere,
  nom,
  espaces,
  ouvrirPaires,
}: {
  e: EntreeFil;
  heure: string;
  premiere: boolean;
  nom: string;
  espaces: Map<string, InfoEspaceSuperviseur>;
  ouvrirPaires: () => void;
}) {
  // Espace qui « signe » l'entrée : l'expéditeur d'un message, l'espace observé.
  const signe = e.genre === "message" && e.de && e.de !== SUPERVISEUR ? espaces.get(e.de) : e.genre === "observation" && e.wsId ? espaces.get(e.wsId) : undefined;

  const tete =
    e.genre === "superviseur" ? (
      <>
        <span className="sup-tete-texte">{nom}</span>
        {e.vers && <Destinataire qui={e.vers} nom={nom} espaces={espaces} />}
      </>
    ) : e.genre === "message" ? (
      <>
        <span className="sup-tete-texte">{e.de === SUPERVISEUR ? nom : (espaces.get(e.de ?? "")?.nom ?? "espace fermé")}</span>
        {e.vers && <Destinataire qui={e.vers} nom={nom} espaces={espaces} />}
      </>
    ) : null;

  return (
    <div className="sup-entree sup-ent" data-genre={e.genre} data-premiere={premiere || undefined}>
      <span className="sup-heure">{heure}</span>
      <span className="sup-signe">
        {signe ? (
          <MiniAvatar mono={signe.mono} couleur={signe.couleur} taille={20} label={`Aller à ${signe.nom}`} onClick={() => allerA(signe.id)} />
        ) : e.genre === "utilisateur" ? (
          <span className="sup-invite" aria-hidden="true">
            ❯
          </span>
        ) : e.genre === "superviseur" || e.genre === "message" ? (
          <span className="sup-signe-viseur">
            <ViseurPoint taille={14} couleur="var(--texte-discret)" rayonPoint={1.6} />
          </span>
        ) : null}
      </span>
      <div className="sup-corps">
        {tete && <div className="sup-tete-entree">{tete}</div>}
        {e.parties.map((p, i) => (
          <Partie key={i} p={p} genre={e.genre} espaces={espaces} ouvrirPaires={ouvrirPaires} />
        ))}
      </div>
    </div>
  );
}

function Destinataire({ qui, nom, espaces }: { qui: string; nom: string; espaces: Map<string, InfoEspaceSuperviseur> }) {
  if (qui === SUPERVISEUR) {
    return (
      <>
        <IconeRoute />
        <ViseurPoint taille={12} epaisseur={1.9} />
        <span className="sup-tete-texte">{nom}</span>
      </>
    );
  }
  const w = espaces.get(qui);
  return (
    <>
      <IconeRoute />
      {w && <MiniAvatar mono={w.mono} couleur={w.couleur} taille={16} label={`Aller à ${w.nom}`} onClick={() => allerA(w.id)} />}
      <span className="sup-tete-texte">{w?.nom ?? "espace fermé"}</span>
    </>
  );
}

function Partie({
  p,
  genre,
  espaces,
  ouvrirPaires,
}: {
  p: PartieFil;
  genre: EntreeFil["genre"];
  espaces: Map<string, InfoEspaceSuperviseur>;
  ouvrirPaires: () => void;
}) {
  switch (p.type) {
    case "texte":
      return (
        <div className="sup-texte sup-ent" data-genre={genre} data-ton={p.ton}>
          {p.tete && <span className="sup-texte-tete">{p.tete}</span>}
          {p.texte}
        </div>
      );
    case "outil":
      return (
        <div className="sup-outil sup-ent" data-statut={p.statut}>
          <span className="sup-outil-etat" aria-hidden="true">
            {p.statut === "en_cours" ? (
              <span className="sup-spin" />
            ) : p.statut === "fait" ? (
              <span className="sup-mk">
                <IconeCoche taille={12} couleur="var(--succes)" />
              </span>
            ) : p.statut === "en_attente" ? (
              <span className="sup-outil-point" />
            ) : (
              <IconeCroix taille={11} />
            )}
          </span>
          <span className="sup-outil-texte">
            <span className="sup-outil-nom">{nomOutil(p.outil)}</span>
            {/* Un seul espace entre le nom et les arguments (maquette). */}
            <span className="sup-outil-args">{` ${p.args}`}</span>
            {p.detail && <span className="sup-outil-detail">{` · ${p.detail}`}</span>}
          </span>
        </div>
      );
    case "etats": {
      const lignes = p.lignes.filter((l) => espaces.has(l.wsId));
      return (
        <div className="sup-etats sup-ent">
          <div className="sup-etats-tete">
            {comptesEtats(lignes.map((l) => l.etat)).map((c) => (
              <span key={c.etat} className="sup-etats-compte">
                <span className="sup-point-etat" data-etat={c.etat} aria-hidden="true" />
                {c.texte}
              </span>
            ))}
          </div>
          <div className="sup-etats-lignes">
            {lignes.map((l) => {
              const w = espaces.get(l.wsId)!;
              const libelle = LIBELLES_ETAT_LIGNE[l.etat];
              return (
                <button
                  key={l.wsId}
                  type="button"
                  className="sup-ligne-survol sup-etat-ligne"
                  aria-label={`Aller à ${w.nom}, ${libelle} : ${l.phrase}`}
                  onClick={() => allerA(w.id)}
                >
                  <MiniAvatar mono={w.mono} couleur={w.couleur} taille={22} />
                  <span className="sup-etat-ligne-corps">
                    <span className="sup-etat-ligne-haut">
                      <span className="sup-etat-ligne-nom">{w.nom}</span>
                      <span className="sup-etat-ligne-etat" data-etat={l.etat}>
                        {libelle}
                      </span>
                    </span>
                    <span className="sup-etat-ligne-phrase">{l.phrase}</span>
                  </span>
                  <span className="sup-etat-ligne-touche">{w.raccourci}</span>
                </button>
              );
            })}
          </div>
        </div>
      );
    }
    case "refs":
      return (
        <div className="sup-refs sup-ent">
          {p.wsIds.map((id) => {
            const w = espaces.get(id);
            return w ? (
              <MiniAvatar key={id} mono={w.mono} couleur={w.couleur} taille={20} label={`Aller à ${w.nom}`} onClick={() => allerA(w.id)} />
            ) : null;
          })}
        </div>
      );
    case "action": {
      const touche = p.action.type === "aller" ? (espaces.get(p.action.wsId)?.raccourci ?? "") : "";
      return (
        <div className="sup-ent" style={{ display: "flex" }}>
          <button type="button" className="sup-chip sup-action" onClick={() => executerActionFil(p.action, ouvrirPaires)}>
            {p.libelle}
            {touche && <Kbd variante="puce">{touche}</Kbd>}
          </button>
        </div>
      );
    }
  }
}

