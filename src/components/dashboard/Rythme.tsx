import { useLayoutEffect, useRef, useState } from "react";
import type { Reunion } from "../../lib/activityApi";
import { monogramme } from "../../lib/monogram";
import { IconeActivite, IconeCalendrier, IconeFermer } from "../ui/icons";
import { Ticket } from "./Ticket";
import {
  ariaColonne,
  duree,
  grouperCommits,
  heure,
  pct,
  plageCreneau,
  sousTitreCreneau,
  type Colonne,
  type CommitPose,
  type GroupeCommits,
  type Repere,
} from "../../lib/recapModele";

/** Hauteur utile d'une pile (px) : la colonne la plus chargée de la plage l'atteint. */
const HAUTEUR_PILE = 128;
/** Commits listés dans l'infobulle d'un cercle qui en regroupe plusieurs (les plus récents). */
const COMMITS_PAR_BULLE = 4;
/** Largeurs des infobulles (px), pour les recaler au bord de la frise. */
const BULLE_COLONNE = 248;

export interface EntreeLegende {
  dir: string;
  name: string;
  couleur: string;
  minutes: number;
}

/**
 * « Rythme de la journée » : la frise au quart d'heure (à l'heure en mode semaine),
 * empilée par espace, les commits en anneaux au-dessus, les réunions en blocs gris
 * dessous et le trait « maintenant ». Survoler une colonne en donne le détail, la
 * cliquer l'épingle sous la frise. La légende met un espace en avant.
 */
