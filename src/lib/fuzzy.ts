/**
 * Recherche floue pure pour la palette de commandes : les lettres de la requête doivent
 * apparaître dans l'ordre dans le texte (« nvespace » trouve « Nouvel espace »), sans
 * tenir compte de la casse ni des accents. Plus de points quand les lettres se suivent,
 * tombent en début de mot ou près du début ; la requête découpée sur les espaces est un
 * ET (chaque mot doit trouver sa place), « nouv esp » trouve donc aussi « Nouvel espace ».
 */

export interface CorrespondanceFloue {
  /** Plus grand = meilleur ; 0 pour une requête vide. */
  score: number;
  /** Positions (dans le texte d'origine) des lettres trouvées, triées, sans doublon. */
  indices: number[];
}

/**
 * Minuscule sans accent, caractère par caractère : la longueur reste celle du texte
 * d'origine, pour que les positions trouvées servent directement à surligner.
 */
export function normaliser(texte: string): string {
  let out = "";
  for (const c of texte) {
    const base = c.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    // Une lettre hors BMP (2 unités) ou qui se décompose en plusieurs : on garde la
    // longueur en unités du caractère d'origine.
    out += base.length === c.length ? base : c.toLowerCase().padEnd(c.length, " ").slice(0, c.length);
  }
  return out;
}

const alphaNum = (c: string): boolean => /[\p{L}\p{N}]/u.test(c);

/** Meilleur placement d'UN mot dans le texte (programmation dynamique, textes courts). */
function placerMot(mot: string, texte: string): CorrespondanceFloue | null {
  const n = texte.length;
  const m = mot.length;
  if (m === 0) return { score: 0, indices: [] };
  if (m > n) return null;

  // best[j][i] : meilleur score avec mot[j] posé sur texte[i] ; prev pour remonter.
  const best: number[][] = Array.from({ length: m }, () => new Array(n).fill(-Infinity));
  const prev: number[][] = Array.from({ length: m }, () => new Array(n).fill(-1));

  for (let j = 0; j < m; j++) {
    for (let i = j; i < n; i++) {
      if (texte[i] !== mot[j]) continue;
      const debutDeMot = i === 0 || !alphaNum(texte[i - 1]);
      const gain = 1 + (debutDeMot ? 8 : 0);
      if (j === 0) {
        best[0][i] = gain - Math.min(i, 10) * 0.3;
        continue;
      }
      for (let k = j - 1; k < i; k++) {
        const base = best[j - 1][k];
        if (base === -Infinity) continue;
        const liaison = k === i - 1 ? 6 : -Math.min(i - k - 1, 5) * 0.5;
        const cand = base + gain + liaison;
        if (cand > best[j][i]) {
          best[j][i] = cand;
          prev[j][i] = k;
        }
      }
    }
  }

  let fin = -1;
  for (let i = 0; i < n; i++) {
    if (best[m - 1][i] > (fin === -1 ? -Infinity : best[m - 1][fin])) fin = i;
  }
  if (fin === -1) return null;

  const indices: number[] = [];
  for (let j = m - 1, i = fin; j >= 0; j--) {
    indices.push(i);
    i = prev[j][i];
  }
  indices.reverse();

  let score = best[m - 1][fin];
  if (texte.startsWith(mot)) score += 10; // préfixe franc
  if (texte === mot) score += 10;
  return { score, indices };
}

/**
 * Compare la requête à un texte. `null` = pas de correspondance. Requête vide : tout
 * passe avec un score nul (l'appelant garde alors son ordre naturel).
 */
export function scoreFloue(requete: string, texte: string): CorrespondanceFloue | null {
  const mots = normaliser(requete).split(/\s+/).filter(Boolean);
  if (mots.length === 0) return { score: 0, indices: [] };
  const t = normaliser(texte);
  let score = 0;
  const indices = new Set<number>();
  for (const mot of mots) {
    const r = placerMot(mot, t);
    if (!r) return null;
    score += r.score;
    for (const i of r.indices) indices.add(i);
  }
  return { score, indices: [...indices].sort((a, b) => a - b) };
}

/**
 * Filtre et classe : meilleur score d'abord, ex æquo dans l'ordre d'origine. `textes`
 * donne les champs cherchables d'un élément avec un poids (1 = champ principal ; un
 * champ secondaire, comme la branche, compte moins). Les indices rendus sont ceux du
 * PREMIER champ (celui qu'on surligne), vides si seul un champ secondaire a trouvé.
 */
export function classerFlou<T>(
  items: readonly T[],
  requete: string,
  textes: (item: T) => ReadonlyArray<{ texte: string; poids?: number }>,
): Array<{ item: T; score: number; indices: number[] }> {
  const vide = normaliser(requete).trim() === "";
  const out: Array<{ item: T; score: number; indices: number[]; ordre: number }> = [];
  items.forEach((item, ordre) => {
    if (vide) {
      out.push({ item, score: 0, indices: [], ordre });
      return;
    }
    let meilleur: { score: number; indices: number[] } | null = null;
    textes(item).forEach((champ, rang) => {
      const r = scoreFloue(requete, champ.texte);
      if (!r) return;
      const score = r.score * (champ.poids ?? 1);
      if (!meilleur || score > meilleur.score) {
        meilleur = { score, indices: rang === 0 ? r.indices : [] };
      }
    });
    if (meilleur) {
      const { score, indices } = meilleur;
      out.push({ item, score, indices, ordre });
    }
  });
  out.sort((a, b) => b.score - a.score || a.ordre - b.ordre);
  return out.map(({ item, score, indices }) => ({ item, score, indices }));
}
