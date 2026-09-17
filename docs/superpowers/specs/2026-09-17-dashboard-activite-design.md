# Dashboard d'activité — design

Date : 2026-09-17. Statut : validé en brainstorming (approche A, sections 1 à 4).

## 1. Objectif

Une vue « Dashboard » dans terminials qui restitue le travail de l'utilisateur jour par jour
(hier, plus tôt dans la journée, la semaine) à partir de quatre sources — commits git, sessions
Claude Code, commandes tapées dans les panes, activité ClickUp — avec des graphiques, une
timeline, et trois résumés générés par un LLM (Gemma auto-hébergé par défaut) : **bilan** de la
journée, **reste à faire**, **semaine**. Les tickets ClickUp sont cités sous forme de liens.

Les résumés sont générés automatiquement à 07:00 du lundi au vendredi pour le dernier jour
ouvré, et à la demande par un bouton.

Hors périmètre : partage en équipe, service distant de stockage, OAuth ClickUp, historique des
commandes antérieur à l'installation (elles ne se reconstruisent pas après coup).

## 2. Architecture

```
crates/core/src/activity/            logique pure, testable sans GUI
  mod.rs                             types partagés (ActivityEvent, EventKind…), config
  store.rs                           SQLite (rusqlite bundled) : schéma, insert idempotent, requêtes
  tickets.rs                         extract_ticket_ids() + résolution/cache des tickets
  digest.rs                          événements d'une plage → texte compact déterministe + hash
  summaries.rs                       prompts système, génération, cache, choix du « dernier jour ouvré »
  collectors/git.rs                  git log par dépôt connu
  collectors/claude.rs               ~/.claude/projects/*/*.jsonl
  collectors/shell.rs                interprétation des OSC 133 (C/D) → événements shell_cmd
  collectors/clickup.rs              REST v2 : tâches modifiées, tâches ouvertes
  providers/llm.rs                   trait LlmProvider + OpenAiCompatible / Ollama / ClaudeCli
  providers/clickup.rs               client HTTP ClickUp (ureq)
  settings.rs                        ~/.config/terminials/settings.json (0600)
  shell_integration.rs               shims bash/zsh injectés au spawn du PTY
src-tauri/src/activity.rs            commandes Tauri fines + planificateur (collecte, 07:00)
src/store/dashboard.ts               état UI (ouvert, jour, mode, filtre, données, erreurs)
src/components/DashboardOverlay.tsx  overlay plein cadre (calqué sur DiffOverlay)
src/components/dashboard/*.tsx       StatTiles, HourChart, WorkspaceBars, Timeline, SummaryPanel, SettingsPanel
src/lib/dashboardDay.ts              bornes de journée locale, dernier jour ouvré, formats
src/lib/markdownLite.tsx             rendu markdown restreint → nœuds React (jamais innerHTML)
```

Règle de dépendances : `activity/*` ne dépend ni de Tauri ni du front ; `src-tauri/activity.rs`
ne contient que du câblage ; le front n'agrège rien lui-même, il affiche ce que renvoient
`activity_stats` et `activity_query`.

## 3. Modèle de données

Base : `$XDG_DATA_HOME/terminials/activity.db` (défaut `~/.local/share/terminials/activity.db`),
ouverte en WAL, créée au premier lancement. Migrations par `PRAGMA user_version`.

