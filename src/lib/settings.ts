import { z } from 'zod';
import { db } from './db';
import { FIELD_QUERIES } from './countries';
import { checkForInjection } from './injection';
import { isAdmin } from './user';

export const FIELD_CHOICES = [...FIELD_QUERIES.map((q) => q.field), 'Other'] as const;

export const RESUME_MODES = ['template', 'own-tex'] as const;

export type Settings = {
  fields: string[];
  visaStatus: string;
  resumeMode: (typeof RESUME_MODES)[number];
  /** The file name that the server made for the .tex of the user, or null. */
  ownTex: string | null;
  templateId: string;
};

export const SettingsSchema = z.object({
  fields: z.array(z.enum(FIELD_CHOICES)).max(6, 'Choose 6 fields or fewer.'),
  visaStatus: z
    .string()
    .max(200, 'The visa status must have 200 characters or fewer.')
    .superRefine((text, ctx) => {
      const check = checkForInjection(text);
      if (check.suspicious) ctx.addIssue({ code: 'custom', message: `The visa status was refused: ${check.why}.` });
    }),
});

export type SearchSettings = z.infer<typeof SettingsSchema>;

/** The admin keeps the own LaTeX source of the .env until the admin chooses a template. */
async function defaultResumeMode(userId: string): Promise<Settings['resumeMode']> {
  return process.env.RESUME_TEX?.trim() && (await isAdmin(userId)) ? 'own-tex' : 'template';
}

function parseFields(text: string): string[] {
  try {
    const v: unknown = JSON.parse(text);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

export async function getSettings(userId: string): Promise<Settings> {
  const row = await db.userSettings.findUnique({ where: { userId } });
  if (!row) return { fields: [], visaStatus: '', resumeMode: await defaultResumeMode(userId), ownTex: null, templateId: 'classic' };
  return {
    fields: parseFields(row.fields),
    visaStatus: row.visaStatus,
    resumeMode: row.resumeMode === 'own-tex' ? 'own-tex' : 'template',
    ownTex: row.ownTex,
    templateId: row.templateId,
  };
}

export async function saveSearchSettings(userId: string, input: SearchSettings): Promise<void> {
  const fields = JSON.stringify(input.fields);
  const visaStatus = input.visaStatus.trim();
  const existing = await db.userSettings.findUnique({ where: { userId }, select: { userId: true } });
  if (existing) await db.userSettings.update({ where: { userId }, data: { fields, visaStatus } });
  else await db.userSettings.create({ data: { userId, fields, visaStatus, resumeMode: await defaultResumeMode(userId) } });
}
