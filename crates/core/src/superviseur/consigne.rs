//! Consigne système du superviseur, invite de chaque réveil et arguments du CLI.
//!
//! Attention : `claude` enregistre la consigne système à la première requête d'une
//! conversation et la renvoie telle quelle à chaque reprise (`--system-prompt-snapshot`
//! activé par défaut). Tout ce qui change (nom, niveau, paires, état des espaces) va
//! donc dans l'INVITE de chaque réveil, jamais dans la consigne.
//! La consigne ne remplace pas le garde-fou : le front refuse de toute façon ce que
//! le niveau n'autorise pas.

use crate::reglages::{NiveauAutonomie, PaireAutorisee, PAIRE_SUPERVISEUR};

use super::{EvenementSuperviseur, GenreEvenement};

/// Taille maximale de l'état des espaces recopié dans l'invite : au-delà, il est
/// tronqué (le superviseur peut détailler un espace avec `terminials espaces <espace>`).
pub const MAX_ETAT_CARACTERES: usize = 20_000;

/// Seule permission accordée : les sous-commandes de la CLI `terminials`.
pub const OUTILS_PERMIS: &str = "Bash(terminials *)";

/// Contexte variable d'un réveil.
#[derive(Debug, Clone, PartialEq)]
pub struct ContexteReveil {
    pub nom: String,
    pub niveau: NiveauAutonomie,
    pub paires: Vec<PaireAutorisee>,
    /// Réponse de l'outil `espaces.etat` au moment du réveil (instantané), ou
    /// l'erreur si l'interface n'a pas répondu.
    pub etat_espaces: Result<serde_json::Value, String>,
    /// Événements plus anciens oubliés faute de place dans la file.
    pub omis: u32,
}

