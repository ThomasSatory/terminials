import { invoke } from "@tauri-apps/api/core";
import { homeDir } from "@tauri-apps/api/path";
import { useWorkspaceStore, type Workspace } from "../store/workspace";
import {
  useSuperviseurStore,
  SUPERVISEUR,
  type ActionFil,
  type DemandeValidation,
  type Echange,
  type PartieFil,
  type StatutOutil,
} from "../store/superviseur";
import { useReglagesStore } from "../store/reglages";
import { useUiStore } from "../store/ui";
import { useDashboardStore } from "../store/dashboard";
import { CLASSES, decider, peutValider, type ContexteGardeFou } from "./gardeFou";
import { superviseurApi } from "./superviseurApi";
import { writePty } from "./pty";
import { lireDernieresLignes } from "./terminalRegistry";
import { focusTab } from "./tabFocus";
import { fermerEspace } from "./shortcutDispatch";
import { etatEspace } from "./etatAgent";
import { groupeCourant, nomInterlocuteur, relaisVers, sourcesEtat } from "./etatEspacesSuperviseur";
import { nettoyerResume } from "./posteSuperviseur";
import { couleurHex, paireAutorisee, PAIRE_SUPERVISEUR } from "./reglages";
import type { ReponseEnAttente, ReponseOutil, RequeteOutil } from "./outilsProtocole";
import {
  DELAI_ENTREE_MS,
  argsAffiches,
  cibleAffichee,
  construireEtatEspaces,
  developperDossier,
  lignesEtats,
  nettoyerTexte,
  nombreLignes,
  ongletParDefaut,
  resoudreEspace,
  resoudreOnglet,
  sequenceEcriture,
  texteSansValidation,
  titreDemande,
  titreOnglet,
} from "./outilsSuperviseur";
import { texteTransmis } from "./superviseurLibelles";

/**
 * Exécuteur front des outils du superviseur (§9 du contrat) : chaque `outil-requete` du
 * backend passe ici. On résout l'espace et l'onglet visés, on demande au garde-fou
 * (`decider`) ce qui est permis, puis on exécute avec les mêmes chemins que l'interface
 * (stores, registre des terminaux, `writePty`), on pose une carte « À valider », ou on
 * refuse — et on répond TOUJOURS (sinon l'appelant attend le délai du pont).
 *
 * Les appels du superviseur s'inscrivent au fil (ligne d'outil qui tourne, puis coche) ;
 * ceux des agents des espaces n'y laissent que ce qui compte pour l'utilisateur (une
 * question routée, une notification).
 *
 * Également ici : ce que font les boutons du poste de suivi sur une carte (Autoriser, Refuser),
 * aller à un espace, et les actions posées dans le fil.
 */

const estObjet = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const chaine = (v: unknown) => (typeof v === "string" ? v : "");
const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

const ok = (data: unknown): ReponseOutil => ({ ok: true, data });
const echec = (erreur: string): ReponseOutil => ({ ok: false, erreur });

function reglagesSuperviseur(): ContexteGardeFou & { nom: string } {
  return useReglagesStore.getState().reglages.superviseur;
}

const espaces = () => useWorkspaceStore.getState().workspaces;
const espace = (id: string) => espaces().find((w) => w.id === id);

const nomDe = nomInterlocuteur;

// --- Journal du fil ---

/**
 * Ligne d'outil d'un appel du superviseur dans le fil. Invisible pour les appels des
 * espaces, et pour l'état que le moteur lit lui-même avant chaque tour (hors tour, rien à
 * montrer : ce n'est pas une action).
 */
class Journal {
  readonly visible: boolean;
  private entree: string | null = null;

  constructor(private readonly req: RequeteOutil) {
    const interne =
      (estObjet(req.args) && req.args.interne === true) ||
      (req.outil === "espaces.etat" && !useSuperviseurStore.getState().moteur.enCours);
    this.visible = req.origine.type === "superviseur" && !interne;
  }

