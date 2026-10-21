import { z } from 'zod';
import { db } from './db';
import { defaultResumeMode } from './settings';
import { WIZARD_STEPS, type WizardStep } from './onboarding-steps';

export type Onboarding = {
  /** When the user finished or skipped the wizard. Null shows the wizard. */
  onboardedAt: string | null;
  /** The last step that the user opened. Null when the wizard is done. */
  step: WizardStep | null;
};

/** `step` sets the step (null clears it). `onboarded` true finishes or skips the wizard, false opens it again. */
export const OnboardingSchema = z
  .object({
    step: z.enum(WIZARD_STEPS, { error: `The step must be one of: ${WIZARD_STEPS.join(', ')}.` }).nullable().optional(),
    onboarded: z.boolean({ error: 'Send onboarded as true or false.' }).optional(),
  })
  .refine((v) => v.step !== undefined || v.onboarded !== undefined, 'Send a step or onboarded.');

const asStep = (v: string | null): WizardStep | null => (WIZARD_STEPS as readonly string[]).includes(v ?? '') ? (v as WizardStep) : null;

export async function getOnboarding(userId: string): Promise<Onboarding> {
  const row = await db.userSettings.findUnique({ where: { userId }, select: { onboardedAt: true, wizardStep: true } });
  return { onboardedAt: row?.onboardedAt?.toISOString() ?? null, step: asStep(row?.wizardStep ?? null) };
}

/** An upsert: a new user has no settings row yet. */
export async function saveOnboarding(userId: string, input: z.infer<typeof OnboardingSchema>): Promise<Onboarding> {
  const data: { wizardStep?: string | null; onboardedAt?: Date | null } = {};
  if (input.step !== undefined) data.wizardStep = input.step;
  if (input.onboarded !== undefined) data.onboardedAt = input.onboarded ? new Date() : null;
  const row = await db.userSettings.upsert({
    where: { userId },
    update: data,
    create: { userId, ...data, resumeMode: await defaultResumeMode(userId) },
  });
  return { onboardedAt: row.onboardedAt?.toISOString() ?? null, step: asStep(row.wizardStep) };
}
