import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import type { Inline } from "../../lib/markdownLite";
import { IconeChevronDroit, IconeCoche } from "../ui/icons";
import { IconeCopierDaily } from "./icones";
import { Ticket } from "./Ticket";
import { duree, compte, drapeauSection, type Etiquette, type Puce } from "../../lib/recapModele";

export interface SectionVue {
  /** Dossier de l'espace (clé), ou `""` pour ce qui ne se rattache à aucun projet. */
  dir: string;
  name: string;
  couleur: string;
  monogramme: string;
  /** Branche affichée sous le nom (« hors dépôt » sans branche). */
  branche: string;
  minutes: number;
  commits: number;
  puces: Puce[];
}

/** État du bilan rédigé, tel que la liste doit le refléter. */
export type EtatBilan = "chargement" | "absent" | "ok" | "erreur";

/** Un lien du bilan dont le libellé est un identifiant (« ABC-123 ») devient une pastille. */
const ID_TICKET = /^[A-Za-z0-9#_-]{2,24}$/;

function enLigne(inl: Inline[], noms: Map<string, string>, onOpen: (url: string) => void): ReactNode {
  return inl.map((n, i) => {
    switch (n.t) {
      case "text":
        return <Fragment key={i}>{n.v}</Fragment>;
      case "bold":
        return <strong key={i}>{n.v}</strong>;
      case "code":
        return <code key={i}>{n.v}</code>;
      case "link":
        return ID_TICKET.test(n.text) ? (
          <Ticket key={i} id={n.text} url={n.href} titre={noms.get(n.text)} onOpen={onOpen} className="rc-tk-puce" />
        ) : (
          <a
            key={i}
            className="rc-lien"
            href={n.href}
            onClick={(e) => {
              e.preventDefault();
              onOpen(n.href);
            }}
          >
            {n.text}
          </a>
        );
    }
  });
}

function EtiquettePuce({ e, className }: { e: Etiquette; className: string }) {
  return (
    <span className={className} data-etiquette={e}>
      {e}
    </span>
  );
}

/**
 * « Bilan par projet » : une section repliable par espace actif (avatar, nom,
 * branche, temps et commits), ses puces rédigées par l'agent, avec pastilles de
 * tickets et étiquettes (bloqué, en attente, en cours) ; une section repliée garde
 * son drapeau visible. En tête, « Tout replier » et « Copier pour le daily ».
 */
export function BilanProjets({
  sections,
  etat,
  fermes,
  onBasculer,
  onTout,
  focus,
  noms,
  onOpen,
  texteDaily,
}: {
  sections: SectionVue[];
  etat: EtatBilan;
  fermes: Record<string, boolean>;
  onBasculer: (dir: string) => void;
  /** Replie tout (true) ou déplie tout (false). */
  onTout: (replier: boolean) => void;
  focus: string | null;
  noms: Map<string, string>;
  onOpen: (url: string) => void;
  texteDaily: string[];
}) {
  const [copie, setCopie] = useState<"non" | "ok" | "echec">("non");
  // Préfixe des ids de plis : le chemin du dossier ne convient pas (une espace
  // casserait la liste d'IDREF d'aria-controls).
  const idBase = useId();
  const minuterie = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(minuterie.current), []);

  const copier = () => {
    const fin = (r: "ok" | "echec") => {
      setCopie(r);
      clearTimeout(minuterie.current);
      minuterie.current = setTimeout(() => setCopie("non"), 2600);
    };
    try {
      navigator.clipboard.writeText(texteDaily.join("\n")).then(
        () => fin("ok"),
        () => fin("echec"),
      );
    } catch {
      fin("echec");
    }
  };

  const unOuvert = sections.some((s) => !fermes[s.dir]);
  const rienACopier = etat !== "ok" || sections.every((s) => s.puces.length === 0);

  return (
    <section aria-label="Bilan par projet" className="rc-bilan">
      <div className="rc-bilan-tete">
        <div className="rc-titre-ligne rc-bilan-titre">
          <h2 className="rc-intertitre">Bilan par projet</h2>
          <span className="rc-sous">l’aide-mémoire du point quotidien</span>
        </div>
        {sections.length > 0 && (
          <button type="button" className="rc-replier hov" onClick={() => onTout(unOuvert)}>
            {unOuvert ? "Tout replier" : "Tout déplier"}
          </button>
        )}
        <button
          type="button"
          className="rc-copier"
          data-copie={copie === "ok"}
          disabled={rienACopier}
          onClick={copier}
        >
          {copie === "ok" ? <IconeCoche taille={14} epaisseur={1.9} className="rc-coche" /> : <IconeCopierDaily />}
          {copie === "ok" ? "Copié" : "Copier pour le daily"}
        </button>
      </div>
      {copie !== "non" && (
        <p role="status" className="rc-copie-note" data-echec={copie === "echec"}>
          {copie === "ok"
            ? `${texteDaily.length} lignes dans le presse-papier, projet par projet, prêtes à coller au point quotidien.`
            : "Le presse-papier a refusé la copie."}
        </p>
      )}

      <div className="rc-bilan-liste">
        {sections.length === 0 && <p className="rc-vide">Aucun projet actif sur cette période.</p>}
        {sections.map((s, i) => {
          const ouvert = !fermes[s.dir];
          const drapeau = ouvert ? null : drapeauSection(s.puces);
          const idCorps = `${idBase}-pli-${i}`;
          return (
            <div key={s.dir} className="rc-projet">
              <button
                type="button"
                className="rc-projet-tete hov"
                aria-expanded={ouvert}
                aria-controls={idCorps}
                style={focus === s.dir ? { background: `${s.couleur}12` } : undefined}
                onClick={() => onBasculer(s.dir)}
              >
                <span aria-hidden="true" className="rc-mono rc-mono-grand" style={{ background: `${s.couleur}18`, color: s.couleur }}>
                  {s.monogramme}
                </span>
                <span className="rc-projet-nom">
                  <span className="rc-projet-titre">{s.name}</span>
                  <span className="rc-projet-branche">{s.branche}</span>
                </span>
                {drapeau && <EtiquettePuce e={drapeau} className="rc-drapeau" />}
                <span className="rc-projet-meta">
                  {s.dir === "" ? "" : `${duree(s.minutes)} · ${compte(s.commits, "commit", "commits")}`}
                </span>
                <IconeChevronDroit taille={14} className="rc-chev" data-ouvert={ouvert} />
              </button>
              {/* Replié : `inert` sort les liens du pli de l'ordre de tabulation. */}
              <div id={idCorps} className="rc-pli" data-ouvert={ouvert} inert={!ouvert}>
                <div>
                  <ul className="rc-puces">
                    {etat === "chargement" && <li className="rc-squelette" />}
                    {etat !== "chargement" && s.puces.length === 0 && (
                      <li className="rc-puce rc-puce-vide">
                        {etat === "ok" ? "Le bilan ne dit rien de ce projet." : "Pas encore de bilan rédigé pour ce projet."}
                      </li>
                    )}
                    {s.puces.map((p, i) => (
                      <li key={i} className="rc-puce">
                        <span aria-hidden="true" className="rc-puce-point" style={{ background: s.couleur }} />
                        <span className="rc-puce-texte">
                          {enLigne(p.inl, noms, onOpen)}
                          {p.etiquette && <EtiquettePuce e={p.etiquette} className="rc-etiquette" />}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}
