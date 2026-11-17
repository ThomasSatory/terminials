import { useCallback, useLayoutEffect, useRef } from "react";

/**
 * Rappel d'identité stable qui appelle toujours la DERNIÈRE version de `fn`.
 *
 * Le dock passe ses rappels à des avatars mémoïsés : une fermeture neuve à chaque rendu
 * les re-rendrait tous. Celui-ci ne change jamais, et lit pourtant l'état du dernier
 * rendu (espace ouvert, glisser en cours). À n'appeler que depuis un gestionnaire
 * d'événement, jamais pendant le rendu (la ref y serait d'un rendu en retard).
 */
export function useRappelStable<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R {
  const ref = useRef(fn);
  useLayoutEffect(() => {
    ref.current = fn;
  });
  return useCallback((...args: A) => ref.current(...args), []);
}
