import { useEffect, useRef, useState, type KeyboardEvent } from "react";
import { useReglagesStore } from "../../store/reglages";
import { useSuperviseurStore, SUPERVISEUR } from "../../store/superviseur";
import { useWorkspaceStore } from "../../store/workspace";
import { NOM_SUPERVISEUR_MAX, type NiveauAutonomie } from "../../lib/reglages";
import { nomBoutPaire } from "../../lib/outilsSuperviseur";
import { couleurEspace } from "../../lib/couleurEspace";
import { monogramme } from "../../lib/monogram";
import { LIBELLES_NIVEAU, NIVEAUX, descriptionNiveau } from "../../lib/superviseurLibelles";
import type { EtatAffiche } from "../../hooks/useEtatSuperviseur";
import { Kbd } from "../ui/Kbd";
import {
  IconeBouclier,
  IconeCoche,
  IconeCroix,
  IconeCurseurs,
  IconeEchange,
  IconePlume,
  MiniAvatar,
  Viseur,
  ViseurPoint,
} from "./elements";

/**
 * En-tête du panneau (maquette Superviseur) : viseur et nom renommable en place (≤ 16
 * caractères, Entrée valide, Échap annule), ligne d'état, échanges toujours autorisés
 * (compteur, liste dépliable), interrupteur de pause, fermer ; puis le niveau d'autonomie
 * (radiogroup Observer / Réorganiser / Agir) et ce qu'il permet.
 */
export function EnTeteSuperviseur({
  etat,
  pairesOuvertes,
  basculerPaires,
  fermer,
}: {
  etat: EtatAffiche;
  pairesOuvertes: boolean;
  basculerPaires: () => void;
  fermer: () => void;
}) {
  const nom = useReglagesStore((s) => s.reglages.superviseur.nom);
  const niveau = useReglagesStore((s) => s.reglages.superviseur.niveau);
  const pause = useReglagesStore((s) => s.reglages.superviseur.pause);
  const nbPaires = useReglagesStore((s) => s.reglages.superviseur.paires.length);
  const [brouillon, setBrouillon] = useState<string | null>(null);
  // Fin du renommage (Entrée, Échap, coche, croix) : le champ disparaît avec le focus, qui
  // tombait sur <body> — hors du panneau, Échap ne le fermait plus. Il revient au nom.
  const nomRef = useRef<HTMLButtonElement>(null);
  const editait = useRef(false);
  useEffect(() => {
    if (brouillon !== null) {
      editait.current = true;
      return;
    }
    if (!editait.current) return;
    editait.current = false;
    nomRef.current?.focus();
  }, [brouillon]);

  const valider = () => {
    const v = [...(brouillon ?? "").trim()].slice(0, NOM_SUPERVISEUR_MAX).join("");
    if (v && v !== nom) useReglagesStore.getState().setNomSuperviseur(v);
    setBrouillon(null);
  };
  const surNom = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      valider();
    } else if (e.key === "Escape") {
      // Échap annule le renommage, sans fermer le panneau.
      e.preventDefault();
      e.stopPropagation();
      setBrouillon(null);
    }
  };

  return (
    <div className="sup-tete">
      <div className="sup-tete-ligne">
        <span className="sup-tete-viseur" data-mode={etat.mode} aria-hidden="true">
          <Viseur mode={etat.mode} taille="tete" />
        </span>
        <span className="sup-tete-identite">
          {brouillon === null ? (
            <span className="sup-tete-nom-ligne">
              <button
                ref={nomRef}
                type="button"
                className="hov sup-tete-nom"
                aria-label={`Renommer ${nom}`}
                title="Renommer"
                onClick={() => setBrouillon(nom)}
              >
                <span className="sup-tronque">{nom}</span>
                <IconePlume />
              </button>
              <Kbd variante="puce">Ctrl+Maj+Espace</Kbd>
            </span>
          ) : (
            <span className="sup-tete-nom-ligne sup-tete-edition">
              <input
                className="sup-tete-champ"
                aria-label="Nom du superviseur (Entrée valide, Échap annule)"
                value={brouillon}
                maxLength={NOM_SUPERVISEUR_MAX}
                autoFocus
                onChange={(e) => setBrouillon(e.target.value)}
                onKeyDown={surNom}
              />
              <button type="button" className="hov sup-icone-24 sup-valider" aria-label="Valider le nom (Entrée)" title="Valider (Entrée)" onClick={valider}>
                <IconeCoche taille={12} />
              </button>
              <button type="button" className="hov sup-icone-24" aria-label="Annuler (Échap)" title="Annuler (Échap)" onClick={() => setBrouillon(null)}>
                <IconeCroix taille={11} />
              </button>
            </span>
          )}
          <span className="sup-ligne-etat sup-tronque" data-ton={etat.ton}>
            {etat.ligne}
          </span>
        </span>
        <button
          type="button"
          className="hov sup-tete-reglage"
          aria-label={`Échanges toujours autorisés (${nbPaires})`}
          aria-expanded={pairesOuvertes}
          title="Échanges toujours autorisés"
          onClick={basculerPaires}
        >
          <IconeCurseurs />
          <span className="sup-tete-compteur" aria-hidden="true">
            {nbPaires}
          </span>
        </button>
        <button
          type="button"
          className="sup-fl sup-pause"
          role="switch"
          aria-checked={pause}
          onClick={() => useReglagesStore.getState().basculerPause()}
        >
          <span className="sup-pause-piste" aria-hidden="true">
            <span className="sup-pause-bouton" />
          </span>
          En pause
        </button>
        <button type="button" className="hov sup-tete-fermer" aria-label="Fermer le superviseur (Échap)" title="Fermer (Échap)" onClick={fermer}>
          <IconeCroix taille={12} />
        </button>
      </div>
      <Niveaux niveau={niveau} />
      <div className="sup-niveau-phrase">
        <IconeBouclier />
        <span>{descriptionNiveau(niveau, nom)}</span>
      </div>
      {pairesOuvertes && <PairesAutorisees nom={nom} />}
    </div>
  );
}

