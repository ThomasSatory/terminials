import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { useDashboardStore } from "../store/dashboard";
import { useWorkspaceStore } from "../store/workspace";
import { useUiStore } from "../store/ui";
import { focusTab } from "../lib/tabFocus";
import { dispatchShortcut } from "../lib/shortcutDispatch";
import { useActivityData, useSummary } from "../hooks/useActivityData";
import { useSaisieTemps } from "../hooks/useSaisieTemps";
import { activityApi, clickupActif, type ActivitySettings } from "../lib/activityApi";
import { collectedAgoLabel, dayRange, formatWeekLabel, shiftDay, todayString, weekRange } from "../lib/dashboardDay";
import { couleurAuto, couleurEspace } from "../lib/couleurEspace";
import { monogramme } from "../lib/monogram";
import { buildFrise } from "../lib/frise";
import { buildWeekDays } from "../lib/weekDays";
import { splitTitle } from "../lib/summaryTitle";
import { attacherPuces } from "../lib/friseBilan";
import { SAISIE_PAR_DEFAUT, cibleDuJour, tempsParUs } from "../lib/tempsSaisie";
import { IconeRafraichir } from "./ui/icons";
import { BarreRecap } from "./dashboard/BarreRecap";
import { SelecteurJours } from "./dashboard/SelecteurJours";
import { Chiffres, type Chiffre } from "./dashboard/Chiffres";
import { Rythme } from "./dashboard/Rythme";
import { BilanProjets, type EtatBilan, type SectionVue } from "./dashboard/BilanProjets";
import { TempsSaisie } from "./dashboard/TempsSaisie";
import { Reunions } from "./dashboard/Reunions";
import { OpenTasks } from "./dashboard/OpenTasks";
import { Chronologie } from "./dashboard/Chronologie";
import { useSemaine } from "./dashboard/useSemaine";
import {
  activite,
  chronologie,
  colonnesRythme,
  commitsFrise,
  compte,
  derniereBranche,
  duree,
  heure,
  jourLong,
  joursSelecteur,
  jourVoisin,
  libelleBilan as libelleBilanRedige,
  lignesSaisies,
  nomsTickets,
  numeroSemaine,
  phraseHoraire,
  position,
  pucesDe,
  reperes,
  texteDaily,
} from "../lib/recapModele";
import "../styles/recap.css";

/** Ouvre un lien externe (ticket, lien du bilan) par le plugin opener, jamais par
    la navigation du webview. */
function openLink(href: string): void {
  void openUrl(href);
}

/** Horloge à la minute : le trait « maintenant » et la cible du jour avancent seuls. */
function useMaintenant(): number {
  const [t, setT] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    const h = setInterval(() => setT(Math.floor(Date.now() / 1000)), 60_000);
    return () => clearInterval(h);
  }, []);
  return t;
}

/**
 * Couleur d'affichage d'un dossier d'espace, la même que dans le dock : la couleur
 * propre de l'espace ouvert sur ce dossier, sinon sa teinte automatique (stable par
 * dossier, donc aussi pour un espace fermé depuis). Le sélecteur rend une chaîne :
 * les sondes branche / dirty, qui recréent la liste d'espaces, ne re-rendent rien.
 */
function useCouleurDossier(): (dir: string) => string {
  const cle = useWorkspaceStore((s) => s.workspaces.map((w) => `${w.cwd}\t${w.color ?? ""}`).join("\n"));
  return useMemo(() => {
    const parDir = new Map<string, string>();
    for (const ligne of cle ? cle.split("\n") : []) {
      const [cwd, color] = ligne.split("\t");
      if (!parDir.has(cwd)) parDir.set(cwd, couleurEspace({ cwd, color: color || undefined }));
    }
    return (dir: string) => parDir.get(dir) ?? couleurAuto(dir);
  }, [cle]);
}

