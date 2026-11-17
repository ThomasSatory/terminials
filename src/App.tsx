import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { TabbedTerminals } from "./components/TabbedTerminals";
import { DiffOverlay } from "./components/DiffOverlay";
import { DashboardOverlay } from "./components/DashboardOverlay";
import { TopBar } from "./components/TopBar";
import { Dock } from "./components/dock/Dock";
import { SpacePopover } from "./components/dock/SpacePopover";
import { SpaceMenu } from "./components/dock/SpaceMenu";
import { GroupPopover } from "./components/dock/GroupPopover";
import { Accueil } from "./components/Accueil";
import { MenuAjout } from "./components/MenuAjout";
import { Mosaique } from "./components/Mosaique";
import { AgentBubble } from "./components/AgentBubble";
import { CommandPalette } from "./components/CommandPalette";
import { MenuTerminal } from "./components/MenuTerminal";
import { Toast } from "./components/Toast";
import { Parametres } from "./components/parametres/Parametres";
import { PanneauSuperviseur } from "./components/superviseur/PanneauSuperviseur";
import { BulleSuperviseur } from "./components/superviseur/BulleSuperviseur";
import { useShortcuts } from "./hooks/useShortcuts";
import { useApparence } from "./hooks/useApparence";
import { useOutilsSuperviseur } from "./hooks/useOutilsSuperviseur";
import { useReveilSuperviseur } from "./hooks/useReveilSuperviseur";
import { useSonAttente } from "./hooks/useSonAttente";
import { registerSocketEvents } from "./lib/socketEvents";
import { injectPaths } from "./lib/injectFiles";
import { resolvePaneId, toCssPoint } from "./lib/dropTarget";
import { activityApi } from "./lib/activityApi";
import { useWorkspaceStore, loadSavedState } from "./store/workspace";
import { keepExistingSessions } from "./lib/claudeResume";
import { useDashboardStore } from "./store/dashboard";
import { useUiStore, calqueAncreOuvert } from "./store/ui";
import { useReglagesStore } from "./store/reglages";
import { useSuperviseurStore } from "./store/superviseur";
import { focusTab } from "./lib/tabFocus";
import { echeanceAnticipee, nextDelayMs, DIRTY_BUDGET, PORTS_BUDGET } from "./lib/pollSchedule";
import { vuePleinEcran } from "./lib/vuePleinEcran";
import "./styles/shell.css";

