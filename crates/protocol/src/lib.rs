use serde::{Deserialize, Serialize};

/// Une requête envoyée par la CLI vers l'app via le socket. Une par ligne.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Request {
    pub method: String,
    #[serde(default)]
    pub params: serde_json::Value,
}

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Status {
    Ok,
    Error,
}

/// Réponse renvoyée par l'app. Une par ligne.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Response {
    pub status: Status,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub data: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

impl Response {
    pub fn ok(data: serde_json::Value) -> Self {
        Self {
            status: Status::Ok,
            data,
            error: None,
        }
    }
    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            status: Status::Error,
            data: serde_json::Value::Null,
            error: Some(msg.into()),
        }
    }
}

// ---------------------------------------------------------------------------
// Outils du superviseur : requête/réponse entre la CLI, le backend et le front.
//
// L'état (espaces, onglets, terminaux) vit dans les stores React : le backend ne sait
// pas répondre seul. Il relaie donc chaque appel d'outil vers la webview (événement
// `outil-requete`, avec un identifiant), puis attend la réponse que le front renvoie
// par la commande Tauri `outil_repondre`. Le garde-fou (classe de l'outil, niveau
// d'autonomie, pause, paires autorisées) est appliqué côté front, où vivent ces
// réglages et l'état des sessions (src/lib/gardeFou.ts).
// ---------------------------------------------------------------------------

/// Méthode socket qui porte tous les appels d'outils :
/// `{"method":"outil","params":{"outil":"terminal.lire","args":{…},"jeton":…,"workspaceId":…,"ptyId":…}}`.
pub const METHODE_OUTIL: &str = "outil";

/// Variable d'environnement qui porte le jeton du superviseur. Posée par le moteur dans
/// l'environnement du `claude` qu'il pilote, relue par la CLI et vérifiée par le backend :
/// seul un appel muni du bon jeton a l'origine « superviseur ».
pub const ENV_JETON_SUPERVISEUR: &str = "TERMINIALS_SUPERVISEUR_JETON";

/// Ce qu'un outil a le droit de faire : c'est la classe, et non la consigne donnée au
/// modèle, que le garde-fou compare au niveau d'autonomie réglé.
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum ClasseOutil {
    /// Lire l'état, lire un terminal, prévenir l'utilisateur, poser une question.
    Observer,
    /// Créer, renommer, ranger, fermer un espace ; ouvrir un onglet ; donner le focus.
    Reorganiser,
    /// Écrire dans le terminal d'une session.
    Ecrire,
}

/// Les outils, identifiés sur le fil par leur id pointé (`espace.creer`).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq, Hash)]
pub enum Outil {
    #[serde(rename = "espaces.etat")]
    EspacesEtat,
    #[serde(rename = "terminal.lire")]
    TerminalLire,
    #[serde(rename = "notifier")]
    Notifier,
    #[serde(rename = "demander")]
    Demander,
    /// Pose le résumé d'une phrase d'un espace (poste de suivi). Réservé au superviseur :
    /// le front le refuse depuis un espace ou l'extérieur.
    #[serde(rename = "espace.resumer")]
    EspaceResumer,
    #[serde(rename = "espace.creer")]
    EspaceCreer,
    #[serde(rename = "espace.renommer")]
    EspaceRenommer,
    #[serde(rename = "espace.deplacer")]
    EspaceDeplacer,
    #[serde(rename = "espace.fermer")]
    EspaceFermer,
    #[serde(rename = "groupe.creer")]
    GroupeCreer,
    #[serde(rename = "onglet.ouvrir")]
    OngletOuvrir,
    #[serde(rename = "espace.focus")]
    EspaceFocus,
    #[serde(rename = "terminal.ecrire")]
    TerminalEcrire,
    #[serde(rename = "session.demander")]
    SessionDemander,
    #[serde(rename = "session.repondre")]
    SessionRepondre,
}

