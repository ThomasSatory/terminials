import { useEffect, useState, type ComponentType } from "react";
import type { ActivitySettings, ClickupSource } from "../../lib/activityApi";
import { heuresEnMinutes, listToText, textToList } from "../../lib/reglagesTexte";
import { descCollecte, heureEnTexte, minutesEnHeures, texteEnHeure, type RangeeParametre } from "../../lib/parametresModele";
import { useWorkspaceStore } from "../../store/workspace";
import { Rangee, useParametres } from "./contexte";
import { BoutonAction, ChampNombre, ChampTexte, Interrupteur, Segments, ZoneTexte } from "./controles";
import { useActivite } from "./useReglagesActivite";

/**
 * Rangées de la section Activité : les réglages du récap (`ActivitySettings`), déplacés
 * ici depuis le volet du récap. Ils ne s'affichent qu'une fois lus (le modèle n'en
 * propose aucun avant) ; chaque changement passe par `useReglagesActivite().modifier`.
 */

type P = { rangee: RangeeParametre };

/** Réglages d'activité lus + leur modificateur qui confirme sur la rangée. */
function useActiviteRangee(id: string) {
  const act = useActivite();
  const { signaler } = useParametres();
  const modifier = (f: (s: ActivitySettings) => ActivitySettings, texte?: string) => {
    act?.modifier(f);
    signaler(id, texte);
  };
  return { s: act?.reglages ?? null, modifier };
}

function Heure({ rangee }: P) {
  const { s, modifier } = useActiviteRangee(rangee.id);
  if (!s) return null;
  return (
    <Rangee
      rangee={rangee}
      controle={
        // Horloge dessinée par nous, à droite dans le champ (maquette Parametres/06) :
        // WebKitGTK ne dessine pas l'indicateur natif d'un champ d'heure.
        <span className="par-heure-enveloppe">
          <input
            className="par-champ par-heure"
            data-mono=""
            type="time"
            aria-label={rangee.libelle}
            value={heureEnTexte(s.schedule.hour, s.schedule.minute)}
            onChange={(e) => {
              const h = texteEnHeure(e.target.value);
              if (h) modifier((x) => ({ ...x, schedule: { ...x.schedule, ...h } }));
            }}
          />
          <svg className="par-heure-horloge" aria-hidden="true" width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.1" strokeLinecap="round">
            <circle cx="6" cy="6" r="5.2" />
            <path d="M6 3.2V6l1.9 1.6" />
          </svg>
        </span>
      }
    />
  );
}

function JoursOuvres({ rangee }: P) {
  const { s, modifier } = useActiviteRangee(rangee.id);
  if (!s) return null;
  return (
    <Rangee
      rangee={rangee}
      controle={
        <Interrupteur
          actif={s.schedule.weekdaysOnly}
          libelle={rangee.libelle}
          onChange={(v) => modifier((x) => ({ ...x, schedule: { ...x.schedule, weekdaysOnly: v } }))}
        />
      }
    />
  );
}

const SOURCES: { valeur: ClickupSource; libelle: string }[] = [
  { valeur: "claude_mcp", libelle: "Via Claude Code" },
  { valeur: "api", libelle: "Clé personnelle" },
  { valeur: "off", libelle: "Désactivée" },
];

function Taches({ rangee }: P) {
  const { s, modifier } = useActiviteRangee(rangee.id);
  if (!s) return null;
  return (
    <Rangee
      rangee={rangee}
      controle={
        <Segments
          libelle={rangee.libelle}
          options={SOURCES}
          valeur={s.clickup.source}
          onChange={(v) => modifier((x) => ({ ...x, clickup: { ...x.clickup, source: v } }))}
        />
      }
    />
  );
}

function Listes({ rangee }: P) {
  const { s, modifier } = useActiviteRangee(rangee.id);
  if (!s) return null;
  return (
    <Rangee
      rangee={rangee}
      large={
        <ZoneTexte
          libelle={rangee.libelle}
          placeholder="Une adresse ou un identifiant de liste par ligne"
          valeur={listToText(s.clickup.listes ?? [], "\n")}
          onChange={(t) => modifier((x) => ({ ...x, clickup: { ...x.clickup, listes: textToList(t, /\n/) } }))}
        />
      }
    />
  );
}

function Cle({ rangee }: P) {
  const { s, modifier } = useActiviteRangee(rangee.id);
  if (!s) return null;
  return (
    <Rangee
      rangee={rangee}
      controle={
        <ChampTexte
          libelle={rangee.libelle}
          type="password"
          largeur={240}
          placeholder="Clé du gestionnaire de tâches"
          valeur={s.clickup.token}
          onChange={(t) => modifier((x) => ({ ...x, clickup: { ...x.clickup, token: t.trim() } }))}
        />
      }
    />
  );
}

function Reunions({ rangee }: P) {
  const { s, modifier } = useActiviteRangee(rangee.id);
  if (!s) return null;
  return (
    <Rangee
      rangee={rangee}
      controle={
        <Interrupteur
          actif={s.saisie.reunionsAgenda ?? true}
          libelle={rangee.libelle}
          onChange={(v) => modifier((x) => ({ ...x, saisie: { ...x.saisie, reunionsAgenda: v } }))}
        />
      }
    />
  );
}

