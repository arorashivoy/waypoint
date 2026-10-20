import type { usePending } from '../data';

export type PendingData = NonNullable<ReturnType<typeof usePending>['data']>;
export type NeedsItem = PendingData['needs'][number];
export type AwaitingItem = PendingData['awaiting'][number];
export type SafeItem = PendingData['auto'][number];
export type AppliedItem = PendingData['appliedList'][number];

export type SectionKey = 'needs' | 'awaiting' | 'safe' | 'applied';

export interface SectionInfo {
  key: SectionKey;
  title: string;
  count: number;
}

/** The sections in the order the screen shows them. "Needs you" is first. */
export function pendingSections(data: { needs: unknown[]; awaiting: unknown[]; auto: unknown[]; appliedList: unknown[] }): SectionInfo[] {
  return [
    { key: 'needs', title: 'Needs you', count: data.needs.length },
    { key: 'awaiting', title: 'Waiting for a reply', count: data.awaiting.length },
    { key: 'safe', title: 'Safe to send', count: data.auto.length },
    { key: 'applied', title: 'Applied', count: data.appliedList.length },
  ];
}

/** The count in the coral badge of the shell. */
export const needsCount = (data: { needs: unknown[] }) => data.needs.length;

export interface EmptyText {
  cause: string;
  detail: string;
  action: string;
}

/** Why a section is empty, in plain words. Each one has one action: go to the jobs. */
export const EMPTY_TEXT: Record<SectionKey, EmptyText> = {
  needs: {
    cause: 'Nothing needs you now.',
    detail: 'A reply that Waypoint cannot answer on its own shows here, with the reason.',
    action: 'See the jobs',
  },
  awaiting: {
    cause: 'No referral request is waiting for a reply.',
    detail: 'Ask a contact for a referral from a job. The request waits here.',
    action: 'See the jobs',
  },
  safe: {
    cause: 'No reply was safe to send on its own.',
    detail: 'A reply shows here when every answer in it was already on file.',
    action: 'See the jobs',
  },
  applied: {
    cause: 'You have not marked a job as applied.',
    detail: 'Mark a job as applied. It moves here with the CV that you sent.',
    action: 'See the jobs',
  },
};
