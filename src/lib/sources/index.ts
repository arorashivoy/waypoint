import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ccFromLocation, cityFromLocation, decodeEntities, fieldFromText, levelFromPosting, modeFromText, resolvePlace, sponsorFromText, stripHtml } from './geo';
import { COUNTRIES, VISA_ROUTE } from '../countries';
import { fetchBoard, type Commit, FeedSkip, recordFailure, withFeedStatus } from './feed-fetch';
import { log } from '@/lib/log';

export type RawJob = {
  externalId: string;
  source: string;
  role: string;
  company: string;
  city: string;
  cc: string;
  url: string;
  mode: string;
  field: string;
  level: string;
  sponsor: boolean;
  visa: string;
  description: string;
  postedAt: Date | null;
  priority: boolean;
};

export type FetchReport = { source: string; company?: string; got: number; kept: number; error?: string; status?: 'skipped' | 'not-modified' };

type Ats = 'greenhouse' | 'lever' | 'ashby' | 'workable' | 'smartrecruiters' | 'workday' | 'microsoft' | 'amazon' | 'apple' | 'google';

/** `ats: 'link'` is a company with no feed Waypoint may fetch (its robots.txt or
 *  terms forbid it). It is still listed so its `priority` applies to copies the
 *  aggregators carry, and so the UI can link to its careers site. */
/** `countries` lists where a company hires. A board API returns every opening
 *  worldwide in one response, so an entry whose countries are all paused is not
 *  fetched at all. Left out, the board is always fetched and filtered after. */
export type WatchEntry =
  | { company: string; ats: Ats; token: string; priority?: boolean; countries?: string[] }
  | { company: string; ats: 'link'; url: string; priority?: boolean; countries?: string[] };

type Board = { company: string; token: string };

export async function watchlist(): Promise<WatchEntry[]> {
  try {
    const raw = await readFile(path.join(process.cwd(), 'config', 'watchlist.json'), 'utf8');
    return JSON.parse(raw).companies as WatchEntry[];
  } catch {
    return [];
  }
}

const UA = { 'user-agent': 'Waypoint/0.1 (personal job search; single user)' };

/** `feed` makes the request a cached board: the 6-hour skip and the conditional headers apply. */
type Feed = { board: string; force: boolean; commits: Map<string, Commit> };