function CommandesShell({ rangee }: P) {
  const { s, modifier } = useActiviteRangee(rangee.id);
  if (!s) return null;
  return (
    <Rangee
      rangee={rangee}
      controle={
        <Interrupteur
          actif={s.shell.integration}
          libelle={rangee.libelle}
          onChange={(v) => modifier((x) => ({ ...x, shell: { ...x.shell, integration: v } }))}
        />
      }
    />
  );
}

function CommandesIgnorees({ rangee }: P) {
  const { s, modifier } = useActiviteRangee(rangee.id);
  if (!s) return null;
  return (
    <Rangee
      rangee={rangee}
      controle={
        <ChampTexte
          libelle={rangee.libelle}
          largeur={260}
          valeur={listToText(s.shell.ignoredCommands, ", ")}
          onChange={(t) => modifier((x) => ({ ...x, shell: { ...x.shell, ignoredCommands: textToList(t, /,/) } }))}
        />
      }
    />
  );
}

function AdresseCommits({ rangee }: P) {
  const { s, modifier } = useActiviteRangee(rangee.id);
  if (!s) return null;
  return (
    <Rangee
      rangee={rangee}
      controle={
        <ChampTexte
          libelle={rangee.libelle}
          largeur={240}
          placeholder="git config user.email"
          valeur={s.git.authorEmail ?? ""}
          onChange={(t) => modifier((x) => ({ ...x, git: { authorEmail: t.trim() || null } }))}
        />
      }
    />
  );
}

function Motifs({ rangee }: P) {
  const { s, modifier } = useActiviteRangee(rangee.id);
  if (!s) return null;
  return (
    <Rangee
      rangee={rangee}
      large={
        <ZoneTexte
          libelle={rangee.libelle}
          placeholder="ABC-\d+"
          valeur={listToText(s.ticketPatterns, "\n")}
          onChange={(t) => modifier((x) => ({ ...x, ticketPatterns: textToList(t, /\n/) }))}
        />
      }
    />
  );
}

function Objectif({ rangee }: P) {
  const { s, modifier } = useActiviteRangee(rangee.id);
  if (!s) return null;
  return (
    <Rangee
      rangee={rangee}
      controle={
        <>
          <label className="par-heures">
            Lun. à jeu.
            <ChampNombre
              libelle="Heures à saisir du lundi au jeudi"
              valeur={minutesEnHeures(s.saisie.journeeMinutes)}
              onChange={(t) => modifier((x) => ({ ...x, saisie: { ...x.saisie, journeeMinutes: heuresEnMinutes(t) } }))}
            />
            h
          </label>
          <label className="par-heures">
            Ven.
            <ChampNombre
              libelle="Heures à saisir le vendredi"
              valeur={minutesEnHeures(s.saisie.vendrediMinutes)}
              onChange={(t) => modifier((x) => ({ ...x, saisie: { ...x.saisie, vendrediMinutes: heuresEnMinutes(t) } }))}
            />
            h
          </label>
        </>
      }
    />
  );
}

function TacheReunions({ rangee }: P) {
  const { s, modifier } = useActiviteRangee(rangee.id);
  if (!s) return null;
  return (
    <Rangee
      rangee={rangee}
      controle={
        <ChampTexte
          libelle={rangee.libelle}
          largeur={140}
          placeholder="T-100"
          valeur={s.saisie.usReunion}
          onChange={(t) => modifier((x) => ({ ...x, saisie: { ...x.saisie, usReunion: t.trim() } }))}
        />
      }
    />
  );
}

/** Horloge à la minute : l'âge de la dernière collecte se met à jour seul. */
function useMaintenant(periodeMs = 30_000): number {
  const [t, setT] = useState(() => Date.now());
  useEffect(() => {
    const h = window.setInterval(() => setT(Date.now()), periodeMs);
    return () => window.clearInterval(h);
  }, [periodeMs]);
  return t;
}

function Collecte({ rangee }: P) {
  const act = useActivite();
  const { signaler } = useParametres();
  const maintenant = useMaintenant();
  if (!act) return null;
  const relever = () => {
    if (act.collecteEnCours) return;
    void act.collecter().then((erreurs) => {
      if (erreurs.length) useWorkspaceStore.getState().showToast(`collecte : ${erreurs[0]}`);
      signaler(rangee.id, erreurs.length ? "Relevé, avec des erreurs" : "Relevé");
    });
  };
  return (
    <Rangee
      rangee={rangee}
      desc={descCollecte(act.derniereCollecte, Math.floor(maintenant / 1000), act.collecteEnCours)}
      controle={
        <BoutonAction icone="M13 8a5 5 0 1 1-1.6-3.7M13 2.5v3h-3" enCours={act.collecteEnCours} onClick={relever}>
          {act.collecteEnCours ? "Collecte…" : "Relever"}
        </BoutonAction>
      }
    />
  );
}

export const RANGEES_ACTIVITE: Record<string, ComponentType<P>> = {
  heure: Heure,
  joursOuvres: JoursOuvres,
  taches: Taches,
  listes: Listes,
  cle: Cle,
  reunions: Reunions,
  commandesShell: CommandesShell,
  commandesIgnorees: CommandesIgnorees,
  adresseCommits: AdresseCommits,
  motifs: Motifs,
  objectif: Objectif,
  tacheReunions: TacheReunions,
  collecte: Collecte,
};
