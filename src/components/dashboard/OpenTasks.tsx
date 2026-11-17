import { useState } from "react";
import type { OpenTask } from "../../lib/activityApi";
import { compareTasks, foldLabel, formatTaskDue } from "../../lib/tachesOuvertes";
import { IconeChevronDroit } from "../ui/icons";
import { Statut, Ticket } from "./Ticket";

/** Tâches visibles tant que la liste n'est pas dépliée. */
export const TACHES_VISIBLES = 4;

function Ligne({ task, onOpen }: { task: OpenTask; onOpen: (url: string) => void }) {
  return (
    <li className="rc-tache">
      <Ticket id={task.id} url={task.url} titre={task.name} onOpen={onOpen} />
      <span className="rc-tache-nom">{task.name}</span>
      <Statut status={task.status} />
      <span className="rc-tache-echeance">{task.dueDate != null ? formatTaskDue(task.dueDate) : "—"}</span>
    </li>
  );
}

/**
 * « Tâches ouvertes du sprint » : identifiant en pastille, nom, état teinté,
 * échéance. Triées par échéance puis priorité ; les quatre premières visibles, les
 * suivantes dans un pli qui s'ouvre en douceur. Suivi des tâches inactif : une
 * ligne discrète renvoie aux réglages.
 */
export function OpenTasks({
  tasks,
  active,
  onOpen,
}: {
  tasks: OpenTask[];
  active: boolean;
  onOpen: (url: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const sorted = [...tasks].sort(compareTasks);
  const top = sorted.slice(0, TACHES_VISIBLES);
  const suite = sorted.slice(TACHES_VISIBLES);

  return (
    <section aria-label="Tâches ouvertes" className="rc-panneau rc-carte">
      <div className="rc-carte-tete">
        <h2 className="rc-intertitre">Tâches ouvertes du sprint</h2>
        {active && <span className="rc-carte-total">{sorted.length}</span>}
      </div>
      {!active ? (
        <p className="rc-vide rc-vide-carte">Activer le suivi des tâches dans les réglages.</p>
      ) : sorted.length === 0 ? (
        <p className="rc-vide rc-vide-carte">Aucune tâche ouverte.</p>
      ) : (
        <>
          <ul className="rc-taches">
            {top.map((t) => (
              <Ligne key={t.id} task={t} onOpen={onOpen} />
            ))}
          </ul>
          {suite.length > 0 && (
            <>
              <div id="rc-taches-suite" className="rc-pli" data-ouvert={open} inert={!open}>
                <div>
                  <ul className="rc-taches">
                    {suite.map((t) => (
                      <Ligne key={t.id} task={t} onOpen={onOpen} />
                    ))}
                  </ul>
                </div>
              </div>
              <button
                type="button"
                className="rc-plier hov"
                aria-expanded={open}
                aria-controls="rc-taches-suite"
                onClick={() => setOpen(!open)}
              >
                <IconeChevronDroit taille={12} epaisseur={1.7} className="rc-chev" data-ouvert={open} />
                {foldLabel(open, suite.length)}
              </button>
            </>
          )}
        </>
      )}
    </section>
  );
}
