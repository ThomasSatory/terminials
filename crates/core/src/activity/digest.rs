//! Construction du digest textuel déterministe envoyé au LLM pour le résumé
//! d'une journée (spec §6). Le texte est groupé par workspace puis par heure
//! locale, et haché en SHA-256 pour permettre la mise en cache des résumés.

use super::tickets::ticket_url;
use super::{workspace_name, ActivityEvent, EventKind, TicketInfo};
use chrono::Timelike;
use sha2::{Digest as _, Sha256};
use std::collections::BTreeMap;

/// Taille maximale (en octets) du texte du digest. Au-delà, on compacte
/// progressivement (suppression des commandes shell **et des corps de commit**,
/// puis troncature plus agressive des prompts, puis coupe brutale en dernier
/// recours).
pub const MAX_CHARS: usize = 24_000;

/// Digest textuel d'une journée d'événements, prêt à être envoyé au LLM.
pub struct Digest {
    pub text: String,
    /// SHA-256 hexadécimal du texte, pour la mise en cache des résumés.
    pub hash: String,
    pub event_count: usize,
}

#[derive(serde::Deserialize)]
struct CommitStats {
    files: i64,
    added: i64,
    deleted: i64,
    /// Corps du commit tel que collecté (tronqué à 400 caractères par le
    /// collecteur git). `default` : les lignes écrites avant l'ajout du champ ne
    /// l'ont pas, et une base existante doit rester lisible.
    #[serde(default)]
    body: String,
}

/// Construit le digest déterministe des `events` du jour, en utilisant `offset`
/// comme fuseau pour l'affichage des heures et `tickets` pour enrichir les
/// identifiants de tickets cités (nom, statut).
pub fn build_digest(events: &[ActivityEvent], tickets: &[TicketInfo], offset: chrono::FixedOffset) -> Digest {
    let text = render(events, tickets, offset, true, 120);
    let text = if text.len() > MAX_CHARS { render(events, tickets, offset, false, 120) } else { text };
    let text = if text.len() > MAX_CHARS { render(events, tickets, offset, false, 60) } else { text };
    let text = if text.len() > MAX_CHARS { truncate_at_line_boundary(&text, MAX_CHARS) } else { text };

    let hash = Sha256::digest(text.as_bytes()).iter().map(|b| format!("{b:02x}")).collect();
    Digest { text, hash, event_count: events.len() }
}

/// Coupe `text` à `max_chars` octets au plus, sur une frontière de ligne.
/// `max_chars` est un index en octets qui peut tomber au milieu d'un caractère
/// UTF-8 multi-octets (guillemets, tiret, accents) : on recule d'abord jusqu'à
/// la frontière de caractère valide la plus proche avant de trancher.
fn truncate_at_line_boundary(text: &str, max_chars: usize) -> String {
    if text.len() <= max_chars {
        return text.to_string();
    }
    let mut end = max_chars.min(text.len());
    while end > 0 && !text.is_char_boundary(end) {
        end -= 1;
    }
    match text[..end].rfind('\n') {
        Some(pos) => text[..=pos].to_string(),
        None => String::new(),
    }
}

/// Heure locale d'un horodatage. `%at` d'un commit est arbitraire (une date
/// aberrante suffit) : un timestamp hors bornes se replie sur epoch 0 plutôt que
/// de faire paniquer toute la construction du digest.
fn local_hour(ts: i64, offset: chrono::FixedOffset) -> u32 {
    chrono::DateTime::from_timestamp(ts, 0)
        .unwrap_or(chrono::DateTime::UNIX_EPOCH)
        .with_timezone(&offset)
        .hour()
}

fn truncate_title(title: &str, limit: usize) -> String {
    let count = title.chars().count();
    if count <= limit {
        format!("« {title} »")
    } else {
        let truncated: String = title.chars().take(limit).collect();
        format!("« {truncated}… »")
    }
}

fn render_commit_stats(body: Option<&str>) -> String {
    let Some(body) = body else { return String::new() };
    let Ok(stats) = serde_json::from_str::<CommitStats>(body) else { return String::new() };
    let word = if stats.files == 1 { "fichier" } else { "fichiers" };
    format!(" (+{} −{}, {} {word})", stats.added, stats.deleted, stats.files)
}

