import type { Claim, ClaimsDoc, EducationTarget, PositionTarget, ProjectTarget } from './doc';

/**
 * Pure edits of a profile document. Each function returns a new document and
 * never changes its input: loadProfileDoc shares its cached object.
 */

export const ITEM_KINDS = ['position', 'education', 'project', 'claim'] as const;
export type ItemKind = (typeof ITEM_KINDS)[number];
export type Item = PositionTarget | EducationTarget | ProjectTarget | Claim;
export const DRAFT_TYPES = ['meta', 'profile', ...ITEM_KINDS] as const;
export type DraftType = (typeof DRAFT_TYPES)[number];
export type DraftLike = { type: DraftType; data: unknown; matches: string | null };

export const itemKey = (kind: ItemKind, item: Item): string => (kind === 'claim' ? (item as Claim).slug : (item as { id: string }).id);

function listOf(doc: ClaimsDoc, kind: ItemKind): Item[] {
  if (kind === 'position') return doc.targets.positions;
  if (kind === 'education') return doc.targets.educations;
  if (kind === 'project') return doc.targets.projects;
  return doc.claims;
}

export function findItem(doc: ClaimsDoc, kind: ItemKind, key: string): Item | null {
  return listOf(doc, kind).find((x) => itemKey(kind, x) === key) ?? null;
}

export const hasItem = (doc: ClaimsDoc, kind: ItemKind, key: string) => findItem(doc, kind, key) !== null;

/** Maps an evidence target that names `kind:from` (or a bullet of it) to `kind:to`. */
function retarget(target: string, kind: ItemKind, from: string, to: string): string {
  if (target === `${kind}:${from}`) return `${kind}:${to}`;
  if (kind === 'position' && target.startsWith(`position:${from}/`)) return `position:${to}/${target.slice(`position:${from}/`.length)}`;
  return target;
}

function renameRefs(doc: ClaimsDoc, kind: ItemKind, from: string, to: string): void {
  for (const c of doc.claims) {
    if (kind === 'claim') for (const l of c.links) l.to = l.to === from ? to : l.to;
    else for (const e of c.evidence) e.target = retarget(e.target, kind, from, to);
  }
}

function dropRefs(doc: ClaimsDoc, kind: ItemKind, key: string): void {
  for (const c of doc.claims) {
    if (kind === 'claim') c.links = c.links.filter((l) => l.to !== key);
    else c.evidence = c.evidence.filter((e) => e.target !== `${kind}:${key}` && !e.target.startsWith(`${kind}:${key}/`));
  }
}

/** Puts `item` in place of the item with `key`, or adds it at the end when `key` is null or not found. A new key renames the references to the old one. */
export function upsertItem(doc: ClaimsDoc, kind: ItemKind, key: string | null, item: Item): ClaimsDoc {
  const next = structuredClone(doc);
  const list = listOf(next, kind);
  const copy = structuredClone(item);
  const i = key === null ? -1 : list.findIndex((x) => itemKey(kind, x) === key);
  if (i < 0) {
    list.push(copy);
    return next;
  }
  list[i] = copy;
  const newKey = itemKey(kind, copy);
  if (key !== null && newKey !== key) renameRefs(next, kind, key, newKey);
  return next;
}

/** Removes an item, and the evidence and links that name it. A revision keeps the old state. */
export function removeItem(doc: ClaimsDoc, kind: ItemKind, key: string): ClaimsDoc {
  const next = structuredClone(doc);
  const list = listOf(next, kind);
  const i = list.findIndex((x) => itemKey(kind, x) === key);
  if (i >= 0) list.splice(i, 1);
  dropRefs(next, kind, key);
  return next;
}

const unite = <T>(a: T[] | undefined, b: T[] | undefined, key: (x: T) => string): T[] => {
  const out = [...(a ?? [])];
  const seen = new Set(out.map(key));
  for (const x of b ?? []) if (!seen.has(key(x))) {
    seen.add(key(x));
    out.push(x);
  }
  return out;
};
const lower = (s: string) => s.trim().toLowerCase();

/** The existing item, with the empty fields filled from `incoming` and the lists united. It keeps the key of `existing`. */
export function mergeItem(kind: ItemKind, existing: Item, incoming: Item): Item {
  const out: Record<string, unknown> = { ...(incoming as Record<string, unknown>), ...(existing as Record<string, unknown>) };
  for (const [k, v] of Object.entries(existing as Record<string, unknown>)) {
    const fill = (incoming as Record<string, unknown>)[k];
    if ((v === null || v === undefined || v === '') && fill !== undefined) out[k] = fill;
  }
  if (kind === 'claim') {
    const a = existing as Claim;
    const b = incoming as Claim;
    out.aliases = unite(a.aliases, b.aliases, lower);
    out.links = unite(a.links, b.links, (l) => l.to);
    out.evidence = unite(a.evidence, b.evidence, (e) => e.target);
    out.mentions = unite(a.mentions, b.mentions, (m) => m.surface);
  } else if (kind === 'position') {
    out.bullets = unite((existing as PositionTarget).bullets, (incoming as PositionTarget).bullets, (b) => lower(b.text ?? b.match));
    // Bullet IDs must stay unique in the position.
    const ids = new Set<string>();
    out.bullets = (out.bullets as NonNullable<PositionTarget['bullets']>).filter((b) => (ids.has(b.id) ? false : (ids.add(b.id), true)));
  } else if (kind === 'education') {
    out.aliases = unite((existing as EducationTarget).aliases, (incoming as EducationTarget).aliases, lower);
  } else {
    out.bullets = unite((existing as ProjectTarget).bullets, (incoming as ProjectTarget).bullets, lower);
  }
  return out as Item;
}

/** The order in which drafts apply, so that the target of a claim's evidence exists first. */
const ORDER: Record<DraftType, number> = { profile: 0, meta: 1, education: 2, position: 3, project: 4, claim: 5 };

/**
 * Applies drafts to a document. A matched draft merges into the item it
 * matches and keeps that item's key; the claim drafts of the same batch that
 * point at the draft's own key are pointed at the kept key.
 */
export function applyDrafts(doc: ClaimsDoc, drafts: DraftLike[]): ClaimsDoc {
  let next = structuredClone(doc);
  const renames: [ItemKind, string, string][] = [];
  for (const d of [...drafts].sort((a, b) => ORDER[a.type] - ORDER[b.type])) {
    if (d.type === 'profile') {
      next = structuredClone(d.data as ClaimsDoc);
      continue;
    }
    if (d.type === 'meta') {
      next.profile = { name: next.profile.name, headline: String((d.data as { headline?: unknown }).headline ?? '') };
      continue;
    }
    const kind = d.type;
    const item = structuredClone(d.data) as Item;
    if (kind === 'claim') {
      const c = item as Claim;
      for (const [k, from, to] of renames) {
        c.evidence = c.evidence.map((e) => ({ ...e, target: retarget(e.target, k, from, to) }));
        if (k === 'claim') c.links = c.links.map((l) => (l.to === from ? { ...l, to } : l));
      }
    }
    const own = itemKey(kind, item);
    const key = d.matches && hasItem(next, kind, d.matches) ? d.matches : hasItem(next, kind, own) ? own : null;
    if (key === null) {
      next = upsertItem(next, kind, null, item);
      continue;
    }
    if (key !== own) renames.push([kind, own, key]);
    next = upsertItem(next, kind, key, mergeItem(kind, findItem(next, kind, key) as Item, item));
  }
  return next;
}
