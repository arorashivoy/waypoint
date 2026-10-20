import type { Requirement } from './types';

export type { Requirement };

const TOP = 3;

/** The 3 requirements the screen shows first: the `must` items in the order of the posting, then `nice` items only when fewer than 3 `must` items exist. */
export function topRequirements<T extends Pick<Requirement, 'importance'>>(reqs: T[]): T[] {
  const must = reqs.filter((r) => r.importance === 'must').slice(0, TOP);
  if (must.length >= TOP) return must;
  return [...must, ...reqs.filter((r) => r.importance !== 'must').slice(0, TOP - must.length)];
}
