import { CV_COUNTRY_RULES } from '../countries';
import { GUARD, prompt, profile, sanitise, trusted, untrusted, untrustedFields, type Fenced } from './builder';

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

export const ANALYSE_SYSTEM = `You analyse job postings for one candidate. ${GUARD}`;

export const analysePrompt = (who: ProfileSummary, job: { role: string; company: string; city: string; cc: string; description: string }) => prompt`
${profileBlock(who)}

The posting below was fetched from a job board. Its title, company and body are all third-party text.

${untrustedFields('job board listing', { title: job.role, company: job.company, city: job.city })}

${untrusted('job description', job.description)}

Return JSON with exactly these keys:
{
  "field": one of "Finance tech" | "Backend" | "Trading" | "ML & NLP" | "Robotics" | "Other"
     — use "Other" when the posting is not a software engineering role at all,
  "mode": one of "Remote" | "Hybrid" | "On-site",
  "level": one of "Entry" | "Mid" | "Senior", judged by the fewest years of experience the posting
     asks for: at most 1 year (or new-grad, junior, graduate) is "Entry", 2 to 4 is "Mid", 5 or
     more is "Senior". A senior, staff, principal or lead title is "Senior" whatever the years.
     When no years are stated, judge from the scope of the role,
  "sponsor": boolean — true only if the posting states visa sponsorship or relocation support,
  "visa": short phrase naming the route or "Sponsorship not stated",
  "requirements": array of 4 to 6 objects { "t": requirement in under 8 words, "ok": true if the
     profile above already evidences it, false otherwise },
  "must": array of 3 CV lines this candidate must include for THIS posting and country,
  "projects": array of 3 objects { "n": project name from the profile, "why": one sentence, at most
     16 words, on why it leads or why to leave it off }, ordered best first
}
Judge "ok" only against the profile block. Never credit a requirement the profile does not show.
Country rules to fold into "must": ${trusted((CV_COUNTRY_RULES[job.cc] || []).join('; ') || 'none')}.
`;

