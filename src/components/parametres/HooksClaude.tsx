import { useEffect, useState } from "react";
import { reglagesApi, type EtatHooks } from "../../lib/reglagesApi";
import { useReglagesStore } from "../../store/reglages";
import { useWorkspaceStore } from "../../store/workspace";
import { couleurEspace } from "../../lib/couleurEspace";
import { monogramme } from "../../lib/monogram";
import { cheminAbrege, type RangeeParametre } from "../../lib/parametresModele";
import { Avatar } from "../ui/Avatar";
import { Rangee, useParametres } from "./contexte";
import { useHome } from "../../hooks/useHome";

/**
 * Hooks Claude Code (Paramètres › Agents et notifications) : état réel lu par
 * `hooks_etat` (script présent et à jour, six événements déclarés dans
 * ~/.claude/settings.json), installation par `hooks_installer` — la même opération que
 * `terminials hooks setup`. Trois cartes montrent ce que les hooks allument, avec les
 * avatars de vos propres espaces.
 */

type Statut = "lecture" | "absents" | "perimes" | "installes" | "installation";

function statutDe(etat: EtatHooks | null, occupe: boolean, lu: boolean): Statut {
  if (occupe) return "installation";
  if (!lu) return "lecture";
  if (etat?.installes && etat.scriptAJour) return "installes";
  if (etat?.installes) return "perimes";
  return "absents";
}

const TEXTES: Record<Statut, string> = {
  lecture: "Vérification…",
  absents: "À installer",
  perimes: "À mettre à jour",
  installes: "Installés",
  installation: "Installation…",
};

/** Avatars des cartes : vos trois premiers espaces (le même s'il n'y en a qu'un). */
function useAvatarsExemple(): { mono: string; couleur: string }[] {
  const cle = useWorkspaceStore((s) =>
    s.workspaces
      .slice(0, 3)
      .map((w) => `${monogramme(w.name)}\u0001${couleurEspace(w)}`)
      .join("\u0000"),
  );
  const accent = useReglagesStore((s) => s.reglages.apparence.accent);
  const liste = cle ? cle.split("\u0000").map((x) => x.split("\u0001")) : [];
  return [0, 1, 2].map((i) => {
    const e = liste.length ? liste[i % liste.length] : null;
    return e ? { mono: e[0], couleur: e[1] } : { mono: "cl", couleur: accent };
  });
}

export function HooksClaude({ rangee }: { rangee: RangeeParametre }) {
  const [etat, setEtat] = useState<EtatHooks | null>(null);
  const [lu, setLu] = useState(false);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState<string | null>(null);
  const { signaler } = useParametres();
  const home = useHome();
  const avatars = useAvatarsExemple();

  useEffect(() => {
    let vivant = true;
    reglagesApi
      .hooksEtat()
      .then((e) => {
        if (vivant) setEtat(e);
      })
      .catch((e: unknown) => {
        if (vivant) setErreur(String(e));
      })
      .finally(() => {
        if (vivant) setLu(true);
      });
    return () => {
      vivant = false;
    };
  }, []);

  const installer = () => {
    if (occupe) return;
    setOccupe(true);
    setErreur(null);
    reglagesApi
      .hooksInstaller()
      .then((e) => {
        setEtat(e);
        signaler(rangee.id, "Installés");
      })
      .catch((e: unknown) => setErreur(`installation impossible : ${String(e)}`))
      .finally(() => setOccupe(false));
  };

  const statut = statutDe(etat, occupe, lu);
  const installes = statut === "installes";
  const sous = erreur
    ? erreur
    : installes && etat
      ? cheminAbrege(etat.cheminScript, home)
      : "Sans eux, l’app ne voit pas quand un agent travaille ou vous attend.";

  const cartes = [
    { titre: "Arc «\u00a0au travail\u00a0»", texte: "Prompt envoyé, outil en cours.", etat: "travail" as const, reprise: false },
    { titre: "Pastille «\u00a0vous attend\u00a0»", texte: "Fin de tour ou autorisation demandée.", etat: "attente" as const, reprise: false },
    { titre: "Reprise des sessions", texte: "Chaque onglet retrouve sa conversation.", etat: "repos" as const, reprise: true },
  ];

  return (
    <Rangee
      rangee={rangee}
      large={
        <div className="par-hooks">
          <div className="par-hooks-tete">
            <span className="par-hooks-statut" data-statut={statut}>
              {occupe || statut === "lecture" ? <span className="par-spin" aria-hidden="true" /> : <span className="par-hooks-point" aria-hidden="true" />}
              {TEXTES[statut]}
            </span>
            <span className="par-hooks-sous" data-mono={(installes && !erreur) || undefined} data-erreur={erreur ? "" : undefined}>
              {sous}
            </span>
            {statut === "absents" || statut === "perimes" ? (
              <button type="button" className="par-prim" onClick={installer}>
                <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M8 2.5v7.5M4.8 7l3.2 3.2L11.2 7M3 13.5h10" />
                </svg>
                {statut === "perimes" ? "Mettre à jour les hooks" : "Installer les hooks"}
              </button>
            ) : installes ? (
              <button type="button" className="hov par-annuler" onClick={installer}>
                Réinstaller
              </button>
            ) : null}
          </div>
          <div className="par-hooks-cartes">
            {cartes.map((c, i) => (
              <div key={c.titre} className="par-hooks-carte" data-eteinte={!installes || undefined}>
                <span className="par-hooks-avatar" aria-hidden="true">
                  <Avatar
                    monogramme={avatars[i].mono}
                    couleur={avatars[i].couleur}
                    etat={installes ? c.etat : "repos"}
                    taille={30}
                    sautille={false}
                  />
                  {installes && c.reprise && (
                    <span className="par-hooks-reprise">
                      <svg width="9" height="9" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M13 8a5 5 0 1 1-1.6-3.7" />
                        <path d="M13 2.5v3h-3" />
                      </svg>
                    </span>
                  )}
                </span>
                <span className="par-hooks-carte-texte">
                  <span className="par-hooks-carte-titre">{c.titre}</span>
                  <span className="par-hooks-carte-detail">{c.texte}</span>
                </span>
              </div>
            ))}
          </div>
          <div className="par-hooks-cli">
            En ligne de commande : <span>terminials hooks setup</span>
          </div>
        </div>
      }
    />
  );
}
