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

/** LinkedIn rejects a connection note over this, with no partial send. */
export const NOTE_LIMIT = 300;

/**
 * For an alumnus who is not a connection yet. A connection request is the only
 * way to reach them without InMail, and its note is capped at 300 characters,
 * so there is no room for a CV link or a name: the recipient is picked from a
 * search after this is drafted, so "Hi," is all the frame can know. The full
 * referral message, with the CV, goes out once they accept.
 */
export const ALUMNI_NOTE_TEMPLATE = `Hi, fellow {school} alum here. I'm applying for {role} at {company}.{hook} Would you be open to referring me, or pointing me to the right person?`;

export type AlumniNoteFill = { school: string; role: string; company: string; hook: string };

/** "(m/w/d)" is a legal formality of German adverts, not part of the job title,
 *  and it costs characters the note does not have. */
const bareRole = (role: string) => role.replace(/\s*\((?:[mfwdx](?:\s*\/\s*[mfwdx])+|all genders)\)/gi, '');

/** School and company are capped short enough that the frame with an empty
 *  hook and a 120-character role always fits in the limit. */
const noteFrame = (v: Omit<AlumniNoteFill, 'hook'>) => ({
  school: clampToWords(span(v.school, 400), 60),
  company: clampToWords(span(v.company, 400), 60),
  role: clampToWords(span(bareRole(v.role), 400), 120),
});

const renderNote = (f: ReturnType<typeof noteFrame>, hook: string) =>
  fill(ALUMNI_NOTE_TEMPLATE, { ...f, hook: hook ? ` ${hook}.` : '' });

/** A hook cut down to a few words reads as a typo, not a reason. */
export const MIN_HOOK = 30;

/** Characters left for the hook once the frame is filled, so the prompt can ask
 *  for a span that fits instead of one that gets cut. The 2 is the space and
 *  full stop the frame wraps it in. */
export const alumniHookBudget = (v: Omit<AlumniNoteFill, 'hook'>) => NOTE_LIMIT - renderNote(noteFrame(v), '').length - 2;

/**
 * Over the limit, the hook gives way first, then the role title. The ask sits
 * in the frame after both, so it is never what gets cut: a note that loses its
 * question is a note that gets accepted and never answered.
 */
export function renderAlumniNote(v: AlumniNoteFill) {
  const f = noteFrame(v);
  let hook = span(v.hook, 220);
  const over = () => renderNote(f, hook).length - NOTE_LIMIT;
  if (over() > 0) hook = clampToWords(hook, Math.max(0, hook.length - over()));
  if (hook.length < MIN_HOOK) hook = '';
  if (over() > 0) f.role = clampToWords(f.role, Math.max(0, f.role.length - over()));
  return renderNote(f, hook);
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
