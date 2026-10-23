import { z } from 'zod';
import type { ClaimsDoc } from '../claims';
import { checkSuggestion } from './suggest';

/**
 * The lines that Claude writes for one tailored CV (design 2026-10-23).
 *
 * Claude may write new words for a bullet or a project, from the whole profile. Each line names its
 * sources: bullet ids (`position/bullet`), `project:<id>` and claim slugs. Each line passes
 * `checkSuggestion` with the text of its own sources only. The posting is never part of that text, so
 * the posting cannot add a number, a name or a tool. A line that fails is not used.
 */

export const MAX_WRITTEN_PROJECTS = 8;
export const MAX_WRITTEN_BULLETS = 30;
export const MAX_PROJECT_LINES = 3;

export const WriteReply = z.object({
  projects: z
    .array(z.object({ id: z.string(), heading: z.string(), tech: z.string(), year: z.string(), lines: z.array(z.string()).max(MAX_PROJECT_LINES), sources: z.array(z.string()) }))
    .max(MAX_WRITTEN_PROJECTS),
  bullets: z.array(z.object({ id: z.string(), text: z.string(), sources: z.array(z.string()) })).max(MAX_WRITTEN_BULLETS),
  reply: z.string(),
});
export type WriteReplyT = z.infer<typeof WriteReply>;

export type WrittenBullet = { text: string; old: string; sources: string[] };
export type WrittenProject = { heading: string; tech: string; year: string; lines: string[]; old: string; sources: string[] };
export type Written = { bullets: Record<string, WrittenBullet>; projects: Record<string, WrittenProject>; dropped: { id: string; why: string }[] };

/** The lines of the CV as it is now, for each bullet id. An own .tex gives the line of the file. */
type Opts = { bulletText?: Map<string, string> };

const empty = (): Written => ({ bullets: {}, projects: {}, dropped: [] });

/** LaTeX to the words a reader sees. */
const plain = (s: string) => s.replace(/\\([#&%$_{}])/g, '$1').replace(/\\[a-zA-Z]+\*?/g, ' ').replace(/[{}]/g, ' ').replace(/\s+/g, ' ').trim();

function bulletOf(doc: ClaimsDoc, id: string, opts: Opts): string | null {
  const [pos, bullet] = id.split('/');
  const b = doc.targets.positions.find((p) => p.id === pos)?.bullets?.find((x) => x.id === bullet);
  if (!b) return null;
  return opts.bulletText?.get(id) ?? b.text ?? b.match;
}

function projectText(doc: ClaimsDoc, id: string): string | null {
  const p = doc.targets.projects.find((x) => x.id === id);
  if (!p) return null;
  return [p.title, p.org, p.description, ...(p.bullets ?? []), p.tex ? plain(p.tex) : ''].filter(Boolean).join('\n');
}

/** The text and the proofs of the named sources, or the first source that the profile does not have. */
function sourcesOf(doc: ClaimsDoc, sources: string[], opts: Opts): { text: string[]; proofs: string[] } | { unknown: string } {
  const text: string[] = [];
  const proofs: string[] = [];
  for (const s of sources) {
    if (s.startsWith('project:')) {
      const t = projectText(doc, s.slice('project:'.length));
      if (t === null) return { unknown: s };
      text.push(t);
    } else if (s.includes('/')) {
      const t = bulletOf(doc, s, opts);
      if (t === null) return { unknown: s };
      text.push(t);
    } else {
      const c = doc.claims.find((x) => x.slug === s);
      if (!c) return { unknown: s };
      proofs.push(c.label, ...c.evidence.flatMap((e) => (e.proof ? [e.proof] : [])));
    }
  }
  return { text, proofs };
}

const skillsOf = (doc: ClaimsDoc) => doc.claims.filter((c) => c.kind === 'skill' || c.kind === 'language').flatMap((c) => [c.label, ...c.aliases]);

/** True when `text` says only what `own` (the old text) and the named sources prove. */
function passes(text: string, own: string, src: { text: string[]; proofs: string[] }, skills: string[]): { ok: true } | { ok: false; why: string } {
  return checkSuggestion({ bulletId: '', text, claims: [] }, { sourceText: [own, ...src.text].join('\n'), proofs: src.proofs, skills });
}

/** Checks a reply of the model. Only the lines that pass are kept. */
export function checkWritten(reply: WriteReplyT, doc: ClaimsDoc, opts: Opts = {}): Written {
  const out = empty();
  const skills = skillsOf(doc);

  for (const b of reply.bullets) {
    const old = bulletOf(doc, b.id, opts);
    if (old === null) { out.dropped.push({ id: b.id, why: 'not in your profile' }); continue; }
    const src = sourcesOf(doc, b.sources, opts);
    if ('unknown' in src) { out.dropped.push({ id: b.id, why: `unknown source ${src.unknown}` }); continue; }
    const text = b.text.trim();
    if (text === old.trim()) continue;
    const r = passes(text, old, src, skills);
    if (!r.ok) { out.dropped.push({ id: b.id, why: r.why }); continue; }
    out.bullets[b.id] = { text, old, sources: [...new Set(b.sources)] };
  }

  for (const p of reply.projects) {
    const own = projectText(doc, p.id);
    const profile = doc.targets.projects.find((x) => x.id === p.id);
    if (own === null || !profile) { out.dropped.push({ id: p.id, why: 'not in your profile' }); continue; }
    const src = sourcesOf(doc, p.sources, opts);
    if ('unknown' in src) { out.dropped.push({ id: p.id, why: `unknown source ${src.unknown}` }); continue; }
    const lines: string[] = [];
    for (const line of p.lines.map((l) => l.trim()).filter(Boolean)) {
      const r = passes(line, own, src, skills);
      if (r.ok) lines.push(line);
      else out.dropped.push({ id: p.id, why: r.why });
    }
    if (!lines.length) continue;
    // A heading, a tech list or a year that says more than the sources is replaced, not the whole entry.
    const field = (v: string, fallback: string) => {
      const t = v.trim();
      return t && passes(t, own, src, skills).ok ? t : fallback;
    };
    out.projects[p.id] = {
      heading: field(p.heading, profile.title),
      tech: field(p.tech, ''),
      year: field(p.year, ''),
      lines,
      old: profile.description?.trim() || (profile.bullets ?? []).join(' ') || profile.title,
      sources: [...new Set(p.sources)],
    };
  }
  return out;
}

/**
 * The stored lines that the build may use now. A line is checked again against the profile of today, so a
 * claim or a bullet that the user deleted stops backing it. The ids in `keep` stay as the user wrote them.
 */
export function effectiveWritten(w: Written | undefined, doc: ClaimsDoc, keep: string[], opts: Opts = {}): Written {
  if (!w) return empty();
  const skip = new Set(keep);
  const again = checkWritten(
    {
      bullets: Object.entries(w.bullets ?? {}).filter(([id]) => !skip.has(id)).map(([id, b]) => ({ id, text: b.text, sources: b.sources ?? [] })),
      projects: Object.entries(w.projects ?? {}).filter(([id]) => !skip.has(id)).map(([id, p]) => ({ id, heading: p.heading, tech: p.tech, year: p.year, lines: p.lines, sources: p.sources ?? [] })),
      reply: '',
    },
    doc,
    opts,
  );
  return { ...again, dropped: [] };
}
