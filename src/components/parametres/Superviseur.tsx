import { useReglagesStore } from "../../store/reglages";
import { useWorkspaceStore } from "../../store/workspace";
import { couleurEspace } from "../../lib/couleurEspace";
import { monogramme } from "../../lib/monogram";
import type { NiveauAutonomie } from "../../lib/reglages";
import { membrePaire, sousTitrePaire, type RangeeParametre } from "../../lib/parametresModele";
import { Avatar } from "../ui/Avatar";
import { Rangee, useParametres } from "./contexte";
import { useClavierRadio } from "./controles";

/** Autonomie et paires autorisées (Paramètres › Superviseur, maquette Parametres). */

const NIVEAUX: readonly { valeur: NiveauAutonomie; libelle: string; phrase: string }[] = [
  { valeur: "observer", libelle: "Observer", phrase: "Il regarde et vous prévient. Il ne crée, ne range et n’écrit rien." },
  {
    valeur: "reorganiser",
    libelle: "Réorganiser",
    phrase: "Il crée, renomme, range et ferme des espaces. Il n’écrit jamais dans un terminal.",
  },
  {
    valeur: "agir",
    libelle: "Agir",
    phrase: "Il réorganise librement. Écrire dans un terminal passe toujours par votre accord.",
  },
];

/** Hauteur d'une option (56) + écart (4) : pas de l'indicateur qui glisse. */
const PAS_NIVEAU = 60;

export function NiveauxAutonomie({ rangee }: { rangee: RangeeParametre }) {
  const niveau = useReglagesStore((s) => s.reglages.superviseur.niveau);
  const { signaler } = useParametres();
  const rang = Math.max(
    0,
    NIVEAUX.findIndex((n) => n.valeur === niveau),
  );
  const choisir = (i: number) => {
    if (NIVEAUX[i].valeur === niveau) return;
    useReglagesStore.getState().setNiveau(NIVEAUX[i].valeur);
    signaler(rangee.id, NIVEAUX[i].libelle);
  };
  const clavier = useClavierRadio(NIVEAUX.length, rang, choisir);
  return (
    <Rangee
      rangee={rangee}
      large={
        <div role="radiogroup" aria-label="Autonomie du superviseur" className="par-niveaux" onKeyDown={clavier.surClavier}>
          <span aria-hidden="true" className="par-niveaux-indic" style={{ transform: `translateY(${rang * PAS_NIVEAU}px)` }} />
          {NIVEAUX.map((n, i) => {
            const on = i === rang;
            return (
              <button
                key={n.valeur}
                ref={clavier.ref(i)}
                type="button"
                role="radio"
                className="par-niveau"
                aria-checked={on}
                tabIndex={on ? 0 : -1}
                onClick={() => choisir(i)}
              >
                <span aria-hidden="true" className="par-niveau-barres">
                  {[0, 1, 2].map((k) => (
                    <span key={k} style={{ height: 5 + k * 3.5, opacity: k <= i ? 1 : 0.28 }} />
                  ))}
                </span>
                <span className="par-niveau-texte">
                  <span className="par-niveau-libelle">{n.libelle}</span>
                  <span className="par-niveau-phrase">{n.phrase}</span>
                </span>
                <span aria-hidden="true" className="par-niveau-radio">
                  <span />
                </span>
              </button>
            );
          })}
        </div>
      }
    />
  );
}

/** Avatar d'un membre de paire : l'espace ouvert sur ce dossier, sinon son nom ; le
    superviseur en carré à l'accent (sa marque du dock). */
function AvatarMembre({ nom, wsId, superviseur }: { nom: string; wsId: string | null; superviseur: boolean }) {
  const couleur = useWorkspaceStore((s) => {
    const w = wsId ? s.workspaces.find((x) => x.id === wsId) : undefined;
    return w ? couleurEspace(w) : null;
  });
  if (superviseur) {
    return <span className="par-paire-sup">{monogramme(nom)}</span>;
  }
  // Dossier sans espace ouvert : gris neutre des maquettes.
  const teinte = couleur ?? "#b6c2d4";
  // Fond à 24 (et non 18 comme au repos dans le dock) : celui de la maquette des paires.
  return <Avatar monogramme={monogramme(nom)} couleur={teinte} taille={26} sautille={false} style={{ background: `${teinte}24` }} />;
}

export function PairesAutorisees({ rangee }: { rangee: RangeeParametre }) {
  const paires = useReglagesStore((s) => s.reglages.superviseur.paires);
  const nomSup = useReglagesStore((s) => s.reglages.superviseur.nom);
  // Noms et dossiers des espaces ouverts, en chaîne : pas de re-rendu à chaque sonde.
  const cle = useWorkspaceStore((s) => s.workspaces.map((w) => `${w.id}\u0001${w.cwd}\u0001${w.name}`).join("\u0000"));
  const espaces = cle
    ? cle.split("\u0000").map((l) => {
        const [id, cwd, name] = l.split("\u0001");
        return { id, cwd, name };
      })
    : [];
  const { signaler } = useParametres();
  return (
    <Rangee
      rangee={rangee}
      large={
        <div className="par-paires">
          {paires.map((p) => {
            const a = membrePaire(p.a, espaces, nomSup);
            const b = membrePaire(p.b, espaces, nomSup);
            return (
              <div key={`${p.a}\u0000${p.b}`} className="par-paire">
                <span aria-hidden="true" className="par-paire-avatars">
                  <AvatarMembre {...a} />
                  <svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="var(--texte-discret)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M3 6h10l-2.5-2.5M13 10H3l2.5 2.5" />
                  </svg>
                  <AvatarMembre {...b} />
                </span>
                <span className="par-paire-texte">
                  <span className="par-paire-noms" title={`${p.a} ↔ ${p.b}`}>
                    {a.nom} ↔ {b.nom}
                  </span>
                  <span className="par-paire-depuis">{sousTitrePaire(p)}</span>
                </span>
                <button
                  type="button"
                  className="par-revoquer"
                  aria-label={`Révoquer la paire ${a.nom} et ${b.nom}`}
                  onClick={() => {
                    useReglagesStore.getState().revoquerPaire(p.a, p.b);
                    signaler(rangee.id, "Paire révoquée");
                  }}
                >
                  Révoquer
                </button>
              </div>
            );
          })}
          {paires.length === 0 && (
            <div className="par-paires-vide">
              Aucune paire autorisée. Une paire s’ajoute quand vous laissez deux espaces échanger, depuis le superviseur.
            </div>
          )}
        </div>
      }
    />
  );
}