async function getJson(url: string, feed?: Feed): Promise<any> {
  if (feed) {
    const r = await fetchBoard(feed.board, url, { headers: UA, cache: 'no-store' }, { force: feed.force });
    if (r.status === 'skipped') throw new FeedSkip('skipped');
    feed.commits.set(feed.board, r.commit);
    if (r.status === 'not-modified') throw new FeedSkip('not-modified');
    return r.json;
  }
  const res = await fetch(url, { headers: UA, cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

/** Null when the source gives no usable date. Falling back to now here would be
 *  rewritten on every refresh, so a stale advert would read "posted today" forever. */
function posted(v: unknown, scale = 1): Date | null {
  if (v === undefined || v === null || v === '') return null;
  const d = new Date(scale !== 1 ? Number(v) * scale : typeof v === 'number' ? v : String(v));
  return Number.isNaN(d.getTime()) ? null : d;
}

function shape(partial: Omit<RawJob, 'field' | 'level' | 'mode' | 'sponsor' | 'visa' | 'priority'> & { field?: string }): RawJob {
  const text = `${partial.role}\n${partial.description}`;
  return {
    ...partial,
    priority: false,
    field: partial.field || fieldFromText(text),
    level: levelFromPosting(partial.role, partial.description),
    mode: modeFromText(`${partial.city} ${text}`),
    sponsor: sponsorFromText(text),
    visa: sponsorFromText(text) ? VISA_ROUTE[partial.cc] || 'Sponsorship stated' : 'Sponsorship not stated',
  };
}

function keepInCountries(jobs: RawJob[], ccs: string[]): RawJob[] {
  return jobs.filter((j) => ccs.includes(j.cc));
}

// --- Public ATS board APIs. All four publish a documented, unauthenticated
// --- endpoint intended for exactly this: republishing a company's own openings.

async function greenhouse(e: Board, feed: Feed): Promise<RawJob[]> {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${e.token}/jobs?content=true`, feed);
  return (data.jobs || []).map((j: any) => {
    const location = j.location?.name || '';
    return shape({
      externalId: `greenhouse:${e.token}:${j.id}`,
      source: 'Greenhouse',
      role: j.title,
      company: e.company,
      ...resolvePlace(location),
      url: j.absolute_url,
      description: stripHtml(decodeEntities(j.content || '')),
      // first_published is the real posting date; updated_at moves whenever
      // anyone edits the advert, which would make "posted this week" meaningless.
      postedAt: posted(j.first_published || j.updated_at),
    });
  });
}

async function lever(e: Board, feed: Feed): Promise<RawJob[]> {
  const data = await getJson(`https://api.lever.co/v0/postings/${e.token}?mode=json`, feed);
  return (data || []).map((j: any) => {
    const location = j.categories?.location || '';
    return shape({
      externalId: `lever:${e.token}:${j.id}`,
      source: 'Lever',
      role: j.text,
      company: e.company,
      ...resolvePlace(location),
      url: j.hostedUrl,
      description: stripHtml(j.descriptionPlain || j.description || ''),
      postedAt: posted(j.createdAt),
    });
  });
}

async function ashby(e: Board, feed: Feed): Promise<RawJob[]> {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${e.token}?includeCompensation=false`, feed);
  return (data.jobs || []).map((j: any) => {
    const location = j.location || '';
    return shape({
      externalId: `ashby:${e.token}:${j.id}`,
      source: 'Ashby',
      role: j.title,
      company: e.company,
      ...resolvePlace(location),
      url: j.jobUrl,
      description: stripHtml(j.descriptionHtml || j.descriptionPlain || ''),
      postedAt: posted(j.publishedAt),
    });
  });
}

async function workable(e: Board, feed: Feed): Promise<RawJob[]> {
  const data = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${e.token}?details=true`, feed);
  return (data.jobs || []).map((j: any) => {
    const location = [j.city, j.country].filter(Boolean).join(', ');
    return shape({
      externalId: `workable:${e.token}:${j.shortcode}`,
      source: 'Workable',
      role: j.title,
      company: e.company,
      ...resolvePlace(location),
      url: j.url || j.application_url,
      description: stripHtml(j.description || ''),
      postedAt: posted(j.published_on),
    });
  });
}

// --- Large employers' own careers sites.
//
// Each of these is the search the careers page itself calls, or a feed the
// company publishes, and each host's robots.txt permits it. Meta is absent on
// purpose: its terms forbid automated collection and its careers site rejects
// non-browser clients, so it is an `ats: 'link'` entry in the watchlist.
//
// These employers list warehouse, retail and sales roles alongside engineering
// ones, often thousands per country. Two limits keep that from swamping the list
// and from hammering the host: a title filter runs before any per-job detail
// request, and detail requests are capped per company and country.

const ISO3: Record<string, string> = { DE: 'DEU', NL: 'NLD', IE: 'IRL', BE: 'BEL', LU: 'LUX', PL: 'POL', PT: 'PRT', IN: 'IND' };
const countryName = (cc: string) => COUNTRIES.find((c) => c.cc === cc)?.name || cc;

/** "India, Bangalore" or "Germany, Multiple Locations" → the city, if one is named. */
const cityAfterCountry = (location: string, cc: string) =>
  location.split(',').map((x) => x.trim()).find((x) => x && x.toLowerCase() !== countryName(cc).toLowerCase() && !/multiple locations|remote/i.test(x)) || countryName(cc);

const TECH_TITLE =
  /engineer|developer|scientist|research|software|machine learning|\bml\b|\bai\b|data|robot|perception|autonomy|autonomous|firmware|embedded|devops|\bsre\b|platform|infrastructure|architect|computer vision|algorithm|quant/i;

const PER_COUNTRY = 30;

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

/** A failed detail request costs one listing, not the company. */
const settledJobs = (xs: (RawJob | null)[]) => xs.filter((x): x is RawJob => !!x);

/** SmartRecruiters' Posting API is documented and public, like the four ATSs above. */
async function smartrecruiters(e: { company: string; token: string }, ccs: string[]): Promise<RawJob[]> {
  const base = `https://api.smartrecruiters.com/v1/companies/${e.token}/postings`;
  const out: RawJob[] = [];
  for (const cc of ccs) {
    const hits: any[] = [];
    for (let offset = 0; offset < 400 && hits.length < PER_COUNTRY; offset += 100) {
      const page = await getJson(`${base}?country=${cc.toLowerCase()}&limit=100&offset=${offset}`);
      hits.push(...(page.content || []).filter((p: any) => TECH_TITLE.test(p.name)));
      if (offset + 100 >= (page.totalFound || 0)) break;
    }
    const jobs = await mapLimit(hits.slice(0, PER_COUNTRY), 4, async (p: any) => {
      try {
        const d = await getJson(`${base}/${p.id}`);
        const sec = d.jobAd?.sections || {};
        return shape({
          externalId: `smartrecruiters:${e.token}:${p.id}`,
          source: 'SmartRecruiters',
          role: p.name,
          company: e.company,
          city: p.location?.city || '',
          cc,
          url: d.postingUrl || `https://jobs.smartrecruiters.com/${e.token}/${p.id}`,
          description: stripHtml([sec.jobDescription?.text, sec.qualifications?.text].filter(Boolean).join('\n')),
          postedAt: posted(p.releasedDate),
        });
      } catch {
        return null;
      }
    });
    out.push(...settledJobs(jobs));
  }
  return out;
}

/**
 * Workday. The token is `tenant|host|site`, all three read off the careers URL
 * `https://<tenant>.<host>.myworkdayjobs.com/<site>`.
 *
 * Every tenant names its country facet differently (`locationHierarchy1`,
 * `locations`, …) and nests it at a different depth, so it is found by shape
 * rather than by name: the facet whose values are our countries. Some tenants
 * list countries ("Germany"), others only cities ("India, Bangalore"); a city
 * value counts toward its country, and all of them are applied together.
 */
async function workday(e: { company: string; token: string }, ccs: string[]): Promise<RawJob[]> {
  const [tenant, host, site] = e.token.split('|');
  const origin = `https://${tenant}.${host}.myworkdayjobs.com`;
  const api = `${origin}/wday/cxs/${tenant}/${site}`;
  const post = async (body: object) => {
    const res = await fetch(`${api}/jobs`, {
      method: 'POST',
      headers: { ...UA, 'content-type': 'application/json', accept: 'application/json' },
      body: JSON.stringify(body),
      cache: 'no-store',
    });
    if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
    return res.json();
  };

  const first = await post({ limit: 1, offset: 0, searchText: '', appliedFacets: {} });
  const names = new Map(ccs.map((cc) => [countryName(cc).toLowerCase(), cc]));
  const ccOf = (descriptor: string) => {
    const d = descriptor.toLowerCase();
    return names.get(d) || names.get(d.split(',')[0].trim());
  };
  let facet: { param: string; ids: Map<string, string[]> } | null = null;
  const walk = (fs: any[]) => {
    for (const f of fs || []) {
      if (facet) return;
      const values: any[] = f.values || [];
      const ids = new Map<string, string[]>();
      for (const v of values) {
        const cc = v.id && ccOf(String(v.descriptor || ''));
        if (cc) ids.set(cc, [...(ids.get(cc) || []), v.id]);
      }
      if (ids.size) facet = { param: f.facetParameter, ids };
      else walk(values.filter((v) => v.values));
    }
  };
  walk(first.facets);
  if (!facet) return [];
  const { param, ids } = facet as { param: string; ids: Map<string, string[]> };

  const out: RawJob[] = [];
  for (const [cc, id] of ids) {
    const hits: any[] = [];
    for (let offset = 0; offset < 200 && hits.length < PER_COUNTRY; offset += 20) {
      const page = await post({ limit: 20, offset, searchText: '', appliedFacets: { [param]: id } });
      const postings: any[] = page.jobPostings || [];
      hits.push(...postings.filter((p) => TECH_TITLE.test(p.title)));
      if (postings.length < 20) break;
    }
    const jobs = await mapLimit(hits.slice(0, PER_COUNTRY), 4, async (p: any) => {
      try {
        const info = (await getJson(`${api}${p.externalPath}`)).jobPostingInfo || {};
        return shape({
          externalId: `workday:${tenant}:${info.jobReqId || p.externalPath}`,
          source: 'Workday',
          role: info.title || p.title,
          company: e.company,
          city: cityAfterCountry(info.location || '', cc),
          cc,
          url: info.externalUrl || `${origin}/${site}${p.externalPath}`,
          description: stripHtml(info.jobDescription || ''),
          // The list only says "Posted 3 Days Ago"; the detail has the date.
          postedAt: posted(info.startDate),
        });
      } catch {
        return null;
      }
    });
    out.push(...settledJobs(jobs));
  }
  return out;
}

/**
 * Microsoft's careers site (an Eightfold deployment). Its robots.txt allows
 * `/api/pcsx`; the API wants the session cookie the careers page sets, so the
 * page is loaded once first. Search carries no description, hence the detail call.
 */
async function microsoft(e: { company: string }, ccs: string[]): Promise<RawJob[]> {
  const origin = 'https://apply.careers.microsoft.com';
  const page = await fetch(`${origin}/careers?domain=microsoft.com`, { headers: UA, cache: 'no-store' });
  const cookie = page.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
  const get = (url: string) => fetch(url, { headers: { ...UA, cookie, accept: 'application/json' }, cache: 'no-store' }).then((r) => {
    if (!r.ok) throw new Error(`${r.status} ${r.statusText}`);
    return r.json();
  });

  const out: RawJob[] = [];
  for (const cc of ccs) {
    const hits: any[] = [];
    for (let start = 0; start < 150 && hits.length < PER_COUNTRY; start += 10) {
      const data = (await get(`${origin}/api/pcsx/search?domain=microsoft.com&query=&location=${encodeURIComponent(countryName(cc))}&start=${start}&sort_by=timestamp`)).data || {};
      const positions: any[] = data.positions || [];
      hits.push(...positions.filter((p) => TECH_TITLE.test(p.name) && (p.standardizedLocations || []).includes(cc)));
      if (positions.length < 10 || start + 10 >= (data.count || 0)) break;
    }
    const jobs = await mapLimit(hits.slice(0, PER_COUNTRY), 4, async (p: any) => {
      try {
        const d = (await get(`${origin}/api/pcsx/position_details?position_id=${p.id}&domain=microsoft.com&hl=en`)).data || {};
        const location = (p.locations || [])[0] || '';
        return shape({
          externalId: `microsoft:${p.id}`,
          source: 'Microsoft Careers',
          role: p.name,
          company: e.company,
          city: cityAfterCountry(location, cc),
          cc,
          url: d.publicUrl || `${origin}${p.positionUrl}`,
          description: stripHtml(d.jobDescription || ''),
          postedAt: posted(p.postedTs, 1000),
        });
      } catch {
        return null;
      }
    });
    out.push(...settledJobs(jobs));
  }
  return out;
}

/** amazon.jobs search. Restricted server-side to engineering and science
 *  categories: unfiltered, Germany alone is 700 listings, mostly logistics. */
const AMAZON_CATEGORIES = ['software-development', 'machine-learning-science', 'research-science', 'data-science', 'hardware-development', 'solutions-architect'];

async function amazon(e: { company: string }, ccs: string[]): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const cc of ccs) {
    const iso3 = ISO3[cc];
    if (!iso3) continue;
    const url = new URL('https://www.amazon.jobs/en/search.json');
    url.searchParams.set('result_limit', '100');
    url.searchParams.set('sort', 'recent');
    url.searchParams.append('normalized_country_code[]', iso3);
    for (const c of AMAZON_CATEGORIES) url.searchParams.append('category[]', c);
    const data = await getJson(url.toString());
    for (const j of data.jobs || []) {
      out.push(
        shape({
          externalId: `amazon:${j.id_icims || j.id}`,
          source: 'Amazon Jobs',
          role: j.title,
          company: e.company,
          city: j.city || cityFromLocation(j.normalized_location || ''),
          cc,
          url: `https://www.amazon.jobs${j.job_path}`,
          description: stripHtml([j.description, j.basic_qualifications, j.preferred_qualifications].filter(Boolean).join('\n')),
          postedAt: posted(j.posted_date),
        }),
      );
    }
  }
  return out;
}