impl Outil {
    pub const TOUS: [Outil; 15] = [
        Outil::EspacesEtat,
        Outil::TerminalLire,
        Outil::Notifier,
        Outil::Demander,
        Outil::EspaceResumer,
        Outil::EspaceCreer,
        Outil::EspaceRenommer,
        Outil::EspaceDeplacer,
        Outil::EspaceFermer,
        Outil::GroupeCreer,
        Outil::OngletOuvrir,
        Outil::EspaceFocus,
        Outil::TerminalEcrire,
        Outil::SessionDemander,
        Outil::SessionRepondre,
    ];

    /// Identifiant pointé, celui du fil JSON et de `src/lib/gardeFou.ts`.
    pub fn id(self) -> &'static str {
        match self {
            Outil::EspacesEtat => "espaces.etat",
            Outil::TerminalLire => "terminal.lire",
            Outil::Notifier => "notifier",
            Outil::Demander => "demander",
            Outil::EspaceResumer => "espace.resumer",
            Outil::EspaceCreer => "espace.creer",
            Outil::EspaceRenommer => "espace.renommer",
            Outil::EspaceDeplacer => "espace.deplacer",
            Outil::EspaceFermer => "espace.fermer",
            Outil::GroupeCreer => "groupe.creer",
            Outil::OngletOuvrir => "onglet.ouvrir",
            Outil::EspaceFocus => "espace.focus",
            Outil::TerminalEcrire => "terminal.ecrire",
            Outil::SessionDemander => "session.demander",
            Outil::SessionRepondre => "session.repondre",
        }
    }

    pub fn depuis_id(id: &str) -> Option<Outil> {
        Outil::TOUS.into_iter().find(|o| o.id() == id)
    }

    /// Classe de l'outil. Doit rester identique à `CLASSES` de `src/lib/gardeFou.ts`
    /// (vérifié de part et d'autre par un test sur la même table).
    pub fn classe(self) -> ClasseOutil {
        match self {
            Outil::EspacesEtat
            | Outil::TerminalLire
            | Outil::Notifier
            | Outil::Demander
            | Outil::EspaceResumer => ClasseOutil::Observer,
            Outil::EspaceCreer
            | Outil::EspaceRenommer
            | Outil::EspaceDeplacer
            | Outil::EspaceFermer
            | Outil::GroupeCreer
            | Outil::OngletOuvrir
            | Outil::EspaceFocus => ClasseOutil::Reorganiser,
            Outil::TerminalEcrire | Outil::SessionDemander | Outil::SessionRepondre => {
                ClasseOutil::Ecrire
            }
        }
    }
}

/// Qui appelle l'outil. Déterminée par le BACKEND (jeton, variables d'environnement
/// jointes par la CLI), jamais déclarée librement par l'appelant.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum Origine {
    /// Le `claude` piloté par le moteur du superviseur (jeton valide).
    Superviseur,
    /// Un agent (ou l'utilisateur) dans le terminal d'un espace de l'app.
    Espace {
        #[serde(rename = "workspaceId")]
        workspace_id: String,
        #[serde(rename = "ptyId", default, skip_serializing_if = "Option::is_none")]
        pty_id: Option<u64>,
    },
    /// Une CLI lancée hors de l'app.
    Externe,
}

/// Charge de l'événement `outil-requete` (backend → front).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct RequeteOutil {
    /// Identifiant de corrélation : le front le rend tel quel à `outil_repondre`.
    pub id: u64,
    pub outil: Outil,
    #[serde(default)]
    pub args: serde_json::Value,
    pub origine: Origine,
}

/// Réponse du front à une requête d'outil (commande `outil_repondre`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Default)]
pub struct ReponseOutil {
    pub ok: bool,
    #[serde(default, skip_serializing_if = "serde_json::Value::is_null")]
    pub data: serde_json::Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub erreur: Option<String>,
}

impl ReponseOutil {
    pub fn ok(data: serde_json::Value) -> Self {
        Self {
            ok: true,
            data,
            erreur: None,
        }
    }
    pub fn err(msg: impl Into<String>) -> Self {
        Self {
            ok: false,
            data: serde_json::Value::Null,
            erreur: Some(msg.into()),
        }
    }
}

