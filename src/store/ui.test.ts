import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore, calqueAncreOuvert, initialUiState } from "./ui";

const ui = () => useUiStore.getState();

describe("store ui", () => {
  beforeEach(() => ui().reset());

  it("démarre sur le terminal, dock visible, aucun calque", () => {
    expect(ui().vue).toBe("terminal");
    expect(ui().dockVisible).toBe(true);
    expect(calqueAncreOuvert(ui())).toBe(false);
    expect(ui().paletteOuverte).toBe(false);
    expect(ui().bulleEspace).toBeNull();
  });

  it("basculerMosaique alterne terminal et mosaïque, et ferme les calques", () => {
    ui().ouvrirMenuEspace("ws:1");
    ui().basculerMosaique();
    expect(ui().vue).toBe("mosaique");
    expect(ui().menuEspace).toBeNull();
    ui().basculerMosaique();
    expect(ui().vue).toBe("terminal");
  });

  it("setVue pose la vue demandée", () => {
    ui().setVue("mosaique");
    expect(ui().vue).toBe("mosaique");
  });

  it("palette : ouvrir, fermer, basculer", () => {
    ui().ouvrirPalette();
    expect(ui().paletteOuverte).toBe(true);
    ui().fermerPalette();
    expect(ui().paletteOuverte).toBe(false);
    ui().basculerPalette();
    expect(ui().paletteOuverte).toBe(true);
    ui().basculerPalette();
    expect(ui().paletteOuverte).toBe(false);
  });

  it("les calques s'excluent : ouvrir l'un ferme les autres", () => {
    ui().ouvrirPalette();
    ui().ouvrirPopoverEspace({ mode: "creer" });
    expect(ui().paletteOuverte).toBe(false);
    expect(ui().popoverEspace).toEqual({ mode: "creer" });

    ui().ouvrirMenuEspace("ws:2");
    expect(ui().popoverEspace).toBeNull();
    expect(ui().menuEspace).toBe("ws:2");

    ui().ouvrirMenuGroupe("grp:1");
    expect(ui().menuEspace).toBeNull();
    expect(ui().menuGroupe).toBe("grp:1");
    expect(calqueAncreOuvert(ui())).toBe(true);

    ui().ouvrirFormulaireGroupe({ mode: "creer" });
    expect(ui().menuGroupe).toBeNull();
    expect(ui().formulaireGroupe).toEqual({ mode: "creer" });

    ui().basculerMenuAjout();
    expect(ui().formulaireGroupe).toBeNull();
    expect(ui().menuAjout).toBe(true);

    ui().ouvrirPalette();
    expect(ui().menuAjout).toBe(false);
    expect(calqueAncreOuvert(ui())).toBe(false);
  });

  it("fermer un calque n'affecte que lui", () => {
    ui().ouvrirPopoverEspace({ mode: "modifier", wsId: "ws:3" });
    ui().fermerMenuEspace();
    expect(ui().popoverEspace).toEqual({ mode: "modifier", wsId: "ws:3" });
    ui().fermerPopoverEspace();
    expect(ui().popoverEspace).toBeNull();
    ui().ouvrirFormulaireGroupe({ mode: "modifier", groupId: "grp:0" });
    ui().fermerFormulaireGroupe();
    expect(ui().formulaireGroupe).toBeNull();
    ui().basculerMenuAjout();
    ui().fermerMenuAjout();
    expect(ui().menuAjout).toBe(false);
    ui().ouvrirMenuGroupe("grp:2");
    ui().fermerMenuEspace();
    expect(ui().menuGroupe).toBe("grp:2");
    ui().fermerMenuGroupe();
    expect(ui().menuGroupe).toBeNull();
  });

  it("fermerCalques ferme tout sans toucher à la vue ni au dock", () => {
    ui().setVue("mosaique");
    ui().ouvrirMenuEspace("ws:1");
    ui().fermerCalques();
    expect(calqueAncreOuvert(ui())).toBe(false);
    expect(ui().vue).toBe("mosaique");
    expect(ui().dockVisible).toBe(true);
  });

  it("masquer le dock referme ce qui s'y ancre ; l'ouvrir d'un calque le réaffiche", () => {
    ui().ouvrirPopoverEspace({ mode: "creer", groupId: "grp:1" });
    ui().basculerDock();
    expect(ui().dockVisible).toBe(false);
    expect(ui().popoverEspace).toBeNull();

    ui().ouvrirPopoverEspace({ mode: "creer" });
    expect(ui().dockVisible).toBe(true);

    ui().basculerDock();
    ui().ouvrirMenuEspace("ws:1");
    expect(ui().dockVisible).toBe(true);
    ui().basculerDock();
    ui().ouvrirFormulaireGroupe({ mode: "creer" });
    expect(ui().dockVisible).toBe(true);
    ui().basculerDock();
    ui().basculerMenuAjout();
    expect(ui().dockVisible).toBe(true);

    ui().ouvrirMenuGroupe("grp:1");
    ui().basculerDock();
    expect(ui().menuGroupe).toBeNull();
    ui().ouvrirMenuGroupe("grp:1");
    expect(ui().dockVisible).toBe(true);
  });

  it("masquer le dock garde la palette, qui n'y est pas ancrée", () => {
    ui().ouvrirPalette();
    ui().basculerDock();
    expect(ui().paletteOuverte).toBe(true);
  });

  it("la palette ne force pas l'affichage du dock", () => {
    ui().basculerDock();
    ui().ouvrirPalette();
    expect(ui().dockVisible).toBe(false);
  });

  it("basculerMenuAjout referme le menu déjà ouvert", () => {
    ui().basculerMenuAjout();
    ui().basculerMenuAjout();
    expect(ui().menuAjout).toBe(false);
  });

  it("setBulleEspace ne notifie pas quand rien ne change", () => {
    let notifications = 0;
    const stop = useUiStore.subscribe(() => notifications++);
    ui().setBulleEspace(null);
    expect(notifications).toBe(0);
    ui().setBulleEspace("ws:1");
    expect(ui().bulleEspace).toBe("ws:1");
    expect(notifications).toBe(1);
    ui().setBulleEspace("ws:1");
    expect(notifications).toBe(1);
    stop();
  });

  it("oublierEspace referme le menu et le popover de modification de cet espace seulement", () => {
    ui().ouvrirMenuEspace("ws:1");
    ui().oublierEspace("ws:2");
    expect(ui().menuEspace).toBe("ws:1");
    ui().oublierEspace("ws:1");
    expect(ui().menuEspace).toBeNull();

    ui().ouvrirPopoverEspace({ mode: "modifier", wsId: "ws:4" });
    ui().oublierEspace("ws:4");
    expect(ui().popoverEspace).toBeNull();

    ui().ouvrirPopoverEspace({ mode: "creer" });
    ui().oublierEspace("ws:4");
    expect(ui().popoverEspace).toEqual({ mode: "creer" });
  });

  it("oublierGroupe ferme sa modification et fait retomber une création hors groupe", () => {
    ui().ouvrirFormulaireGroupe({ mode: "modifier", groupId: "grp:1" });
    ui().oublierGroupe("grp:1");
    expect(ui().formulaireGroupe).toBeNull();

    ui().ouvrirPopoverEspace({ mode: "creer", groupId: "grp:2" });
    ui().oublierGroupe("grp:2");
    expect(ui().popoverEspace).toEqual({ mode: "creer", groupId: null });

    ui().ouvrirMenuGroupe("grp:3");
    ui().oublierGroupe("grp:4");
    expect(ui().menuGroupe).toBe("grp:3");
    ui().oublierGroupe("grp:3");
    expect(ui().menuGroupe).toBeNull();
  });

  it("reset revient à l'état initial", () => {
    ui().setVue("mosaique");
    ui().basculerDock();
    ui().ouvrirPalette();
    ui().setBulleEspace("ws:1");
    ui().reset();
    expect(ui()).toMatchObject(initialUiState);
  });
});

