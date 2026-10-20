/** Plain words for the job check. This file has no imports, so the server and the screen both use it. */

export const STATUS_LABEL = { met: 'Met', partial: 'Partly', missing: 'Missing' } as const;

export const BLOCKER_LABEL: Record<string, string> = {
  citizenship: 'Needs a citizenship or work permit you may not have',
  clearance: 'Needs a security clearance',
  language: 'Needs a language you may not speak',
  location: 'Needs you to work in a set place',
  seniority: 'Asks for more years of work than the posting expects from a new hire',
  other: 'Needs something that may exclude you',
};

/** The short lead of the blocker line in the job list, by blocker type. */
export const BLOCKER_LEAD: Record<string, string> = {
  citizenship: 'Needs a work permit',
  clearance: 'Needs a security clearance',
  language: 'Needs a language',
  location: 'Must work in a set place',
  seniority: 'Needs more experience',
  other: 'Has a hard requirement',
};

const QUOTE_MAX = 60;

/** One line for a blocker: the lead, then the posting's own words, cut to 60 characters. */
export function blockerLine(type: string, quote: string): string {
  const lead = BLOCKER_LEAD[type] ?? BLOCKER_LEAD.other;
  const words = quote.replace(/\s+/g, ' ').trim();
  if (!words) return lead;
  const cut = words.length > QUOTE_MAX ? `${words.slice(0, QUOTE_MAX).trimEnd()}…` : words;
  return `${lead}: “${cut}”`;
}

export const LEGITIMACY_LABEL: Record<string, string> = {
  'no-company': 'does not name the company',
  'pay-to-apply': 'asks you to pay to apply',
  reposted: 'looks like an old post that the company listed again',
  'vague-role': 'does not say what the work is',
};

/** One warning line for the flags, or an empty string when there is no flag. */
export function legitimacyLine(flags: readonly string[]): string {
  const words = flags.map((f) => LEGITIMACY_LABEL[f] ?? f);
  return words.length ? `Take care. This posting ${words.join('; ')}.` : '';
}
