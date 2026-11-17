import { useEffect, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from "react";

/**
 * Contrôles du langage Dock pour la vue Paramètres (maquette Parametres) : interrupteur,
 * segments à indicateur glissant, pastilles de couleur, pas à pas, champs. Vrais
 * éléments de formulaire, nommés (aria-label), au clavier : un groupe de choix est un
 * `radiogroup` à tabulation unique, parcouru aux flèches.
 */

/** Flèches d'un radiogroup : rang suivant (bouclé), ou null si la touche n'en est pas une. */
export function rangFleche(cle: string, rang: number, n: number): number | null {
  if (n <= 0) return null;
  if (cle === "ArrowRight" || cle === "ArrowDown") return (rang + 1) % n;
  if (cle === "ArrowLeft" || cle === "ArrowUp") return (rang - 1 + n) % n;
  if (cle === "Home") return 0;
  if (cle === "End") return n - 1;
  return null;
}

/** Clavier d'un radiogroup : la flèche choisit l'option voisine et lui donne le focus. */
export function useClavierRadio(n: number, rang: number, choisir: (i: number) => void) {
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const surClavier = (e: KeyboardEvent<HTMLElement>) => {
    const suivant = rangFleche(e.key, Math.max(0, rang), n);
    if (suivant === null) return;
    e.preventDefault();
    e.stopPropagation();
    choisir(suivant);
    refs.current[suivant]?.focus();
  };
  const ref = (i: number) => (el: HTMLButtonElement | null) => {
    refs.current[i] = el;
  };
  return { surClavier, ref };
}

export function Interrupteur({ actif, libelle, onChange }: { actif: boolean; libelle: string; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      className="par-inter"
      aria-checked={actif}
      aria-label={libelle}
      onClick={() => onChange(!actif)}
    >
      <span aria-hidden="true" />
    </button>
  );
}

export interface OptionSegment<T> {
  valeur: T;
  libelle: string;
}

export function Segments<T>({
  libelle,
  options,
  valeur,
  onChange,
  mono = false,
}: {
  libelle: string;
  options: readonly OptionSegment<T>[];
  valeur: T;
  onChange: (v: T) => void;
  mono?: boolean;
}) {
  const n = options.length;
  const rang = Math.max(
    0,
    options.findIndex((o) => o.valeur === valeur),
  );
  const choisir = (i: number) => {
    if (options[i].valeur !== valeur) onChange(options[i].valeur);
  };
  const clavier = useClavierRadio(n, rang, choisir);
  return (
    <div
      role="radiogroup"
      aria-label={libelle}
      className="par-seg"
      data-mono={mono || undefined}
      style={{ gridTemplateColumns: `repeat(${n}, 1fr)` } as CSSProperties}
      onKeyDown={clavier.surClavier}
    >
      <span
        aria-hidden="true"
        className="par-seg-indic"
        style={{ width: `calc((100% - 6px) / ${n})`, transform: `translateX(${rang * 100}%)` }}
      />
      {options.map((o, i) => (
        <button
          key={String(o.valeur)}
          ref={clavier.ref(i)}
          type="button"
          role="radio"
          className="par-seg-opt"
          aria-checked={i === rang}
          tabIndex={i === rang ? 0 : -1}
          onClick={() => choisir(i)}
        >
          {o.libelle}
        </button>
      ))}
    </div>
  );
}

export function Coche({ taille = 12, epaisseur = 2.2 }: { taille?: number; epaisseur?: number }) {
  return (
    <svg aria-hidden="true" width={taille} height={taille} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth={epaisseur} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 8.5l3.2 3L13 4.5" />
    </svg>
  );
}

export function Pastilles({
  libelle,
  options,
  valeur,
  onChange,
}: {
  libelle: string;
  options: readonly { nom: string; couleur: string }[];
  valeur: string;
  onChange: (couleur: string, nom: string) => void;
}) {
  const rang = options.findIndex((o) => o.couleur.toLowerCase() === valeur.toLowerCase());
  const choisir = (i: number) => {
    if (i !== rang) onChange(options[i].couleur, options[i].nom);
  };
  const clavier = useClavierRadio(options.length, rang, choisir);
  return (
    <div role="radiogroup" aria-label={libelle} className="par-pastilles" onKeyDown={clavier.surClavier}>
      {options.map((o, i) => {
        const on = i === rang;
        return (
          <button
            key={o.couleur}
            ref={clavier.ref(i)}
            type="button"
            role="radio"
            className="par-pastille"
            aria-checked={on}
            aria-label={o.nom}
            title={o.nom}
            tabIndex={on || (rang === -1 && i === 0) ? 0 : -1}
            style={{ background: o.couleur, color: "var(--texte-sur-accent)", "--par-pastille": o.couleur } as CSSProperties}
            onClick={() => choisir(i)}
          >
            {on && <Coche />}
          </button>
        );
      })}
    </div>
  );
}

export function PasAPas({
  libelle,
  valeur,
  min,
  max,
  unite,
  onChange,
}: {
  libelle: string;
  valeur: number;
  min: number;
  max: number;
  unite: string;
  onChange: (v: number) => void;
}) {
  return (
    <div role="group" aria-label={libelle} className="par-pas">
      <button type="button" className="hov" aria-label="Réduire la taille" disabled={valeur <= min} onClick={() => onChange(valeur - 1)}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M3.5 8h9" />
        </svg>
      </button>
      {/* Pas d'aria-live ici : la région role=status de la page annonce déjà le changement,
          une seconde annonce doublerait chaque clic. */}
      <span className="par-pas-valeur">
        {valeur} {unite}
      </span>
      <button type="button" className="hov" aria-label="Augmenter la taille" disabled={valeur >= max} onClick={() => onChange(valeur + 1)}>
        <svg aria-hidden="true" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </button>
    </div>
  );
}

/**
 * Brouillon d'un champ dont la valeur enregistrée est normalisée (rognée, bornée,
 * complétée par un défaut) : la saisie affiche ce qu'on tape, la valeur part aussitôt, et
 * le champ reprend la valeur enregistrée quand il perd le focus (ou si elle change
 * ailleurs pendant qu'on n'y est pas).
 */
function useBrouillon(valeur: string) {
  const [brouillon, setBrouillon] = useState(valeur);
  const focus = useRef(false);
  useEffect(() => {
    if (!focus.current) setBrouillon(valeur);
  }, [valeur]);
  return {
    brouillon,
    setBrouillon,
    onFocus: () => {
      focus.current = true;
    },
    onBlur: () => {
      focus.current = false;
      setBrouillon(valeur);
    },
  };
}

export function ChampTexte({
  libelle,
  valeur,
  onChange,
  placeholder,
  largeur = 220,
  mono = true,
  type = "text",
  maxLength,
}: {
  libelle: string;
  valeur: string;
  onChange: (v: string) => void;
  placeholder?: string;
  largeur?: number;
  mono?: boolean;
  type?: "text" | "password";
  maxLength?: number;
}) {
  const b = useBrouillon(valeur);
  return (
    <input
      className="par-champ"
      data-mono={mono || undefined}
      type={type}
      aria-label={libelle}
      placeholder={placeholder}
      value={b.brouillon}
      maxLength={maxLength}
      spellCheck={false}
      autoComplete="off"
      style={{ width: largeur }}
      onFocus={b.onFocus}
      onBlur={b.onBlur}
      onChange={(e) => {
        b.setBrouillon(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

export function ZoneTexte({
  libelle,
  valeur,
  onChange,
  placeholder,
}: {
  libelle: string;
  valeur: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  const b = useBrouillon(valeur);
  return (
    <textarea
      className="par-champ par-zone"
      aria-label={libelle}
      placeholder={placeholder}
      rows={3}
      value={b.brouillon}
      spellCheck={false}
      onFocus={b.onFocus}
      onBlur={b.onBlur}
      onChange={(e) => {
        b.setBrouillon(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

export function ChampNombre({
  libelle,
  valeur,
  onChange,
}: {
  libelle: string;
  valeur: string;
  onChange: (v: string) => void;
}) {
  const b = useBrouillon(valeur);
  return (
    <input
      className="par-champ par-nombre"
      data-mono=""
      type="number"
      min={0}
      max={24}
      step={0.25}
      aria-label={libelle}
      value={b.brouillon}
      onFocus={b.onFocus}
      onBlur={b.onBlur}
      onChange={(e) => {
        b.setBrouillon(e.target.value);
        onChange(e.target.value);
      }}
    />
  );
}

/** Combinaisons de touches (« Ctrl » « Maj » « N » / « Ctrl » « Maj » « Entrée »). */
export function Touches({ combos }: { combos: readonly (readonly string[])[] }) {
  return (
    <span className="par-touches">
      {combos.map((c, i) => (
        <span key={i} className="par-touches-combo">
          {i > 0 && <span className="par-touches-sep">/</span>}
          {c.map((t, k) => (
            <kbd key={k} className="par-kbd">
              {t}
            </kbd>
          ))}
        </span>
      ))}
    </span>
  );
}

/** Bouton secondaire de la maquette (« Relever », « Ouvrir le dossier »). */
export function BoutonAction({
  onClick,
  icone,
  enCours = false,
  children,
}: {
  onClick: () => void;
  icone?: string;
  enCours?: boolean;
  children: ReactNode;
}) {
  return (
    <button type="button" className="hov par-action" aria-busy={enCours || undefined} onClick={onClick}>
      {enCours ? (
        <span className="par-spin" aria-hidden="true" />
      ) : (
        icone && (
          <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            <path d={icone} />
          </svg>
        )
      )}
      {children}
    </button>
  );
}
