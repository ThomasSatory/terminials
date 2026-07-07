import { describe, it, expect, vi } from "vitest";
import { registerPaneFocus, unregisterPaneFocus, focusPane } from "./paneFocus";

describe("paneFocus — registre paneId → focus du xterm", () => {
  it("focusPane appelle le callback enregistré", () => {
    const cb = vi.fn();
    registerPaneFocus("p1", cb);
    focusPane("p1");
    expect(cb).toHaveBeenCalledTimes(1);
    unregisterPaneFocus("p1");
  });

  it("focusPane sur un pane inconnu est un no-op silencieux", () => {
    expect(() => focusPane("fantome")).not.toThrow();
  });

  it("unregisterPaneFocus désactive le focus", () => {
    const cb = vi.fn();
    registerPaneFocus("p2", cb);
    unregisterPaneFocus("p2");
    focusPane("p2");
    expect(cb).not.toHaveBeenCalled();
  });

  it("un second register remplace le callback (remontage du pane)", () => {
    const ancien = vi.fn();
    const nouveau = vi.fn();
    registerPaneFocus("p3", ancien);
    registerPaneFocus("p3", nouveau);
    focusPane("p3");
    expect(ancien).not.toHaveBeenCalled();
    expect(nouveau).toHaveBeenCalledTimes(1);
    unregisterPaneFocus("p3");
  });
});
