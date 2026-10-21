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

/**
 * A second layer. Text checks cannot make TeX safe: macros can build any command from parts.
 * The real guard is the engine choice (an own source never compiles with lualatex, see
 * buildResume) with -no-shell-escape and openin_any=p / openout_any=p. These rules refuse the
 * common forms early and give the user a reason.
 * Each rule has a bounded pattern: no nested quantifier, so no input makes a pattern slow.
 */
const RULES: { re: RegExp; reason: string }[] = [
  { re: /\\write\s{0,20}18(?!\d)/, reason: 'The file uses \\write18, which starts a program.' },
  { re: /\\immediate\s{0,20}\\write(?![A-Za-z])/, reason: 'The file uses \\immediate\\write, which writes a file.' },
  { re: /\\openin(?![A-Za-z])/, reason: 'The file uses \\openin, which reads a file.' },
  { re: /\\openout(?![A-Za-z])/, reason: 'The file uses \\openout, which writes a file.' },
  { re: /\\catcode(?![A-Za-z])/, reason: 'The file uses \\catcode, which changes how TeX reads text.' },
  { re: /\\(?:usepackage|RequirePackage)\s{0,20}(?:\[[^\]]{0,300}\])?\s{0,20}\{[^}]{0,500}shellesc/i, reason: 'The file loads the package shellesc, which starts programs.' },
  { re: /\\(?:usepackage|RequirePackage)\s{0,20}(?:\[[^\]]{0,300}\])?\s{0,20}\{[^}]{0,500}luacode/i, reason: 'The file loads the package luacode, which runs Lua code.' },
  { re: /\\begin\s{0,20}\{\s{0,20}luacode/, reason: 'The file has a luacode environment, which runs Lua code.' },
  { re: /directlua|luaexec|luadirect|latelua|lua_now|lua_shipout|\\lua_/, reason: 'The file runs Lua code, which can read and write files.' },
  { re: /\\use:[cC]|\\cs:w|\\scantokens(?![A-Za-z])|\\pdfprimitive(?![A-Za-z])/, reason: 'The file uses \\use:c, \\cs:w, \\scantokens or \\pdfprimitive, which build or hide commands.' },
  { re: /\\csname(?![A-Za-z])/, reason: 'The file uses \\csname, which builds a command from text.' },
  { re: /\\if\s{0,3}0/, reason: 'The file uses \\if0, which can hide text.' },
  { re: /\\[hv]?phantom(?![A-Za-z])\s{0,20}\{[^{}]{0,500}[A-Za-z0-9]/, reason: 'The file uses \\phantom, \\hphantom or \\vphantom with text, which hides the text.' },
];

const FILE_COMMAND = /\\(?:input|include|InputIfFileExists)(?![A-Za-z])\s{0,20}(?:\{\s{0,20}([^{}]{0,500})\}|([^\s{}]{1,500}))/g;
/** A plain relative name: letters, digits, dot, dash, underscore, space, and slashes between parts. */
const PLAIN_NAME = /^[\w.\- ]+(?:\/[\w.\- ]+)*$/;

function badPath(path: string): boolean {
  const p = path.trim();
  return !p || p.startsWith('~') || p.includes('..') || !PLAIN_NAME.test(p);
}

type Rgb = [number, number, number];
const WHITE: Rgb = [1, 1, 1];
const BLACK: Rgb = [0, 0, 0];
const MID: Rgb = [0.5, 0.5, 0.5];
const isPale = (c: Rgb) => c.every((v) => v >= 0.94);

/** A number in a colour spec. NaN when the text is not a plain decimal. */
const num = (x: string | undefined) => (x !== undefined && /^(?:\d{1,6}\.?\d{0,6}|\.\d{1,6})$/.test(x.trim()) ? Number(x.trim()) : NaN);

/** The colour of an xcolor expression such as `white!95` or `white!98!black`. A name that is not known counts as mid grey. */
function exprColor(expr: string, defs: Map<string, Rgb>): Rgb {
  const parts = expr.split('!').map((x) => x.trim());
  const named = (n: string): Rgb => (n === 'white' ? WHITE : n === 'black' ? BLACK : (defs.get(n) ?? MID));
  let cur = named(parts[0].toLowerCase() === 'white' ? 'white' : parts[0]);
  for (let i = 1; i < parts.length && i < 20; i += 2) {
    const n = num(parts[i]);
    if (Number.isNaN(n)) return MID;
    const other = parts[i + 1] === undefined ? WHITE : named(parts[i + 1]);
    const f = Math.min(Math.max(n / 100, 0), 1);
    cur = cur.map((v, k) => v * f + other[k] * (1 - f)) as Rgb;
  }
  return cur;
}

/** The colour of `{spec}` in a model, or MID when the spec is not understood. */
function modelColor(model: string, spec: string, defs: Map<string, Rgb>): Rgb {
  const parts = spec.trim().split(/[\s,]+/).filter(Boolean);
  const vals = parts.map(num);
  const ok = (n: number) => vals.length === n && vals.every((v) => !Number.isNaN(v));
  switch (model) {
    case 'rgb':
      return ok(3) ? (vals as Rgb) : MID;
    case 'RGB':
      return ok(3) ? (vals.map((v) => v / 255) as Rgb) : MID;
    case 'HTML': {
      const m = /^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/.exec(spec.trim());
      return m ? ([m[1], m[2], m[3]].map((h) => parseInt(h, 16) / 255) as Rgb) : MID;
    }
    case 'gray':
      return ok(1) ? [vals[0], vals[0], vals[0]] : MID;
    case 'Gray':
      return ok(1) ? [vals[0] / 15, vals[0] / 15, vals[0] / 15] : MID;
    case 'cmyk':
      return ok(4) && vals.every((v) => v <= 0.06) ? WHITE : MID;
    case 'named':
      return exprColor(spec, defs);
    default:
      return MID;
  }
}

const COLOR_DEF = /\\definecolor\s{0,20}\{\s{0,20}([A-Za-z][\w.\-]{0,50})\s{0,20}\}\s{0,20}\{\s{0,20}([A-Za-z]{3,5})\s{0,20}\}\s{0,20}\{([^{}]{0,100})\}/g;
const COLOR_LET = /\\colorlet\s{0,20}\{\s{0,20}([A-Za-z][\w.\-]{0,50})\s{0,20}\}\s{0,20}(?:\[\d{1,2}\])?\s{0,20}\{([^{}]{0,100})\}/g;
const COLOR_USE = /\\(?:text)?color(?![A-Za-z])\s{0,20}(?:\[\s{0,20}([A-Za-z]{3,5})\s{0,20}\]\s{0,20}\{([^{}]{0,100})\}|\{([^{}]{0,100})\})/g;

function colorReasons(text: string): string[] {
  // Definitions in file order, so a later colorlet can use an earlier name.
  const defs = new Map<string, Rgb>();
  const found: { at: number; name: string; model: string; spec: string }[] = [];
  for (const m of text.matchAll(COLOR_DEF)) found.push({ at: m.index ?? 0, name: m[1], model: m[2], spec: m[3] });
  for (const m of text.matchAll(COLOR_LET)) found.push({ at: m.index ?? 0, name: m[1], model: 'named', spec: m[2] });
  found.sort((x, y) => x.at - y.at);
  for (const d of found.slice(0, 200)) defs.set(d.name, modelColor(d.model, d.spec, defs));
  for (const m of text.matchAll(COLOR_USE)) {
    const c = m[1] ? modelColor(m[1], m[2], defs) : exprColor(m[3], defs);
    if (isPale(c)) return ['The file sets text to white or a near white colour.'];
  }
  return [];
}

/** Remove TeX comments (a `%` that no backslash escapes, to the end of the line), then collapse white space. TeX joins `\textcolor%` and `{white}` in the same way. */
function clean(text: string): string {
  return text.replace(/(?<!\\)%[^\n]*\n?/g, '').replace(/\s+/g, ' ');
}

const TINY_SCALE = /\\scalebox\s{0,20}\{\s{0,20}([\d.]{1,12})|\\resizebox\*?\s{0,20}\{\s{0,20}([\d.]{1,12})/g;

/** Every refusal check on one form of the text. */
function scan(text: string): string[] {
  const reasons: string[] = [];
  for (const r of RULES) if (r.re.test(text)) reasons.push(r.reason);
  if (/\\ExplSyntaxOn/.test(text) && /lua|write|input|open/.test(text)) {
    reasons.push('The file uses \\ExplSyntaxOn with lua, write, input or open, which can build a command.');
  }
  for (const m of text.matchAll(TINY_SCALE)) {
    const f = num(m[1] ?? m[2]);
    if (!Number.isNaN(f) && f < 0.2) {
      reasons.push('The file scales text below 0.2, which hides the text.');
      break;
    }
  }
  for (const m of text.matchAll(FILE_COMMAND)) {
    const path = m[1] ?? m[2] ?? '';
    if (badPath(path)) {
      reasons.push(`The file reads "${path.trim().slice(0, 60)}". Use a plain relative file name, with no "..", no "~" and no absolute path.`);
      break;
    }
  }
  reasons.push(...colorReasons(text));
  for (const h of hiddenTexMarkers(text)) reasons.push(`The file has hidden text: ${h}`);
  return reasons;
}

/** Runs on the raw text and on the text without comments. A refusal of either form counts: \verb|%| can hide a line from one form but not from TeX. */
export function checkOwnTex(text: string): OwnTexCheck {
  if (Buffer.byteLength(text, 'utf8') > MAX_TEX_BYTES) return { ok: false, reasons: ['The file is larger than 1 MB.'] };
  const reasons: string[] = [];
  if (/\^\^/.test(text)) reasons.push('The file uses ^^ notation, which can hide a command.');
  reasons.push(...scan(text), ...scan(clean(text)));
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