```sql
events(
  id INTEGER PRIMARY KEY,
  ts INTEGER NOT NULL,             -- epoch secondes UTC
  kind TEXT NOT NULL,              -- commit | claude_prompt | claude_session | shell_cmd | clickup_change
  workspace_dir TEXT,              -- dossier (repo ou cwd) ; NULL pour clickup_change
  branch TEXT,
  title TEXT NOT NULL,             -- sujet du commit, prompt tronqué, commande, "statut → statut"
  body TEXT,                       -- corps du commit, JSON de détails (fichiers, durée, code retour…)
  ticket_ids TEXT NOT NULL DEFAULT '',  -- liste séparée par des virgules
  source_ref TEXT NOT NULL,        -- clé d'idempotence (voir §4)
  UNIQUE(kind, source_ref)
);
CREATE INDEX events_ts ON events(ts);

repos(dir TEXT PRIMARY KEY, last_seen INTEGER NOT NULL, active INTEGER NOT NULL DEFAULT 1);
tickets(id TEXT PRIMARY KEY, name TEXT, status TEXT, status_type TEXT, url TEXT, due_date INTEGER,
        list_name TEXT, fetched_at INTEGER NOT NULL);
open_tasks(id TEXT PRIMARY KEY, name TEXT, status TEXT, url TEXT, due_date INTEGER, priority TEXT,
           list_name TEXT, fetched_at INTEGER NOT NULL);
summaries(day TEXT NOT NULL, kind TEXT NOT NULL, model TEXT NOT NULL, digest_hash TEXT NOT NULL,
          text TEXT NOT NULL, generated_at INTEGER NOT NULL, PRIMARY KEY(day, kind));
collector_state(name TEXT PRIMARY KEY, cursor TEXT NOT NULL);
```

`repos` est alimenté par le front (dossiers des workspaces ouverts, via
`activity_register_workspaces`) **et** par le collecteur Claude (champ `cwd` des transcripts,
ramené à la racine du dépôt). Un dossier disparu passe `active = 0` et n'est plus scanné.

`ticket_ids` est calculé à l'insertion par `tickets::extract_ticket_ids(branch, title, body)`
avec les motifs par défaut, surchargeables dans les réglages :

- `CU-<id>` (id alphanumérique 6 à 12 caractères, insensible à la casse) ;
- `#<id>` avec id de 7 à 9 caractères contenant au moins une lettre et un chiffre ;
- URL `app.clickup.com/t/[<team>/]<id>` ;
- motifs custom (`ABC-\d+`) ajoutés par l'utilisateur dans `ticketPatterns`.

## 4. Collecteurs

Chaque collecteur expose `fn collect(store, settings, ctx) -> Result<CollectReport, CollectError>`
et gère son propre cursor dans `collector_state`. Tous sont idempotents grâce à
`UNIQUE(kind, source_ref)` : relancer un scan ne duplique rien.

| Collecteur | Cadence | source_ref | Cursor |
|---|---|---|---|
| git | démarrage puis 5 min | sha du commit | `git:<dir>` = ts du dernier scan − 3600 s |
| claude | démarrage puis 5 min | uuid de la ligne jsonl ; `claude_session` = chemin du fichier | `claude` = mtime max vu |
| shell | temps réel | `<pty_id>:<ts_ms>` | aucun |
| clickup | démarrage puis 15 min | `<task_id>:<date_updated>` | `clickup` = date_updated max vu |

**Git.** Pour chaque `repos.active = 1` : `git log --all --since=<cursor> --author=<email>
--format=%H%x00%at%x00%s%x00%b%x1e --numstat`. L'e-mail vient des réglages ou de
`git config user.email` dans le dépôt. La branche portée par l'événement est
`git branch --contains <sha> --format=%(refname:short)` (première non `HEAD`). `body` porte
`{"files": n, "added": a, "deleted": d, "branches": [...]}`. Un dépôt inaccessible ou hors git
est signalé dans le rapport et ignoré.

**Claude Code.** Scan de `~/.claude/projects/*/*.jsonl` dont le mtime dépasse le cursor. Pour
chaque ligne parsable : garder `type == "user"` dont `message.content` est une chaîne, en
écartant les contenus commençant par `<local-command`, `<command-name`, `<system-reminder`
ou vides. Événement `claude_prompt` : `ts` = timestamp, `workspace_dir` = racine du dépôt de
`cwd` (ou `cwd` lui-même hors git), `branch` = `gitBranch`, `title` = 200 premiers caractères
(sauts de ligne aplatis). Par fichier, un `claude_session` avec `ts` = premier timestamp,
`body` = `{"durationSec", "prompts", "sessionId"}`, mis à jour à chaque scan (UPSERT).

**Shell.** `shell_integration.rs` produit, au spawn d'un PTY, la commande à lancer :