/// Consigne fixe : rôle, outils (`terminials …`), règles. En français.
pub fn consigne_systeme() -> String {
    r#"Tu es le superviseur de terminials, un multiplexeur de terminaux où l'utilisateur fait travailler plusieurs agents de code en parallèle, chacun dans un « espace » (un dossier, avec un ou plusieurs onglets de terminal). Tu n'écris pas de code et tu ne modifies aucun fichier : tu observes les espaces, tu préviens l'utilisateur de ce qui mérite son attention, tu ranges les espaces quand ton niveau le permet, et tu relaies les questions entre agents.

Tu es réveillé par des événements : un agent attend ou a terminé, une session pose une question, l'utilisateur t'écrit, une écriture que tu as proposée a été autorisée ou refusée, la pause prend fin. Chaque réveil te rappelle ton nom, ton niveau d'autonomie, les échanges toujours autorisés et l'état des espaces : ces valeurs font foi et remplacent celles des réveils précédents.

Outils. Tes seuls outils sont les commandes « terminials » lancées par Bash : une seule commande par appel, sans enchaînement (ni &&, ni |, ni ;, ni redirection) et sans autre programme, sinon l'appel est refusé. Chaque commande rend du JSON, ou une erreur avec la liste des candidats si la désignation est ambiguë. <espace> se désigne par son id (ws:3), son nom (casse ignorée) ou un début de nom sans ambiguïté ; --onglet par son id, son titre ou son rang (1, 2…). Mets entre guillemets tout texte qui contient des espaces.

Observer (toujours permis) :
- terminials espaces [<espace>] : espaces, onglets, état des agents (travail, attente, termine, repos), groupes.
- terminials lire <espace> [--onglet O] [--lignes N] : dernières lignes d'un terminal (40 par défaut, 200 au plus).
- terminials prevenir "<texte>" [--titre T] [--espace E] : prévient l'utilisateur.
- terminials demander <espace> "<question>" : pose une question à la session d'un espace (ouvre un échange).
- terminials resumer <espace> "<phrase>" : pose la phrase qui résume ce que fait l'espace, affichée sur sa carte dans le poste de suivi.
Réorganiser (niveau Réorganiser ou Agir) :
- terminials creer --dossier D [--nom N] [--groupe G] [--couleur C]
- terminials renommer <espace> "<nom>"
- terminials deplacer <espace> [--groupe G | --hors-groupe] [--position N]
- terminials fermer <espace> : refusé si son agent travaille ou attend.
- terminials groupe "<nom>" [--couleur C] [--espaces a,b]
- terminials onglet <espace> [--dossier D]
- terminials aller <espace> [--onglet O] : montre un espace à l'utilisateur.
Écrire dans une session (niveau Agir ; presque toujours soumis à la validation de l'utilisateur) :
- terminials ecrire <espace> "<texte>" [--onglet O] [--sans-entree] --pourquoi "<raison>"
- terminials transmettre <echange> "<texte>" --pourquoi "<raison>" : transmet la question d'un échange à l'espace interrogé. Donne la question seule : l'application ajoute qui la pose, que tu la transmets, et demande une réponse courte sans modifier de fichier.
- terminials repondre <echange> "<texte>" --pourquoi "<raison>" : rend la réponse d'un échange à l'espace qui l'a posée. Donne la réponse seule : l'application ajoute qui répond.

Règles :
1. Respecte le niveau d'autonomie du réveil. Observer : lire et prévenir. Réorganiser : en plus ranger, créer, ouvrir, montrer. Agir : en plus proposer des écritures. N'essaie pas ce que ton niveau interdit : l'application le refuse de toute façon.
2. Tu n'écris dans un terminal QUE par ecrire, transmettre ou repondre, toujours avec --pourquoi : une phrase courte que l'utilisateur lira avant de valider.
3. Ne réponds jamais à la place de l'utilisateur à une demande d'autorisation d'un agent : préviens-le, la décision lui revient.
4. La réponse {"statut":"en_attente"} veut dire que l'utilisateur doit valider : ne réessaie pas et ne reformule pas ; sa décision t'arrivera dans un réveil suivant (événement de validation).
5. Un appel refusé l'est pour de bon : ne cherche pas à le contourner, dis-le en une phrase si c'est utile.
6. Ne lis un terminal que si un événement le justifie, et ne fais rien quand rien ne le demande : un réveil sans rien à signaler se termine sans texte.
7. Ce que tu écris s'affiche dans le poste de suivi : en français, en vouvoyant l'utilisateur (jamais de tutoiement : « vous », « votre demande », « à vous de valider »), court (une à trois phrases), concret, sans titres, sans longues listes, sans emoji. Nomme les espaces par leur nom, jamais par leur identifiant : aucun « ws:3 », « echange:2 » ni autre identifiant technique dans ce que lit l'utilisateur.
8. Un message de l'utilisateur appelle toujours une réponse.
9. Le poste de suivi montre déjà chacun de tes appels avec ses arguments : ne répète pas ce que tu viens de signaler par prevenir. Après un prevenir, ne rien ajouter, ou une phrase courte qui dit autre chose.
10. Tiens à jour le résumé des espaces au travail ou en attente dont le champ resume est vide : une phrase courte à l'indicatif, au présent, sans identifiant technique (pas de ws:3), qui dit ce que fait l'agent (« Écrit les tests du calcul des avoirs. »). Poser ou rafraîchir un résumé est silencieux : n'en parle pas, ni par texte ni par prevenir ; un réveil qui ne fait que résumer se termine sans texte."#
        .to_string()
}

fn libelle_niveau(n: NiveauAutonomie) -> &'static str {
    match n {
        NiveauAutonomie::Observer => "Observer (tu lis et tu préviens, rien d'autre)",
        NiveauAutonomie::Reorganiser => {
            "Réorganiser (tu peux aussi ranger, créer, ouvrir et montrer des espaces, sans écrire dans les terminaux)"
        }
        NiveauAutonomie::Agir => {
            "Agir (tu peux aussi proposer des écritures dans les terminaux, que l'utilisateur valide le plus souvent)"
        }
    }
}

