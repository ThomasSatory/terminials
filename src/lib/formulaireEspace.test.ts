// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { verifierFormulaire, voisinClavier, arretTabulation } from "./formulaireEspace";

describe("verifierFormulaire", () => {
  it("exige un dossier", () => {
    expect(verifierFormulaire({ name: "app", folder: "  " }, "/home/moi")).toEqual({
      ok: false,
      message: "Dossier requis : tapez un chemin ou Parcourir…",
    });
  });

  it("résout un chemin en ~ avec le dossier personnel", () => {
    expect(verifierFormulaire({ name: "", folder: "~/dev/app/" }, "/home/moi")).toEqual({
      ok: true,
      resolu: { cwd: "/home/moi/dev/app", name: undefined },
    });
  });

  it("demande de réessayer tant que le dossier personnel est inconnu", () => {
    const v = verifierFormulaire({ name: "app", folder: "~/dev/app" }, "");
    expect(v).toEqual({ ok: false, message: "Dossier personnel pas encore résolu, réessayez" });
  });

  it("refuse un chemin relatif", () => {
    const v = verifierFormulaire({ name: "app", folder: "dev/app" }, "/home/moi");
    expect(v).toEqual({ ok: false, message: "Chemin absolu attendu (ex. ~/dev/app)" });
  });
});

describe("voisinClavier", () => {
  let panneau: HTMLElement;
  const bouton = (id: string) => panneau.querySelector<HTMLElement>(`#${id}`)!;

  beforeEach(() => {
    // Un bouton seul, une grille de 2 colonnes (4 pastilles), un bouton désactivé, un champ.
    document.body.innerHTML = `
      <div id="panneau">
        <button id="renommer">Renommer</button>
        <div data-cr-groupe data-colonnes="2">
          <button id="c1"></button><button id="c2"></button>
          <button id="c3"></button><button id="c4"></button>
        </div>
        <button id="inerte" disabled>Inerte</button>
        <input id="champ" />
      </div>`;
    panneau = document.getElementById("panneau")!;
  });

  it("Début et Fin vont aux extrémités, éléments désactivés exclus", () => {
    expect(voisinClavier(panneau, bouton("c2"), "Home")).toBe(bouton("renommer"));
    expect(voisinClavier(panneau, bouton("c2"), "End")).toBe(bouton("champ"));
  });

  it("↑/↓ parcourent tout le panneau en bouclant", () => {
    expect(voisinClavier(panneau, bouton("renommer"), "ArrowDown")).toBe(bouton("c1"));
    expect(voisinClavier(panneau, bouton("renommer"), "ArrowUp")).toBe(bouton("champ"));
    expect(voisinClavier(panneau, bouton("champ"), "ArrowDown")).toBe(bouton("renommer"));
  });

  it("←/→ restent dans le groupe et y bouclent", () => {
    expect(voisinClavier(panneau, bouton("c1"), "ArrowRight")).toBe(bouton("c2"));
    expect(voisinClavier(panneau, bouton("c1"), "ArrowLeft")).toBe(bouton("c4"));
  });

  it("dans une grille, ↑/↓ sautent d'une ligne puis sortent par le bord", () => {
    expect(voisinClavier(panneau, bouton("c1"), "ArrowDown")).toBe(bouton("c3"));
    expect(voisinClavier(panneau, bouton("c3"), "ArrowDown")).toBe(bouton("champ"));
    expect(voisinClavier(panneau, bouton("c2"), "ArrowUp")).toBe(bouton("renommer"));
  });

  it("ignore les autres touches et un panneau vide", () => {
    expect(voisinClavier(panneau, bouton("c1"), "Enter")).toBeNull();
    expect(voisinClavier(document.createElement("div"), bouton("c1"), "ArrowDown")).toBeNull();
  });
});

describe("arretTabulation", () => {
  it("le choisi, sinon le premier", () => {
    expect(arretTabulation(3)).toBe(3);
    expect(arretTabulation(0)).toBe(0);
    expect(arretTabulation(-1)).toBe(0);
  });
});
