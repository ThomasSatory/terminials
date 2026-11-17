/**
 * Menu contextuel natif de la webview. Sans garde, un clic droit là où l'app n'a pas son
 * propre menu (séparateur du dock, fond d'une vue, barre du haut…) ouvre le menu de
 * navigation de WebKitGTK (« Back / Forward / Stop / Reload ») : rien que l'utilisateur
 * puisse vouloir dans une app, et « Reload » y relancerait la page, terminaux compris.
 *
 * Le menu natif n'est laissé qu'aux champs de saisie (input texte, textarea,
 * contenteditable), où il sert à couper, copier, coller. Le terminal a le sien
 * (MenuTerminal : Copier, Coller, Tout sélectionner), ouvert par TerminalPane : le menu
 * natif y est refusé, y compris sur le textarea caché que xterm glisse sous le pointeur.
 * Les menus de l'app (avatar, groupe, terminal…) ouvrent les leurs dans leur propre
 * gestionnaire ; l'écouteur posé ici, sur le document, passe après eux et n'arrête pas la
 * propagation.
 */

/** Types d'input où l'on tape du texte (les autres — case, bouton, curseur… — n'ont rien
    à couper ni coller). */
const INPUTS_TEXTE = new Set(["", "text", "search", "url", "tel", "email", "password", "number"]);

/** Vrai si le menu natif garde son utilité sous `cible` (édition de texte). */
export function menuNatifUtile(cible: EventTarget | null): boolean {
  if (typeof Element === "undefined" || !(cible instanceof Element)) return false;
  if (cible.closest(".xterm")) return false;
  const champ = cible.closest("input, textarea, [contenteditable]");
  if (!champ) return false;
  if (champ instanceof HTMLInputElement) return INPUTS_TEXTE.has(champ.type.toLowerCase());
  if (champ instanceof HTMLTextAreaElement) return true;
  return (champ as HTMLElement).isContentEditable;
}

/** Pose la garde sur le document ; renvoie de quoi la retirer. */
export function neutraliserMenuNatif(doc: Document = document): () => void {
  const garde = (e: MouseEvent) => {
    if (!menuNatifUtile(e.target)) e.preventDefault();
  };
  doc.addEventListener("contextmenu", garde);
  return () => doc.removeEventListener("contextmenu", garde);
}
