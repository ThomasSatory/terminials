import { useState, type ComponentType } from "react";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { useReglagesStore } from "../../store/reglages";
import { useWorkspaceStore } from "../../store/workspace";
import { useDernieresLignes } from "../../hooks/useDernieresLignes";
import {
  ACCENTS,
  DEFILEMENTS,
  TAILLE_POLICE_MAX,
  TAILLE_POLICE_MIN,
  NOM_SUPERVISEUR_MAX,
  type Densite,
  type PoliceTerminal,
  type ReglagesApp,
} from "../../lib/reglages";
import { POLICE_SYSTEME } from "../../lib/apparence";
import { cheminAbrege, optionsShell, type RangeeParametre } from "../../lib/parametresModele";
import { jouerSonAttente } from "../../lib/parametresSon";
import { Rangee, useParametres } from "./contexte";
import { BoutonAction, ChampTexte, Interrupteur, PasAPas, Pastilles, Segments, Touches } from "./controles";
import { HooksClaude } from "./HooksClaude";
import { NiveauxAutonomie, PairesAutorisees } from "./Superviseur";
import { useHome } from "../../hooks/useHome";

/**
 * Rangées des réglages de l'application (store `useReglagesStore`) : chacune lit sa
 * valeur par un sélecteur ciblé, l'applique par `modifier` (effet immédiat, écriture
 * regroupée) et signale « Enregistré ». Une rangée = un composant : chacune s'abonne
 * seulement à ce qu'elle montre.
 */

type P = { rangee: RangeeParametre };

/** Modifie une branche des réglages puis confirme sur la rangée. */
function useModifier() {
  const { signaler } = useParametres();
  return (id: string, f: (r: ReglagesApp) => ReglagesApp, texte?: string) => {
    useReglagesStore.getState().modifier(f);
    signaler(id, texte);
  };
}

const apparence = (r: ReglagesApp, p: Partial<ReglagesApp["apparence"]>) => ({ ...r, apparence: { ...r.apparence, ...p } });
const terminal = (r: ReglagesApp, p: Partial<ReglagesApp["terminal"]>) => ({ ...r, terminal: { ...r.terminal, ...p } });
const notifications = (r: ReglagesApp, p: Partial<ReglagesApp["notifications"]>) => ({
  ...r,
  notifications: { ...r.notifications, ...p },
});

// --- Apparence ---

function Accent({ rangee }: P) {
  const accent = useReglagesStore((s) => s.reglages.apparence.accent);
  const modifier = useModifier();
  return (
    <Rangee
      rangee={rangee}
      controle={
        <Pastilles
          libelle={rangee.libelle}
          options={ACCENTS}
          valeur={accent}
          onChange={(couleur, nom) => modifier(rangee.id, (r) => apparence(r, { accent: couleur }), nom)}
        />
      }
    />
  );
}

const DENSITES: { valeur: Densite; libelle: string }[] = [
  { valeur: "compacte", libelle: "Compacte" },
  { valeur: "normale", libelle: "Normale" },
  { valeur: "ample", libelle: "Ample" },
];

function DensiteDock({ rangee }: P) {
  const densite = useReglagesStore((s) => s.reglages.apparence.densite);
  const modifier = useModifier();
  return (
    <Rangee
      rangee={rangee}
      controle={
        <Segments libelle={rangee.libelle} options={DENSITES} valeur={densite} onChange={(v) => modifier(rangee.id, (r) => apparence(r, { densite: v }))} />
      }
    />
  );
}

function ReduireAnimations({ rangee }: P) {
  const actif = useReglagesStore((s) => s.reglages.apparence.reduireAnimations);
  const modifier = useModifier();
  return (
    <Rangee
      rangee={rangee}
      controle={<Interrupteur actif={actif} libelle={rangee.libelle} onChange={(v) => modifier(rangee.id, (r) => apparence(r, { reduireAnimations: v }))} />}
    />
  );
}