/** Radiogroup d'autonomie : clic, ou flèches gauche/droite comme un vrai groupe radio. */
function Niveaux({ niveau }: { niveau: NiveauAutonomie }) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const choisir = (n: NiveauAutonomie) => useReglagesStore.getState().setNiveau(n);
  const surTouche = (e: KeyboardEvent<HTMLDivElement>) => {
    const pas = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!pas) return;
    e.preventDefault();
    const i = (NIVEAUX.indexOf(niveau) + pas + NIVEAUX.length) % NIVEAUX.length;
    choisir(NIVEAUX[i]);
    refs.current[i]?.focus();
  };
  return (
    <div className="sup-niveaux" role="radiogroup" aria-label="Autonomie du superviseur" onKeyDown={surTouche}>
      {NIVEAUX.map((n, i) => {
        const coche = n === niveau;
        return (
          <button
            key={n}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={coche}
            tabIndex={coche ? 0 : -1}
            className="sup-fl sup-niveau"
            onClick={() => choisir(n)}
          >
            <span className="sup-niveau-barres" aria-hidden="true">
              {[0, 1, 2].map((k) => (
                <span key={k} style={{ height: `${4 + k * 2.5}px`, opacity: k <= i ? 1 : 0.28 }} />
              ))}
            </span>
            <span className="sup-tronque">{LIBELLES_NIVEAU[n]}</span>
          </button>
        );
      })}
    </div>
  );
}

/** Paires d'espaces (désignées par leur dossier) qui échangent sans validation. */
function PairesAutorisees({ nom }: { nom: string }) {
  const paires = useReglagesStore((s) => s.reglages.superviseur.paires);
  const workspaces = useWorkspaceStore((s) => s.workspaces);

  const bout = (b: string) => {
    if (b === SUPERVISEUR) return { sup: true, nom, mono: "", couleur: "" };
    const ws = workspaces.find((w) => w.cwd === b);
    const n = nomBoutPaire(b, workspaces, nom);
    return { sup: false, nom: n, mono: monogramme(n), couleur: ws ? couleurEspace(ws) : "#9296a0" };
  };

  const retirer = (a: string, b: string, nomA: string, nomB: string) => {
    useReglagesStore.getState().revoquerPaire(a, b);
    useSuperviseurStore.getState().ajouterEntree({
      genre: "superviseur",
      parties: [{ type: "texte", ton: "discret", texte: `Échanges entre ${nomA} et ${nomB} : votre validation est de nouveau requise.` }],
    });
  };

  return (
    <section className="sup-paires sup-ent" aria-label="Échanges toujours autorisés">
      <div className="sup-intertitre sup-paires-titre">Toujours autorisés, sans validation</div>
      {paires.map((p) => {
        // Le superviseur toujours à droite, comme la maquette.
        const [a, b] = p.a === SUPERVISEUR ? [bout(p.b), bout(p.a)] : [bout(p.a), bout(p.b)];
        return (
          <div key={`${p.a}\u0000${p.b}`} className="sup-paire sup-ent">
            <MiniAvatar mono={a.mono} couleur={a.couleur} taille={18} />
            <span className="sup-paire-nom">{a.nom}</span>
            <IconeEchange />
            {b.sup ? <ViseurPoint taille={14} /> : <MiniAvatar mono={b.mono} couleur={b.couleur} taille={18} />}
            <span className="sup-paire-nom sup-tronque" style={{ flex: 1 }}>
              {b.nom}
            </span>
            <button
              type="button"
              className="sup-chip sup-paire-retirer"
              aria-label={`Retirer l’autorisation entre ${a.nom} et ${b.nom}`}
              onClick={() => retirer(p.a, p.b, a.nom, b.nom)}
            >
              Retirer
            </button>
          </div>
        );
      })}
      {paires.length === 0 && <div className="sup-paires-vide">Aucun : chaque écriture dans une session passe par vous.</div>}
    </section>
  );
}
