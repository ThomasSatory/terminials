import type { ITerminalOptions, ITheme } from "@xterm/xterm";

/**
 * Apparence des terminaux xterm, alignée sur les jetons de l'UI « Dock » (styles/tokens.css)
 * et sur le terminal de la maquette (Dock.dc.html) : fond de l'app, texte du terminal,
 * curseur bloc accent, couleurs ANSI reprises de la sémantique (vert succès, ambre
 * avertissement, rose suppression, cyan travail).
 *
 * xterm dessine dans un canvas (WebGL) : il ne lit pas les variables CSS, d'où les valeurs
 * en dur. terminalTheme.test.ts vérifie qu'elles restent synchronisées avec tokens.css.
 */

/** Police embarquée (@fontsource-variable) : chargée avant le premier rendu (main.tsx),
    sans quoi xterm mesurerait ses cellules avec la police de repli. */
export const POLICE_TERMINAL = "'JetBrains Mono Variable', 'JetBrains Mono', ui-monospace, monospace";

/** Corps de la maquette (13 px). */
export const TAILLE_TERMINAL = 13;

/** Hauteur du glyphe que mesure xterm pour JetBrains Mono à 13 px (ascendante +
    descendante, arrondie au pixel supérieur), relevée dans l'app réelle. */
export const GLYPHE_TERMINAL_PX = 17;

/**
 * Pas de ligne que xterm donne à un glyphe de `glyphePx` px CSS, au facteur `interligne`
 * et à la densité d'écran `dpr` (renderer WebGL, @xterm/addon-webgl 0.19) :
 * `char.height = ceil(glyphe × dpr)`, `cell.height = floor(char.height × lineHeight)`,
 * en pixels physiques, ramenés en px CSS. Pur, pour tester le choix ci-dessous.
 */
export function pasDeLigneXterm(glyphePx: number, interligne: number, dpr = 1): number {
  return Math.floor(Math.ceil(glyphePx * dpr) * interligne) / dpr;
}

/**
 * Interligne. La maquette écrit `font-size: 13px; line-height: 1.75` : en CSS le facteur
 * multiplie le CORPS, d'où un pas de ligne (distance entre deux lignes de base) de
 * 13 × 1,75 = 22,75 px. Le `lineHeight` de xterm multiplie, lui, la hauteur MESURÉE du
 * glyphe (17 px ici, cf. GLYPHE_TERMINAL_PX), puis arrondit la cellule au pixel physique
 * inférieur (cf. pasDeLigneXterm) : recopier 1.75 donnerait floor(17 × 1,75) = 29 px.
 *
 * À densité 1, un pas est forcément entier : 22,75 px est hors d'atteinte, et le plus
 * proche est 23 px (écart 0,25 px, contre 0,75 px pour 22). Il faut floor(17 × f) = 23,
 * soit 23/17 ≤ f < 24/17 (1,3530 ≤ f < 1,4118) ; 1.36 y tombe avec de la marge
 * (17 × 1,36 = 23,12). Mesuré dans l'app réelle (Xvfb, 1440 × 900, densité 1) : lignes
 * de base espacées de 23 px — l'ancien 1.34 donnait 22 px (floor(22,78)). Le glyphe reste
 * centré dans la cellule (xterm), comme le texte dans sa boîte de ligne CSS de la
 * maquette ; les caractères de cadre restent jointifs (customGlyphs, toute la cellule).
 * Les marges internes (22 px en haut, 26 px sur les côtés, réserve basse du dock) sont
 * celles de la maquette, portées par `.app-terminaux` (styles/shell.css).
 */
export const INTERLIGNE_TERMINAL = 1.36;

/**
 * Palette. Choix par rapport à la maquette :
 * - texte par défaut = `--texte-terminal` (#eceef1) : c'est la couleur des réponses de
 *   l'agent et de l'invite dans la maquette, et le texte « estompé » (SGR 2, que xterm
 *   rend à mi-opacité) retombe alors sur un gris proche du `--texte-discret` des lignes
 *   d'outils, au lieu d'un gris illisible ;
 * - blanc ANSI = `--texte` (#c8cad0), sorties courantes de la maquette (ls, vite) ;
 * - noir clair = `--texte-discret` : jamais plus sombre, contraste 4.5:1 minimum ;
 * - noir ANSI : gris très sombre, assez distinct du fond pour les barres d'état qui
 *   l'utilisent en arrière-plan.
 */
export const THEME_TERMINAL: ITheme = {
  background: "#050506",
  foreground: "#eceef1",
  cursor: "#8f9bff",
  // Caractère sous le curseur bloc : couleur du fond, comme un texte posé sur l'accent.
  cursorAccent: "#050506",
  selectionBackground: "rgba(143, 155, 255, 0.28)",
  selectionInactiveBackground: "rgba(143, 155, 255, 0.14)",
  // Ascenseur discret, à la manière des filets (blanc translucide).
  scrollbarSliderBackground: "rgba(255, 255, 255, 0.12)",
  scrollbarSliderHoverBackground: "rgba(255, 255, 255, 0.2)",
  scrollbarSliderActiveBackground: "rgba(255, 255, 255, 0.28)",
  overviewRulerBorder: "transparent",
  black: "#26282f",
  red: "#ff9d94",
  green: "#7ee787",
  yellow: "#e3b341",
  blue: "#8f9bff",
  magenta: "#f78fc6",
  cyan: "#22d3ee",
  white: "#c8cad0",
  brightBlack: "#9296a0",
  brightRed: "#ffbdb6",
  brightGreen: "#a8f0ae",
  brightYellow: "#f2cc60",
  brightBlue: "#c3caff",
  brightMagenta: "#fbb6dc",
  brightCyan: "#67e8f9",
  brightWhite: "#f5f6f7",
};

export const OPTIONS_TERMINAL: ITerminalOptions = {
  fontFamily: POLICE_TERMINAL,
  fontSize: TAILLE_TERMINAL,
  // Graisses compensées comme celles de l'interface (voir les jetons --graisse-* de
  // tokens.css) : le moteur de rendu épaissit le texte clair sur fond sombre. Une seule
  // graisse pour toutes les couleurs du terminal, réglée sur le texte par défaut (blanc) sans
  // trop amaigrir les couleurs : 200 rend l'encre d'un 400 de la maquette à 13 px (blanc un
  // peu au-dessus, cyan un peu en dessous), 420 celle d'un 600.
  fontWeight: 200,
  fontWeightBold: 420,
  lineHeight: INTERLIGNE_TERMINAL,
  letterSpacing: 0,
  // Curseur de la maquette : bloc plein accent qui clignote.
  cursorStyle: "block",
  cursorBlink: true,
  cursorInactiveStyle: "outline",
  theme: THEME_TERMINAL,
};
