import { describe, it, expect } from "vitest";
import { resolveDraft } from "./workspaceDraft";

const HOME = "/home/x";

describe("resolveDraft", () => {
  it("dossier vide → $HOME, nom vide → « ~ »", () => {
    expect(resolveDraft({ name: "", folder: "" }, HOME)).toEqual({ cwd: HOME, name: "~" });
  });

  it("« ~ » explicite se comporte comme le dossier vide", () => {
    expect(resolveDraft({ name: "", folder: "~" }, HOME)).toEqual({ cwd: HOME, name: "~" });
  });

  it("réexpanse ~/x en chemin absolu", () => {
    expect(resolveDraft({ name: "", folder: "~/dev/terminals" }, HOME)).toEqual({
      cwd: "/home/x/dev/terminals",
      name: undefined,
    });
  });

  it("nom vide hors $HOME → undefined (le store prendra basename)", () => {
    expect(resolveDraft({ name: "  ", folder: "/srv/app" }, HOME)).toEqual({
      cwd: "/srv/app",
      name: undefined,
    });
  });

  it("nom explicite gagne, même sur $HOME", () => {
    expect(resolveDraft({ name: " agent ", folder: "~" }, HOME)).toEqual({
      cwd: HOME,
      name: "agent",
    });
  });

  it("retire le slash final, y compris après expansion de ~", () => {
    expect(resolveDraft({ name: "", folder: "/srv/app/" }, HOME)?.cwd).toBe("/srv/app");
    expect(resolveDraft({ name: "", folder: "~/dev/" }, HOME)?.cwd).toBe("/home/x/dev");
  });

  it("tolère le slash final de homeDir()", () => {
    expect(resolveDraft({ name: "", folder: "~/dev" }, "/home/x/")).toEqual({
      cwd: "/home/x/dev",
      name: undefined,
    });
  });

  it("préserve la racine /", () => {
    expect(resolveDraft({ name: "root", folder: "/" }, HOME)).toEqual({ cwd: "/", name: "root" });
  });

  it("chemin relatif → null (jamais résolu contre le cwd de l'app)", () => {
    expect(resolveDraft({ name: "", folder: "dev/terminals" }, HOME)).toBeNull();
  });

  it("$HOME pas encore résolu → null plutôt qu'un cwd vide", () => {
    expect(resolveDraft({ name: "", folder: "" }, "")).toBeNull();
    expect(resolveDraft({ name: "", folder: "~/dev" }, "")).toBeNull();
  });
});
