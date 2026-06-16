# UI cmux-minimal — Design

> Repasse visuelle de l'interface pour se rapprocher de [cmux](https://cmux.com) : **supprimer les libellés textuels** (boutons « + Workspace » / « + Terminal », compteur « 2/4 », ligne git « ⎇ main * ») au profit d'icônes, de couleur et de position. Aucun changement de comportement ni de modèle de données.

**Statut** : design validé (mockups visuels approuvés), prêt à implémenter
**Date** : 2026-06-16

## 1. Objectif

L'UI actuelle fonctionne mais affiche du texte de chrome partout, et hérite encore du CSS du template Tauri/Vite (boutons blancs arrondis avec `box-shadow`) qui jure avec le thème sombre. On veut le look épuré de cmux : sombre homogène, affordances par icône/couleur, zéro libellé superflu.

**Hors scope** : modèle de données (`store/workspace.ts` inchangé), raccourcis clavier (Ctrl+T / Ctrl+W inchangés), backend, palette de couleurs d'identité.

## 2. Décisions (9 points validés sur mockup)

1. **Ligne de workspace (sidebar)** : pastille couleur + nom. Ligne active simplement teintée (`#242424`). La barre d'accent à gauche (`border-left`) n'apparaît **que** pour un workspace en attente (point 4) — plus de border-left systématique sur la couleur d'identité.
2. **Palette de couleurs** : inchangée — clic sur la pastille ouvre le popover.
3. **Git + ports** : fusionnés en une ligne discrète `branch · :ports` (gris `#6f6f6f`). Dirty = point `·` en fin de branche, suppression du glyphe `⎇` et du `*`. Hors repo : ligne masquée (comportement actuel conservé).
4. **Workspace en attente (`unread`)** : barre d'accent ambre à gauche + halo ambre autour de la pastille (`box-shadow: 0 0 0 3px <alerte>40`). Le glyphe `●` séparé est **supprimé** (redondant).
5. **Texte de statut agent (`status.label`)** : conservé (c'est du contenu réel venu de la CLI, pas du chrome), rendu discret/petit. Barre de `progress` conservée (fine, ambre).
6. **`+ Workspace`** → icône fantôme **+** au **pied** de la sidebar (`margin-top:auto`), `title` au survol.
7. **Compteur `2/4`** → rangée de petites pastilles de panes (pleine = pane actif) dans la top bar.
8. **`+ Terminal`** → icône fantôme **+** en **haut à droite** de la top bar, `title` au survol. Toast « max N terminaux » conservé au max.
9. **Panes (`PaneTree`)** : inchangés — bordure d'accent couleur sur le pane actif, croix × au survol pour fermer.

## 3. Style commun

- **Boutons icône fantôme** : pas de fond au repos, `color:#7a7a7a` ; au survol fond `#2c2c2c`, `color:#ccc`, `border-radius:6px`, ~22×22px. Remplace tous les anciens boutons inline.
- **Suppression du CSS template** : purger `App.css` des règles héritées (`.logo*`, `.container`, `.row`, `h1`, `a`, et surtout les styles globaux `input`/`button` blancs + le bloc `@media (prefers-color-scheme: dark)`). Garder uniquement le reset `html/body/#root` + `body { overflow:hidden }`. Définir un `:root` sombre cohérent (fond `#1e1e1e`, texte `#cfcfcf`, police mono).
- **Sidebar** : fond `#141414`, séparateur `#242424` à droite, largeur 240px conservée.
- **Top bar** : fond `#1e1e1e`, bordure basse `#242424` (au lieu du `#222` plein actuel).

## 4. Fichiers touchés

| Fichier | Changement |
|---|---|
| `src/App.css` | Purge du template ; `:root` sombre ; classes utilitaires icône fantôme si besoin. |
| `src/App.tsx` | Top bar : nom + rangée de pastilles de panes + bouton + icône (remplace nom/compteur/« + Terminal »). |
| `src/components/Sidebar.tsx` | Lignes épurées (ligne git fusionnée, attente = accent+halo, plus de `●`), bouton + au pied. |
| `src/components/PaneTree.tsx` | Inchangé (déjà conforme). |

## 5. Tests / vérification

- Pas de tests unitaires sur le rendu (le projet teste store + palette en pur). Vérification = `tsc`/build sans erreur + revue visuelle dans l'app.
- Critères visuels : aucun libellé texte de chrome restant (« Workspace », « Terminal », « 2/4 », « ⎇ ») ; thème sombre homogène ; survols (tooltips, croix de pane, halo d'attente) fonctionnels.
