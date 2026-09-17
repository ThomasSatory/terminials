import { describe, it, expect, beforeEach } from "vitest";
import { useDashboardStore, initialDashboardState } from "./dashboard";
import { todayString } from "../lib/dashboardDay";

const store = () => useDashboardStore.getState();

describe("dashboard store", () => {
  beforeEach(() => useDashboardStore.setState(initialDashboardState));

  it("toggle ouvre/ferme et efface unreadSummary", () => {
    store().markSummaryReady(); // fermé → unreadSummary = true
    expect(store().unreadSummary).toBe(true);

    store().toggle(); // ouverture
    expect(store().open).toBe(true);
    expect(store().unreadSummary).toBe(false);

    store().toggle(); // fermeture
    expect(store().open).toBe(false);
  });

  it("toggle à l'ouverture remet day à aujourd'hui si day est dans le futur", () => {
    useDashboardStore.setState({ day: "2099-01-01" });
    store().toggle();
    expect(store().day).toBe(todayString());
  });

  it("toggle à l'ouverture garde day si day n'est pas dans le futur", () => {
    useDashboardStore.setState({ day: "2020-01-01" });
    store().toggle();
    expect(store().day).toBe("2020-01-01");
  });

  it("shiftDay(1) depuis 2026-09-16 → 2026-09-17", () => {
    useDashboardStore.setState({ day: "2026-09-16" });
    store().shiftDay(1);
    expect(store().day).toBe("2026-09-17");
  });

  it("setFilterDir sur la même valeur deux fois → null (toggle)", () => {
    store().setFilterDir("/a");
    expect(store().filterDir).toBe("/a");
    store().setFilterDir("/a");
    expect(store().filterDir).toBeNull();
  });

  it("markSummaryReady : fermé → unreadSummary=true, ouvert → reste false", () => {
    expect(store().open).toBe(false);
    store().markSummaryReady();
    expect(store().unreadSummary).toBe(true);

    useDashboardStore.setState({ unreadSummary: false });
    store().toggle(); // ouvre
    store().markSummaryReady();
    expect(store().unreadSummary).toBe(false);
  });

  it("bumpRefresh incrémente refreshTick", () => {
    const before = store().refreshTick;
    store().bumpRefresh();
    expect(store().refreshTick).toBe(before + 1);
  });

  it("setMode(week)", () => {
    store().setMode("week");
    expect(store().mode).toBe("week");
  });

  it("bumpGenerate incrémente generateTick", () => {
    const before = store().generateTick;
    store().bumpGenerate();
    expect(store().generateTick).toBe(before + 1);
  });
});