  /**
   * Inscrit l'appel. `vers` : il écrit dans cet espace, il a son entrée propre (« Nom →
   * espace ») ; `avant` : parties posées devant la ligne (texte discret « Sans
   * validation… »). Sinon la ligne rejoint l'entrée du tour en cours.
   */
  ouvrir(args: string, o: { vers?: string; avant?: PartieFil[]; statut?: StatutOutil; detail?: string } = {}): void {
    if (!this.visible || this.entree) return;
    const partie: PartieFil = {
      type: "outil",
      appelId: this.req.id,
      outil: this.req.outil,
      args,
      statut: o.statut ?? "en_cours",
      ...(o.detail ? { detail: o.detail } : {}),
    };
    const sup = useSuperviseurStore.getState();
    // L'entrée du tour, si elle suit le dernier message de l'utilisateur : ce qu'il a écrit
    // depuis s'intercale, la suite du tour repart dessous.
    const iTour = sup.entreeTour ? sup.fil.findIndex((e) => e.id === sup.entreeTour) : -1;
    let iUtilisateur = sup.fil.length - 1;
    while (iUtilisateur >= 0 && sup.fil[iUtilisateur].genre !== "utilisateur") iUtilisateur--;
    const tour = iTour !== -1 && iTour > iUtilisateur ? sup.entreeTour : null;
    if (tour && !o.vers && !o.avant) {
      sup.ajouterPartie(tour, partie);
      this.entree = tour;
      return;
    }
    this.entree = sup.ajouterEntree({
      genre: "superviseur",
      ...(o.vers ? { vers: o.vers } : {}),
      parties: [...(o.avant ?? []), partie],
    });
    // Les textes suivants du même tour se rangent sous cette entrée, dans l'ordre.
    if (sup.moteur.enCours) useSuperviseurStore.setState({ entreeTour: this.entree });
  }

  fin(statut: StatutOutil, detail?: string): void {
    if (!this.visible || !this.entree) return;
    useSuperviseurStore.getState().majOutil(this.req.id, { statut, ...(detail ? { detail } : {}) });
  }

  /** Inscrit un appel qui échoue d'emblée (refus, désignation introuvable). */
  echec(args: string, statut: "refuse" | "erreur", raison: string): ReponseOutil {
    this.ouvrir(args, { statut, detail: raison });
    return echec(raison);
  }

  /** Partie ajoutée sous la ligne d'outil (avatars, tableau des agents). */
  ajouter(partie: PartieFil): void {
    if (!this.visible || !this.entree) return;
    useSuperviseurStore.getState().ajouterPartie(this.entree, partie);
  }
}

// --- État lu par les outils ---

/**
 * Le tableau « où en sont mes agents » suit-il cet appel ? Seulement quand le tour répond
 * à un message de l'utilisateur (pas à chaque coup d'œil du moteur), et s'il n'est pas
 * déjà au fil depuis ce message (réponse immédiate de `envoyerAuSuperviseur`).
 */
function tableauAttendu(): boolean {
  const s = useSuperviseurStore.getState();
  const depuis = s.moteur.dernierTour ?? 0;
  let i = s.fil.length - 1;
  while (i >= 0 && !(s.fil[i].genre === "utilisateur" && s.fil[i].a > depuis)) i--;
  if (i < 0) return false;
  return !s.fil.slice(i).some((e) => e.parties.some((p) => p.type === "etats"));
}

function occupe(ws: Workspace): boolean {
  const w = useWorkspaceStore.getState();
  const e = etatEspace(ws, { tabPtys: w.tabPtys, busyPtys: w.busyPtys, tabsTermines: w.tabsTermines });
  return e === "travail" || e === "attente";
}

function resoudreGroupe(designation: string): { ok: true; id: string } | { ok: false; erreur: string } {
  const groupes = useWorkspaceStore.getState().groups;
  const q = designation.trim().toLocaleLowerCase("fr");
  const g = groupes.find((x) => x.id === designation) ?? groupes.find((x) => x.name.toLocaleLowerCase("fr") === q);
  if (g) return { ok: true, id: g.id };
  return {
    ok: false,
    erreur: groupes.length
      ? `Groupe « ${designation} » introuvable. Groupes : ${groupes.map((x) => x.name).join(", ")}.`
      : `Groupe « ${designation} » introuvable : aucun groupe. Créez-le avec groupe.creer.`,
  };
}

async function dossierExistant(brut: string): Promise<{ ok: true; dossier: string } | { ok: false; erreur: string }> {
  const home = brut.trim().startsWith("~") ? await homeDir().catch(() => "") : "";
  const dossier = developperDossier(brut, home);
  const existe = await invoke<boolean>("dir_exists", { path: dossier }).catch(() => false);
  return existe ? { ok: true, dossier } : { ok: false, erreur: `Dossier introuvable : ${dossier}.` };
}

// --- Écrire dans un terminal ---

/** Écrit le texte EXACT dans l'onglet, puis Entrée à part. Renvoie une erreur, ou null. */
export function ecrireDansOnglet(tabId: string, texte: string, entree: boolean): string | null {
  const pty = useWorkspaceStore.getState().tabPtys[tabId];
  if (pty === undefined) return "Le terminal de cet onglet n’est pas lancé.";
  const propre = nettoyerTexte(texte);
  if (propre) writePty(pty, sequenceEcriture(propre));
  if (entree) {
    if (propre) setTimeout(() => writePty(pty, "\r"), DELAI_ENTREE_MS);
    else writePty(pty, "\r");
  }
  return null;
}