/// Arguments des outils, tels que la CLI les envoie et que le front les lit.
/// Un `espace` désigne un espace par son id, sinon par son nom (casse ignorée), sinon
/// par un préfixe unique de son nom ; un `onglet` par son id, son titre ou son rang (1…).
pub mod args {
    use serde::{Deserialize, Serialize};

    #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", default)]
    pub struct EspacesEtat {
        /// Un seul espace ; absent : tous.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub espace: Option<String>,
    }

    #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", default)]
    pub struct TerminalLire {
        pub espace: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub onglet: Option<String>,
        /// Défaut 40, plafonné à 200 par le front.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub lignes: Option<u32>,
    }

    #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", default)]
    pub struct Notifier {
        pub texte: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub titre: Option<String>,
        /// Espace concerné (la bulle propose d'y aller).
        #[serde(skip_serializing_if = "Option::is_none")]
        pub espace: Option<String>,
    }

    #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", default)]
    pub struct EspaceResumer {
        pub espace: String,
        pub texte: String,
    }

    #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", default)]
    pub struct Demander {
        /// Espace à qui poser la question ; absent : au superviseur lui-même.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub espace: Option<String>,
        pub question: String,
    }

    #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", default)]
    pub struct EspaceCreer {
        pub dossier: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub nom: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub groupe: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub couleur: Option<String>,
    }

    #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", default)]
    pub struct EspaceRenommer {
        pub espace: String,
        pub nom: String,
    }

    #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", default)]
    pub struct EspaceDeplacer {
        pub espace: String,
        /// Groupe de destination ; `Some("")` : hors groupe ; absent : groupe inchangé.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub groupe: Option<String>,
        /// Rang dans sa nouvelle appartenance (0 = en tête) ; absent : à la fin.
        #[serde(skip_serializing_if = "Option::is_none")]
        pub position: Option<u32>,
    }

    #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", default)]
    pub struct EspaceFermer {
        pub espace: String,
    }

    #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", default)]
    pub struct GroupeCreer {
        pub nom: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub couleur: Option<String>,
        /// Espaces à y ranger d'emblée.
        #[serde(skip_serializing_if = "Vec::is_empty")]
        pub espaces: Vec<String>,
    }

    #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", default)]
    pub struct OngletOuvrir {
        pub espace: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub dossier: Option<String>,
    }

    #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", default)]
    pub struct EspaceFocus {
        pub espace: String,
        #[serde(skip_serializing_if = "Option::is_none")]
        pub onglet: Option<String>,
    }

    fn vrai() -> bool {
        true
    }

    #[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase")]
    pub struct TerminalEcrire {
        pub espace: String,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub onglet: Option<String>,
        /// Texte exact écrit dans le terminal (montré tel quel sur la carte « À valider »).
        pub texte: String,
        /// Valider par Entrée après le texte (défaut : oui).
        #[serde(default = "vrai")]
        pub entree: bool,
        /// Pourquoi le superviseur veut écrire : affiché sur la carte.
        #[serde(default)]
        pub pourquoi: String,
    }

    /// `session.demander` (transmettre la question d'un échange à l'espace interrogé) et
    /// `session.repondre` (rendre la réponse à l'espace qui a demandé).
    #[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
    #[serde(rename_all = "camelCase", default)]
    pub struct SessionEchange {
        /// Identifiant de l'échange (créé par `demander`).
        pub echange: String,
        pub texte: String,
        pub pourquoi: String,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn request_roundtrip_jsonline() {
        let req = Request {
            method: "notify".into(),
            params: serde_json::json!({"title":"t","body":"b"}),
        };
        let line = serde_json::to_string(&req).unwrap();
        assert!(
            !line.contains('\n'),
            "une requête sérialisée ne doit pas contenir de newline"
        );
        let back: Request = serde_json::from_str(&line).unwrap();
        assert_eq!(back.method, "notify");
    }

