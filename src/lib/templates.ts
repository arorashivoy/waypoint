/**
 * Outreach messages are a fixed frame plus a few spans that genuinely depend on
 * the posting. The frame lives here, in the repo, reviewed once; the model is
 * asked only for the spans.
 *
 * The earlier design had Claude write each message end to end. That paid output
 * tokens for "Thanks for connecting" on every application, let the tone drift
 * between messages, and gave injected text in a job description a whole message
 * to corrupt rather than one short slot. Slots also make validation a set
 * membership test — `highlight` must name something already in the profile —
 * instead of an inspection of prose.
 */

/** What the model is asked to supply. Everything else is filled from the
 *  database, so it cannot be hallucinated and costs nothing. */
export type Slots = {
  /** A project title or job title copied verbatim from the profile. */
  highlight: string;
  /** One sentence on that highlight, framed for this posting. */
  proof: string;
  /** The one specific thing this posting asks for. */
  hook: string;
};

export type ReferralFill = {
  firstName: string;
  role: string;
  company: string;
  jobRef: string;
  candidateName: string;
  /** How the CV is offered: a link when one exists that a recruiter can open,
   *  the older "happy to send" otherwise. Never a localhost path — a link the
   *  reader cannot follow is worse than no link. */
  cv: string;
} & Slots;

export const REFERRAL_TEMPLATE = `Hi {firstName},

Hope you are doing well. I am applying for {role} at {company}, and {hook}.

{proof}

Would you be comfortable referring me? The job link is {jobRef}, and {cv}. Happy to answer anything else useful.

Best,
{candidateName}`;

/** Deliberately not a general template engine: a literal replace of known keys,
 *  so a slot value containing "{role}" is inserted as text rather than
 *  re-expanded. A model-supplied span must never be able to address the frame. */
function fill(template: string, values: Record<string, string>) {
  return template.replace(/\{(\w+)\}/g, (whole, key: string) =>
    Object.prototype.hasOwnProperty.call(values, key) ? values[key] : whole,
  );
}

/** Whitespace from a slot would break the one-line note; a stray trailing full
 *  stop would double up against the frame's own punctuation. */
const span = (s: unknown, max: number) =>
  String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/[.!]+$/, '')
    .slice(0, max);

/**
 * Trims to the character limit on a word boundary. The previous `.slice(0, 300)`
 * cut mid-word, which reads as a bug to whoever receives it — and an ellipsis on
 * a referral ask is worse than a slightly shorter sentence.
 */
export function clampToWords(text: string, max: number) {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(' ');
  return (lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut).replace(/[,;:\s]+$/, '');
}

/**
 * Guarantees the message names the validated highlight rather than whatever the
 * model decided to call it. `proof` is asked to lead with that name, and usually
 * does; when it does not — or when `resolveHighlight` had to repair an invented
 * one — the real name is put back in front. Without this the highlight guard
 * would validate a value that never reached the reader.
 */
function groundProof(proof: string, highlight: string, max: number) {
  const body = span(proof, max);
  if (!highlight) return body;
  const seen = body.toLowerCase().replace(/[^a-z0-9]+/g, '');
  const want = highlight.toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (seen.includes(want)) return body;
  // A sentence break rather than a clause, because lower-casing the model's
  // first word to splice it in mangles a leading "I" or a product name.
  if (!body) return `My work on ${highlight} is the closest match`;
  return clampToWords(`My work on ${highlight} is the closest match. ${body}`, max);
}

export function renderReferral(v: ReferralFill) {
  const highlight = span(v.highlight, 60);
  return fill(REFERRAL_TEMPLATE, {
    firstName: v.firstName,
    role: v.role,
    company: v.company,
    jobRef: v.jobRef,
    candidateName: v.candidateName,
    cv: span(v.cv, 200),
    hook: span(v.hook, 160),
    proof: groundProof(v.proof, highlight, 300) + '.',
  });
}

/**
 * The model is told to copy `highlight` verbatim from the profile. This checks
 * that it did. A near miss (case, surrounding punctuation) is repaired against
 * the real title; anything else falls back to the first candidate, because a
 * referral message naming a project the candidate has never built is worse than
 * one naming the wrong-but-real project.
 */
export function resolveHighlight(claimed: unknown, candidates: string[]): string {
  const want = String(claimed ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '');
  if (!want) return candidates[0] || '';
  const exact = candidates.find((c) => c.toLowerCase().replace(/[^a-z0-9]+/g, '') === want);
  if (exact) return exact;
  const partial = candidates.find((c) => {
    const norm = c.toLowerCase().replace(/[^a-z0-9]+/g, '');
    return norm.includes(want) || want.includes(norm);
  });
  return partial || candidates[0] || '';
}