export default function App() {
  useShortcuts();
  // Réglages appliqués en direct (accent, densité, animations) ; les terminaux suivent
  // d'eux-mêmes (TerminalPane).
  useApparence();
  // Superviseur : exécuteur des outils (toujours à l'écoute : le garde-fou décide),
  // réveils nés de l'état des agents. Son à l'attente d'un agent (réglage).
  useOutilsSuperviseur();
  useReveilSuperviseur();
  useSonAttente();
  // Sélecteurs ciblés, jamais `useWorkspaceStore()` nu : s'abonner au store entier
  // faisait re-render tout l'arbre (Sidebar + tous les TabbedTerminals) à CHAQUE tour de sonde.
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeId = useWorkspaceStore((s) => s.activeId);
  const toast = useWorkspaceStore((s) => s.toast);
  // Actions : références stables créées une fois par Zustand.
  const clearToast = useWorkspaceStore((s) => s.clearToast);
  const dashboardOpen = useDashboardStore((s) => s.open);
  const vue = useUiStore((s) => s.vue);
  const dockVisible = useUiStore((s) => s.dockVisible);
  const bulleVisible = useUiStore((s) => s.bulleEspace !== null);
  const paletteOuverte = useUiStore((s) => s.paletteOuverte);
  const parametresOuverts = useUiStore((s) => s.parametres !== null);
  // Panneau du superviseur ouvert : la zone terminal lui laisse la droite (maquette).
  // Actif ou non : désactivé pendant qu'il est ouvert, le panneau montre de quoi le
  // réactiver, et ne doit pas pour autant couvrir la fin des lignes du terminal.
  const panneauOuvert = useSuperviseurStore((s) => s.panneauOuvert);

  // true tant que la restauration n'a pas statué : évite le flash de l'état
  // vide « Open folder » pendant les invoke dir_exists.
  const [booting, setBooting] = useState(true);

  // Restauration des groupes et workspaces persistés au premier montage : chaque cwd
  // est validé côté Rust ; dossier disparu → skippé + toast (jamais restauré :
  // unread/status/progress/ports repartent à zéro, cf. contrat SavedWorkspace).
  // Les groupes sont tous restaurés (même vides) : les groupIndex restent valides.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      // Réglages lus AVANT de lancer le moindre terminal : shell, police, défilement.
      // Un échec de lecture laisse les défauts (le store le signale), le boot continue.
      const reglages = useReglagesStore.getState().charger().catch(() => {});
      const saved = loadSavedState();
      if (saved.workspaces.length > 0 || saved.groups.length > 0) {
        const checks = await Promise.all(
          saved.workspaces.map((entry) =>
            invoke<boolean>("dir_exists", { path: entry.cwd }).catch(() => false),
          ),
        );
        if (cancelled) return;
        // Session Claude dont le dossier a disparu : l'onglet repart sans reprise.
        const valid = await Promise.all(
          saved.workspaces
            .filter((_, i) => checks[i])
            .map((entry) =>
              keepExistingSessions(entry, (path) => invoke<boolean>("dir_exists", { path })),
            ),
        );
        if (cancelled) return;
        const missing = saved.workspaces.filter((_, i) => !checks[i]);
        const s = useWorkspaceStore.getState();
        if (missing.length > 0) {
          s.showToast(
            `dossier introuvable, workspace ignoré : ${missing.map((m) => m.cwd).join(", ")}`,
          );
        }
        await reglages;
        if (cancelled) return;
        s.restoreState({ groups: saved.groups, workspaces: valid });
      }
      await reglages;
      if (!cancelled) setBooting(false);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Glisser-déposer de fichiers : Tauri consomme le drop OS (dragDropEnabled par
  // défaut) et émet tauri://drag-drop — l'event `drop` du DOM ne remonte donc jamais.
  // Les chemins sont écrits, quotés, dans le PTY de l'onglet survolé (Claude Code lit le
  // fichier). Tous types de fichiers : Claude Code lit aussi bien un .ts qu'un .png.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((event) => {
      if (event.payload.type !== "drop") return;
      // position en pixels PHYSIQUES ; elementFromPoint attend des pixels CSS.
      const { x, y } = toCssPoint(event.payload.position, window.devicePixelRatio);
      const paneId = resolvePaneId(document.elementFromPoint(x, y) as HTMLElement | null);
      if (!injectPaths(paneId, event.payload.paths)) {
        useWorkspaceStore.getState().showToast("aucun terminal cible pour les fichiers déposés");
      }
    });
    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Branche les events backend (socket-command, agent-notification, activity-*).
  useEffect(() => {
    const cleanup = registerSocketEvents();
    return () => {
      cleanup.then((fn) => fn());
    };
  }, []);

  // Le collecteur d'activité (dashboard) a besoin de connaître les workspaces
  // ouverts pour rattacher les événements (commits, prompts…) à leur dossier.
  // Dépendance sur la liste jointe des cwd (et non `workspaces`) : un seul appel
  // par changement RÉEL de dossiers, pas à chaque tick des pollers ports/git.
  const workspaceCwds = workspaces.map((w) => w.cwd).join("\n");
  useEffect(() => {
    const dirs = workspaceCwds ? workspaceCwds.split("\n") : [];
    activityApi.registerWorkspaces(dirs).catch(() => {});
  }, [workspaceCwds]);

  // Un espace ou un groupe disparaît (fermeture, socket, suppression) : les calques qui
  // le visaient se referment, plutôt que de rester ancrés à un avatar qui n'existe plus.
  useEffect(
    () =>
      useWorkspaceStore.subscribe((s, prev) => {
        // Changer d'espace ou d'onglet, c'est quitter le coup d'œil jeté depuis la
        // mosaïque : Échap redevient au shell (lib/retourMosaique).
        const ongletActif = (st: typeof s) => st.workspaces.find((w) => w.id === st.activeId)?.activeTabId;
        if (s.activeId !== prev.activeId || ongletActif(s) !== ongletActif(prev)) {
          useUiStore.getState().desarmerRetourMosaique();
        }
        // Arriver sur un autre espace (dock, palette, superviseur), c'est vouloir son
        // terminal : les Paramètres qui le couvriraient se ferment.
        if (s.activeId !== prev.activeId) useUiStore.getState().fermerParametres();
        if (s.workspaces === prev.workspaces && s.groups === prev.groups) return;
        const ui = useUiStore.getState();
        const espaces = new Set(s.workspaces.map((w) => w.id));
        for (const w of prev.workspaces) if (!espaces.has(w.id)) ui.oublierEspace(w.id);
        const groupes = new Set(s.groups.map((g) => g.id));
        for (const g of prev.groups) if (!groupes.has(g.id)) ui.oublierGroupe(g.id);
      }),
    [],
  );

  // Palette refermée : le focus revient au terminal actif. Effet de la COQUILLE, donc
  // exécuté après ceux de ses enfants dans le même rendu : un calque, une vue ou un
  // panneau ouvert par l'action choisie a déjà pris le focus, on ne le lui vole pas.
  // Aucun délai (pas de requestAnimationFrame) : l'attribut inert vient de tomber dans
  // ce même rendu, la zone des terminaux accepte déjà le focus.
  const paletteAvant = useRef(paletteOuverte);
  useEffect(() => {
    const fermee = paletteAvant.current && !paletteOuverte;
    paletteAvant.current = paletteOuverte;
    if (!fermee) return;
    const a = document.activeElement;
    if (a && a !== document.body) return;
    const ui = useUiStore.getState();
    if (calqueAncreOuvert(ui)) return;
    // Une vue plein écran affichée reprend le focus (son clavier : Échap la ferme, etc.) ;
    // sans elle, la frappe après Échap n'allait nulle part et un second Échap ne
    // refermait plus le récap.
    const s = useWorkspaceStore.getState();
    const w = s.workspaces.find((x) => x.id === s.activeId);
    const vue = useDashboardStore.getState().open
      ? ".rc"
      : ui.parametres
        ? ".par"
        : w?.diffOpen
          ? ".diff-v"
          : null;
    if (vue) {
      document.querySelector<HTMLElement>(vue)?.focus();
      return;
    }
    if (ui.vue !== "terminal") return;
    if (w?.activeTabId) focusTab(w.activeTabId);
  }, [paletteOuverte]);

  // Auto-dismiss du toast après 2 s. (clearToast est stable : défini une fois par Zustand.)
  useEffect(() => {
    if (!toast) return;
    const h = setTimeout(() => clearToast(), 2000);
    return () => clearTimeout(h);
  }, [toast, clearToast]);

  // Sonde branche (~2s) : GRATUITE (`symbolic-ref` lit .git/HEAD, 0,00 s mesuré sur
  // un repo de 20 000 fichiers). Elle peut donc rester à cadence fixe et en parallèle.
  // Volontairement séparée du dirty : les fusionner faisait payer un `git status`
  // complet juste pour rafraîchir un nom de branche.
  useEffect(() => {
    let running = false;
    const tick = async () => {
      if (running) return;
      running = true;
      try {
        const s = useWorkspaceStore.getState();
        await Promise.all(
          s.workspaces.map(async (w) => {
            try {
              const branch = await invoke<string | null>("git_branch", { cwd: w.cwd });
              // HEAD détachée / hors repo → null : on garde la dernière branche connue, mais
              // l'état git est désormais connu (« hors dépôt » peut s'afficher).
              s.setBranch(w.id, branch || null);
            } catch {
              /* commande indisponible (backend pas prêt) ou cwd hors repo */
            }
          }),
        );
      } finally {
        running = false;
      }
    };
    const h = setInterval(tick, 2000);
    tick();
    return () => clearInterval(h);
  }, []);

  // Sonde dirty : CHÈRE et irréductible (lstat de chaque fichier suivi — 6,14 s sur
  // ~/dev/monorepo, et ~19 s-CPU de plus dans le hook fanotify d'un antivirus).
  // Boucle auto-ordonnancée : chaque workspace porte sa propre échéance, déduite du coût
  // de SA dernière sonde (pollSchedule). Un repo géant dégrade sa seule fraîcheur, sans
  // saturer le CPU ni retarder les autres.
  // Séquentiel, JAMAIS en parallèle : lancer un `git status` par workspace d'un coup
  // saturait le disque et le scan on-access de l'antivirus.
  // La même sonde rapporte le NOMBRE de fichiers modifiés (git_dirty_count, un seul
  // `git status`) : le compteur du bouton ± suit chaque sonde sans coût supplémentaire.
  // Fin d'un tour d'agent (il vient peut-être d'écrire) : la sonde de son espace est
  // avancée, dans la limite d'un espacement proportionnel à son coût (echeanceAnticipee).
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dueAt = new Map<string, number>(); // wsId -> date de la prochaine sonde
    const derniere = new Map<string, { fin: number; duree: number }>(); // wsId -> dernière sonde

    const round = async () => {
      const { workspaces } = useWorkspaceStore.getState();
      for (const w of workspaces) {
        if (stopped) return;
        if ((dueAt.get(w.id) ?? 0) > Date.now()) continue;
        const started = performance.now();
        try {
          const nb = await invoke<number>("git_dirty_count", { cwd: w.cwd });
          // La sonde dure des secondes : le dossier du workspace a pu changer
          // entre-temps (setCwd, édition inline du dossier). Écrire le résultat
          // sans revérifier afficherait le dirty de l'ANCIEN dossier.
          const still = useWorkspaceStore.getState().workspaces.find((x) => x.id === w.id);
          if (still?.cwd === w.cwd) useWorkspaceStore.getState().setDirty(w.id, nb > 0, nb);
        } catch {
          /* commande indisponible (backend pas prêt) ou cwd hors repo */
        }
        // L'échéance est posée même en cas d'échec : sinon un cwd cassé serait resondé en boucle.
        const duree = performance.now() - started;
        derniere.set(w.id, { fin: Date.now(), duree });
        dueAt.set(w.id, Date.now() + nextDelayMs(duree, DIRTY_BUDGET));
      }
      const live = new Set(workspaces.map((w) => w.id));
      for (const id of [...dueAt.keys()]) if (!live.has(id)) dueAt.delete(id);
      for (const id of [...derniere.keys()]) if (!live.has(id)) derniere.delete(id);
      // Réveil de contrôle à 1 s : c'est ce qui fait sonder un workspace tout juste
      // ouvert sans attendre l'échéance (jusqu'à 2 min) d'un voisin lent, ou celui dont
      // un agent vient de finir. Le tour ne coûte qu'un parcours de Map quand aucune
      // échéance n'est atteinte.
      if (!stopped) timer = setTimeout(round, 1000);
    };
    // Fins de tour : PTY qui quittent `busyPtys`. On remonte à l'espace de leur onglet.
    const desabonner = useWorkspaceStore.subscribe((s, prev) => {
      if (s.busyPtys === prev.busyPtys) return;
      for (const pty of Object.keys(prev.busyPtys)) {
        if (pty in s.busyPtys) continue;
        const tabId = Object.keys(s.tabPtys).find((t) => String(s.tabPtys[t]) === pty);
        const w = tabId ? s.workspaces.find((x) => x.tabs.some((t) => t.id === tabId)) : undefined;
        if (!w) continue;
        const prevue = dueAt.get(w.id) ?? Date.now();
        dueAt.set(w.id, echeanceAnticipee(prevue, Date.now(), DIRTY_BUDGET, derniere.get(w.id)));
      }
    });
    void round();
    return () => {
      stopped = true;
      clearTimeout(timer);
      desabonner();
    };
  }, []);

  // Sonde ports : union des ports ouverts par les onglets de chaque workspace. Même
  // ordonnancement adaptatif que le dirty — le parcours de /proc du sous-arbre reste
  // bien moins cher, mais pas gratuit sur un onglet qui fait tourner un node.
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const dueAt = new Map<string, number>();

    const round = async () => {
      const s = useWorkspaceStore.getState();
      for (const w of s.workspaces) {
        if (stopped) return;
        if ((dueAt.get(w.id) ?? 0) > Date.now()) continue;
        const started = performance.now();
        const ptyIds = w.tabs
          .map((t) => s.tabPtys[t.id])
          .filter((id): id is number => id !== undefined);
        const results = await Promise.all(
          ptyIds.map((ptyId) =>
            invoke<number[]>("workspace_ports", { ptyId }).catch(() => [] as number[]),
          ),
        );
        const ports = new Set<number>(results.flat());
        useWorkspaceStore.getState().setPorts(
          w.id,
          [...ports].sort((a, b) => a - b),
        );
        dueAt.set(w.id, Date.now() + nextDelayMs(performance.now() - started, PORTS_BUDGET));
      }
      const live = new Set(s.workspaces.map((w) => w.id));
      for (const id of [...dueAt.keys()]) if (!live.has(id)) dueAt.delete(id);
      if (!stopped) timer = setTimeout(round, 1000);
    };
    void round();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  const active = workspaces.find((w) => w.id === activeId);
  const plein = vuePleinEcran({
    demarrage: booting,
    nbEspaces: workspaces.length,
    recapOuvert: dashboardOpen,
    diffOuvert: active?.diffOpen ?? false,
    vue,
    parametresOuverts,
  });
  // Réserve basse de la pile de terminaux : la dernière ligne ne passe jamais sous le
  // dock (ni sous une bulle d'agent posée dessus). Pas de transition : chaque image
  // intermédiaire redimensionnerait le PTY.
  const reserve = !dockVisible
    ? "var(--reserve-sans-dock)"
    : bulleVisible
      ? "var(--reserve-dock-bulle)"
      : "var(--reserve-dock)";

  // Vues qui couvrent aussi la barre du haut : la barre, cachée dessous, sort de l'ordre
  // de tabulation (inert) au lieu de recevoir un focus invisible.
  const barreCouverte = plein === "recap" || plein === "accueil" || plein === "mosaique";

  return (
    // Panneau du superviseur ouvert : les vues sous la barre (Paramètres, fichiers
    // modifiés) lui réservent sa place à droite, comme les terminaux, pour que leurs
    // commandes (« Retour au terminal ») ne passent pas dessous.
    <div className="app" data-panneau-superviseur={panneauOuvert || undefined}>
      {/* Palette ouverte : dialogue modal (aria-modal). La coquille rend inerte TOUT ce
          qu'elle recouvre, d'un seul attribut : barre, terminaux, vues, dock, bulle,
          calques. `display: contents` : l'enveloppe ne crée aucune boîte, la mise en page
          et l'empilement (z-index dans `.app`) restent ceux de ses enfants. L'attribut
          tombe dans le rendu même de la fermeture ; le focus est rendu juste après (effet
          plus haut, après ceux des calques que l'action choisie a pu ouvrir). */}
      <div
        className="app-sous-palette"
        inert={paletteOuverte || undefined}
        data-flou={paletteOuverte || undefined}
      >
      <div className="app-barre" inert={barreCouverte || undefined}>
        <TopBar />
      </div>
      <div className="app-zone">
        {/* Keep-alive : TOUS les workspaces (et tous leurs onglets) restent montés en
            permanence, empilés. Les inactifs sont masqués en visibility:hidden — JAMAIS
            display:none (un conteneur 0×0 ferait fit() → resize_pty(0) → reflow shell
            cassé), JAMAIS de démontage (le cleanup d'un TerminalPane tue son shell).
            Sous une vue plein écran, le terminal actif est masqué de la même façon : il
            ne garde pas la saisie, et retrouve focus et taille au retour. */}
        <div
          className="app-terminaux"
          style={{ bottom: reserve, right: panneauOuvert ? "var(--reserve-panneau)" : undefined }}
        >
          {workspaces.map((w) => (
            <div
              key={w.id}
              style={{
                position: "absolute",
                inset: 0,
                visibility: w.id === activeId ? "visible" : "hidden",
              }}
            >
              <TabbedTerminals ws={w} visible={w.id === activeId && plein === null} />
            </div>
          ))}
        </div>
        {/* Fichiers modifiés : sous la barre du haut (qui garde le bouton ± pour revenir),
            au-dessus des terminaux (toujours montés dessous), sous le dock. */}
        {plein === "diff" && active && <DiffOverlay ws={active} />}
        {/* Paramètres : même place que le diff (sous la barre du haut, qui garde son icône
            pour revenir), terminaux toujours montés dessous. */}
        {plein === "parametres" && <Parametres />}
      </div>
      {/* Récap, accueil et mosaïque couvrent aussi la barre du haut, jamais le dock : le
          récap porte sa propre barre (« Activité », onglets, Fermer), comme la maquette.
          La zone terminal ne change pas de taille pour autant (aucun refit inutile). */}
      {plein === "recap" && <DashboardOverlay />}
      {plein === "accueil" && (
        <div className="app-vue-totale">
          <Accueil />
        </div>
      )}
      {plein === "mosaique" && (
        <div className="app-vue-totale">
          <Mosaique />
        </div>
      )}
      {/* Panneau du superviseur : flottant à droite, sous le dock et les bulles. */}
      <PanneauSuperviseur />
      <Dock accueil={plein === "accueil"} />
      <AgentBubble />
      <BulleSuperviseur />
      <SpacePopover />
      <MenuAjout />
      <SpaceMenu />
      <GroupPopover />
      <MenuTerminal />
      </div>
      <CommandPalette />
      <Toast />
    </div>
  );
}
