/** The 6 steps of the onboarding wizard, in order. The server and the screen read this one list. */
export const WIZARD_STEPS = ['account', 'search', 'claude', 'import', 'review', 'refresh'] as const;

export type WizardStep = (typeof WIZARD_STEPS)[number];
