import { existsSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { db } from '../db';
import { hiddenTexMarkers } from '../profile/extract';
import { userDir } from '../user-files';

/**
 * The own résumé source of a user (spec 6.5). The file is hostile input: it is
 * compiled on the host. The checks here refuse the constructs that write files,
 * read other files, run programs or hide text. The compile also has its own
 * limits (see latex.ts), so these checks are the first of two layers.
 */

export const MAX_TEX_BYTES = 1024 * 1024;
const OWN_TEX = 'own.tex';

export type OwnTexCheck = { ok: true } | { ok: false; reasons: string[] };

/** Each rule has a bounded pattern: no nested quantifier, so no input makes a pattern slow. */
const RULES: { re: RegExp; reason: string }[] = [
  { re: /\\write\s{0,20}18(?!\d)/, reason: 'The file uses \\write18, which starts a program.' },
  { re: /\\immediate\s{0,20}\\write(?![A-Za-z])/, reason: 'The file uses \\immediate\\write, which writes a file.' },
  { re: /\\openin(?![A-Za-z])/, reason: 'The file uses \\openin, which reads a file.' },
  { re: /\\openout(?![A-Za-z])/, reason: 'The file uses \\openout, which writes a file.' },
  { re: /\\catcode(?![A-Za-z])/, reason: 'The file uses \\catcode, which changes how TeX reads text.' },
  { re: /\\(?:usepackage|RequirePackage)\s{0,20}(?:\[[^\]]{0,300}\])?\s{0,20}\{[^}]{0,500}shellesc/i, reason: 'The file loads the package shellesc, which starts programs.' },
  { re: /\\csname(?![A-Za-z])/, reason: 'The file uses \\csname, which builds a command from text.' },
  { re: /\\if\s{0,3}0/, reason: 'The file uses \\if0, which can hide text.' },
  { re: /\\phantom(?![A-Za-z])\s{0,20}\{[^{}]{0,500}[A-Za-z0-9]/, reason: 'The file uses \\phantom with text, which hides the text.' },
  { re: /\^\^/, reason: 'The file uses ^^ notation, which can hide a command.' },
];

const FILE_COMMAND = /\\(?:input|include|InputIfFileExists)(?![A-Za-z])\s{0,20}(?:\{\s{0,20}([^{}]{0,500})\}|([^\s{}]{1,500}))/g;
/** A plain relative name: letters, digits, dot, dash, underscore, space, and slashes between parts. */
const PLAIN_NAME = /^[\w.\- ]+(?:\/[\w.\- ]+)*$/;

function badPath(path: string): boolean {
  const p = path.trim();
  return !p || p.startsWith('~') || p.includes('..') || !PLAIN_NAME.test(p);
}

const COLOR_USE = /\\(?:text)?color\s{0,20}\{\s{0,20}([A-Za-z][\w!.\-]{0,50})\s{0,20}\}/g;
const COLOR_MODEL = /\\(?:text)?color\s{0,20}\[\s{0,20}(rgb|RGB|HTML|gray)\s{0,20}\]\s{0,20}\{([^{}]{0,100})\}/g;
const COLOR_DEF = /\\definecolor\s{0,20}\{\s{0,20}([A-Za-z][\w.\-]{0,50})\s{0,20}\}\s{0,20}\{\s{0,20}(rgb|RGB|HTML|gray)\s{0,20}\}\s{0,20}\{([^{}]{0,100})\}/g;

/** True when every channel of the colour is within 16 of white (0.94 or more, or 240 or more of 255). */
function nearWhite(model: string, spec: string): boolean {
  const parts = spec.split(',').map((x) => x.trim());
  if (model === 'HTML') {
    const m = /^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(parts[0] ?? '');
    return !!m && parts.length === 1 && [m[1], m[2], m[3]].every((h) => parseInt(h, 16) >= 0xf0);
  }
  const want = model === 'gray' ? 1 : 3;
  if (parts.length !== want || !parts.every((x) => /^\d{0,4}\.?\d{0,6}$/.test(x) && x !== '' && x !== '.')) return false;
  const min = model === 'RGB' ? 240 : 0.94;
  return parts.every((x) => Number(x) >= min);
}

function colorReasons(text: string): string[] {
  const out: string[] = [];
  if (/\\(?:text)?color\s{0,20}\{\s{0,20}white\s{0,20}(?:!\s{0,5}100\s{0,5})?\}/i.test(text)) out.push('The file sets white text with \\color{white} or \\textcolor{white}.');
  for (const m of text.matchAll(COLOR_MODEL)) {
    if (nearWhite(m[1], m[2])) {
      out.push('The file sets text to a colour that is near white.');
      break;
    }
  }
  const pale = new Set<string>();
  for (const m of text.matchAll(COLOR_DEF)) if (nearWhite(m[2], m[3]) && pale.size < 50) pale.add(m[1]);
  if (pale.size) {
    for (const m of text.matchAll(COLOR_USE)) {
      if (pale.has(m[1])) {
        out.push(`The file defines the near white colour "${m[1]}" and uses it for text.`);
        break;
      }
    }
  }
  return out;
}

export function checkOwnTex(text: string): OwnTexCheck {
  if (Buffer.byteLength(text, 'utf8') > MAX_TEX_BYTES) return { ok: false, reasons: ['The file is larger than 1 MB.'] };
  const reasons: string[] = [];
  for (const r of RULES) if (r.re.test(text)) reasons.push(r.reason);
  for (const m of text.matchAll(FILE_COMMAND)) {
    const path = m[1] ?? m[2] ?? '';
    if (badPath(path)) {
      reasons.push(`The file reads "${path.trim().slice(0, 60)}". Use a plain relative file name, with no "..", no "~" and no absolute path.`);
      break;
    }
  }
  reasons.push(...colorReasons(text));
  for (const h of hiddenTexMarkers(text)) reasons.push(`The file has hidden text: ${h}`);
  return reasons.length ? { ok: false, reasons: [...new Set(reasons)] } : { ok: true };
}

/** The folder that holds the own source of the user, and nothing else. */
export const ownTexDir = (userId: string) => userDir(userId, 'resumes');
export const ownTexPath = (userId: string) => join(ownTexDir(userId), OWN_TEX);
export const hasOwnTex = (userId: string) => existsSync(ownTexPath(userId));

/** Call this only after `checkOwnTex` passed. The old file stays as it was until the new file is complete. */
export async function saveOwnTex(userId: string, text: string): Promise<void> {
  const path = ownTexPath(userId);
  const tmp = `${path}.new`;
  writeFileSync(tmp, text, { mode: 0o600 });
  renameSync(tmp, path);
  await db.userSettings.upsert({
    where: { userId },
    create: { userId, resumeMode: 'own-tex', ownTex: OWN_TEX },
    update: { resumeMode: 'own-tex', ownTex: OWN_TEX },
  });
}

export async function removeOwnTex(userId: string): Promise<void> {
  rmSync(ownTexPath(userId), { force: true });
  await db.userSettings.upsert({
    where: { userId },
    create: { userId, resumeMode: 'template', ownTex: null },
    update: { resumeMode: 'template', ownTex: null },
  });
}
