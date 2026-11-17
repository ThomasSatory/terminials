import { describe, it, expect } from "vitest";
import {
  abscisseIndicateurNav,
  avecFantomes,
  cibleIndicateur,
  indicateurDansBande,
  type GeometrieDock,
} from "./dockFantomes";

const w = (id: string) => ({ id });
const ids = (l: { id: string }[]) => l.map((x) => x.id);

describe("avecFantomes", () => {
  it("garde l'espace fermé à sa place, devant son ancien suivant", () => {
    const avant = [w("a"), w("b"), w("c")];
    expect(ids(avecFantomes([w("a"), w("c")], avant, new Set(["b"])))).toEqual(["a", "b", "c"]);
  });

  it("dernier de la liste : reste en fin", () => {
    const avant = [w("a"), w("b")];
    expect(ids(avecFantomes([w("a")], avant, new Set(["b"])))).toEqual(["a", "b"]);
  });

  it("plusieurs fantômes voisins gardent leur ordre", () => {
    const avant = [w("a"), w("b"), w("c"), w("d")];
    expect(ids(avecFantomes([w("a"), w("d")], avant, new Set(["b", "c"])))).toEqual(["a", "b", "c", "d"]);
  });

  it("un nouvel espace apparu pendant l'animation garde sa place du store", () => {
    const avant = [w("a"), w("b")];
    expect(ids(avecFantomes([w("a"), w("n")], avant, new Set(["b"])))).toEqual(["a", "b", "n"]);
  });

  it("sans fantôme : la liste du store telle quelle ; id revenu ou inconnu ignoré", () => {
    const actuels = [w("a"), w("b")];
    expect(ids(avecFantomes(actuels, [w("a"), w("b")], new Set()))).toEqual(["a", "b"]);
    expect(ids(avecFantomes(actuels, [w("a"), w("b")], new Set(["b", "z"])))).toEqual(["a", "b"]);
  });

  it("le fantôme garde l'objet d'avant (nom, couleur pour l'animation)", () => {
    const fige = { id: "b", name: "api" };
    const out = avecFantomes([{ id: "a", name: "x" }], [{ id: "a", name: "x" }, fige], new Set(["b"]));
    expect(out[1]).toBe(fige);
  });
});

describe("indicateur du dock", () => {
  const g: GeometrieDock = { bande: 10, defile: 0, largeur: 300, mosaique: 400, activite: 448 };

  it("s'efface quand l'avatar ouvert sort de la bande qui défile", () => {
    // Avatar à 52 dans la bande, boîte de 44 : centre à 10 + 52 + 22 = 84.
    expect(indicateurDansBande("espace", 62, 44, g)).toBe(true);
    // Bande défilée de 100 px : le centre passe à -16, hors de la bande (bord à 10).
    expect(indicateurDansBande("espace", 62, 44, { ...g, defile: 100 })).toBe(false);
    // Trop à droite : au-delà de 10 + 300.
    expect(indicateurDansBande("espace", 300, 44, g)).toBe(false);
    // Hors bande ou pas encore mesurée : toujours visible.
    expect(indicateurDansBande("mosaique", 2000, 44, g)).toBe(true);
    expect(indicateurDansBande("espace", 2000, 44, { ...g, largeur: 0 })).toBe(true);
  });

  it("cible : récap > mosaïque > espace ouvert", () => {
    expect(cibleIndicateur(true, "mosaique")).toBe("activite");
    expect(cibleIndicateur(false, "mosaique")).toBe("mosaique");
    expect(cibleIndicateur(false, "terminal")).toBe("espace");
  });

  it("sous un avatar : bord de la bande + abscisse dans la bande", () => {
    expect(abscisseIndicateurNav("espace", 52, g)).toBe(62);
    expect(abscisseIndicateurNav("espace", null, g)).toBeNull();
  });

  it("sous Activité ou Mosaïque : centré sous le bouton de 40 px (maquette Recap : x + 9 + 48 − 2)", () => {
    expect(abscisseIndicateurNav("activite", null, g)).toBe(446);
    expect(abscisseIndicateurNav("mosaique", 0, g)).toBe(398);
  });

  it("bande qui défile : un bouton compense le décalage appliqué à toute la boîte", () => {
    const d = { ...g, defile: 30 };
    // La boîte extérieure recule de 30 px : l'abscisse sous Activité avance d'autant.
    expect(abscisseIndicateurNav("activite", null, d)! - d.defile).toBe(446);
    // Sous un avatar, l'abscisse ne bouge pas : c'est la bande qui défile dessous.
    expect(abscisseIndicateurNav("espace", 52, d)).toBe(62);
  });
});
