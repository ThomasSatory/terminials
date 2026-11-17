import { describe, it, expect } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { Avatar } from "./Avatar";
import { IconButton } from "./IconButton";
import { Kbd } from "./Kbd";
import { IconePlus } from "./icons";

describe("Avatar", () => {
  it("monogramme sur la couleur à 18 au repos, 38 et liseré quand actif", () => {
    const repos = renderToStaticMarkup(<Avatar monogramme="si" couleur="#4ade80" />);
    expect(repos).toContain(">si<");
    expect(repos).toContain("background:#4ade8018");
    expect(repos).toContain("inset 0 0 0 1.5px transparent");
    const actif = renderToStaticMarkup(<Avatar monogramme="si" couleur="#4ade80" actif />);
    expect(actif).toContain("background:#4ade8038");
    expect(actif).toContain("inset 0 0 0 1.5px #4ade80");
  });

  it("arc au travail, pastille et saut en attente, rien au repos", () => {
    const travail = renderToStaticMarkup(<Avatar monogramme="te" couleur="#a99cff" etat="travail" />);
    expect(travail).toContain("ui-avatar-arc");
    expect(travail).not.toContain("ui-avatar-pastille");
    const attente = renderToStaticMarkup(<Avatar monogramme="te" couleur="#a99cff" etat="attente" />);
    expect(attente).toContain("ui-avatar-pastille");
    expect(attente).toContain('data-sautille="true"');
    const immobile = renderToStaticMarkup(
      <Avatar monogramme="te" couleur="#a99cff" etat="attente" sautille={false} />,
    );
    expect(immobile).toContain('data-sautille="false"');
    const repos = renderToStaticMarkup(<Avatar monogramme="te" couleur="#a99cff" />);
    expect(repos).not.toContain("ui-avatar-arc");
    expect(repos).not.toContain("ui-avatar-pastille");
  });

  it("décoratif pour les lecteurs d'écran", () => {
    expect(renderToStaticMarkup(<Avatar monogramme="te" couleur="#a99cff" />)).toContain('aria-hidden="true"');
  });

  it("« terminé » se dessine comme le repos : ni arc ni pastille", () => {
    const html = renderToStaticMarkup(<Avatar monogramme="te" couleur="#a99cff" etat="termine" />);
    expect(html).toContain('data-etat="repos"');
    expect(html).not.toContain("ui-avatar-arc");
    expect(html).not.toContain("ui-avatar-pastille");
  });
});

describe("IconButton", () => {
  it("vrai bouton, nommé par son aria-label, attributs transmis", () => {
    const html = renderToStaticMarkup(
      <IconButton label="Nouvel espace (Ctrl+Maj+N)" data-dock-add="" aria-expanded={false}>
        <IconePlus />
      </IconButton>,
    );
    expect(html).toMatch(/^<button type="button" aria-label="Nouvel espace \(Ctrl\+Maj\+N\)"/);
    expect(html).toContain('data-dock-add=""');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('data-forme="rond"');
    expect(html).toContain('<svg aria-hidden="true"');
  });
});

describe("Kbd", () => {
  it("Kbd porte sa variante", () => {
    expect(renderToStaticMarkup(<Kbd variante="puce">Ctrl+Maj+M</Kbd>)).toBe(
      '<kbd class="ui-kbd" data-variante="puce">Ctrl+Maj+M</kbd>',
    );
  });
});
