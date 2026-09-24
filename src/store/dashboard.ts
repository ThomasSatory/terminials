import { create } from "zustand";
import { todayString, shiftDay as shiftDayString } from "../lib/dashboardDay";

export interface DashboardState {
  /** Overlay du dashboard visible (toggle Ctrl+Shift+H). */
  open: boolean;
  /** Jour sélectionné ("YYYY-MM-DD", heure locale). */
  day: string;
  mode: "day" | "week";
  /** Filtre par dossier de workspace (null = tous). */
  filterDir: string | null;
  filterText: string;
  /** Un résumé LLM est prêt et n'a pas encore été vu (overlay fermé). */
  unreadSummary: boolean;
  settingsOpen: boolean;
  /** Volet « détails » (chronologie ou jour par jour) ouvert, touche `d`. */
  detailsOpen: boolean;
  /** Compteur bumpé pour invalider les hooks de données (dépendance d'effet). */
  refreshTick: number;
  /** Compteur bumpé par « Générer maintenant » : force la régénération des résumés visibles. */
  generateTick: number;
  toggle(): void;
  close(): void;
  setDay(d: string): void;
  shiftDay(delta: number): void;
  today(): void;
  setMode(m: "day" | "week"): void;
  setFilterDir(d: string | null): void;
  setFilterText(t: string): void;
  markSummaryReady(): void;
  setSettingsOpen(b: boolean): void;
  setDetailsOpen(b: boolean): void;
  bumpRefresh(): void;
  bumpGenerate(): void;
}

/** État initial, exporté pour réinitialiser le store entre les tests
 *  (`useDashboardStore.setState(initialDashboardState)`). */
export const initialDashboardState: Pick<
  DashboardState,
  | "open"
  | "day"
  | "mode"
  | "filterDir"
  | "filterText"
  | "unreadSummary"
  | "settingsOpen"
  | "detailsOpen"
  | "refreshTick"
  | "generateTick"
> = {
  open: false,
  day: todayString(),
  mode: "day",
  filterDir: null,
  filterText: "",
  unreadSummary: false,
  settingsOpen: false,
  detailsOpen: false,
  refreshTick: 0,
  generateTick: 0,
};

export const useDashboardStore = create<DashboardState>((set, get) => ({
  ...initialDashboardState,
  toggle: () => {
    const s = get();
    if (s.open) {
      set({ open: false });
      return;
    }
    // Ouverture : jour remis à aujourd'hui si `day` est dans le futur (overlay
    // resté fermé après un changement de jour manuel qui a dérivé), sinon on
    // garde la sélection de l'utilisateur (règle simplifiée du spec).
    const today = todayString();
    set({
      open: true,
      unreadSummary: false,
      day: s.day > today ? today : s.day,
    });
  },
  close: () => set({ open: false }),
  setDay: (d) => set({ day: d }),
  // Renommé à l'import (shiftDayString) pour ne pas masquer cette méthode du store.
  shiftDay: (delta) => set((s) => ({ day: shiftDayString(s.day, delta) })),
  today: () => set({ day: todayString() }),
  setMode: (m) => set({ mode: m }),
  setFilterDir: (d) =>
    set((s) => ({ filterDir: s.filterDir === d ? null : d })),
  setFilterText: (t) => set({ filterText: t }),
  markSummaryReady: () =>
    set((s) => (s.open ? {} : { unreadSummary: true })),
  // Un seul volet à la fois : ouvrir l'un ferme l'autre.
  setSettingsOpen: (b) => set(b ? { settingsOpen: true, detailsOpen: false } : { settingsOpen: false }),
  setDetailsOpen: (b) => set(b ? { detailsOpen: true, settingsOpen: false } : { detailsOpen: false }),
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
  bumpGenerate: () => set((s) => ({ generateTick: s.generateTick + 1 })),
}));
