import { useCallback, useEffect, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import { useReglagesStore } from "../../store/reglages";
import { useSuperviseurStore } from "../../store/superviseur";
import { useWorkspaceStore } from "../../store/workspace";
import { autoriserDemande } from "../../lib/executeurSuperviseur";
import { peutValider } from "../../lib/gardeFou";
import { demandeAuClavier } from "../../lib/posteSuperviseur";
import { fermerPanneauSuperviseur } from "../../lib/shortcutDispatch";
import { useEspacesSuperviseur, useEtatAffiche, useGroupesPoste } from "../../hooks/useEtatSuperviseur";
import { useReserveDock } from "../../hooks/useReserveDock";
import { EnTeteSuperviseur } from "./EnTeteSuperviseur";
import { EspacesPoste } from "./EspacesPoste";
import { FilSuperviseur } from "./FilSuperviseur";
import { SaisieSuperviseur } from "./SaisieSuperviseur";
import { SuperviseurDesactive } from "./SuperviseurDesactive";
import { IconeCroix, MiniAvatar } from "./elements";
import "../../styles/superviseur.css";
import "../../styles/poste.css";

/**
 * Poste de suivi du superviseur : vue plein écran (montée par App à la place du panneau
 * latéral, sous le dock) où les espaces sont rangés par état à gauche (`EspacesPoste`) et
 * où le fil et le prompt, fixe en bas, occupent la colonne de droite. Cliquer un espace le
 * met en filtre : le fil ne montre que lui et le prompt devient « à propos de » cet espace.
 * Ouvert/fermé par Ctrl+Maj+Espace ou la marque du dock (`useSuperviseurStore.panneauOuvert`) ;
 * les terminaux restent montés dessous, jamais redimensionnés.
 *
 * Clavier, par `onKeyDown` sur la racine (jamais sur window : Échap appartient à Claude
 * Code dans le terminal) : Échap ferme la vue, Ctrl+Entrée autorise la plus ancienne carte
 * « À valider » de l'espace filtré (sinon la plus ancienne ouverte). Aucune écriture dans
 * une session ici : tout passe par `autoriserDemande`, donc par le garde-fou.
 */
export function PosteSuperviseur() {
  const actif = useReglagesStore((s) => s.reglages.superviseur.actif);
  const nom = useReglagesStore((s) => s.reglages.superviseur.nom);
  const etat = useEtatAffiche();
  const espaces = useEspacesSuperviseur();
  const groupes = useGroupesPoste();
  const reserve = useReserveDock();
  const [pairesOuvertes, setPairesOuvertes] = useState(false);
  // Espace sur lequel le fil est filtré : propre à cette ouverture du poste.
  const [filtre, setFiltre] = useState<string | null>(null);
  const racine = useRef<HTMLElement>(null);
  const champ = useRef<HTMLInputElement>(null);

  // L'espace filtré a disparu (fermé) : retour à tous les espaces.
  useEffect(() => {
    if (filtre !== null && !espaces.has(filtre)) setFiltre(null);
  }, [filtre, espaces]);

  // Le poste qui s'ouvre prend le focus : le champ du prompt s'il est actif, sinon la racine.
  useEffect(() => {
    (champ.current ?? racine.current)?.focus();
  }, [actif]);

  const basculerFiltre = useCallback((id: string) => setFiltre((f) => (f === id ? null : id)), []);

  const surClavier = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === "Escape" && !e.defaultPrevented) {
      e.preventDefault();
      e.stopPropagation();
      fermerPanneauSuperviseur();
      return;
    }
    if (e.key === "Enter" && e.ctrlKey && !e.nativeEvent.isComposing) {
      const reglages = useReglagesStore.getState().reglages.superviseur;
      const demande = demandeAuClavier(useSuperviseurStore.getState().demandes, filtre);
      if (!demande || !peutValider(reglages).ok) return;
      e.preventDefault();
      const raison = autoriserDemande(demande.id);
      if (raison) useWorkspaceStore.getState().showToast(raison);
    }
  };

  const espaceFiltre = filtre ? espaces.get(filtre) : undefined;
  const compteurs = { attendent: groupes.attendent.length, travail: groupes.travail.length, repos: groupes.repos.length };

  return (
    <section
      ref={racine}
      className="sup-poste"
      tabIndex={-1}
      aria-label={`${nom}, poste de suivi`}
      style={{ "--poste-reserve": reserve } as CSSProperties}
      onKeyDown={surClavier}
    >
      {!actif ? (
        <SuperviseurDesactive fermer={fermerPanneauSuperviseur} />
      ) : (
        <>
          <EnTeteSuperviseur
            etat={etat}
            compteurs={compteurs}
            pairesOuvertes={pairesOuvertes}
            basculerPaires={() => setPairesOuvertes((o) => !o)}
            fermer={fermerPanneauSuperviseur}
          />
          <div className="sup-poste-corps">
            <main className="sup-poste-gauche" aria-label="Espaces">
              <EspacesPoste filtre={filtre} basculerFiltre={basculerFiltre} espaces={espaces} nom={nom} />
            </main>
            <aside className="sup-poste-droite" aria-label={`Parler à ${nom}`}>
              <div className="sup-poste-fil-barre">
                <h2 className="sup-intertitre sup-poste-fil-titre">Fil</h2>
                <span style={{ flex: 1 }} />
                {espaceFiltre ? (
                  <button
                    type="button"
                    className="sup-chip sup-poste-puce"
                    aria-label={`Fil filtré sur ${espaceFiltre.nom} : revenir à tous les espaces`}
                    onClick={() => setFiltre(null)}
                  >
                    <MiniAvatar mono={espaceFiltre.mono} couleur={espaceFiltre.couleur} taille={18} />
                    <span className="sup-tronque">{espaceFiltre.nom}</span>
                    <IconeCroix taille={10} />
                  </button>
                ) : (
                  <span className="sup-poste-tous">tous les espaces</span>
                )}
              </div>
              <FilSuperviseur espaces={espaces} ouvrirPaires={() => setPairesOuvertes(true)} wsId={filtre} />
              <SaisieSuperviseur
                champRef={champ}
                espace={espaceFiltre ? { id: espaceFiltre.id, nom: espaceFiltre.nom } : null}
              />
            </aside>
          </div>
        </>
      )}
    </section>
  );
}
