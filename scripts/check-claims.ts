/**
 * Checks a claims.yml file.
 *
 * The file is the import form of a profile. `migrate:claims` and the app use
 * the same `checkDoc`, so a file that passes here also passes there.
 *
 *   npm run check:claims             the default path
 *   npm run check:claims -- --strict warnings fail too
 *   npm run check:claims -- <path>   another file
 */
import { existsSync, readFileSync } from 'fs';
import { CLAIMS_PATH, checkText, profileFromClaims, renderMetric } from '../src/lib/claims';

const args = process.argv.slice(2);
const strict = args.includes('--strict');
const path = args.find((a) => !a.startsWith('--')) || CLAIMS_PATH;

const C = process.stdout.isTTY
  ? { red: '\x1b[31m', yellow: '\x1b[33m', green: '\x1b[32m', dim: '\x1b[2m', bold: '\x1b[1m', off: '\x1b[0m' }
  : { red: '', yellow: '', green: '', dim: '', bold: '', off: '' };

if (!existsSync(path)) {
  console.log(`${C.yellow}·${C.off} ${path} does not exist.`);
  console.log(`${C.dim}  Not an error. Import a claims.yml in Settings → Data, or run npm run migrate:claims.${C.off}`);
  process.exit(0);
}

const text = readFileSync(path, 'utf8');
const lines = text.split('\n');
const { errors, warnings, doc } = checkText(text);

/** Error paths name a claim slug or a target id rather than a line, because the
 *  validator works on parsed data. Finding that token in the raw text gives
 *  back the line number, which is what makes the message clickable. */
function lineOf(message: string): number | null {
  const key = message.match(/claims\[([a-z0-9-]+)\]/)?.[1];
  if (key) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*-?\\s*slug:\\s*${key}\\s*$`).test(l));
    if (i >= 0) return i + 1;
  }
  const target = message.match(/"(project|position|education):([a-z0-9-]+)"/);
  if (target) {
    const i = lines.findIndex((l) => new RegExp(`^\\s*-?\\s*id:\\s*${target[2]}\\s*$`).test(l));
    if (i >= 0) return i + 1;
  }
  return null;
}

const show = (colour: string, mark: string, msgs: string[]) => {
  for (const m of msgs) {
    const ln = lineOf(m);
    console.log(`${colour}${mark}${C.off} ${path}${ln ? `:${ln}` : ''} ${C.dim}·${C.off} ${m}`);
  }
};

show(C.red, '✗', errors);
if (errors.length && warnings.length) console.log('');
show(C.yellow, '!', warnings);

if (errors.length) {
  console.log(`\n${C.red}${C.bold}${errors.length} error${errors.length > 1 ? 's' : ''}${C.off} — fix them before you import this file.`);
  process.exit(1);
}

// Parsing cleanly is necessary but not sufficient: the file is only correct if
// it still yields the profile the prompts are built from. Running the real
// mapping here catches a file that validates but resolves to an empty or
// nonsensical profile.
const profile = profileFromClaims(doc!);
if (!profile.positions.length && !profile.projects.length) {
  console.log(`${C.red}✗${C.off} valid, but resolves to a profile with no positions and no projects — nothing for the prompts to cite.`);
  process.exit(1);
}

const claims = doc!.claims;
const metrics = claims.filter((c) => c.value !== undefined);
console.log(`${C.green}✓${C.off} ${path} is valid.`);
console.log(
  `${C.dim}  ${claims.length} claims · ${doc!.targets.positions.length} positions · ` +
    `${doc!.targets.educations.length} educations · ${doc!.targets.projects.length} projects · ` +
    `${claims.reduce((n, c) => n + c.evidence.length, 0)} evidence edges · ` +
    `${claims.reduce((n, c) => n + c.links.length, 0)} links${C.off}`,
);
console.log(`${C.dim}  headline: ${profile.headline}${C.off}`);
console.log(`${C.dim}  levels: ${profile.levels.join(', ')} · employer: ${profile.currentEmployer || '—'}${C.off}`);
if (metrics.length) console.log(`${C.dim}  metrics: ${metrics.map(renderMetric).join(' · ')}${C.off}`);

// The gap report: the whole reason the mention edges exist. Only the three
// surfaces where an absence is a *lost match* are reported. A headline holds
// six words and an About section is prose, so "Kafka is missing from the
// headline" is noise; LinkedIn Skills is a recruiter filter, the resume is what
// the ATS parses, and LinkedIn Projects is the cheapest place to evidence side
// work — an absence in those three costs him something measurable.
const GAP_SURFACES = ['resume', 'linkedin-skills', 'linkedin-projects'] as const;
const gaps = GAP_SURFACES.map((s) => {
  const missing = claims.filter((c) => c.evidence.length && !c.mentions.some((m) => m.surface === s && m.listed));
  return { s: s as string, missing };
}).filter((g) => g.missing.length);

if (gaps.length) {
  console.log(`\n${C.bold}Coverage gaps${C.off} ${C.dim}(evidenced, but that surface does not carry it)${C.off}`);
  for (const g of gaps.sort((a, b) => b.missing.length - a.missing.length)) {
    console.log(`  ${g.s.padEnd(20)} ${C.dim}${g.missing.length}:${C.off} ${g.missing.map((c) => c.label).join(', ')}`);
  }
}

if (warnings.length && strict) {
  console.log(`\n${C.yellow}${warnings.length} warning${warnings.length > 1 ? 's' : ''}, and --strict was passed.${C.off}`);
  process.exit(1);
}