function reponseEnAttente(demande: string): ReponseOutil {
  const data: ReponseEnAttente = { statut: "en_attente", demande, message: "En attente de la validation de l'utilisateur." };
  return ok(data);
}

function echangeOuvert(id: unknown): { ok: true; e: Echange } | { ok: false; erreur: string } {
  const tous = useSuperviseurStore.getState().echanges;
  const e = tous.find((x) => x.id === id);
  if (e && (e.etat === "ouvert" || e.etat === "transmis")) return { ok: true, e };
  const enCours = tous.filter((x) => x.etat === "ouvert" || x.etat === "transmis").map((x) => x.id);
  const liste = enCours.length ? ` Échanges en cours : ${enCours.join(", ")}.` : " Aucun échange en cours.";
  return { ok: false, erreur: e ? `Échange ${e.id} déjà clos (${e.etat}).${liste}` : `Échange « ${chaine(id)} » inconnu.${liste}` };
}

// --- Point d'entrée ---

export async function traiterRequete(req: RequeteOutil): Promise<void> {
  let reponse: ReponseOutil;
  try {
    reponse = await executer(req);
  } catch (e) {
    const erreur = `Erreur inattendue : ${message(e)}`;
    useSuperviseurStore.getState().majOutil(req.id, { statut: "erreur", detail: erreur });
    reponse = echec(erreur);
  }
  try {
    await superviseurApi.repondreOutil(req.id, reponse);
  } catch {
    // Backend injoignable : l'appelant finira sur le délai du pont, rien d'autre à faire.
  }
}