describe("retour vers la mosaïque", () => {
  beforeEach(() => useUiStore.getState().reset());
  const ui = () => useUiStore.getState();

  it("armé pour un espace, désarmé par une autre vue, la bascule ou l'oubli de l'espace", () => {
    ui().armerRetourMosaique("ws:1");
    ui().setVue("terminal");
    expect(ui().retourMosaique).toBe("ws:1");
    ui().setVue("mosaique");
    expect(ui().retourMosaique).toBeNull();
    ui().armerRetourMosaique("ws:1");
    ui().basculerMosaique();
    expect(ui().retourMosaique).toBeNull();
    ui().armerRetourMosaique("ws:1");
    ui().oublierEspace("ws:2");
    expect(ui().retourMosaique).toBe("ws:1");
    ui().oublierEspace("ws:1");
    expect(ui().retourMosaique).toBeNull();
  });

  it("désarmer sans rien d'armé ne notifie personne", () => {
    const avant = useUiStore.getState();
    ui().desarmerRetourMosaique();
    expect(useUiStore.getState()).toBe(avant);
  });
});

describe("Paramètres", () => {
  beforeEach(() => useUiStore.getState().reset());

  it("s'ouvrent sur la dernière section et ferment les calques légers", () => {
    const ui = () => useUiStore.getState();
    ui().ouvrirPalette();
    ui().ouvrirParametres("superviseur", ["supOn"]);
    expect(ui().parametres).toEqual({ section: "superviseur", surbrillance: ["supOn"] });
    expect(ui().paletteOuverte).toBe(false);
    ui().fermerParametres();
    expect(ui().parametres).toBeNull();
    ui().basculerParametres();
    expect(ui().parametres).toEqual({ section: "superviseur", surbrillance: [] });
    ui().basculerParametres();
    expect(ui().parametres).toBeNull();
    ui().ouvrirParametres();
    expect(ui().parametres?.section).toBe("superviseur");
  });
});

