import { create } from "zustand";
import { todayString, shiftDay as shiftDayString } from "../lib/dashboardDay";

/** Onglet du récap : la journée résumée, ou la chronologie détaillée. */
export type OngletRecap = "recap" | "chrono";

export interface DashboardState {
  /** Récap de la journée visible (bascule Ctrl+Maj+H). */
  open: boolean;
  /** Jour sélectionné ("YYYY-MM-DD", heure locale). */
  day: string;
  mode: "day" | "week";
  onglet: OngletRecap;
  /** Espace mis en avant dans le rythme (dossier), null = tous. */
  filterDir: string | null;
  /** Filtre texte de la chronologie. */
  filterText: string;
  /** Un bilan est prêt et n'a pas encore été vu (récap fermé). */
  unreadSummary: boolean;
  /** Compteur bumpé pour invalider les hooks de données (dépendance d'effet). */
  refreshTick: number;
  toggle(): void;
  close(): void;
  setDay(d: string): void;
  shiftDay(delta: number): void;
  today(): void;
  setMode(m: "day" | "week"): void;
  setOnglet(o: OngletRecap): void;
  /** Mise en avant d'un espace : la même valeur deux fois la lève (bascule). */
  setFilterDir(d: string | null): void;
  /** Lève la mise en avant sans bascule. */
  clearFilterDir(): void;
  setFilterText(t: string): void;
  markSummaryReady(): void;
  bumpRefresh(): void;
}

/** État initial, exporté pour réinitialiser le store entre les tests
 *  (`useDashboardStore.setState(initialDashboardState)`). */
export const initialDashboardState: Pick<
  DashboardState,
  | "open"
  | "day"
  | "mode"
  | "onglet"
  | "filterDir"
  | "filterText"
  | "unreadSummary"
  | "refreshTick"
> = {
  open: false,
  day: todayString(),
  mode: "day",
  onglet: "recap",
  filterDir: null,
  filterText: "",
  unreadSummary: false,
  refreshTick: 0,
};

export const useDashboardStore = create<DashboardState>((set, get) => ({
  ...initialDashboardState,
  toggle: () => {
    const s = get();
    if (s.open) {
      set({ open: false });
      return;
    }
    // Ouverture : jour remis à aujourd'hui si `day` est dans le futur (récap resté
    // fermé après un changement de jour qui a dérivé), sinon on garde la sélection.
    const today = todayString();
    set({
      open: true,
      unreadSummary: false,
      day: s.day > today ? today : s.day,
    });
  },
  close: () => set({ open: false }),
  // Changer de jour garde la mise en avant : le récap la lève (clearFilterDir) une fois
  // les données du jour arrivées, si l'espace n'y a aucune activité. Le store ne
  // connaît pas l'activité, il ne peut pas en décider seul.
  setDay: (d) => set((s) => (s.day === d ? {} : { day: d })),
  // Renommé à l'import (shiftDayString) pour ne pas masquer cette méthode du store.
  shiftDay: (delta) => set((s) => ({ day: shiftDayString(s.day, delta) })),
  today: () => set({ day: todayString() }),
  setMode: (m) => set({ mode: m }),
  setOnglet: (o) => set({ onglet: o }),
  setFilterDir: (d) => set((s) => ({ filterDir: s.filterDir === d ? null : d })),
  clearFilterDir: () => set({ filterDir: null }),
  setFilterText: (t) => set({ filterText: t }),
  markSummaryReady: () => set((s) => (s.open ? {} : { unreadSummary: true })),
  bumpRefresh: () => set((s) => ({ refreshTick: s.refreshTick + 1 })),
}));