/// Corps du commit, une ligne indentée de deux espaces par ligne non vide, ou
/// chaîne vide s'il n'y en a pas. C'est la source la plus riche en intentions du
/// journal (spec §6 : « commits intégraux, sujet + corps ≤ 400 caractères »).
fn render_commit_body(body: Option<&str>) -> String {
    let Some(body) = body else { return String::new() };
    let Ok(stats) = serde_json::from_str::<CommitStats>(body) else { return String::new() };
    let lignes: Vec<String> = stats
        .body
        .lines()
        .map(|l| l.trim_end())
        .filter(|l| !l.is_empty())
        .map(|l| format!("  {l}"))
        .collect();
    if lignes.is_empty() {
        String::new()
    } else {
        format!("\n{}", lignes.join("\n"))
    }
}

fn ticket_brackets(ticket_ids: &[String]) -> String {
    if ticket_ids.is_empty() {
        String::new()
    } else {
        format!(" [{}]", ticket_ids.join(", "))
    }
}

/// Rend un événement non-`ShellCmd` en une ligne du digest (plus, pour un commit
/// et si `include_body`, les lignes indentées de son corps).
fn render_event_line(ev: &ActivityEvent, prompt_limit: usize, include_body: bool) -> String {
    match ev.kind {
        EventKind::Commit => {
            let corps = if include_body { render_commit_body(ev.body.as_deref()) } else { String::new() };
            format!(
                "- commit : {}{}{}{corps}",
                ev.title,
                render_commit_stats(ev.body.as_deref()),
                ticket_brackets(&ev.ticket_ids)
            )
        }
        EventKind::ClaudePrompt => format!("- claude : {}", truncate_title(&ev.title, prompt_limit)),
        EventKind::ClaudeSession => format!("- session : {}", ev.title),
        EventKind::ClickupChange => format!("- clickup : {}{}", ev.title, ticket_brackets(&ev.ticket_ids)),
        EventKind::ShellCmd => unreachable!("les événements shell sont rendus séparément"),
    }
}

/// Rend la ligne unique des commandes shell d'une heure (dédupliquées par titre,
/// dans l'ordre de première apparition, avec un compteur `×n` si répétées).
fn render_shell_line(shells: &[&ActivityEvent]) -> Option<String> {
    if shells.is_empty() {
        return None;
    }
    let mut order: Vec<&str> = Vec::new();
    let mut counts: BTreeMap<&str, u32> = BTreeMap::new();
    for ev in shells {
        let title = ev.title.as_str();
        if !counts.contains_key(title) {
            order.push(title);
        }
        *counts.entry(title).or_insert(0) += 1;
    }
    let parts: Vec<String> = order
        .into_iter()
        .map(|title| {
            let n = counts[title];
            if n > 1 { format!("{title} ×{n}") } else { title.to_string() }
        })
        .collect();
    Some(format!("- shell : {}", parts.join(" · ")))
}

/// Rend les lignes d'une heure donnée : les événements non-shell dans l'ordre
/// chronologique, suivis (si `include_shell`) d'une unique ligne agrégeant les
/// commandes shell de l'heure.
///
/// `include_shell` gouverne aussi les corps de commit : ils ne sont rendus qu'au
/// palier complet et disparaissent dès le premier palier de compaction, en même
/// temps que les commandes — les deux sont les postes les plus volumineux du
/// digest, et le sujet du commit suffit à en garder la trace.
fn render_hour_lines(events: &[&ActivityEvent], include_shell: bool, prompt_limit: usize) -> Vec<String> {
    let mut lines = Vec::new();
    let mut shells = Vec::new();
    for ev in events {
        if ev.kind == EventKind::ShellCmd {
            shells.push(*ev);
        } else {
            lines.push(render_event_line(ev, prompt_limit, include_shell));
        }
    }
    if include_shell {
        if let Some(line) = render_shell_line(&shells) {
            lines.push(line);
        }
    }
    lines
}

/// En-tête d'un groupe workspace, ou `## ClickUp` pour les événements sans
/// `workspace_dir`. La branche affichée est celle du premier événement du
/// groupe (par ordre chronologique) qui en a une.
fn render_group_header(dir: Option<&str>, events: &[&ActivityEvent]) -> String {
    let Some(dir) = dir else { return "## ClickUp".to_string() };
    let name = workspace_name(dir);
    let branch = events.iter().find_map(|e| e.branch.as_deref());
    match branch {
        Some(b) => format!("## {name} ({dir}) — branche {b}"),
        None => format!("## {name} ({dir})"),
    }
}