/** Aperçu : les dernières lignes du terminal ouvert, à la taille et dans la police réglées. */
function ApercuTerminal() {
  const taille = useReglagesStore((s) => s.reglages.terminal.taillePolice);
  const police = useReglagesStore((s) => s.reglages.terminal.police);
  const tabId = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === s.activeId)?.activeTabId ?? null);
  const lignes = useDernieresLignes(tabId, 5);
  return (
    <div
      role="img"
      aria-label="Aperçu du terminal"
      className="par-apercu"
      style={{ fontSize: taille, fontFamily: police === "systeme" ? POLICE_SYSTEME : undefined }}
    >
      {lignes.map((l, i) => (
        <div key={i} className="par-apercu-ligne">
          {l}
        </div>
      ))}
      <div className="par-apercu-invite">
        <span>❯</span>
        <span className="par-apercu-curseur" aria-hidden="true" />
      </div>
    </div>
  );
}

function TaillePolice({ rangee }: P) {
  const taille = useReglagesStore((s) => s.reglages.terminal.taillePolice);
  const modifier = useModifier();
  return (
    <Rangee
      rangee={rangee}
      controle={
        <PasAPas
          libelle={rangee.libelle}
          valeur={taille}
          min={TAILLE_POLICE_MIN}
          max={TAILLE_POLICE_MAX}
          unite="px"
          onChange={(v) => modifier(rangee.id, (r) => terminal(r, { taillePolice: v }))}
        />
      }
      large={<ApercuTerminal />}
    />
  );
}

// --- Terminal ---

function Shell({ rangee }: P) {
  const shell = useReglagesStore((s) => s.reglages.terminal.shell);
  const infos = useReglagesStore((s) => s.infos);
  const modifier = useModifier();
  const options = optionsShell(infos?.shellSession ?? null, infos?.shellsDisponibles ?? [], shell).map((o) => ({
    valeur: o.valeur,
    libelle: o.libelle,
  }));
  return (
    <Rangee
      rangee={rangee}
      controle={
        <Segments
          libelle={rangee.libelle}
          options={options}
          valeur={shell}
          mono
          onChange={(v) => modifier(rangee.id, (r) => terminal(r, { shell: v }), "Nouveaux terminaux")}
        />
      }
    />
  );
}

function DossierDepart({ rangee }: P) {
  const dossier = useReglagesStore((s) => s.reglages.terminal.dossierDepart);
  const modifier = useModifier();
  return (
    <Rangee
      rangee={rangee}
      controle={
        <ChampTexte
          libelle={rangee.libelle}
          valeur={dossier}
          placeholder="~"
          onChange={(v) => modifier(rangee.id, (r) => terminal(r, { dossierDepart: v }))}
        />
      }
    />
  );
}

const POLICES: { valeur: PoliceTerminal; libelle: string }[] = [
  { valeur: "integree", libelle: "JetBrains Mono" },
  { valeur: "systeme", libelle: "Monospace du système" },
];

function Police({ rangee }: P) {
  const police = useReglagesStore((s) => s.reglages.terminal.police);
  const modifier = useModifier();
  return (
    <Rangee
      rangee={rangee}
      controle={<Segments libelle={rangee.libelle} options={POLICES} valeur={police} onChange={(v) => modifier(rangee.id, (r) => terminal(r, { police: v }))} />}
    />
  );
}

const OPTIONS_DEFILEMENT = DEFILEMENTS.map((v) => ({ valeur: v as number, libelle: v.toLocaleString("fr-FR") }));

function Defilement({ rangee }: P) {
  const defilement = useReglagesStore((s) => s.reglages.terminal.defilement);
  const modifier = useModifier();
  return (
    <Rangee
      rangee={rangee}
      controle={
        <Segments
          libelle={rangee.libelle}
          options={OPTIONS_DEFILEMENT}
          valeur={defilement}
          mono
          onChange={(v) => modifier(rangee.id, (r) => terminal(r, { defilement: v }))}
        />
      }
    />
  );
}

function InterrupteurTerminal({ rangee, cle }: P & { cle: "copierSelection" | "reprendreSessions" }) {
  const actif = useReglagesStore((s) => s.reglages.terminal[cle]);
  const modifier = useModifier();
  return (
    <Rangee
      rangee={rangee}
      controle={<Interrupteur actif={actif} libelle={rangee.libelle} onChange={(v) => modifier(rangee.id, (r) => terminal(r, { [cle]: v }))} />}
    />
  );
}