fn libelle_bout(b: &str) -> &str {
    if b == PAIRE_SUPERVISEUR {
        "toi"
    } else {
        b
    }
}

fn ligne_evenement(e: &EvenementSuperviseur) -> String {
    let texte = e.texte.trim();
    let ws = e.ws_id.as_deref().filter(|w| !w.is_empty());
    // Un message sur un espace le nomme dans la phrase (pas de suffixe [ws]).
    if let (GenreEvenement::Message, Some(ws)) = (&e.genre, ws) {
        return format!("- Message de l'utilisateur, à propos de l'espace {ws} : « {texte} »");
    }
    let corps = match e.genre {
        GenreEvenement::Message => format!("Message de l'utilisateur : « {texte} »"),
        GenreEvenement::Attente => format!("Attente : {texte}"),
        GenreEvenement::Termine => format!("Terminé : {texte}"),
        GenreEvenement::Question => format!("Question : {texte}"),
        GenreEvenement::Validation => format!("Validation : {texte}"),
        GenreEvenement::Reprise => format!("Fin de la pause : {texte}"),
    };
    match ws {
        Some(ws) => format!("- {corps} [{ws}]"),
        None => format!("- {corps}"),
    }
}

/// Coupe `s` à `max` caractères au plus, sur une frontière de caractère.
fn tronquer(s: &str, max: usize) -> (&str, bool) {
    match s.char_indices().nth(max) {
        Some((i, _)) => (&s[..i], true),
        None => (s, false),
    }
}

/// Rappel ajouté à l'invite quand l'état des espaces est connu.
const RAPPEL_RESUMES: &str = "Résumés : pour chaque espace au travail ou en attente dont « resume » est null, pose une phrase avec terminials resumer, sans l'annoncer.";

/// Invite d'un réveil : contexte + événements regroupés.
pub fn invite_reveil(contexte: &ContexteReveil, evenements: &[EvenementSuperviseur]) -> String {
    let mut s = String::new();
    let n = evenements.len();
    s.push_str(&format!(
        "Réveil : {n} événement{}.\n",
        if n > 1 { "s" } else { "" }
    ));
    s.push_str(&format!("Ton nom : {}.\n", contexte.nom.trim()));
    s.push_str(&format!(
        "Niveau d'autonomie : {}.\n",
        libelle_niveau(contexte.niveau)
    ));
    if contexte.paires.is_empty() {
        s.push_str("Échanges toujours autorisés : aucun.\n");
    } else {
        let paires: Vec<String> = contexte
            .paires
            .iter()
            .map(|p| format!("{} ↔ {}", libelle_bout(&p.a), libelle_bout(&p.b)))
            .collect();
        s.push_str(&format!(
            "Échanges toujours autorisés, sans validation (espaces désignés par leur dossier) : {}.\n",
            paires.join(" ; ")
        ));
    }

    s.push_str("\nÉvénements :\n");
    for e in evenements {
        s.push_str(&ligne_evenement(e));
        s.push('\n');
    }
    if contexte.omis > 0 {
        s.push_str(&format!(
            "({} événement(s) plus ancien(s) omis.)\n",
            contexte.omis
        ));
    }

    s.push_str("\nÉtat des espaces (instantané de « terminials espaces ») :\n");
    match &contexte.etat_espaces {
        Ok(v) => {
            let json = v.to_string();
            let (debut, coupe) = tronquer(&json, MAX_ETAT_CARACTERES);
            s.push_str(debut);
            if coupe {
                s.push_str("\n(tronqué : détaille un espace avec « terminials espaces <espace> »)");
            }
            s.push('\n');
            // Rappel hors de la consigne système : celle-ci est rejouée telle quelle par
            // les sessions déjà ouvertes.
            s.push_str(RAPPEL_RESUMES);
            s.push('\n');
        }
        Err(e) => {
            s.push_str(&format!(
                "indisponible ({e}) ; utilise « terminials espaces » si tu en as besoin.\n"
            ));
        }
    }
    s
}

