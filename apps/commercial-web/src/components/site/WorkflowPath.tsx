import { ArrowDown, ArrowRight } from "lucide-react";

import { WORKFLOW_STEPS } from "../../content/siteContent";

type WorkflowPathProps = {
  /** id of the heading that names this workflow. */
  labelledBy: string;
};

/**
 * The integrated production workflow as an ordered list of numbered tiles.
 * The list itself is the text alternative; connector arrows are decorative
 * and switch direction with the layout (horizontal on wide screens).
 */
export function WorkflowPath({ labelledBy }: WorkflowPathProps) {
  return (
    <ol className="workflow" aria-labelledby={labelledBy}>
      {WORKFLOW_STEPS.map((step, index) => {
        const Icon = step.icon;
        const isLast = index === WORKFLOW_STEPS.length - 1;

        return (
          <li key={step.id} className="workflow__step">
            <div className="workflow__tile">
              <div className="workflow__top">
                <span className="workflow__number">
                  <span className="visually-hidden">Step </span>
                  {String(index + 1).padStart(2, "0")}
                </span>
                <span className="workflow__icon" aria-hidden="true">
                  <Icon focusable="false" size={20} strokeWidth={1.9} />
                </span>
              </div>
              <h3 className="workflow__title">{step.title}</h3>
              <p className="workflow__description">{step.description}</p>
            </div>
            {isLast ? null : (
              <span className="workflow__connector" aria-hidden="true">
                <ArrowRight className="workflow__arrow workflow__arrow--across" focusable="false" size={18} />
                <ArrowDown className="workflow__arrow workflow__arrow--down" focusable="false" size={18} />
              </span>
            )}
          </li>
        );
      })}
    </ol>
  );
}
