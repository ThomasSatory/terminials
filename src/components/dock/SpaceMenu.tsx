import { useState, type ReactNode } from "react";
import { useWorkspaceStore, type Workspace } from "../../store/workspace";
import { useDashboardStore } from "../../store/dashboard";
import { useUiStore } from "../../store/ui";
import { abbreviateHome } from "../../lib/paths";
import { nextCopyName } from "../../lib/copyName";
import { couleurEspace } from "../../lib/couleurEspace";
import { libelleCouleur } from "../../lib/palette";
import { monogramme } from "../../lib/monogram";
import { fermerEspace } from "../../lib/shortcutDispatch";
import { Avatar } from "../ui/Avatar";
import { IconeCopier, IconeCrayon, IconeInterdit } from "../ui/icons";
import {
  Calque,
  ContenuModification,
  EnteteCalque,
  EtiquetteChamp,
  Nuancier,
  PucesGroupe,
  useAutreCalque,
  useHome,
  useNumeroOuverture,
  useSortieAnimee,
} from "./SpacePopover";
import "../../styles/creation.css";

/**
 * Panneau d'un espace, ancré à son avatar [data-ws-id] : son menu (`menuEspace` : renommer,
 * dupliquer, couleur, groupe, fermer) et sa modification (`popoverEspace` en mode
 * « modifier », ouverte par « Renommer… » ou Ctrl+Maj+R). Un seul panneau pour les deux,
 * comme la maquette : passer de l'un à l'autre ne le fait pas rejaillir, seul le contenu
 * fond et la largeur glisse (300 ⇄ 352 px). Toujours monté par App ; rend null quand rien
 * n'est ouvert. Navigation complète au clavier dans le menu : ↑/↓ parcourent les actions,
 * ←/→ se déplacent dans le nuancier et les puces, Entrée active, Échap ferme (ou, dans la
 * modification ouverte depuis le menu, y revient).
 */

const LARGEUR_MENU = 300;
const LARGEUR_MODIFICATION = 352;

type Mode = "menu" | "modifier";
/** Séparateur de la clé « mode + espace » : une chaîne garde son identité entre deux
    rendus, ce qu'exige useSortieAnimee (un objet recréé relancerait son effet). */
const SEP = "\u0000";

export function SpaceMenu() {
  const menu = useUiStore((s) => s.menuEspace);
  const modification = useUiStore((s) =>
    s.popoverEspace?.mode === "modifier" ? s.popoverEspace.wsId : null,
  );
  const valeur =
    menu !== null ? `menu${SEP}${menu}` : modification !== null ? `modifier${SEP}${modification}` : null;
  const autre = useAutreCalque("espace");
  const numero = useNumeroOuverture(valeur !== null);
  const { affiche, sortie } = useSortieAnimee<string>(valeur, autre);
  if (!affiche) return null;
  const i = affiche.indexOf(SEP);
  const mode = affiche.slice(0, i) as Mode;
  const wsId = affiche.slice(i + 1);
  // Même clé pour le menu et la modification d'un espace : le panneau reste monté. Un autre
  // espace ou une réouverture le remontent (animation d'entrée, focus, état vierge).
  return <PanneauEspace key={`${numero}${SEP}${wsId}`} wsId={wsId} mode={mode} sortie={sortie} />;
}

function PanneauEspace({ wsId, mode, sortie }: { wsId: string; mode: Mode; sortie: boolean }) {
  const ws = useWorkspaceStore((s) => s.workspaces.find((w) => w.id === wsId));
  // Modification ouverte depuis le menu (« Renommer… ») : Échap y revient, comme la
  // maquette ; ouverte au clavier (Ctrl+Maj+R), Échap ferme.
  const [depuisMenu, setDepuisMenu] = useState(false);
  if (!ws) return null;

  const ui = useUiStore.getState;
  const fermerMenu = () => ui().fermerMenuEspace();
  const fermerModification = () => ui().fermerPopoverEspace();
  const annulerModification = () => {
    if (depuisMenu) ui().ouvrirMenuEspace(ws.id);
    else fermerModification();
  };
  const renommer = () => {
    setDepuisMenu(true);
    ui().ouvrirPopoverEspace({ mode: "modifier", wsId: ws.id });
  };

  const enMenu = mode === "menu";
  return (
    <Calque
      ancre={{ type: "espace", wsId: ws.id }}
      largeur={enMenu ? LARGEUR_MENU : LARGEUR_MODIFICATION}
      label={enMenu ? `Actions de l’espace ${ws.name}` : `Modifier l’espace ${ws.name}`}
      sortie={sortie}
      onFermer={enMenu ? fermerMenu : annulerModification}
      fleches={enMenu}
      cleContenu={mode}
    >
      {enMenu ? (
        <ContenuMenu ws={ws} onRenommer={renommer} onFermer={fermerMenu} />
      ) : (
        <ContenuModification ws={ws} onAnnuler={annulerModification} onFini={fermerModification} />
      )}
    </Calque>
  );
}

