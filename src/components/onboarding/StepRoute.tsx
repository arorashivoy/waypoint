import { STEP_NAMES, stepStatus, type WizardStep } from './steps';

const WORD = { done: 'Done', skipped: 'Skipped', now: 'Now', later: 'Later' } as const;

/**
 * The steps as a route. This is a real sequence: a done stop is filled, the current stop glows mint,
 * a later or skipped stop is hollow lavender (a skipped one says Skipped). It uses the stop styles of the Route primitive.
 * Under 720 px the route is a compact strip of small stops with the name of the current step below.
 */
export default function StepRoute({ steps, current, skipped }: { steps: WizardStep[]; current: WizardStep; skipped: ReadonlySet<WizardStep> }) {
  const at = Math.max(steps.indexOf(current), 0);
  return (
    <nav className="ob-route-nav" aria-label="Setup steps">
      <ol className="ui-route ob-route">
        {steps.map((s, i) => {
          const state = stepStatus(steps, current, skipped, s);
          return (
            <li key={s} className={`ui-stop ${state === 'later' || state === 'skipped' ? 'ui-stop-missing' : 'ui-stop-met'} ob-${state}`} aria-current={state === 'now' ? 'step' : undefined}>
              <span className="ui-stop-label">{STEP_NAMES[s]}</span>
              <span className="ui-stop-word">{WORD[state]}</span>
            </li>
          );
        })}
      </ol>
      <p className="ob-where" aria-hidden="true">Step {at + 1} of {steps.length}: {STEP_NAMES[current]}</p>
    </nav>
  );
}
