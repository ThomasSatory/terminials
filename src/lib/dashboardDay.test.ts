import { describe, it, expect } from "vitest";
import {
  toDayString,
  shiftDay,
  dayRange,
  weekRange,
  lastWorkingDay,
  formatHm,
  formatDuration,
  isWeekend,
  formatDayLabel,
} from "./dashboardDay";

describe("dashboardDay", () => {
  it("toDayString en local", () => {
    expect(toDayString(new Date(2026, 8, 16, 23, 59))).toBe("2026-09-16");
  });
  it("shiftDay traverse les mois", () => {
    expect(shiftDay("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDay("2026-10-01", -1)).toBe("2026-09-30");
  });
  it("dayRange = minuit local → minuit suivant", () => {
    const { from, to } = dayRange("2026-09-16");
    expect(from).toBe(Math.floor(new Date(2026, 8, 16).getTime() / 1000));
    expect(to - from).toBe(86400);
  });

  it("dayRange traverse le changement d'heure sans dériver (jour local ≠ 86400 s)", () => {
    // Dimanche 25 octobre 2026 : passage à l'heure d'hiver en Europe/Paris (jour de 25 h).
    // On ne suppose pas le fuseau de la machine de test : l'attendu est recalculé par
    // composants locaux, comme le fait dayRange lui-même.
    const expectedFrom = Math.floor(new Date(2026, 9, 25).getTime() / 1000);
    const expectedTo = Math.floor(new Date(2026, 9, 26).getTime() / 1000);
    const { from, to } = dayRange("2026-10-25");
    expect(from).toBe(expectedFrom);
    expect(to).toBe(expectedTo);
  });
  it("weekRange du mercredi = lundi → samedi, 5 jours", () => {
    const w = weekRange("2026-09-16");
    expect(w.days).toEqual([
      "2026-09-14",
      "2026-09-15",
      "2026-09-16",
      "2026-09-17",
      "2026-09-18",
    ]);
    expect(w.from).toBe(dayRange("2026-09-14").from);
    expect(w.to).toBe(dayRange("2026-09-19").from);
  });
  it("lastWorkingDay", () => {
    expect(lastWorkingDay("2026-09-21")).toBe("2026-09-18");
    expect(lastWorkingDay("2026-09-22")).toBe("2026-09-21");
    expect(lastWorkingDay("2026-09-20")).toBe("2026-09-18");
  });
  it("formats", () => {
    expect(formatHm(new Date(2026, 8, 16, 9, 14).getTime() / 1000)).toBe("09:14");
    expect(formatDuration(65)).toBe("1 h 05");
    expect(formatDuration(45)).toBe("45 min");
    expect(formatDuration(0)).toBe("0 min");
    expect(isWeekend("2026-09-19")).toBe(true);
    expect(isWeekend("2026-09-16")).toBe(false);
    expect(formatDayLabel("2026-09-16")).toBe("mercredi 16 septembre 2026");
  });
});