    #[test]
    fn response_ok_and_err() {
        let ok = Response::ok(serde_json::json!({"id": 1}));
        let err = Response::err("boom");
        assert!(matches!(ok.status, Status::Ok));
        assert!(matches!(err.status, Status::Error));
        assert_eq!(err.error.as_deref(), Some("boom"));
    }

    #[test]
    fn chaque_outil_a_un_id_unique_qui_le_redonne() {
        for o in Outil::TOUS {
            assert_eq!(Outil::depuis_id(o.id()), Some(o));
            let json = serde_json::to_string(&o).unwrap();
            assert_eq!(json, format!("\"{}\"", o.id()));
        }
        assert_eq!(Outil::depuis_id("inconnu"), None);
    }

    /// Même table que `CLASSES` de src/lib/gardeFou.ts (son test porte la même liste).
    #[test]
    fn classes_des_outils() {
        let attendu = [
            ("espaces.etat", ClasseOutil::Observer),
            ("terminal.lire", ClasseOutil::Observer),
            ("notifier", ClasseOutil::Observer),
            ("demander", ClasseOutil::Observer),
            ("espace.resumer", ClasseOutil::Observer),
            ("espace.creer", ClasseOutil::Reorganiser),
            ("espace.renommer", ClasseOutil::Reorganiser),
            ("espace.deplacer", ClasseOutil::Reorganiser),
            ("espace.fermer", ClasseOutil::Reorganiser),
            ("groupe.creer", ClasseOutil::Reorganiser),
            ("onglet.ouvrir", ClasseOutil::Reorganiser),
            ("espace.focus", ClasseOutil::Reorganiser),
            ("terminal.ecrire", ClasseOutil::Ecrire),
            ("session.demander", ClasseOutil::Ecrire),
            ("session.repondre", ClasseOutil::Ecrire),
        ];
        assert_eq!(attendu.len(), Outil::TOUS.len());
        for (id, classe) in attendu {
            assert_eq!(Outil::depuis_id(id).unwrap().classe(), classe, "{id}");
        }
    }

    #[test]
    fn origine_en_json() {
        assert_eq!(
            serde_json::to_value(Origine::Superviseur).unwrap(),
            serde_json::json!({"type":"superviseur"})
        );
        let e = Origine::Espace {
            workspace_id: "ws:3".into(),
            pty_id: Some(7),
        };
        assert_eq!(
            serde_json::to_value(&e).unwrap(),
            serde_json::json!({"type":"espace","workspaceId":"ws:3","ptyId":7})
        );
        let sans_pty: Origine =
            serde_json::from_str(r#"{"type":"espace","workspaceId":"ws:1"}"#).unwrap();
        assert_eq!(
            sans_pty,
            Origine::Espace {
                workspace_id: "ws:1".into(),
                pty_id: None
            }
        );
    }

    #[test]
    fn requete_et_reponse_d_outil() {
        let r = RequeteOutil {
            id: 4,
            outil: Outil::TerminalLire,
            args: serde_json::json!({"espace":"api","lignes":40}),
            origine: Origine::Externe,
        };
        let v = serde_json::to_value(&r).unwrap();
        assert_eq!(v["outil"], "terminal.lire");
        assert_eq!(v["origine"]["type"], "externe");
        let rep: ReponseOutil = serde_json::from_str(r#"{"ok":false,"erreur":"non"}"#).unwrap();
        assert_eq!(rep, ReponseOutil::err("non"));
    }

    #[test]
    fn ecrire_valide_par_entree_par_defaut() {
        let a: args::TerminalEcrire =
            serde_json::from_str(r#"{"espace":"api","texte":"1"}"#).unwrap();
        assert!(a.entree);
        assert_eq!(a.pourquoi, "");
        let d: args::EspaceDeplacer =
            serde_json::from_str(r#"{"espace":"x","groupe":""}"#).unwrap();
        assert_eq!(d.groupe.as_deref(), Some(""));
    }
}
