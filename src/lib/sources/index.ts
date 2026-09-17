import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { ccFromLocation, cityFromLocation, decodeEntities, fieldFromText, levelFromTitle, modeFromText, resolvePlace, sponsorFromText, stripHtml } from './geo';
import { VISA_ROUTE } from '../countries';

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
  postedAt: Date;
};

export type FetchReport = { source: string; company?: string; got: number; kept: number; error?: string };

type WatchEntry = { company: string; ats: 'greenhouse' | 'lever' | 'ashby' | 'workable'; token: string };

async function watchlist(): Promise<WatchEntry[]> {
  try {
    const raw = await readFile(path.join(process.cwd(), 'config', 'watchlist.json'), 'utf8');
    return JSON.parse(raw).companies as WatchEntry[];
  } catch {
    return [];
  }
}

const UA = { 'user-agent': 'Waypoint/0.1 (personal job search; single user)' };

async function getJson(url: string): Promise<any> {
  const res = await fetch(url, { headers: UA, cache: 'no-store' });
  if (!res.ok) throw new Error(`${res.status} ${res.statusText}`);
  return res.json();
}

function shape(partial: Omit<RawJob, 'field' | 'level' | 'mode' | 'sponsor' | 'visa'> & { field?: string }): RawJob {
  const text = `${partial.role}\n${partial.description}`;
  return {
    ...partial,
    field: partial.field || fieldFromText(text),
    level: levelFromTitle(partial.role),
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

async function greenhouse(e: WatchEntry): Promise<RawJob[]> {
  const data = await getJson(`https://boards-api.greenhouse.io/v1/boards/${e.token}/jobs?content=true`);
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
      postedAt: new Date(j.first_published || j.updated_at || Date.now()),
    });
  });
}

async function lever(e: WatchEntry): Promise<RawJob[]> {
  const data = await getJson(`https://api.lever.co/v0/postings/${e.token}?mode=json`);
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
      postedAt: new Date(j.createdAt || Date.now()),
    });
  });
}

async function ashby(e: WatchEntry): Promise<RawJob[]> {
  const data = await getJson(`https://api.ashbyhq.com/posting-api/job-board/${e.token}?includeCompensation=false`);
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
      postedAt: new Date(j.publishedAt || Date.now()),
    });
  });
}

async function workable(e: WatchEntry): Promise<RawJob[]> {
  const data = await getJson(`https://apply.workable.com/api/v1/widget/accounts/${e.token}?details=true`);
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
      postedAt: new Date(j.published_on || Date.now()),
    });
  });
}

// --- Aggregators.

async function arbeitnow(): Promise<RawJob[]> {
  const data = await getJson('https://www.arbeitnow.com/api/job-board-api');
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
      postedAt: new Date((j.created_at || Date.now() / 1000) * 1000),
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

async function themuse(cc: string, page: number): Promise<RawJob[]> {
  const cities = MUSE_CITIES[cc] || [];
  if (!cities.length) return [];
  const url = new URL('https://www.themuse.com/api/public/jobs');
  for (const c of cities) url.searchParams.append('location', c);
  url.searchParams.set('category', 'Software Engineering');
  url.searchParams.set('page', String(page));
  const data = await getJson(url.toString());

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
        postedAt: new Date(j.publication_date || Date.now()),
      });
    })
    // Their filter is advisory; ours is the one that decides.
    .filter((j: RawJob) => j.cc === cc && j.url);
}

const ADZUNA_COUNTRY: Record<string, string> = { DE: 'de', NL: 'nl', PL: 'pl', IN: 'in', BE: 'be', PT: 'pt', LU: 'lu', IE: 'ie' };

async function adzuna(cc: string, what: string): Promise<RawJob[]> {
  const id = process.env.ADZUNA_APP_ID;
  const key = process.env.ADZUNA_APP_KEY;
  const country = ADZUNA_COUNTRY[cc];
  if (!id || !key || !country) return [];
  const url = `https://api.adzuna.com/v1/api/jobs/${country}/search/1?app_id=${id}&app_key=${key}&results_per_page=50&what=${encodeURIComponent(what)}&content-type=application/json`;
  const data = await getJson(url);
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
      postedAt: new Date(j.created || Date.now()),
    });
  });
}

/**
 * Only sources that publish an API for this purpose. LinkedIn, Indeed, StepStone
 * and Glassdoor forbid scraping, so the Countries screen links out to them by
 * hand instead of fetching them.
 */
export async function fetchAll(activeCcs: string[], queries: string[]): Promise<{ jobs: RawJob[]; report: FetchReport[] }> {
  const report: FetchReport[] = [];
  const out: RawJob[] = [];
  const list = await watchlist();

  const tasks: { label: string; company?: string; run: () => Promise<RawJob[]> }[] = list.map((e) => ({
    label: e.ats,
    company: e.company,
    run: () => ({ greenhouse, lever, ashby, workable })[e.ats](e),
  }));

  if (activeCcs.includes('DE')) tasks.push({ label: 'Arbeitnow', run: arbeitnow });
  for (const cc of activeCcs) {
    for (const page of [0, 1, 2]) tasks.push({ label: `The Muse ${cc}`, run: () => themuse(cc, page) });
    for (const q of queries) tasks.push({ label: `Adzuna ${cc}`, run: () => adzuna(cc, q) });
  }

  const settled = await Promise.allSettled(tasks.map((t) => t.run()));
  settled.forEach((res, i) => {
    const t = tasks[i];
    if (res.status === 'rejected') {
      report.push({ source: t.label, company: t.company, got: 0, kept: 0, error: String(res.reason).slice(0, 140) });
      return;
    }
    const kept = keepInCountries(res.value, activeCcs);
    report.push({ source: t.label, company: t.company, got: res.value.length, kept: kept.length });
    out.push(...kept);
  });

  // De-duplicate: the same opening reaches us from a company board and an
  // aggregator. Company + normalised title + city is the natural key; the ATS
  // copy wins because its description is the authoritative one.
  const rank = (s: string) => (['Greenhouse', 'Lever', 'Ashby', 'Workable'].includes(s) ? 0 : 1);
  const byKey = new Map<string, RawJob>();
  for (const j of out) {
    const key = `${j.company.toLowerCase().trim()}|${j.role.toLowerCase().replace(/[^a-z0-9]/g, '')}|${j.city.toLowerCase()}`;
    const prev = byKey.get(key);
    if (!prev || rank(j.source) < rank(prev.source)) byKey.set(key, j);
  }
  return { jobs: [...byKey.values()], report };
}
