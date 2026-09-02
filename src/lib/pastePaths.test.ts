import { describe, it, expect } from "vitest";
import { quotePathForShell, formatPathsForPrompt, extFromMime } from "./pastePaths";

describe("quotePathForShell", () => {
  it("chemin sans caractère spécial → inchangé (pas de quotes parasites)", () => {
    expect(quotePathForShell("/tmp/terminials-images/pasted-1.png")).toBe(
      "/tmp/terminials-images/pasted-1.png",
    );
  });

  it("espace → quotes simples", () => {
    expect(quotePathForShell("/tmp/mon dossier/a.png")).toBe("'/tmp/mon dossier/a.png'");
  });

  it("apostrophe → échappement '\\'' (jamais de quote qui se referme)", () => {
    expect(quotePathForShell("/tmp/l'image.png")).toBe("'/tmp/l'\\''image.png'");
  });

  it("substitution de commande → quotée, donc inerte pour le shell", () => {
    expect(quotePathForShell("/tmp/$(rm -rf ~).png")).toBe("'/tmp/$(rm -rf ~).png'");
  });
});

describe("formatPathsForPrompt", () => {
  it("un chemin → chemin + espace final (le prompt reste éditable)", () => {
    expect(formatPathsForPrompt(["/tmp/a.png"])).toBe("/tmp/a.png ");
  });

  it("plusieurs chemins → séparés par un espace", () => {
    expect(formatPathsForPrompt(["/tmp/a.png", "/tmp/b c.png"])).toBe("/tmp/a.png '/tmp/b c.png' ");
  });

  it("aucun chemin → chaîne vide (rien n'est écrit dans le PTY)", () => {
    expect(formatPathsForPrompt([])).toBe("");
  });
});

describe("extFromMime", () => {
  it("image/png → png", () => {
    expect(extFromMime("image/png")).toBe("png");
  });

  it("image/jpeg → jpeg", () => {
    expect(extFromMime("image/jpeg")).toBe("jpeg");
  });

  it("suffixe structuré retiré (image/svg+xml → svg ; l'allowlist Rust tranchera)", () => {
    expect(extFromMime("image/svg+xml")).toBe("svg");
  });

  it("paramètres ignorés (image/png;charset=binary → png)", () => {
    expect(extFromMime("image/png;charset=binary")).toBe("png");
  });

  it("type non image → null (rien n'est envoyé au backend)", () => {
    expect(extFromMime("text/plain")).toBeNull();
  });

  it("type absent → null", () => {
    expect(extFromMime("")).toBeNull();
  });
});
