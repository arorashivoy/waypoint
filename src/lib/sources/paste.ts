import { z } from 'zod';
import { db } from '@/lib/db';
import { checkForInjection, INJECTION_WARNING } from '@/lib/injection';
import { safeFetch, SafeFetchError } from '@/lib/net/safe-fetch';
import { queueJobAnalysis } from '@/lib/queue';
import { countryByCc } from '@/lib/countries';
import { ashbyJob, greenhouseJob, leverJob, watchlist, workableJob, workdayJob, type RawJob } from './index';
import { ccFromLocation, cityFromLocation, resolvePlace } from './geo';

/** An error with a text for the user. A retry cannot change it. The handler turns it into a TaskFatal. */
export class PasteUserError extends Error {}

export type Board = 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'workday';
/** A Workday link holds the company (`company`), the host number, the site and the path of the job below `/job/`. */
export type WorkdayRef = { host: string; site: string; path: string[] };
export type Parsed = { board: Board; company: string; jobId: string; region: 'eu' | null; workday?: WorkdayRef };

const BOARD_NAME: Record<Board, string> = { greenhouse: 'Greenhouse', lever: 'Lever', ashby: 'Ashby', workable: 'Workable', workday: 'Workday' };

const MAX_INPUT = 2000;
/** The same form for a company and a job ID. A name of dots only is not a name: it would climb the path. */
export const SLUG = /^[A-Za-z0-9._-]{1,100}$/;
/** One part of a Workday path. No `%`, so a part cannot hide a `/` or a `..`. */
export const WD_PART = /^[A-Za-z0-9._~-]{1,200}$/;
const wdPart = (s: string | undefined): s is string => !!s && WD_PART.test(s) && !/^\.+$/.test(s);
const WORKDAY_HOST = /^([a-z0-9-]{1,63})\.(wd\d{1,3})\.myworkdayjobs\.com$/;
const LOCALE = /^[a-z]{2}-[A-Z]{2}$/;
const slug = (s: string | undefined): s is string => !!s && SLUG.test(s) && !/^\.+$/.test(s);

const HOSTS: Record<string, { board: Board; region: 'eu' | null }> = {
  'boards.greenhouse.io': { board: 'greenhouse', region: null },
  'job-boards.greenhouse.io': { board: 'greenhouse', region: null },
  'job-boards.eu.greenhouse.io': { board: 'greenhouse', region: 'eu' },
  'jobs.lever.co': { board: 'lever', region: null },
  'jobs.eu.lever.co': { board: 'lever', region: 'eu' },
  'jobs.ashbyhq.com': { board: 'ashby', region: null },
  'apply.workable.com': { board: 'workable', region: null },
};

export const PASTE_ERROR = 'Paste a job link from Greenhouse, Lever, Ashby, Workable or Workday (for example https://boards.greenhouse.io/acme/jobs/123).';
const refuse = () => ({ error: PASTE_ERROR });

/** Reads the board, the company and the job ID from the URL. The pasted text is never fetched. */
export function parsePastedUrl(input: string): Parsed | { error: string } {
  const text = input.trim();
  if (!text || text.length > MAX_INPUT) return refuse();
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return refuse();
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return refuse();
  const hostname = url.hostname.toLowerCase();
  const wd = WORKDAY_HOST.exec(hostname);
  if (wd) return parseWorkday(url, wd[1], wd[2]);
  const host = HOSTS[hostname];
  if (!host) return refuse();

  // The query and the fragment are not in the path. One trailing slash is allowed.
  const parts = url.pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
  const [company, second, third, fourth] = parts;
  let jobId: string | undefined;
  let ok = false;
  if (host.board === 'greenhouse') {
    jobId = third;
    ok = parts.length === 3 && second === 'jobs' && /^\d{1,100}$/.test(third ?? '');
  } else if (host.board === 'lever') {
    jobId = second;
    ok = (parts.length === 2 || (parts.length === 3 && third === 'apply'));
  } else if (host.board === 'ashby') {
    jobId = second;
    ok = (parts.length === 2 || (parts.length === 3 && third === 'application'));
  } else {
    jobId = third;
    ok = (parts.length === 3 || (parts.length === 4 && fourth === 'apply')) && second === 'j';
  }
  if (!ok || !slug(company) || !slug(jobId)) return refuse();
  return { board: host.board, company, jobId, region: host.region };
}