export function Rythme({
  colonnes,
  reperes,
  commits,
  reunions,
  legende,
  position,
  maintenant,
  afficherMaintenant,
  focus,
  onFocus,
  epingle,
  onEpingle,
  noms,
  onOpen,
  semaine,
}: {
  colonnes: Colonne[];
  reperes: Repere[];
  commits: CommitPose[];
  reunions: Reunion[];
  legende: EntreeLegende[];
  /** Position relative (0..1) d'un instant dans la frise. */
  position: (ts: number) => number;
  maintenant: number;
  afficherMaintenant: boolean;
  focus: string | null;
  onFocus: (dir: string | null) => void;
  epingle: number | null;
  onEpingle: (i: number | null) => void;
  noms: Map<string, string>;
  onOpen: (url: string) => void;
  semaine: boolean;
}) {
  const n = colonnes.length;
  const creneau = epingle !== null ? colonnes[epingle] ?? null : null;
  const vide = colonnes.every((c) => c.segments.length === 0);

  // Largeur de la frise et de l'étiquette « maintenant », mesurées : l'étiquette se pose à
  // droite du trait (maquette) quand elle y tient, sinon à gauche ET au-dessus de la rangée
  // des commits, qu'aucun cercle ne la recouvre (soirée) ; le mode semaine regroupe les
  // commits trop proches pour être distingués.
  const friseRef = useRef<HTMLDivElement>(null);
  const etiquetteRef = useRef<HTMLSpanElement>(null);
  const [mesures, setMesures] = useState({ frise: 0, etiquette: 0 });
  const fMaintenant = position(maintenant);
  useLayoutEffect(() => {
    const frise = friseRef.current;
    if (!frise) return;
    const mesurer = () => {
      const m = { frise: frise.clientWidth, etiquette: etiquetteRef.current?.offsetWidth ?? 0 };
      setMesures((x) => (x.frise === m.frise && x.etiquette === m.etiquette ? x : m));
    };
    mesurer();
    const ro = new ResizeObserver(mesurer);
    ro.observe(frise);
    return () => ro.disconnect();
  }, [afficherMaintenant, maintenant]);
  // Marge à droite de l'étiquette : 6 px du trait, 4 px avant le bord de la carte.
  const etiquetteADroite = mesures.frise === 0 || (1 - fMaintenant) * mesures.frise >= mesures.etiquette + 10;
  const groupes: GroupeCommits[] = semaine
    ? grouperCommits(commits, position, mesures.frise, afficherMaintenant ? maintenant : null)
    : commits.map((c) => ({ x: position(c.ts), commits: [c] }));

  return (
    <section aria-label="Rythme de la journée" className="rc-panneau rc-rythme">
      <div className="rc-rythme-tete">
        <div className="rc-titre-ligne">
          <h2 className="rc-intertitre">{semaine ? "Rythme de la semaine" : "Rythme de la journée"}</h2>
          <span className="rc-sous">
            {semaine ? "par heure, empilé par espace" : "par quart d’heure, empilé par espace"}
          </span>
        </div>
        <div className="rc-legende">
          {legende.map((l) => {
            const actif = focus === l.dir;
            return (
              <button
                key={l.dir}
                type="button"
                className="rc-chip"
                aria-pressed={actif}
                title={`Ne montrer que ${l.name}`}
                data-attenue={focus !== null && !actif}
                style={
                  actif
                    ? { background: `${l.couleur}1c`, boxShadow: `inset 0 0 0 1px ${l.couleur}80` }
                    : undefined
                }
                onClick={() => onFocus(actif ? null : l.dir)}
              >
                <span aria-hidden="true" className="rc-chip-carre" style={{ background: l.couleur }} />
                <span className="rc-chip-nom">{l.name}</span>
                <span className="rc-chip-duree">{duree(l.minutes)}</span>
              </button>
            );
          })}
          {focus !== null && (
            <button type="button" className="rc-tout hov" onClick={() => onFocus(null)}>
              Tout afficher
            </button>
          )}
        </div>
      </div>

      <div className="rc-commits">
        {groupes.map((g, i) => {
          const f = g.x;
          // Cercle d'un groupe : la couleur du commit le plus récent, ou de celui de
          // l'espace mis en avant.
          const c = (focus !== null ? [...g.commits].reverse().find((x) => x.dir === focus) : undefined) ?? g.commits[g.commits.length - 1];
          return (
            <span
              key={`${g.commits[0].ts}-${i}`}
              className="rc-commit"
              // Commits du même instant dans plusieurs espaces : le point de l'espace
              // focalisé passe devant les anneaux atténués des autres.
              style={{ left: pct(f), animationDelay: `${420 + i * 60}ms`, zIndex: focus !== null && focus === c.dir ? 3 : undefined }}
              data-cote={f < 0.12 ? "debut" : f > 0.86 ? "fin" : "centre"}
            >
              <span
                className="rc-commit-anneau"
                style={{ borderColor: c.couleur, opacity: focus && focus !== c.dir ? 0.25 : 1 }}
              />
              <span className="rc-bulle rc-commit-bulle">
                {g.commits.length === 1 ? (
                  <LigneCommit commit={c} />
                ) : (
                  <>
                    <span className="rc-bulle-mono rc-discret">{g.commits.length} commits</span>
                    {g.commits.slice(-COMMITS_PAR_BULLE).map((x, k) => (
                      <span key={`${x.ts}-${k}`} className="rc-bulle-ligne">
                        <LigneCommit commit={x} />
                      </span>
                    ))}
                    {g.commits.length > COMMITS_PAR_BULLE && (
                      <span className="rc-bulle-mono rc-discret">
                        et {g.commits.length - COMMITS_PAR_BULLE} plus anciens
                      </span>
                    )}
                  </>
                )}
              </span>
            </span>
          );
        })}
      </div>

      <div ref={friseRef} className="rc-frise">
        {reperes.map((r) => (
          <span key={`g${r.left}`} aria-hidden="true" className="rc-frise-grille" style={{ left: pct(r.left) }} />
        ))}
        <div className="rc-colonnes" data-semaine={semaine}>
          {colonnes.map((c) => {
            const choisie = epingle === c.i;
            return (
              <button
                key={c.i}
                type="button"
                className="rc-col"
                aria-label={ariaColonne(c, semaine)}
                aria-pressed={choisie}
                data-choisie={choisie}
                onClick={() => onEpingle(choisie ? null : c.i)}
              >
                <span aria-hidden="true" className="rc-col-survol" />
                <span aria-hidden="true" className="rc-col-fond" />
                <span
                  aria-hidden="true"
                  className="rc-col-pile"
                  style={{ animationDelay: `${Math.min(c.i * 11, 900)}ms` }}
                >
                  {[...c.segments].reverse().map((s) => (
                    <span
                      key={s.dir}
                      className="rc-seg"
                      style={{
                        height: Math.max(3, Math.round(s.part * HAUTEUR_PILE)),
                        background: s.couleur,
                        opacity: focus && focus !== s.dir ? 0.16 : 1,
                      }}
                    />
                  ))}
                </span>
                <span aria-hidden="true" className="rc-col-base" data-future={c.future} />
                <span
                  aria-hidden="true"
                  className="rc-bulle rc-col-bulle"
                  data-cote={c.i < 5 ? "debut" : c.i > n - 6 ? "fin" : "centre"}
                  style={{ width: BULLE_COLONNE }}
                >
                  <span className="rc-bulle-mono rc-discret">{plageCreneau(c, semaine)}</span>
                  {c.segments.map((s) => (
                    <span key={s.dir} className="rc-bulle-ligne">
                      <span className="rc-bulle-tete">
                        <span className="rc-carre" style={{ background: s.couleur }} />
                        {s.name}
                        <span className="rc-bulle-heure">{s.minutes} min</span>
                      </span>
                      <span className="rc-bulle-quoi">
                        {s.us[0] ? (
                          <>
                            {`${s.us[0].name ?? s.detail} · `}
                            {/* Identifiant du ticket jamais coupé à son tiret. */}
                            <span className="rc-nowrap">{s.us[0].id}</span>
                          </>
                        ) : (
                          s.detail
                        )}
                      </span>
                    </span>
                  ))}
                  {c.reunions.length > 0 && (
                    <span className="rc-bulle-quoi">Réunion : {c.reunions.map((r) => r.titre).join(", ")}</span>
                  )}
                  {c.segments.length === 0 && c.reunions.length === 0 && (
                    <span className="rc-bulle-quoi rc-discret">{c.future ? "À venir" : "Aucune activité"}</span>
                  )}
                  {c.segments.length > 0 && (
                    <span className="rc-bulle-aide">
                      {choisie ? "Cliquer pour désépingler" : "Cliquer pour épingler le détail"}
                    </span>
                  )}
                </span>
              </button>
            );
          })}
        </div>
        {afficherMaintenant && (
          <span
            aria-hidden="true"
            className="rc-maintenant"
            // Sans la place à droite du trait (soirée), l'étiquette passe à gauche, dans
            // la carte, et monte au-dessus de la rangée des commits.
            data-cote={etiquetteADroite ? undefined : "fin"}
            style={{ left: pct(fMaintenant) }}
          >
            <span ref={etiquetteRef} className="rc-maintenant-label">
              maintenant · {heure(maintenant)}
            </span>
          </span>
        )}
      </div>

      <div className="rc-reunions-bande">
        {reunions.map((r) => {
          const minutes = (r.fin - r.debut) / 60;
          const large = semaine ? minutes >= 120 : minutes >= 30;
          return (
            <span
              key={r.id}
              className="rc-reunion-bloc"
              title={`${r.titre}, ${heure(r.debut)}–${heure(r.fin)}`}
              style={{ left: pct(position(r.debut)), width: pct(position(r.fin) - position(r.debut)) }}
            >
              {large ? r.titre : ""}
            </span>
          );
        })}
      </div>

      <div aria-hidden="true" className="rc-reperes">
        {reperes.map((r) => (
          <span key={`l${r.left}`} className="rc-repere" data-ancre={r.ancre} style={{ left: pct(r.left) }}>
            {r.label}
          </span>
        ))}
      </div>

      <div className="rc-creneau">
        {creneau === null ? (
          <p className="rc-creneau-aide">
            <IconeActivite taille={14} />
            {vide
              ? "Aucune activité mesurée sur cette période."
              : `Survolez la frise pour le détail ${semaine ? "d’une heure" : "d’un quart d’heure"}, cliquez pour l’épingler ici. Les cercles au-dessus sont les commits, les blocs gris les réunions.`}
          </p>
        ) : (
          <Creneau
            key={creneau.i}
            colonne={creneau}
            semaine={semaine}
            noms={noms}
            onOpen={onOpen}
            onFermer={() => onEpingle(null)}
          />
        )}
      </div>
    </section>
  );
}

