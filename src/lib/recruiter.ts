import { HttpError } from '@/lib/auth/http';
import { fetchSignal } from '@/lib/fetch-timeout';

export type Recruiter = { name: string; email: string; position: string; confidence: number };

const HUNTER = 'https://api.hunter.io/v2/domain-search';

/** The job titles that route applications. A match ranks above a confidence score. */
const RECRUITING = /recruit|talent|acquisition|sourc|people|human resources|\bhr\b/i;

/** A plain address check. The user can edit the address before the email goes anywhere. */
export const EMAIL = /^[^\s@<>"]+@[^\s@<>"]+\.[^\s@<>"]+$/;

type HunterEmail = { value?: string; type?: string; confidence?: number; first_name?: string | null; last_name?: string | null; position?: string | null };

/** The best personal address first: a recruiting title, then the confidence score of Hunter. */
export function pickRecruiter(emails: HunterEmail[]): Recruiter | null {
  const people = emails
    .filter((e) => e.value && EMAIL.test(e.value) && e.type !== 'generic' && (e.first_name || e.last_name))
    .map((e) => ({
      name: [e.first_name, e.last_name].filter(Boolean).join(' '),
      email: e.value as string,
      position: e.position ?? '',
      confidence: e.confidence ?? 0,
    }));
  people.sort((a, b) => Number(RECRUITING.test(b.position)) - Number(RECRUITING.test(a.position)) || b.confidence - a.confidence);
  return people[0] ?? null;
}

/** Searches the company in Hunter.io, in the HR department first. The key goes in a header, so no log of a URL holds it. */
export async function findRecruiter(company: string): Promise<Recruiter> {
  const key = process.env.HUNTER_API_KEY?.trim();
  if (!key) throw new HttpError(400, 'Hunter.io is not set up. Add HUNTER_API_KEY to .env, then restart Waypoint.');
  const search = async (department?: string) => {
    const url = new URL(HUNTER);
    url.searchParams.set('company', company);
    url.searchParams.set('limit', '10');
    if (department) url.searchParams.set('department', department);
    const res = await fetch(url, { headers: { 'X-API-KEY': key }, signal: fetchSignal() });
    if (res.status === 401) throw new HttpError(502, 'Hunter.io refused the key. Check HUNTER_API_KEY in .env.');
    if (res.status === 429) throw new HttpError(502, 'The Hunter.io limit for this month is used. Try again next month.');
    if (!res.ok) throw new HttpError(502, `Hunter.io answered with status ${res.status}. Try again later.`);
    const json = (await res.json()) as { data?: { emails?: HunterEmail[] } };
    return json.data?.emails ?? [];
  };
  let found = pickRecruiter(await search('hr'));
  if (!found) found = pickRecruiter(await search());
  if (!found) throw new HttpError(404, `Hunter.io has no recruiter email for ${company}.`);
  return found;
}