export async function executer(req: RequeteOutil): Promise<ReponseOutil> {
  const outil = req.outil;
  if (!(outil in CLASSES)) return echec(`Outil inconnu : ${String(outil)}.`);
  const args = estObjet(req.args) ? req.args : {};
  const ctx = reglagesSuperviseur();
  const journal = new Journal(req);
  const affiche = (o: { nomEspace?: string; cible?: string } = {}) => argsAffiches(outil, args, o);

  // Le garde-fou d'abord, sur ce qui ne dépend pas de la cible (origine, niveau, pause).
  const prealable = decider({ outil, origine: req.origine, paire: null, cibleBloquee: false, cibleOccupee: false }, ctx);
  if (prealable.type === "refuser") return journal.echec(affiche(), "refuse", prealable.raison);

  const designer = () => resoudreEspace(args.espace, espaces());

  switch (outil) {
    case "espaces.etat": {
      let seul: string | undefined;
      let nomEspace: string | undefined;
      if (args.espace !== undefined && args.espace !== "") {
        const r = designer();
        if (!r.ok) return journal.echec(affiche(), "erreur", r.erreur);
        seul = r.valeur.id;
        nomEspace = r.valeur.name;
      }
      journal.ouvrir(affiche({ nomEspace }));
      const data = construireEtatEspaces(sourcesEtat(), seul);
      journal.fin("fait");
      if (!seul && journal.visible && tableauAttendu() && data.espaces.length) {
        journal.ajouter({ type: "etats", lignes: lignesEtats(data.espaces, relaisVers) });
      }
      return ok(data);
    }

    case "terminal.lire": {
      const r = designer();
      if (!r.ok) return journal.echec(affiche(), "erreur", r.erreur);
      const o = resoudreOnglet(r.valeur, args.onglet);
      if (!o.ok) return journal.echec(affiche({ nomEspace: r.valeur.name }), "erreur", o.erreur);
      const titre = titreOnglet(o.valeur.tab, o.valeur.rang - 1);
      journal.ouvrir(affiche({ cible: cibleAffichee(r.valeur.name, titre) }));
      const lignes = lireDernieresLignes(o.valeur.tab.id, nombreLignes(args.lignes));
      journal.fin("fait", lignes.length ? undefined : "terminal vide");
      return ok({ espace: { id: r.valeur.id, nom: r.valeur.name }, onglet: { id: o.valeur.tab.id, titre }, lignes });
    }

    case "notifier": {
      const texte = chaine(args.texte).trim();
      if (!texte) return journal.echec(affiche(), "erreur", "Texte vide.");
      let ws: Workspace | undefined;
      if (args.espace !== undefined && args.espace !== "") {
        const r = designer();
        if (!r.ok) return journal.echec(affiche(), "erreur", r.erreur);
        ws = r.valeur;
      } else if (req.origine.type === "espace") {
        ws = espace(req.origine.workspaceId);
      }
      const titre = chaine(args.titre).trim() || ws?.name || ctx.nom;
      journal.ouvrir(affiche());
      // Appel du superviseur : ses arguments (affichés en entier) portent déjà le message,
      // le fil ne le répète pas en paragraphe (maquette : l'appel, puis un seul texte).
      if (!journal.visible) {
        // Un agent prévient l'utilisateur : le fil le garde, signé de l'espace.
        useSuperviseurStore.getState().ajouterEntree({
          genre: "observation",
          ...(ws ? { wsId: ws.id } : {}),
          parties: [ws ? { type: "texte", tete: ws.name, texte: ` vous prévient : ${texte}` } : { type: "texte", texte }],
        });
      }
      await superviseurApi.notifierSysteme(titre, texte).catch(() => {});
      journal.fin("fait");
      return ok({ statut: "fait" });
    }

    case "espace.resumer": {
      const texte = nettoyerResume(chaine(args.texte));
      if (!texte) return journal.echec(affiche(), "erreur", "Résumé vide.");
      const r = designer();
      if (!r.ok) return journal.echec(affiche(), "erreur", r.erreur);
      // Silencieux, sans journal.ouvrir : un résumé par espace à chaque réveil noierait le fil.
      useSuperviseurStore.getState().poserResume(r.valeur.id, texte, groupeCourant(r.valeur.id));
      return ok({ statut: "fait", espace: { id: r.valeur.id, nom: r.valeur.name } });
    }

    case "demander": {
      if (req.origine.type !== "espace") return echec("« demander » s'utilise depuis le terminal d'un espace.");
      const de = espace(req.origine.workspaceId);
      if (!de) return echec("L'espace qui pose la question n'est plus ouvert.");
      const question = chaine(args.question).trim();
      if (!question) return echec("Question vide.");
      let vers: string = SUPERVISEUR;
      if (args.espace !== undefined && args.espace !== "") {
        const r = designer();
        if (!r.ok) return echec(r.erreur);
        if (r.valeur.id === de.id) return echec("Posez la question à un autre espace que le vôtre.");
        vers = r.valeur.id;
      }
      const w = useWorkspaceStore.getState();
      const ptyId = req.origine.ptyId;
      const deTabId =
        ptyId === undefined ? null : (Object.entries(w.tabPtys).find(([, id]) => id === ptyId)?.[0] ?? null);
      const sup = useSuperviseurStore.getState();
      const id = sup.ouvrirEchange({ de: de.id, deTabId, vers, question });
      sup.ajouterEntree({ genre: "message", de: de.id, vers, parties: [{ type: "texte", texte: `« ${question} »` }] });
      void superviseurApi
        .signaler({ genre: "question", texte: `${de.name} demande à ${nomDe(vers)} (échange ${id}) : « ${question} »`, wsId: de.id })
        .catch(() => {});
      return ok({ statut: "transmise", echange: id, message: `Question confiée à ${ctx.nom}.` });
    }

    case "espace.creer": {
      const brut = chaine(args.dossier).trim();
      if (!brut) return journal.echec(affiche(), "erreur", "Dossier non précisé.");
      journal.ouvrir(affiche());
      const d = await dossierExistant(brut);
      if (!d.ok) {
        journal.fin("erreur", d.erreur);
        return echec(d.erreur);
      }
      let groupId: string | null = null;
      if (chaine(args.groupe).trim()) {
        const g = resoudreGroupe(chaine(args.groupe));
        if (!g.ok) {
          journal.fin("erreur", g.erreur);
          return echec(g.erreur);
        }
        groupId = g.id;
      }
      const w = useWorkspaceStore.getState();
      const avant = w.activeId;
      const nom = chaine(args.nom).trim();
      const id = w.addWorkspace(d.dossier, nom || undefined, groupId);
      const couleur = couleurHex(args.couleur);
      if (couleur) w.setWorkspaceColor(id, couleur);
      // Créer n'est pas aller : l'utilisateur reste où il est (« Y aller » dans le fil).
      if (avant) useWorkspaceStore.setState({ activeId: avant });
      journal.fin("fait");
      journal.ajouter({ type: "refs", wsIds: [id] });
      return ok({ statut: "fait", espace: { id, nom: espace(id)?.name ?? nom } });
    }

    case "espace.renommer": {
      const r = designer();
      if (!r.ok) return journal.echec(affiche(), "erreur", r.erreur);
      const nom = chaine(args.nom).trim();
      if (!nom) return journal.echec(affiche({ nomEspace: r.valeur.name }), "erreur", "Nouveau nom vide.");
      journal.ouvrir(affiche({ nomEspace: r.valeur.name }));
      useWorkspaceStore.getState().renameWorkspace(r.valeur.id, nom);
      journal.fin("fait");
      return ok({ statut: "fait" });
    }

    case "espace.deplacer": {
      const r = designer();
      if (!r.ok) return journal.echec(affiche(), "erreur", r.erreur);
      const a = affiche({ nomEspace: r.valeur.name });
      const position =
        typeof args.position === "number" && Number.isInteger(args.position) && args.position >= 0 ? args.position : undefined;
      const w = useWorkspaceStore.getState();
      if (args.groupe === "") {
        journal.ouvrir(a);
        w.assignToGroup(r.valeur.id, null, position);
      } else if (chaine(args.groupe).trim()) {
        const g = resoudreGroupe(chaine(args.groupe));
        if (!g.ok) return journal.echec(a, "erreur", g.erreur);
        journal.ouvrir(a);
        w.assignToGroup(r.valeur.id, g.id, position);
      } else if (position !== undefined) {
        journal.ouvrir(a);
        w.moveWorkspace(r.valeur.id, position);
      } else {
        return journal.echec(a, "erreur", "Rien à déplacer : précisez un groupe ou une position.");
      }
      journal.fin("fait");
      return ok({ statut: "fait" });
    }

    case "espace.fermer": {
      const r = designer();
      if (!r.ok) return journal.echec(affiche(), "erreur", r.erreur);
      const a = affiche({ nomEspace: r.valeur.name });
      const d = decider(
        { outil, origine: req.origine, paire: null, cibleBloquee: false, cibleOccupee: occupe(r.valeur) },
        ctx,
      );
      if (d.type === "refuser") return journal.echec(a, "refuse", d.raison);
      journal.ouvrir(a);
      if (!fermerEspace(r.valeur.id)) {
        journal.fin("erreur", "dernier espace");
        return echec("Dernier espace : il reste ouvert.");
      }
      journal.fin("fait");
      return ok({ statut: "fait" });
    }

    case "groupe.creer": {
      const nom = chaine(args.nom).trim();
      if (!nom) return journal.echec(affiche(), "erreur", "Nom du groupe vide.");
      const membres: Workspace[] = [];
      for (const d of Array.isArray(args.espaces) ? args.espaces : []) {
        const r = resoudreEspace(d, espaces());
        if (!r.ok) return journal.echec(affiche(), "erreur", r.erreur);
        if (!membres.includes(r.valeur)) membres.push(r.valeur);
      }
      journal.ouvrir(affiche());
      const w = useWorkspaceStore.getState();
      const gid = w.addGroup(nom, couleurHex(args.couleur) ?? undefined);
      for (const m of membres) useWorkspaceStore.getState().assignToGroup(m.id, gid);
      journal.fin("fait");
      if (membres.length) journal.ajouter({ type: "refs", wsIds: membres.map((m) => m.id) });
      return ok({ statut: "fait", groupe: { id: gid, nom } });
    }

    case "onglet.ouvrir": {
      const r = designer();
      if (!r.ok) return journal.echec(affiche(), "erreur", r.erreur);
      journal.ouvrir(affiche({ nomEspace: r.valeur.name }));
      let dossier: string | undefined;
      if (chaine(args.dossier).trim()) {
        const d = await dossierExistant(chaine(args.dossier));
        if (!d.ok) {
          journal.fin("erreur", d.erreur);
          return echec(d.erreur);
        }
        dossier = d.dossier;
      }
      const tabId = useWorkspaceStore.getState().addTab(r.valeur.id, dossier);
      journal.fin("fait");
      return ok({ statut: "fait", onglet: { id: tabId } });
    }

    case "espace.focus": {
      const r = designer();
      if (!r.ok) return journal.echec(affiche(), "erreur", r.erreur);
      let tabId: string | undefined;
      let cible = r.valeur.name;
      if (args.onglet !== undefined && args.onglet !== "") {
        const o = resoudreOnglet(r.valeur, args.onglet);
        if (!o.ok) return journal.echec(affiche({ nomEspace: r.valeur.name }), "erreur", o.erreur);
        tabId = o.valeur.tab.id;
        cible = cibleAffichee(r.valeur.name, titreOnglet(o.valeur.tab, o.valeur.rang - 1));
      }
      journal.ouvrir(affiche({ cible }));
      // Le superviseur change d'espace pour l'utilisateur, sans lui voler la saisie.
      allerA(r.valeur.id, tabId, false);
      journal.fin("fait");
      return ok({ statut: "fait" });
    }

    case "terminal.ecrire":
    case "session.demander":
    case "session.repondre":
      return ecrireOutil(req, args, ctx, journal);
  }
}

