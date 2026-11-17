import { describe, expect, it } from "vitest";
import { homeWorkspaceName, nomEspaceDepart, resoudreDossierDepart } from "./homeWorkspace";

describe("homeWorkspaceName", () => {
  it("prend « ~ » tant qu'il est libre", () => {
    expect(homeWorkspaceName([])).toBe("~");
    expect(homeWorkspaceName(["app", "~ 2"])).toBe("~");
  });

  it("numérote à partir de 2 quand « ~ » existe", () => {
    expect(homeWorkspaceName(["~"])).toBe("~ 2");
    expect(homeWorkspaceName(["~", "~ 2"])).toBe("~ 3");
  });
});

describe("resoudreDossierDepart", () => {
  const home = "/home/moi";
  it("« ~ », vide et « ~/… » partent du dossier personnel", () => {
    expect(resoudreDossierDepart("~", home)).toBe("/home/moi");
    expect(resoudreDossierDepart("  ", home)).toBe("/home/moi");
    expect(resoudreDossierDepart("~/dev/", home)).toBe("/home/moi/dev");
    expect(resoudreDossierDepart("~", "/home/moi/")).toBe("/home/moi");
  });

  it("un chemin absolu reste tel quel, un relatif part du dossier personnel", () => {
    expect(resoudreDossierDepart("/srv/projets", home)).toBe("/srv/projets");
    expect(resoudreDossierDepart("/", home)).toBe("/");
    expect(resoudreDossierDepart("dev", home)).toBe("/home/moi/dev");
  });
});

describe("nomEspaceDepart", () => {
  it("« ~ » pour le dossier personnel, le nom du dossier sinon, numérotés s'ils sont pris", () => {
    expect(nomEspaceDepart("/home/moi", "/home/moi", ["~"])).toBe("~ 2");
    expect(nomEspaceDepart("/home/moi/dev", "/home/moi", [])).toBe("dev");
    expect(nomEspaceDepart("/home/moi/dev", "/home/moi", ["dev"])).toBe("dev 2");
    expect(nomEspaceDepart("/", "/home/moi", [])).toBe("/");
  });
});
