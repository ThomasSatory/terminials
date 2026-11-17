/**
 * Contextes WebGL des terminaux, en nombre borné.
 *
 * Un navigateur ne garde qu'une poignée de contextes WebGL vivants par page (16 sous
 * Chrome, moins sur certains pilotes) : au-delà, il sacrifie le plus ancien sans
 * prévenir (« context lost », puis « not restored »). Avec dix terminaux ou plus, tous
 * montés en permanence (keep-alive), xterm perdait ainsi ses contextes au hasard. On en
 * garde donc au plus `MAX_CONTEXTES_WEBGL`, attribués aux terminaux montrés le plus
 * récemment : un terminal qui reste caché longtemps rend le sien et repasse au rendu DOM
 * (identique à l'écran, juste plus lent), puis le reprend quand il redevient visible.
 */

export const MAX_CONTEXTES_WEBGL = 8;

/** Terminaux qui tiennent un contexte, du moins au plus récemment montré. */
const tenants = new Map<string, () => void>();

/**
 * Le terminal `tabId` tient (ou vient de prendre) un contexte : il passe en tête des plus
 * récents. Si la borne est dépassée, le plus ancien est libéré via son `liberer`.
 */
export function reserverWebgl(tabId: string, liberer: () => void, max = MAX_CONTEXTES_WEBGL): void {
  tenants.delete(tabId);
  tenants.set(tabId, liberer);
  while (tenants.size > max) {
    const [plusAncien, rendre] = tenants.entries().next().value as [string, () => void];
    tenants.delete(plusAncien);
    rendre();
  }
}

/** Le terminal a perdu ou rendu son contexte (perte du pilote, démontage). */
export function oublierWebgl(tabId: string): void {
  tenants.delete(tabId);
}

/** Terminaux qui tiennent un contexte, du plus ancien au plus récent (tests). */
export function tenantsWebgl(): string[] {
  return [...tenants.keys()];
}

/** Remise à zéro (tests). */
export function viderWebgl(): void {
  tenants.clear();
}
