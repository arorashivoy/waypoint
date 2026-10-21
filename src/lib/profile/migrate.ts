import { db } from '../db';
import { normEmail } from '../auth/users';
import { checkText } from '../claims';
import * as docModule from './doc';
import { canonicalDoc, checkYaml } from './doc';
import { readProfileDoc, saveProfile } from './store';

/**
 * Moves a claims.yml into the tables of one user (spec 3.5):
 * 1. check the file with the strict checkDoc,
 * 2. write the tables in one transaction,
 * 3. export the tables to YAML and compare the result with the file, as
 *    parsed data. If they differ, roll back and name the difference.
 */

export type MigrateResult =
  | { ok: true; counts: { positions: number; educations: number; projects: number; claims: number }; warnings: string[]; replaced: boolean }
  | { ok: false; errors: string[] };

class RoundTripError extends Error {
  constructor(public lines: string[]) {
    super('round trip');
  }
}

/** Up to 20 lines "path: before → after" for the places where two values differ. */
export function differences(a: unknown, b: unknown, path = '', out: string[] = []): string[] {
  if (out.length >= 20) return out;
  if (JSON.stringify(a) === JSON.stringify(b)) return out;
  const isObj = (v: unknown) => !!v && typeof v === 'object';
  if (isObj(a) && isObj(b)) {
    const keys = new Set([...Object.keys(a as object), ...Object.keys(b as object)]);
    for (const k of keys) differences((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], Array.isArray(a) ? `${path}[${k}]` : path ? `${path}.${k}` : k, out);
    return out;
  }
  const show = (v: unknown) => (v === undefined ? '(missing)' : JSON.stringify(v).slice(0, 80));
  out.push(`${path || 'root'}: ${show(a)} → ${show(b)}`);
  return out;
}

export async function migrateClaimsText(email: string, text: string): Promise<MigrateResult> {
  const check = checkText(text);
  if (!check.doc) return { ok: false, errors: check.errors };
  const shown = normEmail(email);
  const user = await db.user.findUnique({ where: { email: shown } });
  if (!user) return { ok: false, errors: [`No user has the email ${shown}.`] };

  const original = canonicalDoc(check.doc);
  const replaced = !!(await db.profileMeta.findUnique({ where: { userId: user.id } }));
  try {
    const saved = await saveProfile(user.id, check.doc, 'Migrated from claims.yml', async (tx) => {
      const back = await readProfileDoc(tx, user.id);
      // toYaml through the module object, so a test can replace it.
      const again = back ? checkYaml(docModule.toYaml(back)) : null;
      const lines = again?.doc ? differences(original, canonicalDoc(again.doc)) : ['the export does not pass checkDoc'];
      if (lines.length) throw new RoundTripError(lines);
    });
    const d = check.doc;
    return {
      ok: true,
      counts: { positions: d.targets.positions.length, educations: d.targets.educations.length, projects: d.targets.projects.length, claims: d.claims.length },
      warnings: [...check.warnings, ...saved.warnings.filter((w) => !check.warnings.includes(w))],
      replaced,
    };
  } catch (e) {
    if (e instanceof RoundTripError) return { ok: false, errors: ['The tables do not give the same data back. Nothing was saved.', ...e.lines] };
    throw e;
  }
}
