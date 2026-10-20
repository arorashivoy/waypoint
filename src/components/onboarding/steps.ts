import { WIZARD_STEPS, type WizardStep } from '@/lib/onboarding-steps';

export { WIZARD_STEPS, type WizardStep };

export const STEP_NAMES: Record<WizardStep, string> = {
  account: 'Your account',
  search: 'Your job search',
  claude: 'Claude',
  import: 'Your profile',
  review: 'Review',
  refresh: 'First jobs',
};

/**
 * The steps this user sees. The Claude step shows only when no credential pays for Claude yet,
 * or when the user asks to add an own key.
 */
export function wizardSteps(me: { claude: { mode: string } }, ownKey = false): WizardStep[] {
  const hasCredential = me.claude.mode !== 'none';
  return WIZARD_STEPS.filter((s) => s !== 'claude' || !hasCredential || ownKey);
}

/** The step to open: the saved one when this user still sees it, else the first step. */
export function startStep(steps: WizardStep[], saved: WizardStep | null): WizardStep {
  return saved && steps.includes(saved) ? saved : steps[0];
}
