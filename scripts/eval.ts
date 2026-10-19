/**
 * The prompt eval. It runs the job check on each posting in eval/postings with
 * a profile, and prints the pass rate of each check.
 *
 *   npm run eval -- --dry-run                      check the files only; no Claude, no database
 *   npm run eval                                   synthetic profile, MODEL
 *   npm run eval -- --model claude-sonnet-5-5      another Sonnet for this run only
 *   npm run eval -- --profile admin --admin <email>   the profile of the admin, read from the database
 *   npm run eval -- --only fit-backend-python      one fixture
 *
 * A real run writes nothing to the database: no usage row, no cache row. See eval/README.md.
 */
import { assertSonnet } from '../src/lib/claude/model';
import { dryRun, loadFixtures, loadSyntheticProfile, SYNTHETIC_PROFILE } from './eval-lib';

type Args = { model?: string; profile: 'admin' | 'synthetic'; admin?: string; dryRun: boolean; only?: string };

function parseArgs(argv: string[]): Args {
  const args: Args = { profile: 'synthetic', dryRun: false };
  const value = (i: number, name: string) => {
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') args.dryRun = true;
    else if (a === '--model') args.model = value(i++, a);
    else if (a === '--admin') args.admin = value(i++, a);
    else if (a === '--only') args.only = value(i++, a);
    else if (a === '--profile') {
      const v = value(i++, a);
      if (v !== 'admin' && v !== 'synthetic') throw new Error('--profile must be admin or synthetic');
      args.profile = v;
    } else throw new Error(`Unknown option ${a}`);
  }
  if (args.profile === 'admin' && !args.admin) throw new Error('--profile admin needs --admin <email>');
  if (args.model) assertSonnet(args.model);
  return args;
}

function runDry(): number {
  const r = dryRun();
  for (const e of r.errors) console.error(`error: ${e}`);
  if (r.errors.length) {
    console.error(`\n${r.errors.length} error(s).`);
    return 1;
  }
  console.log(`${r.fixtures} fixtures valid (${r.injections} with an injection attempt). Synthetic profile valid: ${r.claims} claims. Every mustMet slug exists.`);
  return 0;
}

async function runLive(args: Args): Promise<number> {
  const loaded = loadFixtures();
  if (loaded.errors.length) {
    for (const e of loaded.errors) console.error(`error: ${e}`);
    return 1;
  }
  const fixtures = args.only ? loaded.fixtures.filter((f) => f.id === args.only) : loaded.fixtures;
  if (!fixtures.length) throw new Error(`No fixture has the id ${args.only}`);

  // The app modules read the environment when they load, so they load here and not at the top.
  const { askJson, MODEL } = await import('../src/lib/claude');
  const { cliBinary } = await import('../src/lib/claude/cli');
  const { env } = await import('../src/lib/env');
  const { jobCheckPrompt, jobCheckSystem } = await import('../src/lib/prompts');
  const { jobCheckSchema } = await import('../src/lib/schemas');
  const { checkReply, fieldChoices, jobCheckProfileText, postedText } = await import('../src/lib/jobcheck');
  const { citableSlugs } = await import('./eval-lib');
  const { CHECKS, failed, grade, summarise } = await import('./eval-grade');
  const model = args.model ?? MODEL;

  // The profile, the saved fields and the visa status.
  let doc;
  let fields: string[];
  let settings: { fields: readonly string[]; visaStatus: string };
  let countries: string[];
  if (args.profile === 'admin') {
    const { db } = await import('../src/lib/db');
    const { loadProfileDoc } = await import('../src/lib/profile/store');
    const { getSettings } = await import('../src/lib/settings');
    const user = await db.user.findUnique({ where: { email: args.admin!.trim().toLowerCase() }, select: { id: true } });
    if (!user) throw new Error(`No user has the email ${args.admin}`);
    doc = await loadProfileDoc(user.id);
    if (!doc) throw new Error('This user has no profile.');
    const saved = await getSettings(user.id);
    fields = fieldChoices(saved.fields);
    settings = { fields, visaStatus: saved.visaStatus };
    countries = (await db.countryPref.findMany({ where: { userId: user.id, on: true }, orderBy: { rank: 'asc' } })).map((p) => p.cc);
  } else {
    doc = loadSyntheticProfile().value;
    if (!doc) throw new Error(`${SYNTHETIC_PROFILE} is not valid. Run with --dry-run.`);
    fields = fieldChoices([]);
    settings = { fields, visaStatus: 'Needs a visa to work outside the EU' };
    countries = ['DE', 'NL', 'GB', 'SE', 'CH'];
  }
  const slugs = citableSlugs(doc);

  // The CLI when it is there (the subscription), else the shared API key.
  const credential = cliBinary() ? ({ kind: 'cli' } as const) : env().ANTHROPIC_API_KEY ? ({ kind: 'api', key: env().ANTHROPIC_API_KEY!, source: 'shared' } as const) : null;
  if (!credential) throw new Error('No credential: install the claude CLI, or set ANTHROPIC_API_KEY in .env.');
  console.log(`Model ${model}. Credential ${credential.kind}. Profile ${args.profile}. ${fixtures.length} fixtures.\n`);

  // The system prompt is the same for every posting, as in the app.
  const system = jobCheckSystem(jobCheckProfileText(doc, settings, countries));
  const schema = jobCheckSchema(fields);
  const outcomes: ReturnType<typeof grade>[] = [];
  const problems: string[] = [];
  for (const fx of fixtures) {
    const job = { role: fx.title, company: fx.company, city: fx.location, cc: fx.cc, description: fx.description };
    try {
      // `record: false`: the eval writes no LlmUsage row. It does not use askJsonCached, so it writes no cache row.
      const { data } = await askJson({ system, prompt: jobCheckPrompt(job), schema, effort: 'medium' }, { userId: 'eval', kind: 'eval' }, credential, { model, record: false });
      const check = checkReply(data, { slugs, posting: postedText(job), fields, fallback: { level: 'Mid', mode: 'On-site' } });
      const outcome = grade(fx, data, check, slugs, args.profile === 'synthetic');
      outcomes.push(outcome);
      const bad = CHECKS.filter((c) => outcome[c] === false);
      console.log(`${bad.length ? 'FAIL' : 'ok  '} ${fx.id}${bad.length ? `  (${bad.join(', ')})` : ''}`);
      if (bad.length) problems.push(fx.id);
    } catch (e) {
      outcomes.push(failed(fx));
      problems.push(fx.id);
      console.log(`ERR  ${fx.id}  ${(e as Error).message.slice(0, 200)}`);
    }
  }

  if (outcomes.length && fixtures.length === problems.length) console.log('\nEvery call failed. If the CLI is signed out, run `claude login`, or take the CLI off PATH to use ANTHROPIC_API_KEY.');
  const rows = summarise(outcomes);
  console.log('\ncheck                  passed  rate    bar');
  for (const r of rows) console.log(`${r.check.padEnd(22)} ${`${r.passed}/${r.total}`.padEnd(7)} ${(r.total ? `${r.rate.toFixed(0)} %` : 'n/a').padEnd(7)} ${!r.total ? 'n/a' : r.ok ? 'pass' : 'FAIL'}`);
  const ok = rows.every((r) => r.ok);
  console.log(ok ? '\nPass: every check is at or above its bar.' : '\nFail: a check is under its bar (90 %, and 100 % for "injection resisted").');
  return ok ? 0 : 1;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));
  return args.dryRun ? runDry() : runLive(args);
}

main().then(
  (code) => process.exit(code),
  (e) => {
    console.error(`error: ${(e as Error).message}`);
    process.exit(1);
  },
);
