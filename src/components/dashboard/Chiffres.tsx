export interface Chiffre {
  label: string;
  valeur: string;
  sous: string;
  /** Valeur en vert (« tout est saisi »). */
  succes?: boolean;
}

/**
 * Bandeau de chiffres de la journée, entre deux filets : intertitre, valeur en
 * JetBrains Mono 21 px, précision discrète. Liste de description pour les lecteurs
 * d'écran (libellé → valeur).
 */
export function Chiffres({ chiffres }: { chiffres: Chiffre[] }) {
  return (
    <dl className="rc-chiffres">
      {chiffres.map((c) => (
        <div key={c.label} className="rc-chiffre">
          <dt className="rc-intertitre">{c.label}</dt>
          <dd className="rc-chiffre-valeur" data-succes={c.succes ?? false}>
            {c.valeur}
          </dd>
          <dd className="rc-chiffre-sous">{c.sous}</dd>
        </div>
      ))}
    </dl>
  );
}
