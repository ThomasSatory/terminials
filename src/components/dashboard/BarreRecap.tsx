import { useRef, type KeyboardEvent } from "react";
import type { OngletRecap } from "../../store/dashboard";
import { IconeReglages } from "./icones";

const ONGLETS: Array<[OngletRecap, string]> = [
  ["recap", "Récap"],
  ["chrono", "Chronologie"],
];

/**
 * Rangée haute du récap (46 px) : pastille accent, « Activité », semaine et
 * raccourci, onglets Récap / Chronologie (soulignés à l'accent), puis le mode
 * jour / semaine et les réglages, que la maquette ne dessine pas, et « Fermer ».
 * Les onglets se parcourent aussi aux flèches, comme un vrai `tablist`.
 */
export function BarreRecap({
  semaine,
  onglet,
  onOnglet,
  mode,
  onMode,
  onReglages,
  alerte,
  collecte,
  erreurs,
  onFermer,
}: {
  semaine: number;
  onglet: OngletRecap;
  onOnglet: (o: OngletRecap) => void;
  mode: "day" | "week";
  onMode: (m: "day" | "week") => void;
  /** Ouvre Paramètres › Activité (seul écran des réglages d'activité). */
  onReglages: () => void;
  /** La dernière collecte a remonté des erreurs : la roue le signale. */
  alerte: boolean;
  /** Ancienneté de la dernière collecte, et ses erreurs : infobulle de la roue. */
  collecte: string;
  erreurs: readonly string[];
  onFermer: () => void;
}) {
  const liste = useRef<HTMLDivElement>(null);

  const auClavier = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== "ArrowLeft" && e.key !== "ArrowRight") return;
    e.preventDefault();
    const i = ONGLETS.findIndex(([o]) => o === onglet);
    const suivant = ONGLETS[(i + (e.key === "ArrowRight" ? 1 : ONGLETS.length - 1)) % ONGLETS.length][0];
    onOnglet(suivant);
    liste.current?.querySelector<HTMLButtonElement>(`[data-onglet="${suivant}"]`)?.focus();
  };

  return (
    <header className="rc-barre">
      <div className="rc-barre-titre">
        <span aria-hidden="true" className="rc-barre-pastille" />
        <span className="rc-barre-nom">Activité</span>
        <span className="rc-barre-sous">semaine {semaine} · Ctrl+Maj+H</span>
      </div>
      <div ref={liste} role="tablist" aria-label="Vues du récap" className="rc-onglets" onKeyDown={auClavier}>
        {ONGLETS.map(([o, libelle]) => (
          <button
            key={o}
            type="button"
            role="tab"
            id={`rc-onglet-${o}`}
            aria-controls="rc-panneau"
            aria-selected={onglet === o}
            tabIndex={onglet === o ? 0 : -1}
            data-onglet={o}
            className="rc-onglet"
            onClick={() => onOnglet(o)}
          >
            <span>{libelle}</span>
            <span aria-hidden="true" className="rc-onglet-trait" />
          </button>
        ))}
      </div>
      <div role="group" aria-label="Période" className="rc-mode">
        <button type="button" className="rc-mode-btn hov" aria-pressed={mode === "day"} onClick={() => onMode("day")}>
          Jour
        </button>
        <button type="button" className="rc-mode-btn hov" aria-pressed={mode === "week"} onClick={() => onMode("week")}>
          Semaine
        </button>
      </div>
      <button
        type="button"
        className="rc-reglages-btn hov"
        aria-label="Réglages de l’activité (Paramètres)"
        aria-describedby="rc-reglages-tip"
        data-alerte={alerte}
        onClick={onReglages}
      >
        <IconeReglages />
        {/* Infobulle maison (#1b1c21, rayon 10) plutôt que celle, native, du système. */}
        <span id="rc-reglages-tip" role="tooltip" className="ui-tip rc-reglages-tip">
          <span className="ui-tip-titre">Réglages de l’activité</span>
          {collecte && <span className="ui-tip-detail">{collecte}</span>}
          {erreurs.map((e, i) => (
            <span key={i} className="ui-tip-detail rc-reglages-tip-erreur">
              {e}
            </span>
          ))}
        </span>
      </button>
      <button type="button" className="rc-fermer hov" title="Revenir au terminal (Échap)" onClick={onFermer}>
        Fermer
        <kbd className="rc-fermer-kbd">Échap</kbd>
      </button>
    </header>
  );
}
