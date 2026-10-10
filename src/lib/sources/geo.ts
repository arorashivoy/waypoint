const CITY_CC: [RegExp, string][] = [
  [/berlin|munich|münchen|frankfurt|hamburg|cologne|köln|dresden|stuttgart|leipzig|düsseldorf|dusseldorf|karlsruhe|nuremberg|germany|deutschland/i, 'DE'],
  [/amsterdam|rotterdam|utrecht|eindhoven|the hague|den haag|delft|netherlands|nederland/i, 'NL'],
  [/dublin|cork|galway|limerick|ireland/i, 'IE'],
  [/brussels|bruxelles|antwerp|antwerpen|ghent|gent|leuven|belgium|belgique|belgië/i, 'BE'],
  [/luxembourg|luxemburg/i, 'LU'],
  [/warsaw|warszawa|krak[oó]w|wroc[lł]aw|gda[nń]sk|pozna[nń]|katowice|poland|polska/i, 'PL'],
  [/lisbon|lisboa|porto|braga|coimbra|portugal/i, 'PT'],
  [/bengaluru|bangalore|hyderabad|pune|chennai|mumbai|delhi|gurgaon|gurugram|noida|kolkata|india/i, 'IN'],
];

export function ccFromLocation(location: string): string | null {
  for (const [re, cc] of CITY_CC) if (re.test(location)) return cc;
  return null;
}

export function cityFromLocation(location: string): string {
  const first = location.split(/[,;|]/)[0].trim();
  return first || location.trim();
}

/**
 * Resolves a posting's free-text location to one country and the city that
 * actually sits in it.
 *
 * Postings often list several places — "London or Dublin", "Berlin; Remote",
 * "Dublin, Ireland / London, UK". Taking the country from the whole string but
 * the city from the first segment puts the right country next to the wrong
 * city, so a Dublin-or-London role displayed as "IE · London". Here the country
 * is matched first, then the city is taken from the segment that produced it.
 */
export function resolvePlace(location: string): { cc: string; city: string } {
  const cc = ccFromLocation(location);
  if (!cc) return { cc: '', city: cityFromLocation(location) };

  const segments = location.split(/[,;|/]| or | and /i).map((x) => x.trim()).filter(Boolean);
  const match = segments.find((seg) => ccFromLocation(seg) === cc && !/^(remote|hybrid|on-?site)$/i.test(seg));
  return { cc, city: match || cityFromLocation(location) };
}

const REMOTE = /\bremote\b|\bwork from home\b|\bfully distributed\b/i;
const HYBRID = /\bhybrid\b/i;

export function modeFromText(text: string): 'Remote' | 'Hybrid' | 'On-site' {
  if (HYBRID.test(text)) return 'Hybrid';
  if (REMOTE.test(text)) return 'Remote';
  return 'On-site';
}

/** Cheap pre-LLM guesses, overwritten by the analysis pass when Claude runs. */
export function fieldFromText(text: string): string {
  const t = text.toLowerCase();
  const software = /\b(software|backend|back-end|engineer|developer|api|microservice|kubernetes|java|python|golang|typescript)\b/.test(t);
  // Finance words alone also describe a bank's sales and operations roles, so
  // they only make a posting Finance tech when it also reads as software.
  if (software && /fintech|payments?\b|banking|capital markets|asset management|wealth management|securities|ledger|settlement|custody|post-trade|clearing|collateral/.test(t)) return 'Finance tech';
  if (/market making|low.?latency|trading system|order book|execution/.test(t)) return 'Trading';
  if (/\bros ?2?\b|slam|robotic|autonomy|lidar|motion planning|\buavs?\b|drones?\b/.test(t)) return 'Robotics';
  if (/\bnlp\b|\bllm\b|transformer|machine learning|pytorch|deep learning/.test(t)) return 'ML & NLP';
  // Only claim a software field when the posting actually reads like one. The
  // aggregators carry sales, marketing and site roles too, and labelling those
  // "Backend" would quietly pollute the Field filter.
  if (software) return 'Backend';
  return 'Other';
}

export function levelFromTitle(title: string): 'Entry' | 'Mid' | 'Senior' {
  if (/\b(senior|staff|principal|lead|head of|architect|manager)\b/i.test(title)) return 'Senior';
  if (/\b(junior|graduate|intern|associate|analyst|entry)\b/i.test(title)) return 'Entry';
  return 'Mid';
}

const COUNT = '(\\d{1,2}|one|two|three|four|five|six|seven|eight|nine|ten)';
const WORDS: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
// "3+ years of experience", "2-4 years' professional experience", "five years of Python work".
const YEARS = new RegExp(
  `\\b${COUNT}\\s*\\+?\\s*(?:(?:-|–|to)\\s*${COUNT}\\s*\\+?\\s*)?years?['’]?\\s*(?:of\\s+)?(?:[\\w-]+\\s+){0,4}?(?:experience|exp\\b|work)`,
  'gi',
);

/** Fewest years of experience a posting asks for, or null when it names none.
 *  The fewest, because "3+ years of Python, 5+ preferred" is open at 3. */
export function requiredYears(description: string): number | null {
  let fewest: number | null = null;
  for (const m of description.matchAll(YEARS)) {
    const n = WORDS[m[1].toLowerCase()] ?? Number(m[1]);
    // "20 years of experience" is the company's age, not a requirement.
    if (n <= 15 && (fewest === null || n < fewest)) fewest = n;
  }
  return fewest;
}

/** A senior title settles it; otherwise the years the posting asks for do, since
 *  most titles are a bare "Software Engineer" whatever the level. Entry means at
 *  most one year, because that is the bar a candidate with ~1.5 years clears. */
export function levelFromPosting(title: string, description: string): 'Entry' | 'Mid' | 'Senior' {
  const byTitle = levelFromTitle(title);
  if (byTitle === 'Senior') return byTitle;
  const years = requiredYears(description);
  if (years === null) return byTitle;
  return years <= 1 ? 'Entry' : years < 5 ? 'Mid' : 'Senior';
}

const SPONSOR = /visa sponsorship|sponsor(ship)? (is )?(available|provided|offered)|relocation (package|support|assistance)|blue card|work permit support|we sponsor/i;

export function sponsorFromText(text: string): boolean {
  return SPONSOR.test(text);
}

/** Greenhouse returns its description as entity-escaped HTML, so entities have to
 *  be decoded before tags can be stripped. */
export function decodeEntities(s: string): string {
  return s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&');
}

export function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<\/(p|div|li|h[1-6]|br)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/&quot;|&ldquo;|&rdquo;/g, '"')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