/** Les trois outils d'écriture : cible, garde-fou complet, puis écrire / carte / refus. */
function ecrireOutil(
  req: RequeteOutil,
  args: Record<string, unknown>,
  ctx: ContexteGardeFou & { nom: string },
  journal: Journal,
): ReponseOutil {
  const outil = req.outil as DemandeValidation["outil"];
  const sup = useSuperviseurStore.getState();
  const texte = nettoyerTexte(chaine(args.texte));
  const pourquoi = chaine(args.pourquoi).trim();
  const affiche = (o: { nomEspace?: string; cible?: string } = {}) => argsAffiches(outil, args, o);

  let ws: Workspace;
  let tab: Workspace["tabs"][number];
  let entree = true;
  let de: string | null = null;
  let ech: Echange | null = null;
  let paire: [string, string] | null = null;

  if (outil === "terminal.ecrire") {
    const r = resoudreEspace(args.espace, espaces());
    if (!r.ok) return journal.echec(affiche(), "erreur", r.erreur);
    const o = resoudreOnglet(r.valeur, args.onglet);
    if (!o.ok) return journal.echec(affiche({ nomEspace: r.valeur.name }), "erreur", o.erreur);
    ws = r.valeur;
    tab = o.valeur.tab;
    entree = args.entree !== false;
    if (!texte && !entree) return journal.echec(affiche({ nomEspace: ws.name }), "erreur", "Rien à écrire.");
  } else {
    if (!texte) return journal.echec(affiche(), "erreur", "Texte vide.");
    const e = echangeOuvert(args.echange);
    if (!e.ok) return journal.echec(affiche(), "erreur", e.erreur);
    ech = e.e;
    if (outil === "session.demander") {
      if (ech.vers === SUPERVISEUR) {
        return journal.echec(affiche(), "erreur", "Cette question vous est adressée : répondez avec session.repondre.");
      }
      const cible = espace(ech.vers);
      if (!cible) return journal.echec(affiche(), "erreur", "L'espace interrogé n'est plus ouvert.");
      const t = ongletParDefaut(cible);
      if (!t) return journal.echec(affiche(), "erreur", "L'espace interrogé n'a aucun onglet.");
      ws = cible;
      tab = t;
      de = ech.de;
      const source = espace(ech.de);
      paire = source ? [source.cwd, cible.cwd] : null;
    } else {
      const cible = espace(ech.de);
      if (!cible) return journal.echec(affiche(), "erreur", "L'espace qui a posé la question n'est plus ouvert.");
      const t = cible.tabs.find((x) => x.id === ech!.deTabId) ?? ongletParDefaut(cible);
      if (!t) return journal.echec(affiche(), "erreur", "L'espace qui a posé la question n'a aucun onglet.");
      ws = cible;
      tab = t;
      de = ech.vers;
      if (ech.vers === SUPERVISEUR) paire = [cible.cwd, PAIRE_SUPERVISEUR];
      else {
        const repondant = espace(ech.vers);
        paire = repondant ? [cible.cwd, repondant.cwd] : null;
      }
    }
  }

  // Relais : le texte écrit dit qui parle et par qui il passe (maquette, « Texte exact ») ;
  // l'échange, lui, garde le texte brut.
  const ecrit =
    outil === "terminal.ecrire" || !ech
      ? texte
      : texteTransmis(outil, {
          auteur: nomDe(outil === "session.demander" ? ech.de : ech.vers),
          superviseur: ctx.nom,
          texte,
          parSuperviseur: outil === "session.repondre" && ech.vers === SUPERVISEUR,
        });

  const rang = ws.tabs.indexOf(tab);
  const cibleTexte = cibleAffichee(ws.name, titreOnglet(tab, rang));
  const bloquee = tab.id in sup.sessionsBloquees;
  const d = decider({ outil, origine: req.origine, paire, cibleBloquee: bloquee, cibleOccupee: false }, ctx);
  const a = affiche({ cible: cibleTexte });

  if (d.type === "refuser") return journal.echec(a, "refuse", d.raison);

  // Réponse rendue par une autre session : elle entre au fil comme un message routé, que
  // l'écriture parte tout de suite ou attende la validation.
  if (outil === "session.repondre" && ech && ech.vers !== SUPERVISEUR) {
    sup.ajouterEntree({ genre: "message", de: ech.vers, vers: ech.de, parties: [{ type: "texte", texte: `« ${texte} »` }] });
  }

  if (d.type === "valider") {
    const id = sup.ajouterDemande({
      appelId: req.id,
      outil,
      cible: { wsId: ws.id, tabId: tab.id },
      de,
      echangeId: ech?.id ?? null,
      titre: titreDemande(outil, ws.name, { bloquee, deSuperviseur: de === SUPERVISEUR }),
      texte: ecrit,
      ...(ecrit !== texte ? { brut: texte } : {}),
      entree,
      pourquoi: pourquoi || d.raison,
      ...(bloquee ? { apercu: lireDernieresLignes(tab.id, 8) } : {}),
      paire,
      bloquee,
    });
    journal.ouvrir(a, { vers: ws.id, statut: "en_attente", detail: "à valider" });
    return reponseEnAttente(id);
  }

  // Exécuté sans validation : seul un échange d'une paire autorisée en arrive là.
  const avant: PartieFil[] = [];
  if (paire && de) avant.push({ type: "texte", ton: "discret", texte: texteSansValidation(nomDe(de), ws.name) });
  journal.ouvrir(a, { vers: ws.id, avant });
  const erreur = ecrireDansOnglet(tab.id, ecrit, entree);
  if (erreur) {
    journal.fin("erreur", erreur);
    return echec(erreur);
  }
  journal.fin("fait");
  if (paire) useReglagesStore.getState().compterEchange(paire[0], paire[1]);
  if (ech) apresEcritureEchange(outil, ech.id, tab.id, texte);
  return ok({ statut: "fait" });
}