/** A Workday job link: `/<site>/job/<place>/<title>_<id>`, with an optional locale before the site and `/apply` after. */
function parseWorkday(url: URL, tenant: string, host: string): Parsed | { error: string } {
  const parts = url.pathname.replace(/^\//, '').replace(/\/$/, '').split('/');
  if (LOCALE.test(parts[0] ?? '')) parts.shift();
  if (parts.at(-1) === 'applyManually' && parts.at(-2) === 'apply') parts.splice(-2);
  else if (parts.at(-1) === 'apply') parts.pop();
  const [site, job, ...path] = parts;
  if (job !== 'job' || !wdPart(site) || path.length < 1 || path.length > 3 || !path.every(wdPart)) return refuse();
  return { board: 'workday', company: tenant, jobId: path[path.length - 1], region: null, workday: { host, site, path } };
}

/** The API URL to fetch. Ashby and Workable have no one-job endpoint, so they give the list of the board. Built only from the parsed fields. */
export function apiUrlFor(p: Parsed): string {
  if (p.board === 'workday') {
    const w = p.workday!;
    return `https://${p.company}.${w.host}.myworkdayjobs.com/wday/cxs/${p.company}/${w.site}/job/${w.path.join('/')}`;
  }
  const company = encodeURIComponent(p.company);
  const id = encodeURIComponent(p.jobId);
  const eu = p.region === 'eu' ? '.eu' : '';
  switch (p.board) {
    case 'greenhouse':
      return `https://boards-api${eu}.greenhouse.io/v1/boards/${company}/jobs/${id}?content=true`;
    case 'lever':
      return `https://api${eu}.lever.co/v0/postings/${company}/${id}?mode=json`;
    case 'ashby':
      return `https://api.ashbyhq.com/posting-api/job-board/${company}?includeCompensation=false`;
    case 'workable':
      return `https://apply.workable.com/api/v1/widget/accounts/${company}?details=true`;
  }
}

export const PasteTaskPayload = z.object({
  board: z.enum(['greenhouse', 'lever', 'ashby', 'workable', 'workday']),
  company: z.string().regex(SLUG).refine((s) => !/^\.+$/.test(s)),
  jobId: z.string().regex(SLUG).refine((s) => !/^\.+$/.test(s)),
  region: z.enum(['eu']).nullable(),
  workday: z.object({ host: z.string().regex(/^wd\d{1,3}$/), site: z.string().regex(WD_PART), path: z.array(z.string().regex(WD_PART)).min(1).max(3) }).optional(),
}).refine((p) => (p.board === 'workday') === !!p.workday);

export type PasteResult = { jobId: string; added: boolean; cc: string; warning: string | null; note: string | null };

/** Finds the one job in the JSON that the board gave. Null when the board has no such job. */
function pick(p: Parsed, data: any): any {
  if (p.board === 'workday') return data?.jobPostingInfo && typeof data.jobPostingInfo === 'object' ? data : null;
  if (p.board === 'greenhouse' || p.board === 'lever') return data && typeof data === 'object' && !Array.isArray(data) && data.id !== undefined ? data : null;
  const list: any[] = Array.isArray(data?.jobs) ? data.jobs : [];
  const key = p.board === 'ashby' ? 'id' : 'shortcode';
  return list.find((j) => j && String(j[key]) === p.jobId) ?? null;
}

/** Fetches the job from the board API and stores it. The fetch URL comes from the payload, never from a stored string. */
export async function pasteJob(userId: string, p: Parsed): Promise<PasteResult> {
  const name = BOARD_NAME[p.board];
  const notFound = new PasteUserError(`Waypoint could not find this job on ${name}. Check the link.`);
  let res: Response;
  try {
    res = await safeFetch(apiUrlFor(p));
  } catch (e) {
    if (e instanceof SafeFetchError) throw new PasteUserError(e.message);
    throw e;
  }
  // A 5xx answer or a 429 answer can pass, so the task runs again. Any other failure is a fact about the link.
  if (res.status >= 500 || res.status === 429) throw new Error(`${name} answered ${res.status}`);
  if (!res.ok) throw notFound;
  let data: unknown;
  try {
    data = await res.json();
  } catch {
    throw new PasteUserError(`Waypoint could not read the answer of ${name}.`);
  }
  const posting = pick(p, data);
  if (!posting) throw notFound;

  // The company name is from the watchlist when the board is there. Its token then makes the same externalId as a refresh.
  // A Workday token holds the host and the site too: `tenant|host|site`.
  const want = (p.board === 'workday' ? `${p.company}|${p.workday!.host}|${p.workday!.site}` : p.company).toLowerCase();
  const entry = (await watchlist()).find((w) => w.ats === p.board && 'token' in w && w.token.toLowerCase() === want);
  const token = entry && 'token' in entry ? entry.token : p.company;
  const company = entry?.company || (p.board === 'greenhouse' && typeof posting.company_name === 'string' && posting.company_name.trim()) || p.company;
  let job: RawJob;
  if (p.board === 'workday') {
    const w = p.workday!;
    const info = posting.jobPostingInfo;
    const location = String(info.location || '');
    // Prefer the country code of Workday. The free text of the location is the fallback.
    const cc = (typeof info.country?.alpha2Code === 'string' && info.country.alpha2Code.toUpperCase()) || ccFromLocation(location) || '';
    job = workdayJob(info, `/job/${w.path.join('/')}`, {
      tenant: p.company,
      host: w.host,
      site: w.site,
      company: entry?.company || (typeof posting.hiringOrganization?.name === 'string' && posting.hiringOrganization.name.trim()) || p.company,
      cc,
      city: cityFromLocation(location),
      remote: resolvePlace(location).remote,
    });
  } else job = { greenhouse: greenhouseJob, lever: leverJob, ashby: ashbyJob, workable: workableJob }[p.board](posting, company, token);
  if (typeof job.role !== 'string' || !job.role.trim() || typeof job.url !== 'string' || !/^https:\/\//i.test(job.url)) {
    throw new PasteUserError(`Waypoint could not read this job from ${name}.`);
  }

  const known = await db.job.findUnique({ where: { externalId: job.externalId }, select: { id: true, pastedBy: true } });
  const { externalId, priority, postedAt, ...fields } = job;
  // A second user who pastes the same job makes it a shared job. Each user can see a job that they pasted.
  const shared = !!known?.pastedBy && known.pastedBy !== userId;
  const row = await db.job.upsert({
    where: { externalId },
    update: { ...fields, ...(postedAt && { postedAt }), ...(shared && { pastedBy: null }), fetchedAt: new Date() },
    create: { externalId, ...fields, pastedBy: userId, priority: entry?.priority ?? priority, postedAt: postedAt ?? new Date() },
  });

  const scan = checkForInjection(`${job.role}\n${job.description}`);
  const on = (await db.countryPref.findMany({ where: { userId, on: true }, select: { cc: true } })).map((c) => c.cc);
  let note: string | null = null;
  // A remote job shows in the list whatever its country, so it needs no note.
  if (row.remote) note = null;
  else if (!row.cc) note = 'Waypoint could not find the country of this job. It does not show in your list, but you can open it from here.';
  else if (!on.includes(row.cc)) {
    note = `This job is in ${countryByCc(row.cc)?.name ?? row.cc}, which is off in your settings. Turn it on in Settings to see the job in your list.`;
  }

  await queueJobAnalysis(userId, row.id);
  return { jobId: row.id, added: !known, cc: row.cc, warning: scan.suspicious ? INJECTION_WARNING : null, note };
}
