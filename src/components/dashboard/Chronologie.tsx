import type { CSSProperties, Ref } from "react";
import type { WeekDayRow } from "../../lib/weekDays";
import { heure, type GenreChrono, type HeureChrono } from "../../lib/recapModele";

const DISCRET = "var(--texte-discret)";

/** Glyphe d'une ligne, teinté de la couleur de son espace. */
function Glyphe({ genre, couleur }: { genre: GenreChrono; couleur: string }) {
  return (
    <span aria-hidden="true" className="rc-glyphe" data-genre={genre} style={{ "--rc-teinte": couleur } as CSSProperties}>
      {genre === "shell" ? ">" : <span />}
    </span>
  );
}

/**
 * Onglet « Chronologie » : la journée heure par heure, commits, prompts à l'agent,
 * commandes, changements de ticket et réunions, chacun à sa minute et à la couleur
 * de son espace. Un champ filtre les lignes (touche `/`). En mode semaine, le jour
 * par jour : une ligne par journée, qui l'ouvre au clic.
 */
export function Chronologie({
  heures,
  couleur,
  filtre,
  onFiltre,
  champ,
  semaine,
  onJour,
}: {
  heures: HeureChrono[];
  couleur: (dir: string) => string;
  filtre: string;
  onFiltre: (t: string) => void;
  champ: Ref<HTMLInputElement>;
  /** Mode semaine : les lignes du jour par jour, sinon null. */
  semaine: WeekDayRow[] | null;
  onJour: (day: string) => void;
}) {
  const avecTickets = heures.some((h) => h.items.some((i) => i.genre === "ticket"));
  return (
    <section aria-label="Chronologie" className="rc-panneau rc-chrono">
      <div className="rc-chrono-tete">
        <h2 className="rc-intertitre">{semaine ? "Jour par jour" : "Chronologie"}</h2>
        {semaine ? (
          <span className="rc-sous">cliquer pour ouvrir la journée</span>
        ) : (
          <>
            <span className="rc-chrono-legende">
              <span><Glyphe genre="commit" couleur="var(--texte)" />commit</span>
              <span><Glyphe genre="prompt" couleur="var(--texte)" />prompt à l’agent</span>
              <span><Glyphe genre="shell" couleur="var(--texte)" />terminal</span>
              <span><Glyphe genre="reunion" couleur={DISCRET} />réunion</span>
              {avecTickets && <span><Glyphe genre="ticket" couleur="var(--texte)" />ticket</span>}
            </span>
            <input
              ref={champ}
              type="search"
              className="rc-filtre"
              placeholder="Filtrer"
              aria-label="Filtrer la chronologie ( / )"
              value={filtre}
              onChange={(e) => onFiltre(e.target.value)}
            />
          </>
        )}
      </div>

      {semaine ? (
        <div className="rc-semaine">
          {semaine.map((j) => (
            <button
              key={j.day}
              type="button"
              className="rc-semaine-jour hov"
              disabled={j.future}
              onClick={() => onJour(j.day)}
            >
              <span className="rc-chrono-heure">{j.label}</span>
              {j.future ? (
                <span className="rc-discret">à venir</span>
              ) : (
                <span className="rc-semaine-corps">
                  <span className="rc-semaine-fait">{j.fait || "Aucune activité"}</span>
                  {j.compteurs && <span className="rc-sous">{j.compteurs}</span>}
                  {j.segments.length > 0 && (
                    <span aria-hidden="true" className="rc-jour-barre">
                      {j.segments.map((s) => (
                        <span key={s.dir ?? "sans-espace"} style={{ flex: s.events, background: s.color }} />
                      ))}
                    </span>
                  )}
                </span>
              )}
            </button>
          ))}
        </div>
      ) : heures.length === 0 ? (
        <p className="rc-vide">{filtre.trim() ? "Aucune ligne pour ce filtre." : "Aucune activité ce jour."}</p>
      ) : (
        heures.map((h) => (
          <div key={h.heure} className="rc-chrono-groupe">
            <span className="rc-chrono-heure">{h.heure}</span>
            <div className="rc-chrono-items">
              {h.items.map((it, i) => {
                const teinte = it.dir ? couleur(it.dir) : DISCRET;
                return (
                  <div key={`${it.ts}-${i}`} className="rc-chrono-item rc-ln" data-genre={it.genre}>
                    <span className="rc-chrono-minute">{heure(it.ts)}</span>
                    <Glyphe genre={it.genre} couleur={it.genre === "reunion" ? DISCRET : teinte} />
                    <span className="rc-chrono-texte" title={it.texte}>
                      {it.texte}
                      {it.fois > 1 && <span className="rc-discret"> ×{it.fois}</span>}
                    </span>
                    {it.nom && (
                      <span className="rc-chrono-espace" style={{ color: teinte }}>
                        {it.nom}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))
      )}
    </section>
  );
}