- bash : `bash --init-file <shim>` où le shim source `~/.bashrc` s'il existe, puis installe
  un `trap DEBUG` (préexécution, gardé par un drapeau pour ne tirer qu'une fois par prompt)
  émettant `OSC 133;C;<b64(cmd)>;<b64(pwd)> BEL`, et ajoute à `PROMPT_COMMAND` l'émission de
  `OSC 133;D;<code retour> BEL` ;
- zsh : `ZDOTDIR=<dir shim>` dont le `.zshrc` source celui de l'utilisateur puis déclare
  `preexec`/`precmd` équivalents ;
- autre shell, ou `shell.integration = false` : commande inchangée, aucun événement.

Le shim est écrit dans `$XDG_RUNTIME_DIR/terminials/shell/` au démarrage. Les charges sont en
base64 pour ne jamais casser le parseur OSC (une commande peut contenir ESC ou BEL). Le
scanner `osc.rs` s'étend pour rendre ces séquences en `OscEvent::Command { cmd, pwd }` et
`OscEvent::Exit { code }` ; le thread lecteur de `spawn_pty` les transmet à `collectors::shell`
qui apparie C puis D et insère `shell_cmd` (`title` = commande, `body` =
`{"exit": code, "durationMs": d}`), sauf si la commande (premier mot) est dans
`shell.ignoredCommands`. Les séquences ne sont pas retirées du flux : xterm.js ignore les OSC
qu'il ne connaît pas.

**ClickUp.** Avec `clickup.token` :

1. au premier appel, `GET /api/v2/user` et `GET /api/v2/team` → `userId`, `teamId` mémorisés
   dans `collector_state` ;
2. toutes les 15 min, `GET /api/v2/team/{teamId}/task?assignees[]={userId}
   &date_updated_gt={cursor_ms}&include_closed=true&subtasks=true&page=N` jusqu'à page vide →
   un `clickup_change` par tâche (`title` = `"<nom> → <statut>"`, `body` = JSON de la tâche
   réduite, `ticket_ids` = son id, `workspace_dir` = NULL) ;
3. dans la même passe, `GET …/task?assignees[]={userId}&include_closed=false
   &order_by=due_date` → remplace `open_tasks` ;
4. les `ticket_ids` rencontrés dans `events` et absents ou vieux (> 24 h) de `tickets` sont
   résolus par `GET /api/v2/task/{id}` (au plus 30 par passe).

Sans token, les tickets ne sont pas résolus : le front construit
`https://app.clickup.com/t/<id>` depuis l'id nu.

## 5. Fournisseurs LLM

```rust
pub trait LlmProvider {
    fn name(&self) -> String;                       // ex. "openai:google/gemma-4-31B-it"
    fn complete(&self, req: &LlmRequest) -> Result<String, LlmError>;
}
pub struct LlmRequest { pub system: String, pub user: String, pub max_tokens: u32, pub temperature: f32 }
pub enum LlmError { Unauthorized, Http { status: u16, body: String }, Network(String), Timeout, Malformed(String), Disabled }
```

- `OpenAiCompatible` (défaut, porte Gemma) : `POST {baseUrl}/v1/chat/completions`, corps
  `{model, temperature, max_tokens, messages:[system,user]}`, en-têtes `Authorization: Bearer
  <token>` si token non vide, `Content-Type: application/json`, plus `extraHeaders` libres
  (Gemma : `x-env: dev`). Réponse : `choices[0].message.content`. 401/403 →
  `Unauthorized`.
- `Ollama` : `POST {baseUrl}/api/chat` avec `{model, stream:false, messages, options:{temperature,
  num_predict}}` ; réponse `message.content`.
- `ClaudeCli` : `claude -p --model <model> --output-format text`, prompt système et utilisateur
  concaténés sur stdin, timeout 120 s, échec si le binaire est absent.

Timeout HTTP : 120 s. Client : `ureq` (bloquant, rustls). Les appels sont lancés depuis un thread
dédié côté Tauri, jamais sur le thread principal.

Le jeton Gemma actuel est un JWT de service qui expire 6 heures après émission : le dashboard
doit traiter `Unauthorized` comme un état normal (bandeau « jeton expiré » + champ pour le
recoller), pas comme un bug. Si le lab fournit plus tard un moyen d'obtenir un jeton par
script, `llm.tokenCommand` (commande shell dont stdout est le jeton) sera exécutée avant chaque
appel ; la clé est prévue dans les réglages, non implémentée en v1.

## 6. Digest, résumés, planification

**Digest** (`digest.rs`) : `build_digest(events, tickets, range) -> Digest { text, hash }`.
Texte déterministe, groupé par workspace (nom = basename du dossier) puis par heure, une
ligne par événement :

```
## terminals (~/dev/terminals) — branche master
### 09h
- commit 3be757f : fix(core): déclarer TERM/COLORTERM… (+42 −7, 3 fichiers) [CU-86c1abc]
- claude : « J'aimerais ajouter une nouvelle feature, un dashboard… »
- shell : npm test ×7 · cargo test ×2 · git push
## Tickets cités
- [CU-86c1abc] Dashboard d'activité — en cours — https://app.clickup.com/t/86c1abc
```

Règles de compaction : prompts Claude tronqués à 120 caractères ; commandes shell dédupliquées
par (workspace, heure, commande) et comptées ; commits intégraux (sujet + corps ≤ 400 caractères) ;
plafond de 24 000 caractères, au-delà on supprime d'abord les commandes, puis on tronque les
prompts à 60. `hash` = SHA-256 hexadécimal du texte.

**Résumés** (`summaries.rs`), trois `SummaryKind` :

| kind | Entrée | Prompt système (résumé) |
|---|---|---|
| `bilan` | digest du jour | Bilan en 5 à 10 puces groupées par sujet, tickets en liens markdown `[id](url)`, aucune invention, pas de préambule, en français. |
| `reste_a_faire` | digest + `open_tasks` + branches non fusionnées (`git branch --no-merged` par repo actif) | Liste priorisée : tickets ClickUp ouverts (échéance en premier), branches à finir, pistes détectées dans les prompts. |
| `semaine` | digests des 5 jours ouvrés de la semaine du jour demandé | Synthèse hebdo : thèmes, tickets clos, tickets en cours, points de friction visibles (commandes répétées, sessions longues). |

`generate(day, kind, force)` : si `summaries` a une ligne pour `(day, kind)` avec le même
`digest_hash` et `force == false`, la renvoyer ; sinon appeler le LLM, stocker, renvoyer. Un
digest vide (aucun événement) ne déclenche pas d'appel : texte fixe « Aucune activité
enregistrée ».

**Planification** (thread dans `src-tauri/activity.rs`, tick toutes les 60 s) :

- collecte git + claude si dernier passage > 5 min, clickup si > 15 min ;
- à `schedule.hour:schedule.minute` (défaut 07:00), jours 1 à 5 si `weekdaysOnly`, génère
  `bilan` et `reste_a_faire` pour `last_working_day(today)` (lundi → vendredi ; le digest du
  lundi inclut aussi samedi et dimanche s'ils ont des événements), et `semaine` le vendredi pour
  la semaine courante ;
- rattrapage : `collector_state.summary_last_day` ; si au démarrage la valeur est antérieure au
  dernier jour ouvré révolu et que l'heure courante dépasse l'heure planifiée, on génère une
  fois puis on note le jour ;
- après chaque collecte, événement Tauri `activity-updated { source }` ; après chaque résumé,
  `summary-ready { day, kind }`.

## 7. Contrat IPC (commandes Tauri)

Tous les timestamps sont en epoch secondes UTC ; les jours sont des chaînes `YYYY-MM-DD` en
heure locale de la machine. Les erreurs sont des chaînes lisibles (`Result<_, String>`).

```ts
activity_register_workspaces({ dirs: string[] }): void
activity_collect_now(): CollectReport            // { git: n, claude: n, clickup: n, errors: string[] }
activity_query({ from, to, workspaceDir? }): ActivityEvent[]
activity_stats({ from, to }): ActivityStats
activity_summary({ day, kind, force }): Summary   // { text, model, generatedAt, cached }
activity_open_tasks(): OpenTask[]
activity_status(): ActivityStatus                 // { lastCollect: {git?, claude?, clickup?}, errors: string[], shellIntegration: boolean }
activity_get_settings(): ActivitySettings
activity_set_settings({ settings }): void

interface ActivityEvent { id; ts; kind; workspaceDir?; branch?; title; body?; ticketIds: string[]; tickets: TicketRef[] }
interface TicketRef { id; name?; status?; url }
interface ActivityStats {
  totals: { commits; prompts; commands; tickets; activeMinutes };
  byHour: Array<{ hour: number; commit; claude_prompt; shell_cmd; clickup_change }>;   // 24 entrées
  byDay:  Array<{ day: string; commit; claude_prompt; shell_cmd; clickup_change }>;    // un par jour de la plage
  byWorkspace: Array<{ dir; name; events; commits }>;
}
```

`activeMinutes` : nombre de tranches de 15 minutes contenant au moins un événement, × 15.

## 8. Interface

**Ouverture.** `Ctrl+Shift+H` (`KeyH`, action `toggle-dashboard`), entrée fixe « Dashboard »
en tête de la sidebar (au-dessus de la liste des workspaces), pastille bleue quand un
`summary-ready` est arrivé depuis la dernière ouverture. `Échap` ferme. L'overlay est global
(pas lié à un workspace) et se superpose à la grille comme `DiffOverlay` ; les shells restent
montés.

**Barre du haut.** `◂ jour ▸` (raccourcis `[` `]`), « Aujourd'hui », segment Jour | Semaine,
« collecté il y a N min », bouton « Générer maintenant » (force les résumés du jour affiché),
bouton ⚙ (réglages, panneau latéral droit).

**Colonne gauche, 60 %.**
1. Tuiles : commits, prompts Claude, commandes, tickets touchés, temps actif (h min).
2. Barres empilées par heure (couleur par kind : commit vert, claude bleu, shell gris,
   clickup violet), plage 7h–20h étendue automatiquement aux heures ayant des événements.
   En mode Semaine : une barre par jour.
3. Barres horizontales par workspace ; clic = filtre de la timeline (toggle).
4. Timeline groupée par workspace, ordre chronologique, icône par kind, heure, texte, badges
   ticket cliquables. Filtre texte `/` comme le diff viewer.

**Colonne droite, 40 %.**
1. Bilan : markdown rendu, liens ClickUp cliquables (plugin opener), pied « généré à HH:MM par
   <model> », bouton ↻.
2. Reste à faire : d'abord les `open_tasks` (statut coloré, échéance, liste) triées par
   échéance puis priorité, puis le texte LLM.
3. Mode Semaine : la colonne droite montre le résumé `semaine` seul.

**États.** Chargement → squelettes ; aucun événement → « Aucune activité ce jour » ; erreur
LLM `Unauthorized` → bandeau ambre « Jeton LLM expiré » avec champ de saisie inline qui écrit
`llm.token` et relance ; autre erreur → bandeau rouge avec le message et bouton réessayer ;
ClickUp sans token → la section tâches ouvertes affiche « Ajouter un token ClickUp dans ⚙ ».

**Rendu.** Graphiques en SVG maison (pas de bibliothèque), thème sombre existant.
`markdownLite` rend paragraphes, titres `#`/`##`, listes `-`/`*`/`1.`, `**gras**`,
`` `code` `` et `[texte](url)` en éléments React ; tout le reste est du texte brut.

**Réglages** (`SettingsPanel`) : fournisseur (`openai` | `ollama` | `claude_cli`), URL de base,
modèle, jeton, en-têtes supplémentaires (clé/valeur), température, max tokens ; token ClickUp ;
heure de génération et « jours ouvrés seulement » ; intégration shell on/off et commandes
ignorées ; e-mail git ; motifs de tickets. Enregistrer → `activity_set_settings`, puis
`activity_collect_now`.

## 9. Réglages persistés

`$XDG_CONFIG_HOME/terminials/settings.json` (défaut `~/.config/terminials/settings.json`),
créé avec mode `0600`, écrit atomiquement (fichier temporaire + rename) :

```json
{
  "llm": { "provider": "openai", "baseUrl": "https://llm.example.com/gemma4-31b",
           "model": "google/gemma-4-31B-it", "token": "", "extraHeaders": { "x-env": "dev" },
           "temperature": 0.3, "maxTokens": 1500, "tokenCommand": null },
  "clickup": { "token": "" },
  "schedule": { "hour": 7, "minute": 0, "weekdaysOnly": true },
  "shell": { "integration": true, "ignoredCommands": ["ls", "ll", "la", "cd", "pwd", "clear", "exit"] },
  "git": { "authorEmail": null },
  "ticketPatterns": []
}
```

Les valeurs ci-dessus sont les défauts (le jeton reste vide jusqu'à saisie). Le fichier n'est
jamais commité et son chemin n'apparaît pas dans les logs.

## 10. Gestion d'erreurs

- Une erreur de collecteur n'empêche jamais les autres : `CollectReport.errors` les agrège, le
  front les montre dans ⚙ et dans « collecté il y a N min » (icône ⚠ au survol).
- Base SQLite illisible au démarrage → l'app démarre, le dashboard affiche l'erreur et un
  bouton « recréer la base » (renomme l'ancienne en `.bak`).
- Shim shell impossible à écrire → intégration désactivée pour la session, statut visible.
- LLM : `Unauthorized`, `Timeout`, `Network` distingués dans l'UI (§8). Un résumé en échec
  n'écrase jamais un résumé en cache.
- Planificateur : toute panique dans un tick est rattrapée (`catch_unwind`) et loguée sur
  stderr ; le thread continue.

## 11. Tests

Rust (`cargo test -p terminials-core`) :
- `store` : schéma créé en mémoire, insert idempotent, `query` par plage et par workspace,
  `stats` (byHour, byWorkspace, activeMinutes) sur un jeu fixe ;
- `tickets` : tous les motifs par défaut, motifs custom, absence de faux positif sur un sha ;
- `digest` : sortie déterministe (snapshot texte), compaction, hash stable ;
- `summaries` : `last_working_day` (lundi → vendredi, mardi → lundi, plage du lundi incluant le
  week-end), cache par hash, digest vide sans appel LLM (provider factice) ;
- `collectors::git` : dépôt temporaire (pattern `tmp_repo` de `git.rs`), filtre auteur, `--all` ;
- `collectors::claude` : fixture jsonl synthétique (prompt, tool_result, local-command,
  summary), durée de session ;
- `collectors::shell` : appariement C/D, base64, commande ignorée, D sans C ;
- `osc` : `OscEvent::Command`/`Exit` sur un flux fragmenté ;
- `providers::llm` : corps de requête et en-têtes contre un serveur HTTP minimal sur
  `127.0.0.1` (std `TcpListener`), 401 → `Unauthorized`, contenu extrait ;
- `settings` : défauts, lecture/écriture, mode 0600 ;
- `shell_integration` : shim bash exécuté dans un PTY réel émet bien C puis D pour `echo x`.

Front (`vitest`) :
- `dashboardDay` : bornes locales, `lastWorkingDay`, navigation `[` `]` ;
- `markdownLite` : chaque construction, un lien avec URL non http ignoré, texte brut échappé ;
- `store/dashboard` : réducteurs (jour, mode, filtre, pastille) ;
- `shortcuts` : `Ctrl+Shift+H` → `toggle-dashboard` ;
- composants : `HourChart` (nombre de barres, extension de plage), `Timeline` (groupement,
  filtre), `SummaryPanel` (états chargement / expiré / erreur) avec `invoke` moqué.

Vérification manuelle avant merge : ouvrir le dashboard sur la veille, générer un bilan via
Gemma avec un jeton frais, constater les liens ClickUp cliquables, taper trois commandes dans un
pane et les voir apparaître dans la timeline.

## 12. Dépendances ajoutées

Rust (`crates/core`) : `rusqlite = { features = ["bundled"] }`, `ureq = { features = ["json"] }`,
`chrono`, `sha2`, `base64`, `regex`, `serde_json` (déjà en workspace). Front : aucune.