function apresEcritureEchange(outil: DemandeValidation["outil"], echangeId: string, tabId: string, texte: string): void {
  const sup = useSuperviseurStore.getState();
  if (outil === "session.demander") sup.majEchange(echangeId, { etat: "transmis", versTabId: tabId });
  else if (outil === "session.repondre") sup.majEchange(echangeId, { etat: "repondu", reponse: texte });
}

// --- Cartes « À valider » ---

/**
 * « Autoriser » : le garde-fou est REVÉRIFIÉ (niveau, pause), puis le texte exact est
 * écrit. Renvoie la raison d'un refus, sinon null. La carte reste ouverte si l'écriture
 * échoue (terminal pas encore lancé) : l'utilisateur peut réessayer.
 */
export function autoriserDemande(id: string): string | null {
  const sup = useSuperviseurStore.getState();
  const d = sup.demandes.find((x) => x.id === id && x.statut === "ouverte");
  if (!d) return null;
  const reg = reglagesSuperviseur();
  const permis = peutValider(reg);
  if (!permis.ok) return permis.raison;

  const ws = espace(d.cible.wsId);
  if (!ws || !ws.tabs.some((t) => t.id === d.cible.tabId)) {
    annulerDemande(d, "L’onglet visé n’existe plus : rien n’est écrit.");
    return null;
  }
  const erreur = ecrireDansOnglet(d.cible.tabId, d.texte, d.entree);
  if (erreur) return erreur;

  sup.deciderDemande(id, "autorisee");
  if (d.appelId !== null) sup.majOutil(d.appelId, { statut: "fait", detail: "autorisé par vous" });
  const parties: PartieFil[] = [{ type: "texte", ton: "discret", texte: "Autorisé par vous." }];
  if (d.toujours && d.paire && !paireAutorisee(reg.paires, d.paire[0], d.paire[1])) {
    useReglagesStore.getState().autoriserPaire(d.paire[0], d.paire[1]);
    const nomA = d.de ? nomDe(d.de) : ws.name;
    parties.push(
      { type: "texte", ton: "discret", texte: `Échanges entre ${nomA} et ${ws.name} autorisés sans validation désormais.` },
      { type: "action", libelle: "Réglages", action: { type: "paires" } },
    );
  }
  if (d.echangeId) apresEcritureEchange(d.outil, d.echangeId, d.cible.tabId, d.brut ?? d.texte);
  sup.ajouterEntree({ genre: "superviseur", vers: ws.id, parties });
  void superviseurApi
    .signaler({ genre: "validation", texte: `Autorisé par l'utilisateur : ${d.titre} (demande ${d.id}). Le texte a été écrit.`, wsId: ws.id })
    .catch(() => {});
  return null;
}