/**
 * Récap de la journée (Ctrl+Maj+H), d'après la maquette Recap : barre propre
 * (onglets Récap / Chronologie), en-tête avec le titre du bilan et le sélecteur de
 * jours, bandeau de chiffres, rythme au quart d'heure empilé par espace, bilan par
 * projet, temps à saisir, réunions et tâches ouvertes. Le mode semaine et les
 * réglages, que la maquette ne dessine pas, sont rhabillés dans le même langage.
 *
 * Conteneur focusable posé sur la zone des terminaux (qui restent montés dessous) :
 * clavier sur le conteneur seulement (aucun listener `window`, Échap appartient au
 * terminal sinon), focus rendu au terminal actif à la fermeture.
 */
export function DashboardOverlay() {
  const dockVisible = useUiStore((s) => s.dockVisible);
  const day = useDashboardStore((s) => s.day);
  const mode = useDashboardStore((s) => s.mode);
  const onglet = useDashboardStore((s) => s.onglet);
  const filterDir = useDashboardStore((s) => s.filterDir);
  const filterText = useDashboardStore((s) => s.filterText);
  const refreshTick = useDashboardStore((s) => s.refreshTick);
  const setDay = useDashboardStore((s) => s.setDay);
  const allerAujourdhui = useDashboardStore((s) => s.today);
  const setMode = useDashboardStore((s) => s.setMode);
  const setOnglet = useDashboardStore((s) => s.setOnglet);
  const setFilterDir = useDashboardStore((s) => s.setFilterDir);
  const clearFilterDir = useDashboardStore((s) => s.clearFilterDir);
  const setFilterText = useDashboardStore((s) => s.setFilterText);

  const { loading, events, stats, openTasks, reunionUs, reunions, status, error, reload } = useActivityData();
  const evenementsSemaine = useSemaine();
  const semaine = mode === "week";
  const bilan = useSummary(semaine ? "semaine" : "bilan");
  const saisieTemps = useSaisieTemps(day);
  const maintenant = useMaintenant();
  const couleur = useCouleurDossier();
  const today = todayString(new Date(maintenant * 1000));

  const containerRef = useRef<HTMLDivElement>(null);
  const filtreRef = useRef<HTMLInputElement>(null);

  // Réglages (suivi des tâches, cibles de saisie, horaire du bilan) : relus à chaque collecte.
  const [settings, setSettings] = useState<ActivitySettings | null>(null);
  useEffect(() => {
    let annule = false;
    activityApi
      .getSettings()
      .then((s) => {
        if (!annule) setSettings(s);
      })
      .catch(() => {});
    return () => {
      annule = true;
    };
  }, [refreshTick]);

  // Focus au montage (le textarea xterm perd la saisie) ; au démontage, le focus
  // revient au terminal actif, même contrat que les autres vues.
  useEffect(() => {
    containerRef.current?.focus();
    return () => {
      const s = useWorkspaceStore.getState();
      const w = s.workspaces.find((x) => x.id === s.activeId);
      if (w?.activeTabId) focusTab(w.activeTabId);
    };
  }, []);

  // Sens de la dernière navigation : la journée entre par la droite en avançant,
  // par la gauche en reculant. Calculé au rendu (idempotent) pour animer dès l'image.
  const sens = useRef({ cle: `${mode}:${day}`, avant: true });
  if (sens.current.cle !== `${mode}:${day}`) {
    sens.current = { cle: `${mode}:${day}`, avant: day >= sens.current.cle.slice(sens.current.cle.indexOf(":") + 1) };
  }

  // Créneau épinglé et sections repliées : propres à la période affichée. Le créneau
  // est retenu par son début (t0), pas par son rang : une collecte ou minuit peuvent
  // déplacer les bornes de la frise, et un rang désignerait alors un autre quart d'heure.
  const cle = `${mode}:${day}`;
  const [epingle, setEpingle] = useState<{ cle: string; t0: number } | null>(null);
  const [fermes, setFermes] = useState<Record<string, boolean>>({});
  useEffect(() => setEpingle(null), [cle]);

  // ---------------------------------------------------------------- Données dérivées
  const byWorkspace = useMemo(() => stats?.byWorkspace ?? [], [stats]);
  const plage = useMemo(() => (semaine ? weekRange(day) : dayRange(day)), [semaine, day]);
  const colors = useMemo(() => {
    const m = new Map<string, string>();
    for (const w of byWorkspace) m.set(w.dir, couleur(w.dir));
    for (const ev of events) if (ev.workspaceDir && !m.has(ev.workspaceDir)) m.set(ev.workspaceDir, couleur(ev.workspaceDir));
    return m;
  }, [byWorkspace, events, couleur]);
  // Quart d'heure courant : la frise du jour en cours s'étend jusqu'à l'instant présent
  // (bornes à l'heure pleine locale), recalculée au quart d'heure et non à chaque minute.
  // Un quart d'heure et non une heure UTC : certains fuseaux sont décalés d'une demi-heure.
  const heureCourante = Math.floor(maintenant / 900) * 900;
  const frise = useMemo(
    () => buildFrise(mode, day, events, byWorkspace, colors, heureCourante),
    [mode, day, events, byWorkspace, colors, heureCourante],
  );
  const nomDe = useMemo(() => {
    const noms = new Map<string, string>([...byWorkspace.map((w) => [w.dir, w.name] as const), ...frise.rows.map((r) => [r.dir, r.name] as const)]);
    return (dir: string) => noms.get(dir) ?? dir.split("/").filter(Boolean).pop() ?? dir;
  }, [byWorkspace, frise]);
  const act = useMemo(() => activite(events, plage.from, plage.to), [events, plage]);

  // Mise en avant au changement de période : gardée si l'espace a de l'activité sur
  // la nouvelle période, levée sinon. Les données arrivent après le changement de
  // jour (et le premier rendu porte encore celles de l'ancien) : on attend un cycle
  // de chargement complet de la nouvelle période avant de trancher.
  const reconciliation = useRef<{ cle: string; chargementVu: boolean } | null>(null);
  useEffect(() => {
    reconciliation.current = { cle, chargementVu: false };
  }, [cle]);
  useEffect(() => {
    const r = reconciliation.current;
    if (r === null || r.cle !== cle) return;
    if (loading) {
      r.chargementVu = true;
      return;
    }
    if (!r.chargementVu) return;
    reconciliation.current = null;
    // Échec de lecture : les événements sont ceux d'avant, rien à trancher.
    if (error === null && filterDir !== null && !act.parDir.has(filterDir)) clearFilterDir();
  }, [cle, loading, error, act, filterDir, clearFilterDir]);
  const colonnes = useMemo(() => colonnesRythme(frise, reunions, maintenant), [frise, reunions, maintenant]);
  const epingleRang = epingle?.cle === cle ? colonnes.findIndex((c) => c.t0 === epingle.t0) : -1;
  const epingleIndex = epingleRang >= 0 ? epingleRang : null;
  const tickets = useMemo(() => nomsTickets(events, openTasks), [events, openTasks]);

  const synthese = useMemo(
    () => (bilan.ui.status === "ok" ? splitTitle(bilan.ui.summary.text) : { title: "", body: "" }),
    [bilan.ui],
  );
  const attache = useMemo(() => attacherPuces(synthese.body, frise.rows.map((r) => r.name)), [synthese.body, frise.rows]);

  const saisieReglages = settings?.saisie ?? SAISIE_PAR_DEFAUT;
  const temps = useMemo(
    () =>
      tempsParUs(
        events,
        new Map(byWorkspace.map((w) => [w.dir, w.name])),
        saisieReglages,
        reunionUs,
        maintenant,
        reunions,
        openTasks,
      ),
    [events, byWorkspace, saisieReglages, reunionUs, maintenant, reunions, openTasks],
  );
  const suiviActif = settings !== null && clickupActif(settings.clickup);
  const saisieActive = !semaine && suiviActif;

  // ---------------------------------------------------------------- En-tête
  const estAujourdhui = semaine ? weekRange(today).days[0] === weekRange(day).days[0] : day === today;
  const titre = synthese.title !== "" ? synthese.title : semaine ? "La semaine" : "La journée";
  const surtitre = semaine ? formatWeekLabel(day) : jourLong(day);
  const etatBilan: EtatBilan =
    bilan.ui.status === "ok" ? "ok" : bilan.ui.status === "absent" ? "absent" : bilan.ui.status === "error" ? "erreur" : "chargement";
  const libelleBilan =
    bilan.ui.status === "ok"
      ? libelleBilanRedige(bilan.ui.summary, bilan.ui.reecrit === true, maintenant)
      : bilan.ui.status === "absent"
        ? `${semaine ? "Aucun bilan pour cette semaine." : "Aucun bilan pour cette journée."}${settings ? ` ${phraseHoraire(settings.schedule)}` : ""}`
        : bilan.ui.status === "error"
          ? "Le bilan n’a pas pu être lu"
          : "Lecture du bilan…";
  const erreurBilan = bilan.ui.status === "error" ? bilan.ui.message : bilan.ui.status === "ok" ? bilan.ui.lastError : undefined;
  // « Rédaction… » et l'icône qui tourne : seulement pour une rédaction (appel LLM), jamais
  // pour une simple lecture du cache (le hook distingue les deux, lib/summaryState).
  const enCoursDeRedaction = bilan.redaction;
  const regenerer = () => {
    if (enCoursDeRedaction) return;
    bilan.generate(bilan.ui.status === "ok");
  };

  // ---------------------------------------------------------------- Sélecteur
  const jours = useMemo(() => joursSelecteur(day, today, evenementsSemaine, couleur), [day, today, evenementsSemaine, couleur]);
  const precedent = semaine ? shiftDay(day, -7) : jourVoisin(day, -1, today);
  const suivant = semaine
    ? weekRange(shiftDay(day, 7)).days[0] <= today
      ? shiftDay(day, 7)
      : null
    : jourVoisin(day, 1, today);
  const ouvrirJour = (d: string) => {
    setDay(d);
    setMode("day");
  };

  // ---------------------------------------------------------------- Chiffres
  const commits = events.filter((e) => e.kind === "commit" && e.ts >= plage.from && e.ts < plage.to);
  const espacesCommits = new Set(commits.map((c) => c.workspaceDir ?? "")).size;
  const prompts = events.filter((e) => e.kind === "claude_prompt" && e.ts >= plage.from && e.ts < plage.to).length;
  const minutesReunion = reunions.reduce((s, r) => s + (r.fin - r.debut) / 60, 0);
  const lignes = [
    ...temps.us.map((l) => ({ id: l.ticket.id, propose: l.saisie })),
    ...(temps.reunion.saisie > 0 && temps.reunion.ticket ? [{ id: temps.reunion.ticket.id, propose: temps.reunion.saisie }] : []),
  ];
  const faites = lignes.filter((l) => (saisieTemps.saisies[l.id] ?? 0) >= l.propose).length;
  const toutSaisi = saisieActive && lignes.length > 0 && faites === lignes.length;
  const chiffres: Chiffre[] = [
    {
      label: "Temps actif",
      valeur: duree(act.minutes),
      sous:
        act.premier === null
          ? "aucune activité"
          : semaine
            ? `sur ${compte(new Set(events.filter((e) => e.workspaceDir).map((e) => new Date(e.ts * 1000).toDateString())).size, "jour", "jours")}`
            : estAujourdhui
              ? `depuis ${heure(act.premier)}, en cours`
              : `de ${heure(act.premier)} à ${heure(act.dernier ?? act.premier)}`,
    },
    { label: "Commits", valeur: String(commits.length), sous: commits.length ? `sur ${compte(espacesCommits, "espace", "espaces")}` : "aucun commit" },
    { label: "Prompts", valeur: String(prompts), sous: "envoyés aux agents" },
    { label: "Réunions", valeur: duree(minutesReunion), sous: reunions.length ? compte(reunions.length, "réunion", "réunions") : "aucune réunion" },
    {
      label: "Temps à saisir",
      valeur: duree(temps.total),
      succes: toutSaisi,
      sous: !saisieActive
        ? semaine
          ? `sur ${compte(temps.jours, "jour", "jours")}`
          : "saisie non configurée"
        : toutSaisi
          ? "tout est saisi"
          : lignesSaisies(faites, lignes.length),
    },
  ];

  // ---------------------------------------------------------------- Légende et bilan
  const legende = [...act.parDir].map(([dir, minutes]) => ({ dir, name: nomDe(dir), couleur: couleur(dir), minutes }));
  const sections: SectionVue[] = useMemo(() => {
    const parProjet = [...act.parDir].map(([dir, minutes]) => {
      const name = nomDe(dir);
      const ligne = frise.rows.find((r) => r.dir === dir);
      return {
        dir,
        name,
        couleur: couleur(dir),
        monogramme: monogramme(name),
        branche: derniereBranche(events, dir) ?? "hors dépôt",
        minutes,
        commits: ligne?.commits ?? 0,
        puces: pucesDe(attache.phrases.get(name) ?? ""),
      };
    });
    const autres = pucesDe(attache.autres);
    if (autres.length > 0) {
      parProjet.push({
        dir: "",
        name: "Hors projet",
        couleur: "#9296a0",
        monogramme: "··",
        branche: "ce que le bilan ne rattache à aucun espace",
        minutes: 0,
        commits: 0,
        puces: autres,
      });
    }
    return parProjet;
  }, [act, nomDe, frise, couleur, events, attache]);
  const daily = texteDaily(`${surtitre} : ${titre}`, sections);

  const mettreEnAvant = (dir: string | null) => {
    setFilterDir(dir);
    // Mettre un espace en avant déplie sa section du bilan.
    if (dir) setFermes((f) => ({ ...f, [dir]: false }));
  };

  // ---------------------------------------------------------------- Temps à saisir
  const jourSemaine = new Date(dayRange(day).from * 1000).getDay();
  const cible = cibleDuJour(jourSemaine, saisieReglages);
  const noteSaisie = semaine
    ? `Total sur ${compte(temps.jours, "jour travaillé", "jours travaillés")}, réparti au prorata du temps mesuré.`
    : cible === 0
      ? "Week-end : seul le temps mesuré est proposé."
      : day === today
        ? `Cible : le temps écoulé jusqu’à ${heure(maintenant)}, réparti au prorata du temps mesuré.`
        : `Cible ${duree(cible)}, répartie au prorata du temps mesuré, au quart d’heure.`;

  // ---------------------------------------------------------------- Chronologie
  const heures = useMemo(
    () => (onglet === "chrono" && !semaine ? chronologie(events, reunions, nomDe, filterText) : []),
    [onglet, semaine, events, reunions, nomDe, filterText],
  );
  const joursSemaine = useMemo(
    () => (semaine ? buildWeekDays(weekRange(day).days, events, colors, today) : null),
    [semaine, day, events, colors, today],
  );

  // ---------------------------------------------------------------- Clavier
  const fermer = () => dispatchShortcut({ type: "toggle-dashboard" });
  // Un seul écran pour les réglages d'activité : Paramètres › Activité. Le récap n'a
  // plus son volet (la maquette n'en dessine pas) ; deux écrans qui écrivaient les mêmes
  // réglages pouvaient s'écraser l'un l'autre.
  const ouvrirReglagesActivite = () => {
    useDashboardStore.getState().close();
    useUiStore.getState().ouvrirParametres("activite");
  };
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    const cible = e.target as HTMLElement;
    const champ = cible.tagName === "INPUT" || cible.tagName === "TEXTAREA" || cible.tagName === "SELECT";
    if (champ) {
      // Un champ garde ses touches ; Échap rend seulement le focus au récap (fermer
      // perdrait une saisie en cours, un réglage par exemple).
      if (e.key === "Escape") {
        e.preventDefault();
        containerRef.current?.focus();
      }
      return;
    }
    // AltGr (qui donne [ et ] en AZERTY) peut remonter en Ctrl+Alt selon le moteur :
    // il ne doit pas neutraliser les raccourcis.
    if (!e.getModifierState("AltGraph") && (e.ctrlKey || e.altKey || e.metaKey)) return;
    switch (e.key) {
      case "Escape":
        e.preventDefault();
        fermer();
        break;
      case "[":
        if (precedent) setDay(precedent);
        break;
      case "]":
        if (suivant) setDay(suivant);
        break;
      case "d":
        setOnglet(onglet === "chrono" ? "recap" : "chrono");
        break;
      case "/":
        e.preventDefault();
        setOnglet("chrono");
        // Le champ n'existe qu'une fois l'onglet rendu : focus au tick suivant.
        setTimeout(() => filtreRef.current?.focus(), 0);
        break;
    }
  };

  const collecte = collectedAgoLabel(status?.lastCollect ?? {}, maintenant);
  const erreursCollecte = status?.errors ?? [];
  const premierChargement = loading && stats === null;
  const animation = sens.current.avant ? "rc-entree-avant" : "rc-entree-arriere";

  // Le panneau est remonté (clé) à chaque changement de période ou d'onglet, et le
  // volet comme le bandeau d'erreur disparaissent : si l'élément focalisé s'y
  // trouvait (journée de la vue semaine, « Réessayer », « Fermer »), le focus
  // tomberait sur <body> et le clavier du récap (Échap, [, ], d, /) serait perdu.
  // On le rend alors au conteneur. `focusDedans` n'est levé que par un départ
  // explicite vers un autre élément : un élément retiré du DOM n'a pas de cible.
  const focusDedans = useRef(false);
  // Changer d'onglet (Récap ⇄ Chronologie) repart du haut : titre, sélecteur de jours,
  // puis le contenu. La zone défilante est commune aux deux onglets, et la chronologie
  // s'ouvrait sinon au défilement du récap, en plein milieu de la liste.
  const mainRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    if (mainRef.current) mainRef.current.scrollTop = 0;
  }, [onglet]);
  useLayoutEffect(() => {
    const actif = document.activeElement;
    if (focusDedans.current && (actif === null || actif === document.body)) containerRef.current?.focus();
  }, [cle, onglet, error, premierChargement]);

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className="rc"
      // Dock affiché : la zone défilante s'arrête au-dessus de lui (recap.css).
      data-dock={dockVisible || undefined}
      onKeyDown={onKeyDown}
      onFocus={() => {
        focusDedans.current = true;
      }}
      onBlur={(e) => {
        if (e.relatedTarget instanceof Node && !e.currentTarget.contains(e.relatedTarget)) focusDedans.current = false;
      }}
    >
      <BarreRecap
        semaine={numeroSemaine(day)}
        onglet={onglet}
        onOnglet={setOnglet}
        mode={mode}
        onMode={setMode}
        onReglages={ouvrirReglagesActivite}
        alerte={erreursCollecte.length > 0}
        collecte={collecte}
        erreurs={erreursCollecte}
        onFermer={fermer}
      />

      <main ref={mainRef} aria-label="Récap de la journée" className="rc-main">
        <div className="rc-contenu">
          <div className="rc-entete">
            <div key={`t-${cle}`} className={`rc-entete-texte ${animation}`}>
              <div className="rc-surtitre">
                {surtitre}
                {estAujourdhui && (
                  <span className="rc-en-cours">
                    <span aria-hidden="true" className="rc-en-cours-arc" />
                    en cours
                  </span>
                )}
              </div>
              <h1 className="rc-titre">{titre}</h1>
              <div className="rc-redaction">
                <span data-erreur={erreurBilan !== undefined}>
                  {erreurBilan !== undefined && bilan.ui.status === "ok" ? "La dernière réécriture a échoué" : libelleBilan}
                </span>
                <button
                  type="button"
                  className="rc-regen hov"
                  title="Réécrire le bilan à partir de l’activité"
                  aria-busy={enCoursDeRedaction}
                  onClick={regenerer}
                >
                  <IconeRafraichir taille={12} className="rc-regen-icone" data-tourne={enCoursDeRedaction} />
                  {enCoursDeRedaction ? "Rédaction…" : bilan.ui.status === "ok" ? "Régénérer" : "Rédiger le bilan"}
                </button>
                {erreurBilan !== undefined && (
                  <p role="alert" className="rc-redaction-detail" title={erreurBilan}>
                    {erreurBilan}
                  </p>
                )}
              </div>
            </div>
            <SelecteurJours
              jours={jours}
              selection={semaine ? null : day}
              precedent={precedent}
              suivant={suivant}
              onJour={ouvrirJour}
              onNaviguer={setDay}
              onAujourdhui={jours.some((j) => j.day === today) ? null : allerAujourdhui}
              semaine={semaine}
            />
          </div>

          <div
            key={`${cle}:${onglet}`}
            id="rc-panneau"
            role="tabpanel"
            aria-labelledby={`rc-onglet-${onglet}`}
            className={animation}
          >
            {error ? (
              <div className="rc-erreur-bandeau">
                <p>{error}</p>
                <button type="button" className="rc-btn hov" onClick={reload}>
                  Réessayer
                </button>
              </div>
            ) : premierChargement ? (
              <div className="rc-chargement" aria-busy="true">
                <div className="rc-squelette" style={{ height: 64 }} />
                <div className="rc-squelette" style={{ height: 260 }} />
              </div>
            ) : onglet === "chrono" ? (
              <Chronologie
                heures={heures}
                couleur={couleur}
                filtre={filterText}
                onFiltre={setFilterText}
                champ={filtreRef}
                semaine={joursSemaine}
                onJour={ouvrirJour}
              />
            ) : (
              <>
                <Chiffres chiffres={chiffres} />
                <Rythme
                  colonnes={colonnes}
                  reperes={reperes(frise, mode)}
                  commits={commitsFrise(frise)}
                  reunions={reunions}
                  legende={legende}
                  position={(ts) => position(frise, ts)}
                  maintenant={maintenant}
                  afficherMaintenant={maintenant > frise.start && maintenant < frise.end}
                  focus={filterDir}
                  onFocus={mettreEnAvant}
                  epingle={epingleIndex}
                  onEpingle={(i) => setEpingle(i === null || !colonnes[i] ? null : { cle, t0: colonnes[i].t0 })}
                  noms={tickets}
                  onOpen={openLink}
                  semaine={semaine}
                />
                <div className="rc-bas">
                  <BilanProjets
                    sections={sections}
                    etat={etatBilan}
                    fermes={fermes}
                    onBasculer={(dir) => setFermes((f) => ({ ...f, [dir]: !f[dir] }))}
                    onTout={(replier) => setFermes(Object.fromEntries(sections.map((s) => [s.dir, replier])))}
                    focus={filterDir}
                    noms={tickets}
                    onOpen={openLink}
                    texteDaily={daily}
                  />
                  <div className="rc-cote">
                    <TempsSaisie temps={temps} saisie={saisieActive ? saisieTemps : null} note={noteSaisie} onOpen={openLink} />
                    <Reunions reunions={reunions} />
                    <OpenTasks tasks={openTasks} active={suiviActif} onOpen={openLink} />
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      </main>

    </div>
  );
}
