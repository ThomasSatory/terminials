/**
 * Appariement du bilan (cf. `summaries.rs`) aux lignes de la frise, par le nom
 * du projet — le même `workspace_name(dir)` côté digest et côté stats.
 *
 * - Prompt v4 : une section `## projet` par projet, suivie de ses puces ; la
 *   frise affiche ces puces (markdown) sous la ligne du projet.
 * - Prompt v3 (synthèses encore en cache) : une puce par projet, qui commence
 *   par son nom suivi d'un séparateur ; la frise en affiche la phrase.
 *
 * Ce qui ne se rattache à aucune ligne reste dans `autres`, rendu tel quel par
 * le panneau Bilan. Fonction pure, tolérante : « Sur X, », gras, casse, `—`
 * ou `:`.
 */

const SECTION_RE = /^#{1,3}\s+(.*)$/;
const ITEM_RE = /^(?:[-*•]\s+|\d+[.)]\s+)/;
/** Après le nom : fermeture de gras optionnelle, puis `:` `,` `—` `–` ou ` - `. */
const SEPARATEUR_RE = /^\s*\**\s*(?:[:,]\s*|[—–]\s*|-\s+)(.*)$/s;

export interface PucesAttachees {
  /** Texte par nom de projet, en markdown : puces (v4) ou phrase (v3). */
  phrases: Map<string, string>;
  /** Lignes non rattachées (puces d'autres projets, paragraphes), en markdown. */
  autres: string;
}

function capitaliser(s: string): string {
  return s.length === 0 ? s : s[0].toUpperCase() + s.slice(1);
}

function apparier(texte: string, nomsLongsDAbord: string[]): { name: string; phrase: string } | null {
  const t = texte.replace(/^\*+/, "").replace(/^sur\s+/i, "");
  const lower = t.toLowerCase();
  for (const name of nomsLongsDAbord) {
    if (!lower.startsWith(name.toLowerCase())) continue;
    const m = SEPARATEUR_RE.exec(t.slice(name.length));
    if (!m) continue;
    return { name, phrase: capitaliser(m[1].trim()) };
  }
  return null;
}

/** Projet dont la section porte le nom, seul ou suivi d'un complément (« backend (…) »). */
function nomDeSection(titre: string, nomsLongsDAbord: string[]): string | null {
  const t = titre.replace(/\*+/g, "").replace(/[\s:]+$/, "").trim().toLowerCase();
  for (const name of nomsLongsDAbord) {
    const n = name.toLowerCase();
    if (t === n || t.startsWith(`${n} `)) return name;
  }
  return null;
}

export function attacherPuces(body: string, names: string[]): PucesAttachees {
  const phrases = new Map<string, string>();
  const sections = new Map<string, string[]>();
  const autres: string[] = [];
  // Le nom le plus long d'abord : « backend-tests » avant « backend ».
  const noms = [...names].sort((a, b) => b.length - a.length);
  // Section `##` en cours : un projet, `null` si elle n'en nomme aucun, ou
  // `undefined` avant la première.
  let section: string | null | undefined;
  for (const ligne of body.split("\n")) {
    const trim = ligne.trim();
    if (trim === "") continue;
    const titre = SECTION_RE.exec(trim);
    if (titre) {
      section = nomDeSection(titre[1], noms);
      if (section === null) autres.push(ligne);
      continue;
    }
    if (typeof section === "string") {
      const lignes = sections.get(section) ?? [];
      lignes.push(trim);
      sections.set(section, lignes);
      continue;
    }
    if (section === null || !ITEM_RE.test(trim)) {
      autres.push(ligne);
      continue;
    }
    const match = apparier(trim.replace(ITEM_RE, ""), noms);
    if (match === null) {
      autres.push(ligne);
      continue;
    }
    const deja = phrases.get(match.name);
    phrases.set(match.name, deja === undefined ? match.phrase : `${deja} ${match.phrase}`);
  }
  for (const [name, lignes] of sections) {
    const deja = phrases.get(name);
    phrases.set(name, deja === undefined ? lignes.join("\n") : `${deja}\n\n${lignes.join("\n")}`);
  }
  return { phrases, autres: autres.join("\n") };
}