/// Rend un groupe (workspace ou ClickUp) : en-tête puis les heures, triées,
/// chacune précédée de son sous-titre `### HHh`.
fn render_group(dir: Option<&str>, events: &[&ActivityEvent], include_shell: bool, prompt_limit: usize, offset: chrono::FixedOffset) -> String {
    let mut by_hour: BTreeMap<u32, Vec<&ActivityEvent>> = BTreeMap::new();
    for ev in events {
        by_hour.entry(local_hour(ev.ts, offset)).or_default().push(ev);
    }
    let mut section = vec![render_group_header(dir, events)];
    for (hour, hour_events) in &by_hour {
        section.push(format!("### {hour:02}h"));
        section.extend(render_hour_lines(hour_events, include_shell, prompt_limit));
    }
    section.join("\n")
}

/// Rend la section finale `## Tickets cités`, si au moins un identifiant de
/// ticket est cité par les événements. `events` doit être trié par `ts`
/// croissant : l'ordre de première apparition est donc l'ordre chronologique,
/// indépendamment de l'ordre d'entrée du digest ou du regroupement par workspace.
fn render_tickets_section(events: &[&ActivityEvent], tickets: &[TicketInfo]) -> Option<String> {
    let mut ids: Vec<&str> = Vec::new();
    for ev in events {
        for id in &ev.ticket_ids {
            if !ids.contains(&id.as_str()) {
                ids.push(id.as_str());
            }
        }
    }
    if ids.is_empty() {
        return None;
    }
    let mut section = vec!["## Tickets cités".to_string()];
    for id in ids {
        let line = match tickets.iter().find(|t| t.id == id) {
            Some(t) => format!("- [{}] {} — {} — {}", t.id, t.name, t.status, t.url),
            None => format!("- [{id}] (inconnu) — {}", ticket_url(id)),
        };
        section.push(line);
    }
    Some(section.join("\n"))
}

