/** Plain words for the job check. This file has no imports, so the server and the screen both use it. */

export const STATUS_LABEL = { met: 'Met', partial: 'Partly', missing: 'Missing' } as const;

export const BLOCKER_LABEL: Record<string, string> = {
  citizenship: 'Needs a citizenship or work permit you may not have',
  clearance: 'Needs a security clearance',
  language: 'Needs a language you may not speak',
  location: 'Needs a place of work that does not fit',
  seniority: 'Needs more years of work than you have',
  other: 'Needs something that may exclude you',
};

export const LEGITIMACY_LABEL: Record<string, string> = {
  'no-company': 'does not name the company',
  'pay-to-apply': 'asks you to pay to apply',
  reposted: 'looks like a post that someone put up again',
  'vague-role': 'does not say what the work is',
};

/** One warning line for the flags, or an empty string when there is no flag. */
export function legitimacyLine(flags: readonly string[]): string {
  const words = flags.map((f) => LEGITIMACY_LABEL[f] ?? f);
  return words.length ? `Take care. This posting ${words.join('; ')}.` : '';
}
