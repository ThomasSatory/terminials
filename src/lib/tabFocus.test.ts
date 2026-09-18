import { describe, it, expect, vi } from "vitest";
import { registerTabFocus, unregisterTabFocus, focusTab } from "./tabFocus";

describe("tabFocus — registre tabId → focus du xterm", () => {
  it("focusTab appelle le callback enregistré", () => {
    const cb = vi.fn();
    registerTabFocus("p1", cb);
    focusTab("p1");
    expect(cb).toHaveBeenCalledTimes(1);
    unregisterTabFocus("p1");
  });

  it("focusTab sur un onglet inconnu est un no-op silencieux", () => {
    expect(() => focusTab("fantome")).not.toThrow();
  });

  it("unregisterTabFocus désactive le focus", () => {
    const cb = vi.fn();
    registerTabFocus("p2", cb);
    unregisterTabFocus("p2");
    focusTab("p2");
    expect(cb).not.toHaveBeenCalled();
  });

  it("un second register remplace le callback (remontage de l’onglet)", () => {
    const ancien = vi.fn();
    const nouveau = vi.fn();
    registerTabFocus("p3", ancien);
    registerTabFocus("p3", nouveau);
    focusTab("p3");
    expect(ancien).not.toHaveBeenCalled();
    expect(nouveau).toHaveBeenCalledTimes(1);
    unregisterTabFocus("p3");
  });
});
