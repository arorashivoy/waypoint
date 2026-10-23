import { GUARD_TEXT, prompt, profile, sanitise, untrusted, untrustedFields, type BuiltPrompt, type Fenced } from './builder';

export type ProfileSummary = {
  name: string;
  headline: string;
  positions: { title: string; company: string; location?: string | null; summary?: string | null; years?: string }[];
  educations: { school: string; degree?: string | null; field?: string | null; years?: string | null }[];
  projects: { title: string; org?: string | null; description?: string | null; tags?: string }[];
  skills: string[];
};

/**
 * The profile is the user's own record, but it arrives via a LinkedIn export
 * they did not hand-write either, so it is sanitised too — just not treated as
 * hostile, since it is the ground truth the other blocks are judged against.
 */
export const profileBlock = (p: ProfileSummary): Fenced => profile(`Name: ${sanitise(p.name, 200)}
Headline: ${sanitise(p.headline, 400)}
Experience:
${p.positions.map((x) => `- ${sanitise(x.title, 200)} at ${sanitise(x.company, 200)}${x.location ? `, ${sanitise(x.location, 120)}` : ''}${x.years ? ` (${sanitise(x.years, 60)})` : ''}${x.summary ? ` — ${sanitise(x.summary, 800)}` : ''}`).join('\n') || '- none imported'}
Education:
${p.educations.map((x) => `- ${sanitise([x.degree, x.field].filter(Boolean).join(' '), 200)} at ${sanitise(x.school, 200)}${x.years ? ` (${sanitise(x.years, 60)})` : ''}`).join('\n') || '- none imported'}
Projects:
${p.projects.map((x) => `- ${sanitise(x.title, 200)}${x.org ? ` (${sanitise(x.org, 200)})` : ''}${x.description ? ` — ${sanitise(x.description, 800)}` : ''}`).join('\n') || '- none imported'}
Skills: ${p.skills.map((s) => sanitise(s, 80)).join(', ') || 'none imported'}`);

/**
 * The system prompt of the job check: the fixed rules, then the profile of the
 * user. The text is the same for every job of one user, so the API caches it
 * and a refresh of 50 jobs pays for the profile one time.
 * `profileText` has the claim lines, the countries, the fields and the visa status.
 */
export const jobCheckSystem = (profileText: string): BuiltPrompt => prompt`You check job postings against the profile of one candidate. ${GUARD_TEXT}

The profile is in the <profile> block at the end of these rules. It lists the claims of the candidate as
lines: slug · label · depth · proof. It also lists the countries, the fields and the visa status of the candidate.

Return JSON with exactly these keys:
- "requirements": 3 to 15 objects { "text", "importance", "status", "evidence" }.
  - "text": the requirement in 10 words or fewer.
  - "importance": "must" if the posting requires it. "nice" if the posting prefers it or lists it as a plus.
  - "status": "met" if claims prove it. "partial" if claims prove a part of it. "missing" if no claim proves it.
  - "evidence": the slugs of the claims that prove it. Use only slugs from the profile block.
    A "met" or "partial" requirement needs at least one slug. A "missing" requirement has an empty list.
  Never credit a requirement that the claims do not show.
- "blockers": 0 to 6 objects { "type", "quote" } for hard conditions that the candidate cannot meet.
  - "type": one of "citizenship", "clearance", "language", "location", "seniority", "other".
  - "quote": the words of the posting that state the condition. Copy them exactly. Do not change them.
  A wish or a preference is not a blocker. If the posting states no hard condition, return an empty list.
  The profile block lists the countries where the candidate can work. A place inside one of these countries is not a "location" blocker,
  also when the posting names only some cities or one office there. Use "location" only when the work must be done in a country that is not in that list.
- "legitimacy": the flags that apply to the posting, from "no-company" (no real company is named),
  "pay-to-apply" (the candidate must pay), "reposted" (the posting says it is a repost), "vague-role"
  (the posting does not say what the work is). If no flag applies, return an empty list.
- "level": "Entry", "Mid" or "Senior", from the fewest years of experience that the posting asks for.
  At most 1 year, or new-grad or junior, is "Entry". 2 to 4 years is "Mid". 5 years or more is "Senior".
  A senior, staff, principal or lead title is "Senior". If the posting states no years, judge from the scope of the role.
- "mode": "Remote", "Hybrid" or "On-site".
- "sponsor": true only if the posting states visa sponsorship or relocation support.
- "visa": a short phrase for the visa route, or "Sponsorship not stated".
- "field": the field of the role. Choose one of the "Fields" line of the profile block. If the role is in none of the listed fields, use "Other". Use "Other" also if the role is not a software role.
- "summary": 25 words or fewer on how well the candidate fits this posting.

${profile(profileText)}`;

/** The user prompt of the job check. It holds the posting and nothing else. */
export const jobCheckPrompt = (job: { role: string; company: string; city: string; cc: string; description: string }) => prompt`The posting below came from a job board. Its title, company and body are third-party text.

${untrustedFields('job board listing', { title: job.role, company: job.company, city: job.city, country: job.cc })}

${untrusted('job description', job.description)}

Check this posting against the profile. Reply with the JSON described in the rules.`;