/**
 * jobs.apple.com renders its results server-side into a JSON string literal
 * (`__staticRouterHydrationData = JSON.parse("…")`). The literal is read by
 * scanning to its closing quote, because the content itself contains `");`.
 */
const APPLE_SLUG: Record<string, string> = {
  DE: 'germany-DEU', NL: 'netherlands-NLD', IE: 'ireland-IRL', BE: 'belgium-BEL',
  LU: 'luxembourg-LUX', PL: 'poland-POL', PT: 'portugal-PRT', IN: 'india-IND',
};

function appleResults(html: string): { total: number; results: any[] } {
  const marker = html.indexOf('__staticRouterHydrationData');
  const open = marker < 0 ? -1 : html.indexOf('JSON.parse("', marker);
  if (open < 0) return { total: 0, results: [] };
  let i = open + 'JSON.parse('.length + 1;
  while (i < html.length && html[i] !== '"') i += html[i] === '\\' ? 2 : 1;
  const data = JSON.parse(JSON.parse(html.slice(open + 'JSON.parse('.length, i + 1)));
  const search = data?.loaderData?.search || {};
  return { total: search.totalRecords || 0, results: search.searchResults || [] };
}

async function apple(e: { company: string }, ccs: string[]): Promise<RawJob[]> {
  const out: RawJob[] = [];
  for (const cc of ccs) {
    const slug = APPLE_SLUG[cc];
    if (!slug) continue;
    for (let page = 1; page <= 8; page++) {
      const res = await fetch(`https://jobs.apple.com/en-us/search?location=${slug}&page=${page}`, { headers: UA, cache: 'no-store' });
      if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
      const { total, results } = appleResults(await res.text());
      for (const j of results) {
        if (!TECH_TITLE.test(j.postingTitle || '')) continue;
        const loc = (j.locations || [])[0] || {};
        out.push(
          shape({
            externalId: `apple:${j.positionId || j.id}`,
            source: 'Apple Jobs',
            role: j.postingTitle,
            company: e.company,
            city: loc.city || loc.name || '',
            cc,
            url: `https://jobs.apple.com/en-us/details/${j.positionId}/${j.transformedPostingTitle || ''}`,
            description: j.jobSummary || '',
            postedAt: posted(j.postingDate),
          }),
        );
      }
      if (page * 20 >= total || !results.length) break;
    }
  }
  return out;
}