/** « Refuser » : rien n'est écrit ; le fil dit qui attend encore et comment y aller. */
export function refuserDemande(id: string): void {
  const sup = useSuperviseurStore.getState();
  const d = sup.demandes.find((x) => x.id === id && x.statut === "ouverte");
  if (!d) return;
  sup.deciderDemande(id, "refusee");
  if (d.appelId !== null) sup.majOutil(d.appelId, { statut: "refuse", detail: "refusé par vous" });
  const nomCible = nomDe(d.cible.wsId);
  const parties: PartieFil[] = [];
  if (d.echangeId) {
    sup.majEchange(d.echangeId, { etat: "refuse" });
    const e = sup.echanges.find((x) => x.id === d.echangeId);
    if (d.de === SUPERVISEUR) {
      parties.push(
        { type: "texte", texte: `Refusé : je ne réponds pas à ${nomCible}.` },
        { type: "action", libelle: "Aller voir", action: { type: "aller", wsId: d.cible.wsId } },
      );
    } else {
      const demandeur = e ? e.de : d.cible.wsId;
      const nom = nomDe(demandeur);
      parties.push(
        { type: "texte", texte: `Refusé : je ne transmets rien. ${nom} attend toujours ; dites-lui quoi faire.` },
        { type: "action", libelle: `Aller à ${nom}`, action: { type: "aller", wsId: demandeur } },
      );
    }
  } else if (d.bloquee) {
    parties.push(
      { type: "texte", texte: `Refusé : je n’écris rien dans ${nomCible}. L’agent attend toujours votre réponse.` },
      { type: "action", libelle: "Aller répondre", action: { type: "aller", wsId: d.cible.wsId } },
    );
  } else {
    parties.push(
      { type: "texte", texte: `Refusé : je n’écris rien dans ${nomCible}.` },
      { type: "action", libelle: "Aller voir", action: { type: "aller", wsId: d.cible.wsId } },
    );
  }
  sup.ajouterEntree({ genre: "superviseur", parties });
  void superviseurApi
    .signaler({
      genre: "validation",
      texte: `Refusé par l'utilisateur : ${d.titre} (demande ${d.id}). Rien n'a été écrit ; ne réessaie pas.`,
      wsId: d.cible.wsId,
    })
    .catch(() => {});
}

