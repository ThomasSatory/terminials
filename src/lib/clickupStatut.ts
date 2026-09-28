/**
 * Ton d'affichage d'un état ClickUp. L'état est un libellé libre propre à
 * chaque espace : on reconnaît les familles usuelles, le reste est neutre.
 */
export type TonStatut = "bloque" | "revue" | "test" | "encours" | "fini" | "neutre";

const FAMILLES: Array<[RegExp, TonStatut]> = [
  [/bloqu|block/, "bloque"],
  [/review|revue|relecture/, "revue"],
  [/test|recette|qa|valid/, "test"],
  [/cours|progress|dev|doing/, "encours"],
  [/termin|done|clos|ferm|complete|livr/, "fini"],
];

export function tonStatut(status: string | null | undefined): TonStatut {
  const s = (status ?? "").toLowerCase();
  return FAMILLES.find(([re]) => re.test(s))?.[1] ?? "neutre";
}