// --- Agents et notifications ---

function InterrupteurNotif({ rangee, cle }: P & { cle: keyof ReglagesApp["notifications"] }) {
  const actif = useReglagesStore((s) => s.reglages.notifications[cle]);
  const modifier = useModifier();
  return (
    <Rangee
      rangee={rangee}
      controle={
        <Interrupteur
          actif={actif}
          libelle={rangee.libelle}
          onChange={(v) => {
            modifier(rangee.id, (r) => notifications(r, { [cle]: v }));
            // Le son s'entend au moment où on l'active : on sait ce qu'on a choisi.
            if (cle === "son" && v) jouerSonAttente();
          }}
        />
      }
    />
  );
}

// --- Superviseur ---

function SuperviseurActif({ rangee }: P) {
  const actif = useReglagesStore((s) => s.reglages.superviseur.actif);
  const { signaler } = useParametres();
  return (
    <Rangee
      rangee={rangee}
      controle={
        <Interrupteur
          actif={actif}
          libelle={rangee.libelle}
          onChange={(v) => {
            useReglagesStore.getState().setSuperviseurActif(v);
            signaler(rangee.id, v ? "Activé" : "Désactivé");
          }}
        />
      }
    />
  );
}

function NomSuperviseur({ rangee }: P) {
  const nom = useReglagesStore((s) => s.reglages.superviseur.nom);
  const { signaler } = useParametres();
  return (
    <Rangee
      rangee={rangee}
      controle={
        <ChampTexte
          libelle="Nom du superviseur"
          valeur={nom}
          mono={false}
          largeur={200}
          placeholder="Superviseur"
          maxLength={NOM_SUPERVISEUR_MAX}
          onChange={(v) => {
            useReglagesStore.getState().setNomSuperviseur(v);
            signaler(rangee.id);
          }}
        />
      }
    />
  );
}

function PauseSuperviseur({ rangee }: P) {
  const pause = useReglagesStore((s) => s.reglages.superviseur.pause);
  const { signaler } = useParametres();
  return (
    <Rangee
      rangee={rangee}
      controle={
        <Interrupteur
          actif={pause}
          libelle={rangee.libelle}
          onChange={(v) => {
            useReglagesStore.getState().setPause(v);
            signaler(rangee.id, v ? "En pause" : "Reprise");
          }}
        />
      }
    />
  );
}

// --- Raccourcis ---

function Raccourci({ rangee }: P) {
  return <Rangee rangee={rangee} controle={<Touches combos={rangee.combos ?? []} />} />;
}

// --- À propos ---

function Version({ rangee }: P) {
  const version = useReglagesStore((s) => s.infos?.version);
  return <Rangee rangee={rangee} controle={<span className="par-info">{version ?? "inconnue"}</span>} />;
}

function FichierReglages({ rangee }: P) {
  const fichier = useReglagesStore((s) => s.infos?.fichierReglages ?? null);
  const home = useHome();
  const { signaler } = useParametres();
  if (!fichier) return <Rangee rangee={rangee} controle={<span className="par-info">indisponible</span>} />;
  const copier = () => {
    navigator.clipboard
      ?.writeText(fichier)
      .then(() => signaler(rangee.id, "Chemin copié"))
      .catch(() => useWorkspaceStore.getState().showToast("presse-papier indisponible"));
  };
  return (
    <Rangee
      rangee={rangee}
      controle={
        <>
          <span className="par-info">{cheminAbrege(fichier, home)}</span>
          <button type="button" className="hov par-copier" aria-label="Copier le chemin" title="Copier le chemin" onClick={copier}>
            <svg aria-hidden="true" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
              <rect x="5.5" y="5.5" width="8" height="8" rx="1.5" />
              <path d="M10.5 5.5V3.5A1 1 0 0 0 9.5 2.5h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2" />
            </svg>
          </button>
        </>
      }
    />
  );
}