function annulerDemande(d: DemandeValidation, raison: string): void {
  const sup = useSuperviseurStore.getState();
  sup.deciderDemande(d.id, "annulee");
  if (d.appelId !== null) sup.majOutil(d.appelId, { statut: "erreur", detail: "annulé" });
  sup.ajouterEntree({ genre: "superviseur", parties: [{ type: "texte", ton: "discret", texte: raison }] });
}

/** Cartes dont l'espace ou l'onglet a disparu : annulées (rien ne peut plus y être écrit). */
export function annulerDemandesOrphelines(): void {
  const ws = espaces();
  for (const d of useSuperviseurStore.getState().demandes) {
    if (d.statut !== "ouverte") continue;
    const w = ws.find((x) => x.id === d.cible.wsId);
    if (w && w.tabs.some((t) => t.id === d.cible.tabId)) continue;
    annulerDemande(d, `${d.titre} : l’onglet visé est fermé, la demande est annulée.`);
  }
}

// --- Navigation et actions du fil ---

/**
 * Aller à un espace (avatar du fil, « Aller voir », outil `espace.focus`) : comme un clic
 * sur son avatar du dock — vues plein écran et calques s'effacent, l'onglet visé
 * s'affiche. `focus` : rendre la saisie au terminal (pas quand le superviseur agit seul).
 */
export function allerA(wsId: string, tabId?: string, focus = true): void {
  const s = useWorkspaceStore.getState();
  const ws = s.workspaces.find((w) => w.id === wsId);
  if (!ws) return;
  // « Aller au terminal » doit révéler le terminal : le poste de suivi se referme. Quand
  // le superviseur agit seul (`focus` faux), il reste ouvert : le démonter ferait perdre
  // le focus du prompt que l'utilisateur est peut-être en train de remplir.
  if (focus) useSuperviseurStore.getState().fermerPanneau();
  useDashboardStore.getState().close();
  const ui = useUiStore.getState();
  ui.fermerCalques();
  ui.fermerParametres();
  if (ui.vue !== "terminal") ui.setVue("terminal");
  // L'onglet d'abord : setActive ne marque lu que l'onglet affiché au moment de l'appel.
  if (tabId && ws.tabs.some((t) => t.id === tabId)) s.setActiveTab(wsId, tabId);
  s.setActive(wsId);
  const cible = tabId ?? ws.activeTabId;
  if (focus && cible && typeof requestAnimationFrame === "function") {
    // Le terminal redevient visible au rendu suivant : le focus après.
    requestAnimationFrame(() => requestAnimationFrame(() => focusTab(cible)));
  }
}

/** Action posée dans le fil. `ouvrirPaires` : déplie la liste des échanges autorisés. */
export function executerActionFil(action: ActionFil, ouvrirPaires: () => void): void {
  switch (action.type) {
    case "aller":
      allerA(action.wsId);
      return;
    case "reprendre":
      useReglagesStore.getState().setPause(false);
      return;
    case "niveau":
      useReglagesStore.getState().setNiveau(action.niveau);
      return;
    case "paires":
      ouvrirPaires();
      return;
  }
}
