import { describe, it, expect } from "vitest";
import { parseUnifiedDiff } from "./diff";

/** Diff git classique : un fichier, un hunk (sortie réelle de `git diff --no-color`). */
const SIMPLE = [
  "diff --git a/f.txt b/f.txt",
  "index 1111111..2222222 100644",
  "--- a/f.txt",
  "+++ b/f.txt",
  "@@ -1,3 +1,4 @@",
  " un",
  "-deux",
  "+deux bis",
  "+trois",
  " quatre",
  "",
].join("\n");

const MULTI = [
  "diff --git a/m.ts b/m.ts",
  "index 3333333..4444444 100644",
  "--- a/m.ts",
  "+++ b/m.ts",
  "@@ -10,3 +10,3 @@ fn main()",
  " ctx1",
  "-a",
  "+b",
  " ctx1b",
  "@@ -40,1 +40,2 @@",
  " ctx2",
  "+c",
  "",
].join("\n");

const NO_NEWLINE = [
  "diff --git a/n.txt b/n.txt",
  "index 5555555..6666666 100644",
  "--- a/n.txt",
  "+++ b/n.txt",
  "@@ -1 +1 @@",
  "-ancien",
  "\\ No newline at end of file",
  "+nouveau",
  "\\ No newline at end of file",
  "",
].join("\n");

const BINARY = [
  "diff --git a/img.png b/img.png",
  "index 7777777..8888888 100644",
  "Binary files a/img.png and b/img.png differ",
  "",
].join("\n");

const TWO_FILES = [
  "diff --git a/a.txt b/a.txt",
  "--- a/a.txt",
  "+++ b/a.txt",
  "@@ -1 +1 @@",
  "-x",
  "+y",
  "diff --git a/b.txt b/b.txt",
  "--- a/b.txt",
  "+++ b/b.txt",
  "@@ -5 +5 @@",
  " z",
  "",
].join("\n");

/** Sortie de `git diff --no-index /dev/null <fichier>` pour un fichier untracked. */
const UNTRACKED = [
  "diff --git a/dev/null b/newfile.txt",
  "new file mode 100644",
  "index 0000000..257cc56",
  "--- /dev/null",
  "+++ b/newfile.txt",
  "@@ -0,0 +1,2 @@",
  "+l1",
  "+l2",
  "",
].join("\n");

describe("parseUnifiedDiff", () => {
  it("diff vide → []", () => {
    expect(parseUnifiedDiff("")).toEqual([]);
  });

  it("en-têtes diff --git / index / --- / +++ → meta (texte intégral conservé)", () => {
    expect(parseUnifiedDiff(SIMPLE).slice(0, 4)).toEqual([
      { kind: "meta", text: "diff --git a/f.txt b/f.txt" },
      { kind: "meta", text: "index 1111111..2222222 100644" },
      { kind: "meta", text: "--- a/f.txt" },
      { kind: "meta", text: "+++ b/f.txt" },
    ]);
  });

  it("hunk simple : numéros old/new corrects, marqueur retiré du texte", () => {
    expect(parseUnifiedDiff(SIMPLE).slice(4)).toEqual([
      { kind: "hunk", text: "@@ -1,3 +1,4 @@" },
      { kind: "ctx", oldNo: 1, newNo: 1, text: "un" },
      { kind: "del", oldNo: 2, text: "deux" },
      { kind: "add", newNo: 2, text: "deux bis" },
      { kind: "add", newNo: 3, text: "trois" },
      { kind: "ctx", oldNo: 3, newNo: 4, text: "quatre" },
    ]);
  });

  it("multi-hunks : les compteurs repartent de chaque en-tête @@ (suffixe de section conservé)", () => {
    expect(parseUnifiedDiff(MULTI).slice(4)).toEqual([
      { kind: "hunk", text: "@@ -10,3 +10,3 @@ fn main()" },
      { kind: "ctx", oldNo: 10, newNo: 10, text: "ctx1" },
      { kind: "del", oldNo: 11, text: "a" },
      { kind: "add", newNo: 11, text: "b" },
      { kind: "ctx", oldNo: 12, newNo: 12, text: "ctx1b" },
      { kind: "hunk", text: "@@ -40,1 +40,2 @@" },
      { kind: "ctx", oldNo: 40, newNo: 40, text: "ctx2" },
      { kind: "add", newNo: 41, text: "c" },
    ]);
  });

  it("« \\ No newline at end of file » → meta ; en-tête @@ sans virgule accepté", () => {
    expect(parseUnifiedDiff(NO_NEWLINE).slice(4)).toEqual([
      { kind: "hunk", text: "@@ -1 +1 @@" },
      { kind: "del", oldNo: 1, text: "ancien" },
      { kind: "meta", text: "\\ No newline at end of file" },
      { kind: "add", newNo: 1, text: "nouveau" },
      { kind: "meta", text: "\\ No newline at end of file" },
    ]);
  });

  it("Binary files … differ → tout en meta, pas de crash", () => {
    expect(parseUnifiedDiff(BINARY)).toEqual([
      { kind: "meta", text: "diff --git a/img.png b/img.png" },
      { kind: "meta", text: "index 7777777..8888888 100644" },
      { kind: "meta", text: "Binary files a/img.png and b/img.png differ" },
    ]);
  });

  it("deuxième fichier : diff --git re-bascule en meta (---/+++ ne deviennent pas del/add)", () => {
    const lines = parseUnifiedDiff(TWO_FILES);
    expect(lines[6]).toEqual({ kind: "meta", text: "diff --git a/b.txt b/b.txt" });
    expect(lines[7]).toEqual({ kind: "meta", text: "--- a/b.txt" });
    expect(lines[8]).toEqual({ kind: "meta", text: "+++ b/b.txt" });
    expect(lines[10]).toEqual({ kind: "ctx", oldNo: 5, newNo: 5, text: "z" });
  });

  it("fichier untracked via --no-index : nouvelles lignes numérotées depuis 1", () => {
    expect(parseUnifiedDiff(UNTRACKED).slice(5)).toEqual([
      { kind: "hunk", text: "@@ -0,0 +1,2 @@" },
      { kind: "add", newNo: 1, text: "l1" },
      { kind: "add", newNo: 2, text: "l2" },
    ]);
  });
});
