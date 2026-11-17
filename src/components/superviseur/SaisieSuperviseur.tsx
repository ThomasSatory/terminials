import { useState, type Ref } from "react";
import { useReglagesStore } from "../../store/reglages";
import { useSuperviseurStore, SUPERVISEUR } from "../../store/superviseur";
import { useWorkspaceStore, hasAttention } from "../../store/workspace";
import { envoyerAuSuperviseur } from "../../lib/superviseurApi";
import { suggestionsSuperviseur } from "../../lib/superviseurLibelles";
import { IconeEnvoyer } from "./elements";

/**
 * Suggestions et champ de saisie (maquette Superviseur) : Entrée envoie au superviseur
 * (`envoyerAuSuperviseur`, même chemin que la palette), le message entre au fil avec ❯.
 */
export function SaisieSuperviseur({ champRef }: { champRef: Ref<HTMLInputElement> }) {
  const nom = useReglagesStore((s) => s.reglages.superviseur.nom);
  const pause = useReglagesStore((s) => s.reglages.superviseur.pause);
  const [brouillon, setBrouillon] = useState("");
  const suggestions = useSuggestions();

  const envoyer = (t: string) => {
    if (!t.trim()) return;
    envoyerAuSuperviseur(t);
    setBrouillon("");
  };
  const plein = brouillon.trim().length > 0;

  return (
    <div className="sup-saisie">
      {suggestions.length > 0 && (
        <div className="sup-suggestions">
          {suggestions.map((s) => (
            <button key={s} type="button" className="sup-chip sup-suggestion" onClick={() => envoyer(s)}>
              {s}
            </button>
          ))}
        </div>
      )}
      <div className="sup-champ">
        <span className="sup-invite" aria-hidden="true">
          ❯
        </span>
        <input
          ref={champRef}
          className="sup-champ-texte"
          aria-label={`Parler à ${nom}`}
          placeholder={pause ? `${nom} est en pause` : `Demander à ${nom}…`}
          value={brouillon}
          onChange={(e) => setBrouillon(e.target.value)}
          onKeyDown={(e) => {
            // Ctrl+Entrée appartient à la carte « À valider » (géré par le panneau).
            if (e.key === "Enter" && !e.ctrlKey && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              envoyer(brouillon);
            }
          }}
        />
        <span className="sup-champ-touche" aria-hidden="true">
          Entrée
        </span>
        <button
          type="button"
          className="sup-prim sup-envoyer"
          data-plein={plein}
          aria-label={`Envoyer à ${nom} (Entrée)`}
          onClick={() => envoyer(brouillon)}
        >
          <IconeEnvoyer />
        </button>
      </div>
    </div>
  );
}

function useSuggestions(): string[] {
  const echanges = useSuperviseurStore((s) => s.echanges);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const nbGroupes = useWorkspaceStore((s) => s.groups.length);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const nomDe = (id: string) => workspaces.find((w) => w.id === id)?.name;
  // Question d'une session à une autre, pas encore transmise.
  const enSouffrance = echanges.find((e) => e.etat === "ouvert" && e.vers !== SUPERVISEUR && nomDe(e.de) && nomDe(e.vers));
  return suggestionsSuperviseur({
    echange: enSouffrance ? { de: nomDe(enSouffrance.de)!, vers: nomDe(enSouffrance.vers)! } : null,
    nbEspaces: workspaces.length,
    nbGroupes,
    attente: workspaces.find(hasAttention)?.name ?? null,
    actif: workspaces.find((w) => w.id === activeId)?.name ?? null,
  });
}