/**
 * Google publishes every open role as one XML feed (~20 MB, ~3,400 jobs). Its
 * robots.txt disallows the /jobs/results pages, not this feed, which exists for
 * exactly this kind of reuse. DeepMind and YouTube roles are in it too, labelled
 * by `<employer>`.
 *
 * One job can list offices in several of our countries; it becomes one listing
 * per country so it shows under each.
 */
const GOOGLE_TECH = new Set(['SOFTWARE_ENGINEERING', 'HARDWARE_ENGINEERING', 'TECHNICAL_INFRASTRUCTURE', 'NETWORK_ENGINEERING', 'DATA_CENTER_OPERATIONS']);

async function google(e: { company: string }, ccs: string[]): Promise<RawJob[]> {
  const res = await fetch('https://www.google.com/about/careers/applications/jobs/feed.xml', { headers: UA, cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  const xml = await res.text();
  const tag = (s: string, name: string) => decodeEntities(s.match(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`))?.[1] || '');
  const byName = new Map(ccs.map((cc) => [countryName(cc).toLowerCase(), cc]));

  const out: RawJob[] = [];
  for (const [, job] of xml.matchAll(/<job>([\s\S]*?)<\/job>/g)) {
    const title = tag(job, 'title');
    const categories = [...job.matchAll(/<category>(.*?)<\/category>/g)].map((m) => m[1]);
    if (!TECH_TITLE.test(title) && !categories.some((c) => GOOGLE_TECH.has(c))) continue;

    const offices = new Map<string, string>();
    for (const [, loc] of job.matchAll(/<location>([\s\S]*?)<\/location>/g)) {
      const cc = byName.get(tag(loc, 'country').toLowerCase());
      if (cc && !offices.has(cc)) offices.set(cc, tag(loc, 'city') || countryName(cc));
    }
    if (!offices.size) continue;

    const employer = tag(job, 'employer') || 'Google';
    const company = /^google/i.test(employer) ? employer : employer === 'DeepMind' ? 'Google DeepMind' : `Google (${employer})`;
    const id = tag(job, 'jobid');
    for (const [cc, city] of offices) {
      out.push(
        shape({
          externalId: `google:${id}:${cc}`,
          source: 'Google Careers',
          role: title,
          company,
          city,
          cc,
          url: tag(job, 'url'),
          description: stripHtml(tag(job, 'description')),
          postedAt: posted(tag(job, 'published')),
        }),
      );
    }
  }
  return out;
}

// --- Aggregators.

async function arbeitnow(feed: Feed): Promise<RawJob[]> {
  const data = await getJson('https://www.arbeitnow.com/api/job-board-api', feed);
  return (data.data || []).map((j: any) => {
    const location = j.location || '';
    const tags: string[] = j.tags || [];
    const text = `${j.description || ''} ${tags.join(' ')}`;
    return shape({
      externalId: `arbeitnow:${j.slug}`,
      source: 'Arbeitnow',
      role: j.title,
      company: j.company_name,
      city: cityFromLocation(location),
      // No 'DE' fallback. Arbeitnow also serves arbeitnow.co.uk, so defaulting
      // an unresolved location to Germany filed UK roles under your German list.
      // An unmatched location means we do not know the country, and a job whose
      // country we do not know does not belong in a country-ranked list.
      cc: ccFromLocation(location) || '',
      url: j.url,
      description: stripHtml(text) + (j.visa_sponsorship ? '\n\nVisa sponsorship available.' : ''),
      postedAt: posted(j.created_at, 1000),
    });
  });
}

/**
 * The Muse publishes a public jobs API. Its own `location` filter is loose — a
 * request for Berlin comes back mostly US and remote listings — so the results
 * are re-filtered through our geo matcher and anything that is not actually in
 * the requested country is dropped. Cheap to ask, honest to keep.
 */
const MUSE_CITIES: Record<string, string[]> = {
  DE: ['Berlin, Germany', 'Munich, Germany', 'Frankfurt, Germany'],
  NL: ['Amsterdam, Netherlands'],
  IE: ['Dublin, Ireland'],
  BE: ['Brussels, Belgium'],
  LU: ['Luxembourg, Luxembourg'],
  PL: ['Warsaw, Poland', 'Krakow, Poland'],
  PT: ['Lisbon, Portugal'],
  IN: ['Bengaluru, India', 'Hyderabad, India', 'Pune, India'],
};

async function themuse(cc: string, page: number, feed: Feed): Promise<RawJob[]> {
  const cities = MUSE_CITIES[cc] || [];
  if (!cities.length) return [];
  const url = new URL('https://www.themuse.com/api/public/jobs');
  for (const c of cities) url.searchParams.append('location', c);
  url.searchParams.set('category', 'Software Engineering');
  url.searchParams.set('page', String(page));
  const data = await getJson(url.toString(), feed);

  return (data.results || [])
    .map((j: any) => {
      const location = (j.locations || []).map((l: any) => l.name).join('; ');
      return shape({
        externalId: `themuse:${j.id}`,
        source: 'The Muse',
        role: j.name,
        company: j.company?.name || 'Unknown',
        ...resolvePlace(location),
        url: j.refs?.landing_page || '',
        description: stripHtml(j.contents || ''),
        postedAt: posted(j.publication_date),
      });
    })
    // Their filter is advisory; ours is the one that decides.
    .filter((j: RawJob) => j.cc === cc && j.url);
}

const ADZUNA_COUNTRY: Record<string, string> = { DE: 'de', NL: 'nl', PL: 'pl', IN: 'in', BE: 'be', PT: 'pt', LU: 'lu', IE: 'ie' };

async function adzuna(cc: string, what: string, feed: Feed): Promise<RawJob[]> {
  const id = process.env.ADZUNA_APP_ID;
  const key = process.env.ADZUNA_APP_KEY;
  const country = ADZUNA_COUNTRY[cc];
  if (!id || !key || !country) return [];
  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?app_id=${id}&app_key=${key}&results_per_page=50&what=${encodeURIComponent(what)}&content-type=application/json`;
  const data = await getJson(url, feed);
  return (data.results || []).map((j: any) => {
    const location = j.location?.display_name || '';
    return shape({
      externalId: `adzuna:${j.id}`,
      source: 'Adzuna',
      role: j.title,
      company: j.company?.display_name || 'Unknown',
      city: cityFromLocation(location),
      cc,
      url: j.redirect_url,
      description: stripHtml(j.description || ''),
      postedAt: posted(j.created),
    });
  });
}

/**
 * Only sources whose owners permit automated access: public ATS APIs, careers
 * search endpoints that robots.txt allows, and aggregator APIs. LinkedIn, Indeed,
 * StepStone, Glassdoor and Meta forbid it, so the UI links out to them.
 */
export async function fetchAll(activeCcs: string[], queries: string[], opts: { force: boolean }): Promise<{ jobs: RawJob[]; report: FetchReport[]; commit: () => Promise<void> }> {
  const report: FetchReport[] = [];
  const out: RawJob[] = [];
  const list = await watchlist();
  const { force } = opts;
  // The success data of each board. The caller runs `commit` after it stores the jobs.
  const commits = new Map<string, Commit>();

  const boards = { greenhouse, lever, ashby, workable };
  const careers = { smartrecruiters, workday, microsoft, amazon, apple, google };
  // Each entry is one board with a stable key for the FeedFetch table.
  const tasks: { board: string; label: string; company?: string; run: () => Promise<RawJob[]> }[] = [];
  for (const e of list) {
    if (e.ats === 'link') continue;
    if (e.countries && !e.countries.some((cc) => activeCcs.includes(cc))) continue;
    const board = `${e.ats}:${e.token}`;
    // A company board is one GET request for JSON, so it sends conditional headers.
    // A careers site makes several requests or a POST, so it gets the skip and the status only.
    const run = e.ats in boards
      ? () => boards[e.ats as keyof typeof boards](e as Board, { board, force, commits })
      : async () => {
          const r = await withFeedStatus(board, { force }, () => careers[e.ats as keyof typeof careers](e as Board, activeCcs));
          commits.set(board, r.commit);
          return r.value;
        };
    tasks.push({ board, label: e.ats, company: e.company, run });
  }

  if (activeCcs.includes('DE')) tasks.push({ board: 'arbeitnow', label: 'Arbeitnow', run: () => arbeitnow({ board: 'arbeitnow', force, commits }) });
  for (const cc of activeCcs) {
    for (const page of [0, 1, 2]) {
      const board = `themuse:${cc}:${page}`;
      tasks.push({ board, label: `The Muse ${cc}`, run: () => themuse(cc, page, { board, force, commits }) });
    }
    for (const q of queries) {
      const board = `adzuna:${cc}:${q.toLowerCase()}`;
      tasks.push({ board, label: `Adzuna ${cc}`, run: () => adzuna(cc, q, { board, force, commits }) });
    }
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));
  for (const [i, res] of settled.entries()) {
    const t = tasks[i];
    if (res.status === 'rejected') {
      if (res.reason instanceof FeedSkip) {
        report.push({ source: t.label, company: t.company, got: 0, kept: 0, status: res.reason.status });
        continue;
      }
      const error = String(res.reason).slice(0, 140);
      // The report only reaches the browser, so a dead board would otherwise
      // never show up in the server log.
      log.warn({ source: t.label, company: t.company, error }, 'refresh failed');
      // A parse error comes after the request, so the board records it here.
      commits.delete(t.board);
      await recordFailure(t.board, res.reason);
      report.push({ source: t.label, company: t.company, got: 0, kept: 0, error });
      continue;
    }
    const kept = keepInCountries(res.value, activeCcs);
    report.push({ source: t.label, company: t.company, got: res.value.length, kept: kept.length });
    out.push(...kept);
  }

  // Priority follows the company, not the source, so a Google listing that
  // reaches us through Adzuna or The Muse counts even though Google itself is
  // never fetched. Matched on whole words from the start of the name, so
  // "Amazon Development Center Germany GmbH" is Amazon and "Metaflow" is not Meta.
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
  const top = list.filter((e) => e.priority).map((e) => norm(e.company));
  for (const j of out) {
    const c = norm(j.company);
    j.priority = top.some((p) => c === p || c.startsWith(`${p} `));
  }

  // De-duplicate: the same opening reaches us from a company board and an
  // aggregator. Company + normalised title + city is the natural key; the
  // employer's own copy wins because its description is the authoritative one.
  const AGGREGATORS = ['Arbeitnow', 'The Muse', 'Adzuna'];
  const rank = (j: RawJob) => (AGGREGATORS.includes(j.source) ? 2 : j.priority ? 0 : 1);
  const byKey = new Map<string, RawJob>();
  for (const j of out) {
    const key = `${j.company.toLowerCase().trim()}|${j.role.toLowerCase().replace(/[^a-z0-9]/g, '')}|${j.city.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev || rank(j) < rank(prev)) byKey.set(key, j);
  }
  const commit = async () => {
    for (const c of commits.values()) await c();
  };
  return { jobs: [...byKey.values()], report, commit };
}
