/** Racine d'un nom de copie : « app 3 » → « app ». Un nom entièrement
    numérique (« 42 ») n'a pas de suffixe : il EST sa propre racine. */
function root(name: string): string {
  const m = /^(.*\S)\s+\d+$/.exec(name);
  return m ? m[1] : name;
}

/**
 * Nom de la copie d'un workspace : la racine de `name` suivie du premier rang
 * libre à partir de 2 (le nom nu compte pour le rang 1). Dupliquer « app 2 »
 * donne donc « app 3 », jamais « app 2 2 », et un rang libéré par une fermeture
 * est réutilisé avant d'en ouvrir un nouveau.
 */
export function nextCopyName(name: string, existing: readonly string[]): string {
  const base = root(name.trim());
  const used = new Set<number>();
  for (const e of existing) {
    const t = e.trim();
    if (t === base) used.add(1);
    else if (root(t) === base) used.add(Number(t.slice(base.length).trim()));
  }
  let n = 2;
  while (used.has(n)) n++;
  return `${base} ${n}`;
}