const ICONE_DOSSIER = "M2.5 4.5a1 1 0 0 1 1-1h3l1.5 1.5h4.5a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1h-9a1 1 0 0 1-1-1z";

function DossierConfig({ rangee }: P) {
  const fichier = useReglagesStore((s) => s.infos?.fichierReglages ?? null);
  const donnees = useReglagesStore((s) => s.infos?.dossierDonnees ?? null);
  const home = useHome();
  const { signaler } = useParametres();
  // Le dossier des données vient du backend : écrit en dur, il était faux dès que
  // $XDG_DATA_HOME est défini.
  const desc = donnees ? `${rangee.desc} L’activité est dans ${cheminAbrege(donnees, home)}.` : undefined;
  // Infos absentes : la rangée reste affichée (comme le fichier de réglages) plutôt que de
  // laisser une carte vide, alors que la recherche et la navigation la comptent.
  if (!fichier) return <Rangee rangee={rangee} desc={desc} controle={<span className="par-info">indisponible</span>} />;
  const ouvrir = () => {
    // Le fichier désigné dans son dossier : le gestionnaire s'ouvre dessus.
    revealItemInDir(fichier)
      .then(() => signaler(rangee.id, "Ouvert dans le gestionnaire de fichiers"))
      .catch((e: unknown) => useWorkspaceStore.getState().showToast(`dossier non ouvert : ${String(e)}`));
  };
  return (
    <Rangee
      rangee={rangee}
      desc={desc}
      controle={
        <BoutonAction icone={ICONE_DOSSIER} onClick={ouvrir}>
          Ouvrir le dossier
        </BoutonAction>
      }
    />
  );
}

function Reinitialiser({ rangee }: P) {
  const [arme, setArme] = useState(false);
  const { signaler } = useParametres();
  return (
    <Rangee
      rangee={rangee}
      desc={
        arme
          ? // Écart voulu avec la maquette (« Tous les réglages de cette page… ») : les
            // réglages d'activité (sources, bilan, temps à saisir), tenus par le
            // collecteur, ne sont pas remis à zéro ; le dire serait faux.
            "Apparence, terminal, notifications et superviseur reprennent leur valeur par défaut."
          : "Vos espaces, onglets, paires et hooks ne sont pas touchés."
      }
      controle={
        arme ? (
          <span className="par-reinit-arme">
            <button type="button" className="hov par-annuler" onClick={() => setArme(false)}>
              Annuler
            </button>
            <button
              type="button"
              className="par-danger-plein"
              onClick={() => {
                useReglagesStore.getState().reinitialiser();
                setArme(false);
                signaler(rangee.id, "Réglages d’origine rétablis");
              }}
            >
              Tout réinitialiser
            </button>
          </span>
        ) : (
          <button type="button" className="par-danger" onClick={() => setArme(true)}>
            Réinitialiser…
          </button>
        )
      }
    />
  );
}

/** Rendu de chaque rangée de l'app, par id (cf. lib/parametresModele). */
export const RANGEES_APP: Record<string, ComponentType<P>> = {
  accent: Accent,
  densite: DensiteDock,
  reduire: ReduireAnimations,
  taillePolice: TaillePolice,
  shell: Shell,
  dossierDepart: DossierDepart,
  police: Police,
  defilement: Defilement,
  copierSelection: (p) => <InterrupteurTerminal {...p} cle="copierSelection" />,
  reprendreSessions: (p) => <InterrupteurTerminal {...p} cle="reprendreSessions" />,
  hooks: (p) => <HooksClaude {...p} />,
  notifSysteme: (p) => <InterrupteurNotif {...p} cle="systeme" />,
  bulle: (p) => <InterrupteurNotif {...p} cle="bulle" />,
  son: (p) => <InterrupteurNotif {...p} cle="son" />,
  supActif: SuperviseurActif,
  supNom: NomSuperviseur,
  supPause: PauseSuperviseur,
  supNiveau: (p) => <NiveauxAutonomie {...p} />,
  supPaires: (p) => <PairesAutorisees {...p} />,
  version: Version,
  fichier: FichierReglages,
  dossierConfig: DossierConfig,
  reinitialiser: Reinitialiser,
};

export { Raccourci };