/** Un commit dans l'infobulle d'un cercle : espace, heure, titre. */
function LigneCommit({ commit }: { commit: CommitPose }) {
  return (
    <>
      <span className="rc-bulle-tete">
        <span aria-hidden="true" className="rc-rond" style={{ background: commit.couleur }} />
        {commit.name}
        <span className="rc-bulle-heure">{heure(commit.ts)}</span>
      </span>
      <span className="rc-bulle-mono">{commit.titre}</span>
    </>
  );
}

/** Détail d'un créneau épinglé : chaque espace actif, la réunion, les commits. */
function Creneau({
  colonne,
  semaine,
  noms,
  onOpen,
  onFermer,
}: {
  colonne: Colonne;
  semaine: boolean;
  noms: Map<string, string>;
  onOpen: (url: string) => void;
  onFermer: () => void;
}) {
  const reunion = colonne.reunions[0];
  return (
    <div className="rc-creneau-detail">
      <div className="rc-creneau-tete">
        <span className="rc-creneau-plage">{plageCreneau(colonne, semaine)}</span>
        <span className="rc-sous">{sousTitreCreneau(colonne.segments.length)}</span>
        <button type="button" className="rc-desepingler hov" aria-label="Désépingler le créneau" onClick={onFermer}>
          <IconeFermer taille={12} />
        </button>
      </div>
      <div className="rc-creneau-lignes">
        {colonne.segments.map((s) => (
          <div key={s.dir} className="rc-creneau-ligne">
            <span aria-hidden="true" className="rc-mono" style={{ background: `${s.couleur}18`, color: s.couleur }}>
              {monogramme(s.name)}
            </span>
            <div className="rc-creneau-texte">
              <div className="rc-creneau-nom">
                <span className="rc-fort">{s.name}</span>
                <span className="rc-mono-petit">{s.minutes} min</span>
                {s.us.map((t) => (
                  <Ticket key={t.id} id={t.id} url={t.url} titre={t.name ?? noms.get(t.id)} onOpen={onOpen} />
                ))}
              </div>
              <span>{s.us[0]?.name ?? s.detail}</span>
              {s.prompt && <span className="rc-prompt">« {s.prompt} »</span>}
            </div>
          </div>
        ))}
        {reunion && (
          <div className="rc-creneau-ligne rc-creneau-reunion">
            <span aria-hidden="true" className="rc-mono-reunion">
              <IconeCalendrier taille={13} />
            </span>
            <div className="rc-creneau-texte">
              <span className="rc-fort">
                {reunion.titre}, {heure(reunion.debut)}–{heure(reunion.fin)}
              </span>
              <span className="rc-sous">l’activité mesurée pendant une réunion ne compte pour aucune tâche</span>
            </div>
          </div>
        )}
      </div>
      {colonne.commits.length > 0 && (
        <div className="rc-creneau-commits">
          {colonne.commits.map((c, i) => (
            <span key={`${c.ts}-${i}`} className="rc-creneau-commit">
              <span aria-hidden="true" className="rc-anneau" style={{ borderColor: c.couleur }} />
              <span className="rc-discret">{heure(c.ts)}</span>
              {c.titre}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