fn render(events: &[ActivityEvent], tickets: &[TicketInfo], offset: chrono::FixedOffset, include_shell: bool, prompt_limit: usize) -> String {
    let mut sorted: Vec<&ActivityEvent> = events.iter().collect();
    sorted.sort_by_key(|e| e.ts);

    // Groupes workspace triés par (nom, dossier) ; les événements sans
    // `workspace_dir` forment le groupe `ClickUp`, rendu en dernier.
    let mut by_ws: BTreeMap<(String, String), Vec<&ActivityEvent>> = BTreeMap::new();
    let mut clickup: Vec<&ActivityEvent> = Vec::new();
    for ev in &sorted {
        match &ev.workspace_dir {
            Some(dir) => by_ws.entry((workspace_name(dir), dir.clone())).or_default().push(ev),
            None => clickup.push(ev),
        }
    }

    let mut sections: Vec<String> = Vec::new();
    for ((_, dir), group_events) in &by_ws {
        sections.push(render_group(Some(dir.as_str()), group_events, include_shell, prompt_limit, offset));
    }
    if !clickup.is_empty() {
        sections.push(render_group(None, &clickup, include_shell, prompt_limit, offset));
    }
    if let Some(tickets_section) = render_tickets_section(&sorted, tickets) {
        sections.push(tickets_section);
    }

    if sections.is_empty() {
        String::new()
    } else {
        format!("{}\n", sections.join("\n\n"))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::FixedOffset;

    fn ev(ts: i64, kind: EventKind, dir: &str, title: &str, tickets: &[&str]) -> ActivityEvent {
        ActivityEvent {
            id: 0,
            ts,
            kind,
            workspace_dir: Some(dir.into()),
            branch: Some("master".into()),
            title: title.into(),
            body: None,
            ticket_ids: tickets.iter().map(|s| s.to_string()).collect(),
            tickets: vec![],
            us_ticket: None,
        }
    }
    const T0: i64 = 1_789_516_800; // 2026-09-16 00:00 UTC
    fn utc() -> FixedOffset {
        FixedOffset::east_opt(0).unwrap()
    }

    #[test]
    fn digest_groupe_par_workspace_puis_heure_et_liste_les_tickets() {
        let mut c = ev(T0 + 9 * 3600 + 120, EventKind::Commit, "/home/t/dev/terminals", "fix(core): TERM", &["86c1abc"]);
        c.body = Some(
            r#"{"files":3,"added":42,"deleted":7,"body":"Le parseur perdait le dernier octet.\nRefs CU-86c1abc"}"#
                .into(),
        );
        let evs = vec![
            c,
            ev(T0 + 9 * 3600 + 300, EventKind::ShellCmd, "/home/t/dev/terminals", "npm test", &[]),
            ev(T0 + 9 * 3600 + 400, EventKind::ShellCmd, "/home/t/dev/terminals", "npm test", &[]),
            ev(T0 + 14 * 3600, EventKind::ClaudePrompt, "/home/t/dev/autre", "Ajoute un dashboard", &[]),
        ];
        let tickets = vec![TicketInfo {
            id: "86c1abc".into(),
            name: "Dashboard".into(),
            status: "en cours".into(),
            status_type: "custom".into(),
            url: "https://app.clickup.com/t/86c1abc".into(),
            due_date: None,
            list_name: None,
        }];
        let d = build_digest(&evs, &tickets, utc());
        let expected = "\
## autre (/home/t/dev/autre) — branche master
### 14h
- claude : « Ajoute un dashboard »

## terminals (/home/t/dev/terminals) — branche master
### 09h
- commit : fix(core): TERM (+42 −7, 3 fichiers) [86c1abc]
  Le parseur perdait le dernier octet.
  Refs CU-86c1abc
- shell : npm test ×2

## Tickets cités
- [86c1abc] Dashboard — en cours — https://app.clickup.com/t/86c1abc
";
        assert_eq!(d.text, expected);
        assert_eq!(d.event_count, 4);
        assert_eq!(d.hash.len(), 64);
        assert_eq!(build_digest(&evs, &tickets, utc()).hash, d.hash, "déterministe");
    }

    #[test]
    fn le_corps_du_commit_disparait_au_premier_palier_de_compaction() {
        // Palier complet : corps rendu. Au-delà de MAX_CHARS, le premier palier
        // (celui qui retire les commandes shell) retire aussi les corps de commit,
        // qui sont la partie la plus volumineuse par événement.
        let corps = "détail ".repeat(60);
        let mut evs = Vec::new();
        for i in 0..400 {
            let mut c = ev(T0 + i, EventKind::Commit, "/a", &format!("commit {i}"), &[]);
            c.body = Some(
                serde_json::json!({ "files": 1, "added": 1, "deleted": 0, "body": corps })
                    .to_string(),
            );
            evs.push(c);
        }
        let complet = build_digest(&evs[..1], &[], utc());
        assert!(complet.text.contains("  détail"), "palier complet : {}", complet.text);

        let compacte = build_digest(&evs, &[], utc());
        assert!(compacte.text.len() <= MAX_CHARS, "{}", compacte.text.len());
        assert!(!compacte.text.contains("détail"), "le corps doit disparaître à la compaction");
        assert!(compacte.text.contains("- commit : commit 0"), "les commits restent listés");
    }

    #[test]
    fn corps_de_commit_absent_ou_vide_ne_change_rien() {
        let mut sans_champ = ev(T0, EventKind::Commit, "/a", "x", &[]);
        sans_champ.body = Some(r#"{"files":1,"added":1,"deleted":0}"#.into());
        let mut vide = ev(T0 + 1, EventKind::Commit, "/a", "y", &[]);
        vide.body = Some(r#"{"files":1,"added":1,"deleted":0,"body":""}"#.into());
        let d = build_digest(&[sans_champ, vide], &[], utc());
        assert_eq!(
            d.text,
            "## a (/a) — branche master\n### 00h\n- commit : x (+1 −0, 1 fichier)\n- commit : y (+1 −0, 1 fichier)\n"
        );
    }

    #[test]
    fn digest_vide() {
        let d = build_digest(&[], &[], utc());
        assert_eq!(d.text, "");
        assert_eq!(d.event_count, 0);
    }

    #[test]
    fn prompt_tronque_a_120_et_ticket_inconnu_liste_avec_url_construite() {
        let long = "x".repeat(300);
        let evs = vec![ev(T0, EventKind::ClaudePrompt, "/a", &long, &["zzz1234"])];
        let d = build_digest(&evs, &[], utc());
        assert!(d.text.contains(&format!("« {}… »", "x".repeat(120))));
        assert!(d.text.contains("- [zzz1234] (inconnu) — https://app.clickup.com/t/zzz1234"));
    }

    #[test]
    fn compaction_supprime_les_commandes_puis_tronque_les_prompts() {
        let mut evs = Vec::new();
        for i in 0..2000 {
            evs.push(ev(T0 + i, EventKind::ShellCmd, "/a", &format!("cmd-{i} {}", "y".repeat(20)), &[]));
        }
        for i in 0..300 {
            evs.push(ev(T0 + 5000 + i, EventKind::ClaudePrompt, "/a", &"p".repeat(120), &[]));
        }
        let d = build_digest(&evs, &[], utc());
        assert!(d.text.len() <= MAX_CHARS, "{}", d.text.len());
        assert!(!d.text.contains("shell :"), "les commandes partent d'abord");
    }

    #[test]
    fn troncature_de_dernier_recours_ne_coupe_pas_un_caractere_utf8() {
        // Une ligne courte (le commit) puis des centaines de prompts en « é »
        // (2 octets chacun) : le texte compacté (sans commandes shell, prompts à
        // 60 caractères) dépasse MAX_CHARS et la coupe brutale à l'octet 24000
        // tombe précisément au milieu d'un caractère « é » avec cette longueur de
        // préfixe (vérifié : sans protection de frontière, `text[..24000]` panique
        // avec `byte index 24000 is not a char boundary`).
        let dir = "/a".to_string();
        let prompt = "é".repeat(120);
        let mut evs = vec![ev(T0, EventKind::Commit, &dir, "x", &[])];
        for i in 1..1000 {
            evs.push(ev(T0 + i, EventKind::ClaudePrompt, &dir, &prompt, &[]));
        }
        let d = build_digest(&evs, &[], utc());
        assert!(d.text.len() <= MAX_CHARS, "{}", d.text.len());
    }

    #[test]
    fn tickets_cites_ordonnes_par_ts_meme_si_les_evenements_arrivent_dans_le_desordre() {
        // Dossiers choisis pour que le tri des groupes workspace (par nom) placerait
        // « aaa1111 » avant « bbb2222 » dans le corps du digest de toute façon : on
        // isole donc la section « Tickets cités » pour tester spécifiquement son
        // propre ordre, indépendant de l'ordre de rendu des groupes.
        let plus_tard = ev(T0 + 10 * 3600, EventKind::Commit, "/z", "second", &["bbb2222"]);
        let plus_tot = ev(T0 + 8 * 3600, EventKind::Commit, "/a", "first", &["aaa1111"]);
        // Ordre d'entrée volontairement inversé par rapport au `ts`.
        let evs = vec![plus_tard, plus_tot];
        let d = build_digest(&evs, &[], utc());
        let section = d.text.split("## Tickets cités\n").nth(1).expect("section « Tickets cités » absente");
        let pos_aaa = section.find("aaa1111").expect("ticket aaa1111 absent de la section");
        let pos_bbb = section.find("bbb2222").expect("ticket bbb2222 absent de la section");
        assert!(pos_aaa < pos_bbb, "le ticket de l'événement le plus ancien (ts) doit apparaître en premier dans « Tickets cités »");
    }

    #[test]
    fn clickup_change_et_session_sont_rendus() {
        let mut s = ev(T0 + 8 * 3600, EventKind::ClaudeSession, "/a", "Session Claude Code · 2 prompts · 1 h 31 min", &[]);
        s.body = None;
        let mut c = ev(T0 + 10 * 3600, EventKind::ClickupChange, "/a", "Dashboard → terminé", &["86c1abc"]);
        c.workspace_dir = None;
        let d = build_digest(&[s, c], &[], utc());
        assert!(d.text.contains("## ClickUp\n### 10h\n- clickup : Dashboard → terminé [86c1abc]"));
        assert!(d.text.contains("- session : Session Claude Code · 2 prompts · 1 h 31 min"));
    }
}
