//! Valeur JSON qui garde l'ordre des clés de ses objets.
//!
//! `serde_json::Value` (sans la fonctionnalité `preserve_order`, absente de l'espace de
//! travail) range les clés par ordre alphabétique : réécrire `~/.claude/settings.json`
//! avec lui bouleverserait le fichier de l'utilisateur. Cette valeur relit et réécrit les
//! objets dans leur ordre d'origine (doublons compris), si bien que la fusion des hooks
//! ne change que ce qu'elle ajoute.

use std::fmt;

use serde::de::{Deserialize, Deserializer, MapAccess, SeqAccess, Visitor};
use serde::ser::{Serialize, SerializeMap, SerializeSeq, Serializer};

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Nombre(serde_json::Number),
    Texte(String),
    Liste(Vec<Json>),
    Objet(Vec<(String, Json)>),
}

impl Json {
    pub fn objet_vide() -> Json {
        Json::Objet(Vec::new())
    }

    pub fn texte(&self) -> Option<&str> {
        match self {
            Json::Texte(s) => Some(s),
            _ => None,
        }
    }

    /// Première valeur de la clé, si `self` est un objet.
    pub fn champ(&self, cle: &str) -> Option<&Json> {
        match self {
            Json::Objet(paires) => paires.iter().find(|(k, _)| k == cle).map(|(_, v)| v),
            _ => None,
        }
    }

    pub fn champ_mut(&mut self, cle: &str) -> Option<&mut Json> {
        match self {
            Json::Objet(paires) => paires.iter_mut().find(|(k, _)| k == cle).map(|(_, v)| v),
            _ => None,
        }
    }

    /// Valeur de la clé, créée à la fin de l'objet avec `defaut` si absente. `None` si
    /// `self` n'est pas un objet.
    pub fn champ_ou_inserer(&mut self, cle: &str, defaut: Json) -> Option<&mut Json> {
        let Json::Objet(paires) = self else {
            return None;
        };
        let i = match paires.iter().position(|(k, _)| k == cle) {
            Some(i) => i,
            None => {
                paires.push((cle.to_string(), defaut));
                paires.len() - 1
            }
        };
        Some(&mut paires[i].1)
    }
}

impl Serialize for Json {
    fn serialize<S: Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        match self {
            Json::Null => s.serialize_unit(),
            Json::Bool(b) => s.serialize_bool(*b),
            Json::Nombre(n) => n.serialize(s),
            Json::Texte(t) => s.serialize_str(t),
            Json::Liste(l) => {
                let mut seq = s.serialize_seq(Some(l.len()))?;
                for v in l {
                    seq.serialize_element(v)?;
                }
                seq.end()
            }
            Json::Objet(paires) => {
                let mut map = s.serialize_map(Some(paires.len()))?;
                for (k, v) in paires {
                    map.serialize_entry(k, v)?;
                }
                map.end()
            }
        }
    }
}

struct VisiteurJson;

impl<'de> Visitor<'de> for VisiteurJson {
    type Value = Json;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("une valeur JSON")
    }
    fn visit_unit<E>(self) -> Result<Json, E> {
        Ok(Json::Null)
    }
    fn visit_none<E>(self) -> Result<Json, E> {
        Ok(Json::Null)
    }
    fn visit_bool<E>(self, b: bool) -> Result<Json, E> {
        Ok(Json::Bool(b))
    }
    fn visit_i64<E>(self, n: i64) -> Result<Json, E> {
        Ok(Json::Nombre(n.into()))
    }
    fn visit_u64<E>(self, n: u64) -> Result<Json, E> {
        Ok(Json::Nombre(n.into()))
    }
    fn visit_f64<E>(self, n: f64) -> Result<Json, E> {
        // JSON n'a ni NaN ni infini : `from_f64` ne peut échouer que sur une entrée
        // impossible à produire par le lecteur JSON.
        Ok(serde_json::Number::from_f64(n).map_or(Json::Null, Json::Nombre))
    }
    fn visit_str<E>(self, s: &str) -> Result<Json, E> {
        Ok(Json::Texte(s.to_string()))
    }
    fn visit_string<E>(self, s: String) -> Result<Json, E> {
        Ok(Json::Texte(s))
    }
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Json, A::Error> {
        let mut l = Vec::new();
        while let Some(v) = seq.next_element()? {
            l.push(v);
        }
        Ok(Json::Liste(l))
    }
    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Json, A::Error> {
        let mut paires = Vec::new();
        while let Some((k, v)) = map.next_entry::<String, Json>()? {
            paires.push((k, v));
        }
        Ok(Json::Objet(paires))
    }
}

impl<'de> Deserialize<'de> for Json {
    fn deserialize<D: Deserializer<'de>>(d: D) -> Result<Json, D::Error> {
        d.deserialize_any(VisiteurJson)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn l_ordre_des_cles_survit_a_l_aller_retour() {
        let source = r#"{"zeta":1,"alpha":{"b":true,"a":null},"liste":[1.5,"x",-3],"mu":"é"}"#;
        let v: Json = serde_json::from_str(source).unwrap();
        assert_eq!(serde_json::to_string(&v).unwrap(), source);
    }

    #[test]
    fn champ_ou_inserer_ajoute_a_la_fin() {
        let mut v: Json = serde_json::from_str(r#"{"b":1}"#).unwrap();
        v.champ_ou_inserer("a", Json::objet_vide());
        assert_eq!(serde_json::to_string(&v).unwrap(), r#"{"b":1,"a":{}}"#);
        assert!(Json::Null.champ_ou_inserer("a", Json::Null).is_none());
    }
}