function Item({
  icone,
  libelle,
  indice,
  danger = false,
  inactif = false,
  onClick,
}: {
  icone: ReactNode;
  libelle: string;
  indice?: string;
  danger?: boolean;
  /** Grisé, clic ignoré ; reste atteignable au clavier pour que son indice soit lu. */
  inactif?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="cr-item pi"
      data-danger={(danger && !inactif) || undefined}
      aria-disabled={inactif || undefined}
      onClick={inactif ? undefined : onClick}
    >
      {icone}
      <span className="cr-item-libelle">{libelle}</span>
      {indice && <span className="cr-item-indice">{indice}</span>}
    </button>
  );
}

/** Croix de la maquette (traits plus courts que IconeFermer, trait 1.5). */
function IconeFermerEspace() {
  return (
    <svg
      aria-hidden="true"
      focusable="false"
      width={14}
      height={14}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
    >
      <path d="M4.5 4.5l7 7M11.5 4.5l-7 7" />
    </svg>
  );
}

function ContenuMenu({
  ws,
  onRenommer,
  onFermer,
}: {
  ws: Workspace;
  onRenommer: () => void;
  onFermer: () => void;
}) {
  const home = useHome();
  const noms = useWorkspaceStore((s) => s.workspaces.map((w) => w.name).join("\u0000"));
  // Comme la maquette, le dernier espace ne se ferme pas (grisé, « dernier espace ») :
  // un clic de trop n'y tue pas tous les shells d'un coup. Ctrl+Maj+Q suit la même règle
  // (lib/shortcutDispatch, fermerEspace).
  const dernier = useWorkspaceStore((s) => s.workspaces.length < 2);
  const copie = nextCopyName(ws.name, noms.split("\u0000"));
  const nbOnglets = ws.tabs.length;

  const dupliquer = () => {
    // La copie devient l'espace actif : le récap et la mosaïque s'effacent pour la montrer.
    useDashboardStore.getState().close();
    useUiStore.getState().setVue("terminal");
    useWorkspaceStore.getState().duplicateWorkspace(ws.id);
    onFermer();
  };
  const fermer = () => {
    onFermer();
    fermerEspace(ws.id);
  };

  return (
    <>
      <EnteteCalque
        pastille={
          <Avatar monogramme={monogramme(ws.name)} couleur={couleurEspace(ws)} actif taille={34} />
        }
        titre={ws.name}
        sousTitre={abbreviateHome(ws.cwd, home)}
      />

      <div className="cr-liste">
        <Item icone={<IconeCrayon taille={14} />} libelle="Renommer…" indice="Ctrl+Maj+R" onClick={onRenommer} />
        <Item icone={<IconeCopier taille={14} />} libelle="Dupliquer" indice={copie} onClick={dupliquer} />
      </div>

      <div className="cr-separateur" />

      <div className="cr-section">
        <EtiquetteChamp valeur={libelleCouleur(ws.color)}>Couleur</EtiquetteChamp>
        <Nuancier
          choisie={ws.color ?? null}
          colonnes={8}
          onChoisir={(hex) => useWorkspaceStore.getState().setWorkspaceColor(ws.id, hex)}
        />
      </div>
      {ws.color && (
        <div className="cr-liste" data-retrait>
          <Item
            icone={<IconeInterdit taille={14} />}
            libelle="Retirer la couleur"
            onClick={() => useWorkspaceStore.getState().setWorkspaceColor(ws.id, null)}
          />
        </div>
      )}

      <div className="cr-separateur" data-serre />

      <div className="cr-section" data-puces>
        <EtiquetteChamp>Déplacer dans le groupe</EtiquetteChamp>
        <PucesGroupe
          courant={ws.groupId}
          onChoisir={(g) => useWorkspaceStore.getState().assignToGroup(ws.id, g)}
        />
      </div>

      <div className="cr-separateur" />

      <div className="cr-liste">
        <Item
          icone={<IconeFermerEspace />}
          libelle="Fermer l’espace"
          indice={dernier ? "dernier espace" : `${nbOnglets} onglet${nbOnglets > 1 ? "s" : ""} · Ctrl+Maj+Q`}
          danger
          inactif={dernier}
          onClick={fermer}
        />
      </div>
    </>
  );
}
