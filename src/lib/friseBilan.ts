/**
 * Appariement des puces du bilan (prompt v3, cf. `summaries.rs`) aux lignes de
 * la frise : chaque puce commence par le nom d'un projet — le même
 * `workspace_name(dir)` côté digest et côté stats — suivi d'un séparateur.
 * La frise affiche alors la phrase sous la ligne du projet ; ce qui ne se
 * rattache à aucune ligne reste dans `autres`, rendu tel quel par le panneau
 * Bilan. Fonction pure, tolérante : « Sur X, », gras, casse, `—` ou `:`.
 */

const ITEM_RE = /^(?:[-*•]\s+|\d+[.)]\s+)/;
/** Après le nom : fermeture de gras optionnelle, puis `:` `,` `—` `–` ou ` - `. */
const SEPARATEUR_RE = /^\s*\**\s*(?:[:,]\s*|[—–]\s*|-\s+)(.*)$/s;

export interface PucesAttachees {
  /** Phrase(s) par nom de projet, première lettre en majuscule. */
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

export function attacherPuces(body: string, names: string[]): PucesAttachees {
  const phrases = new Map<string, string>();
  const autres: string[] = [];
  // Le nom le plus long d'abord : « backend-tests » avant « backend ».
  const noms = [...names].sort((a, b) => b.length - a.length);
  for (const ligne of body.split("\n")) {
    const trim = ligne.trim();
    if (trim === "") continue;
    if (!ITEM_RE.test(trim)) {
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
  return { phrases, autres: autres.join("\n") };
}
