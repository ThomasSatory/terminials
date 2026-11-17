// @vitest-environment jsdom
import { describe, it, expect, afterEach } from "vitest";
import { menuNatifUtile, neutraliserMenuNatif } from "./menuNatif";

function el(html: string): HTMLElement {
  const hote = document.createElement("div");
  hote.innerHTML = html;
  document.body.appendChild(hote);
  return hote;
}

/** Clic droit simulé : vrai si le menu natif s'ouvrirait (événement non annulé). */
function clicDroit(cible: Element): boolean {
  return cible.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true }));
}

describe("menuNatifUtile", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("refuse le fond, les boutons et les éléments de l'interface", () => {
    const h = el(`<nav><span class="sep"></span><button><span>te</span></button></nav>`);
    expect(menuNatifUtile(h.querySelector(".sep"))).toBe(false);
    expect(menuNatifUtile(h.querySelector("button span"))).toBe(false);
    expect(menuNatifUtile(document.body)).toBe(false);
    expect(menuNatifUtile(null)).toBe(false);
  });

  it("garde le menu dans les champs de texte, pas sur les cases ni les curseurs", () => {
    const h = el(
      `<input id="t"><input id="s" type="search"><textarea id="a"></textarea>
       <div id="c" contenteditable="true"><b id="cb">x</b></div>
       <input id="k" type="checkbox"><input id="r" type="range">`,
    );
    for (const id of ["t", "s", "a"]) expect(menuNatifUtile(h.querySelector(`#${id}`))).toBe(true);
    for (const id of ["k", "r"]) expect(menuNatifUtile(h.querySelector(`#${id}`))).toBe(false);
    // jsdom n'implémente pas isContentEditable : on ne teste que le chemin des inputs.
  });

  it("refuse le menu natif dans le terminal, textarea caché de xterm compris (menu de l'app)", () => {
    const h = el(
      `<div class="xterm"><textarea class="xterm-helper-textarea"></textarea><div class="xterm-screen"><canvas></canvas></div></div>`,
    );
    expect(menuNatifUtile(h.querySelector("canvas"))).toBe(false);
    expect(menuNatifUtile(h.querySelector("textarea"))).toBe(false);
  });
});

describe("neutraliserMenuNatif", () => {
  it("annule le clic droit hors champ, le laisse dans un champ, et se retire", () => {
    const h = el(`<span id="fond"></span><input id="champ">`);
    const retirer = neutraliserMenuNatif();
    expect(clicDroit(h.querySelector("#fond")!)).toBe(false);
    expect(clicDroit(h.querySelector("#champ")!)).toBe(true);
    retirer();
    expect(clicDroit(h.querySelector("#fond")!)).toBe(true);
  });

  it("n'empêche pas le menu propre d'un élément de s'ouvrir", () => {
    const h = el(`<button id="avatar"></button>`);
    let ouvert = false;
    h.querySelector("#avatar")!.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      ouvert = true;
    });
    const retirer = neutraliserMenuNatif();
    clicDroit(h.querySelector("#avatar")!);
    expect(ouvert).toBe(true);
    retirer();
  });
});
