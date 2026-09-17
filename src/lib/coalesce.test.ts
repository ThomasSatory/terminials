import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { coalesce } from "./coalesce";

describe("coalesce", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("une rafale d'appels ne déclenche qu'une seule exécution", () => {
    const fn = vi.fn();
    const declencher = coalesce(fn, 2000);

    declencher();
    declencher();
    declencher();
    expect(fn).not.toHaveBeenCalled();

    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("l'exécution a lieu au plus tard `delai` après le premier appel de la rafale", () => {
    const fn = vi.fn();
    const declencher = coalesce(fn, 2000);

    declencher();
    // Des appels continus ne doivent pas repousser indéfiniment l'exécution
    // (fenêtre fixe, pas un debounce glissant).
    vi.advanceTimersByTime(1500);
    declencher();
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it("une nouvelle rafale après l'exécution redéclenche", () => {
    const fn = vi.fn();
    const declencher = coalesce(fn, 2000);

    declencher();
    vi.advanceTimersByTime(2000);
    declencher();
    vi.advanceTimersByTime(2000);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("cancel() annule l'exécution en attente", () => {
    const fn = vi.fn();
    const declencher = coalesce(fn, 2000);

    declencher();
    declencher.cancel();
    vi.advanceTimersByTime(10_000);
    expect(fn).not.toHaveBeenCalled();
  });

  it("cancel() sur une fenêtre déjà écoulée ne lève pas", () => {
    const fn = vi.fn();
    const declencher = coalesce(fn, 2000);

    declencher();
    vi.advanceTimersByTime(2000);
    expect(() => declencher.cancel()).not.toThrow();
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