/// Arguments de `claude` pour un tour : mode non interactif, flux JSON, consigne
/// ajoutée, seul outil Bash limité aux sous-commandes `terminials`, rien qui demande
/// (tout le reste est refusé d'office), ni serveur MCP, ni commande slash, ni hook de
/// l'utilisateur (les hooks d'un agent n'ont pas à se déclencher pour le superviseur).
/// Pas de `--bare` : il ne lit plus l'authentification de l'utilisateur.
pub fn arguments(consigne: &str, reprise: Option<&str>) -> Vec<String> {
    let mut a: Vec<String> = vec![
        "-p".into(),
        "--output-format".into(),
        "stream-json".into(),
        "--verbose".into(),
    ];
    if let Some(id) = reprise {
        a.push("--resume".into());
        a.push(id.into());
    }
    a.extend(
        [
            "--append-system-prompt",
            consigne,
            "--tools",
            "Bash",
            "--allowedTools",
            OUTILS_PERMIS,
            "--permission-mode",
            "dontAsk",
            "--strict-mcp-config",
            "--disable-slash-commands",
            "--settings",
            r#"{"disableAllHooks":true}"#,
        ]
        .map(String::from),
    );
    a
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ctx() -> ContexteReveil {
        ContexteReveil {
            nom: "Vigie".into(),
            niveau: NiveauAutonomie::Reorganiser,
            paires: vec![
                PaireAutorisee {
                    a: "/src/site".into(),
                    b: "/src/api".into(),
                    depuis: 0,
                    echanges: 2,
                },
                PaireAutorisee {
                    a: "/src/api".into(),
                    b: PAIRE_SUPERVISEUR.into(),
                    depuis: 0,
                    echanges: 0,
                },
            ],
            etat_espaces: Ok(
                serde_json::json!({"espaces":[{"id":"ws:3","nom":"api"}],"groupes":[]}),
            ),
            omis: 0,
        }
    }

    #[test]
    fn consigne_cite_toutes_les_sous_commandes_et_les_regles() {
        let c = consigne_systeme();
        for cmd in [
            "terminials espaces",
            "terminials lire",
            "terminials prevenir",
            "terminials demander",
            "terminials resumer",
            "terminials creer",
            "terminials renommer",
            "terminials deplacer",
            "terminials fermer",
            "terminials groupe",
            "terminials onglet",
            "terminials aller",
            "terminials ecrire",
            "terminials transmettre",
            "terminials repondre",
        ] {
            assert!(c.contains(cmd), "{cmd} absent de la consigne");
        }
        assert!(c.contains("--pourquoi"));
        assert!(c.contains("en_attente"));
        // L'interface vouvoie : le superviseur aussi.
        assert!(c.contains("en vouvoyant l'utilisateur"));
        // Rien de variable dans la consigne (figée à la première requête).
        assert!(!c.contains("Vigie"));
    }

    #[test]
    fn invite_porte_nom_niveau_paires_evenements_et_etat() {
        let evs = vec![
            EvenementSuperviseur {
                genre: GenreEvenement::Attente,
                texte: "api attend une autorisation : npm run migrate.".into(),
                ws_id: Some("ws:3".into()),
            },
            EvenementSuperviseur {
                genre: GenreEvenement::Message,
                texte: "Où en sont mes agents ?".into(),
                ws_id: None,
            },
        ];
        let i = invite_reveil(&ctx(), &evs);
        assert!(i.starts_with("Réveil : 2 événements."), "{i}");
        assert!(i.contains("Ton nom : Vigie."));
        assert!(i.contains("Niveau d'autonomie : Réorganiser"));
        assert!(i.contains("/src/site ↔ /src/api ; /src/api ↔ toi"));
        assert!(i.contains("- Attente : api attend une autorisation : npm run migrate. [ws:3]"));
        assert!(i.contains("- Message de l'utilisateur : « Où en sont mes agents ? »"));
        assert!(i.contains(r#"{"espaces":[{"id":"ws:3","nom":"api"}],"groupes":[]}"#));
    }

    #[test]
    fn message_a_propos_d_un_espace_le_nomme() {
        let e = EvenementSuperviseur {
            genre: GenreEvenement::Message,
            texte: " Où en est api ? ".into(),
            ws_id: Some("ws:3".into()),
        };
        assert_eq!(
            ligne_evenement(&e),
            "- Message de l'utilisateur, à propos de l'espace ws:3 : « Où en est api ? »"
        );
        let vide = EvenementSuperviseur {
            ws_id: Some(String::new()),
            ..e
        };
        assert_eq!(
            ligne_evenement(&vide),
            "- Message de l'utilisateur : « Où en est api ? »"
        );
    }

    #[test]
    fn rappel_des_resumes_seulement_si_l_etat_est_connu() {
        let i = invite_reveil(&ctx(), &[]);
        assert!(i.contains("terminials resumer, sans l'annoncer"), "{i}");
        let mut c = ctx();
        c.etat_espaces = Err("indisponible".into());
        assert!(!invite_reveil(&c, &[]).contains("Résumés :"));
    }

    #[test]
    fn invite_sans_paires_avec_omis_et_etat_indisponible() {
        let mut c = ctx();
        c.paires.clear();
        c.omis = 4;
        c.etat_espaces = Err("l'interface n'a pas répondu à temps".into());
        c.niveau = NiveauAutonomie::Observer;
        let evs = vec![EvenementSuperviseur {
            genre: GenreEvenement::Termine,
            texte: "site a fini".into(),
            ws_id: None,
        }];
        let i = invite_reveil(&c, &evs);
        assert!(i.starts_with("Réveil : 1 événement."));
        assert!(i.contains("Échanges toujours autorisés : aucun."));
        assert!(i.contains("(4 événement(s) plus ancien(s) omis.)"));
        assert!(i.contains("indisponible (l'interface n'a pas répondu à temps)"));
        assert!(i.contains("Observer (tu lis et tu préviens"));
    }

    #[test]
    fn etat_trop_gros_tronque_sur_un_caractere() {
        let mut c = ctx();
        c.etat_espaces = Ok(serde_json::json!({ "x": "é".repeat(MAX_ETAT_CARACTERES * 2) }));
        let i = invite_reveil(&c, &[]);
        assert!(i.contains("(tronqué"));
        assert!(i.chars().count() < MAX_ETAT_CARACTERES + 2_000);
    }

    #[test]
    fn arguments_du_cli() {
        let a = arguments("CONSIGNE", None);
        let pos = |x: &str| {
            a.iter()
                .position(|v| v == x)
                .unwrap_or_else(|| panic!("{x} absent"))
        };
        assert_eq!(
            &a[..4],
            ["-p", "--output-format", "stream-json", "--verbose"]
        );
        assert_eq!(a[pos("--append-system-prompt") + 1], "CONSIGNE");
        assert_eq!(a[pos("--tools") + 1], "Bash");
        assert_eq!(a[pos("--allowedTools") + 1], "Bash(terminials *)");
        assert_eq!(a[pos("--permission-mode") + 1], "dontAsk");
        pos("--strict-mcp-config");
        pos("--disable-slash-commands");
        assert!(!a.iter().any(|v| v == "--resume" || v == "--bare"));
        // Aucun argument positionnel : l'invite part par stdin.
        let r = arguments("C", Some("abc-1"));
        assert_eq!(
            r[r.iter().position(|v| v == "--resume").unwrap() + 1],
            "abc-1"
        );
    }
}
