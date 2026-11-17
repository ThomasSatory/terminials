import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  abonnerTerminal,
  dernieresLignes,
  desenregistrerTerminal,
  enregistrerTerminal,
  limiter,
  lireDernieresLignes,
  terminalEnregistre,
  type TamponLisible,
  type TerminalLisible,
} from "./terminalRegistry";

/** Faux tampon : chaque entrée est une ligne physique ; `+` en tête = ligne repliée. */
function tampon(lignes: string[], largeur = 10): TamponLisible {
  const physiques = lignes.map((l) => {
    const isWrapped = l.startsWith("+");
    const texte = (isWrapped ? l.slice(1) : l).padEnd(largeur, " ");
    return {
      isWrapped,
      translateToString: (trimRight?: boolean) => (trimRight ? texte.trimEnd() : texte),
    };
  });
  return { length: physiques.length, getLine: (y) => physiques[y] };
}

/** Faux terminal : `ecrire()` simule une écriture analysée par xterm. */
function faux(lignes: string[]): TerminalLisible & { ecrire(): void; abonnes(): number } {
  const cbs = new Set<() => void>();
  return {
    buffer: { active: tampon(lignes) },
    onWriteParsed: (cb) => {
      cbs.add(cb);
      return { dispose: () => cbs.delete(cb) };
    },
    ecrire: () => cbs.forEach((cb) => cb()),
    abonnes: () => cbs.size,
  };
}

describe("dernieresLignes", () => {
  it("rend les n dernières lignes non vides, de la plus ancienne à la plus récente", () => {
    const t = tampon(["$ ls", "a  b", "", "   ", "$ git st", "", ""]);
    expect(dernieresLignes(t, 2)).toEqual(["a  b", "$ git st"]);
    expect(dernieresLignes(t, 10)).toEqual(["$ ls", "a  b", "$ git st"]);
  });

  it("recolle les lignes repliées en une ligne logique, espaces du repli compris", () => {
    const t = tampon(["avant", "0123456789", "+abc def", "après"], 10);
    expect(dernieresLignes(t, 2)).toEqual(["0123456789abc def", "après"]);
    // Un vrai espace tombé pile sur la coupure survit au recollage.
    const coupe = tampon(["un mot    ", "+suite"], 10);
    expect(dernieresLignes(coupe, 1)).toEqual(["un mot    suite"]);
  });

  it("n ≤ 0 ou tampon vide → []", () => {
    expect(dernieresLignes(tampon(["x"]), 0)).toEqual([]);
    expect(dernieresLignes(tampon([]), 3)).toEqual([]);
    expect(dernieresLignes(tampon(["", "  "]), 3)).toEqual([]);
  });

  it("ne parcourt pas plus que le plafond", () => {
    const t = tampon(["vieille", ...Array(50).fill("")]);
    expect(dernieresLignes(t, 1, 20)).toEqual([]);
    expect(dernieresLignes(t, 1, 60)).toEqual(["vieille"]);
  });
});

describe("limiter", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("part tout de suite, puis au plus une fois par délai, dernier appel honoré", () => {
    const fn = vi.fn();
    const l = limiter(fn, 100);
    l.appeler();
    expect(fn).toHaveBeenCalledTimes(1);
    l.appeler();
    l.appeler();
    expect(fn).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(fn).toHaveBeenCalledTimes(2);
    vi.advanceTimersByTime(500);
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("annuler coupe l'envoi en attente", () => {
    const fn = vi.fn();
    const l = limiter(fn, 100);
    l.appeler();
    l.appeler();
    l.annuler();
    vi.advanceTimersByTime(200);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});

describe("registre", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("lit les lignes d'un onglet enregistré, [] sinon", () => {
    const t = faux(["$ npm test", "ok"]);
    expect(lireDernieresLignes("r1", 5)).toEqual([]);
    enregistrerTerminal("r1", t);
    expect(terminalEnregistre("r1")).toBe(true);
    expect(lireDernieresLignes("r1", 1)).toEqual(["ok"]);
    desenregistrerTerminal("r1", t);
    expect(terminalEnregistre("r1")).toBe(false);
    expect(lireDernieresLignes("r1", 5)).toEqual([]);
  });

  it("un abonné est notifié des écritures (limité), de l'enregistrement et du retrait", () => {
    const cb = vi.fn();
    const stop = abonnerTerminal("r2", cb, 100); // avant le montage du terminal
    const t = faux(["x"]);
    enregistrerTerminal("r2", t);
    expect(cb).toHaveBeenCalledTimes(1);
    t.ecrire();
    t.ecrire();
    t.ecrire();
    expect(cb).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledTimes(2);
    desenregistrerTerminal("r2", t);
    vi.advanceTimersByTime(100);
    expect(cb).toHaveBeenCalledTimes(3);
    stop();
  });

  it("un seul relais xterm par terminal, rendu quand le dernier abonné part", () => {
    const t = faux(["x"]);
    enregistrerTerminal("r3", t);
    expect(t.abonnes()).toBe(0); // personne n'écoute : xterm n'est pas sollicité
    const stop1 = abonnerTerminal("r3", () => {});
    const stop2 = abonnerTerminal("r3", () => {});
    expect(t.abonnes()).toBe(1);
    stop1();
    expect(t.abonnes()).toBe(1);
    stop2();
    expect(t.abonnes()).toBe(0);
    desenregistrerTerminal("r3", t);
  });

  it("le retrait d'un ancien terminal n'efface pas son remplaçant (respawn)", () => {
    const ancien = faux(["ancien"]);
    const nouveau = faux(["nouveau"]);
    const stop = abonnerTerminal("r4", () => {});
    enregistrerTerminal("r4", ancien);
    enregistrerTerminal("r4", nouveau);
    expect(ancien.abonnes()).toBe(0);
    expect(nouveau.abonnes()).toBe(1);
    desenregistrerTerminal("r4", ancien);
    expect(lireDernieresLignes("r4", 1)).toEqual(["nouveau"]);
    expect(nouveau.abonnes()).toBe(1);
    stop();
    desenregistrerTerminal("r4", nouveau);
  });

  it("se désabonner annule une notification en attente", () => {
    const cb = vi.fn();
    const t = faux(["x"]);
    enregistrerTerminal("r5", t);
    const stop = abonnerTerminal("r5", cb, 100);
    t.ecrire();
    t.ecrire();
    stop();
    vi.advanceTimersByTime(200);
    expect(cb).toHaveBeenCalledTimes(1);
    desenregistrerTerminal("r5", t);
  });
});
