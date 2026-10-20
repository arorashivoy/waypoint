'use client';

import { useState } from 'react';
import { copyAndOpen, draftCopyOpen, patch, post } from '../api';
import { runTask } from '../tasks';
import { keepFocus, sectionOfItem } from './focus';
import type { AwaitingItem, NeedsItem } from './sections';

export interface PendingActions {
  /** The id of the item that works now. */
  busy: string | null;
  /** The error of an action, by item id. It shows next to the action. */
  errors: Record<string, string>;
  /** Remove the error of an item, for example when its form opens again. */
  clearError: (id: string) => void;
  /** Copy the message, open LinkedIn and mark the reply as handled. `body` is the text to send. */
  send: (item: Pick<NeedsItem, 'id' | 'draft'>, body?: string) => Promise<boolean>;
  /** An alumnus accepted: draft the referral message with the CV link. */
  draftReferral: (item: AwaitingItem, who: { name: string; url: string }) => Promise<boolean>;
  /** Paste what the contact wrote: Waypoint drafts the answer. */
  submitReply: (item: AwaitingItem, incoming: string) => Promise<boolean>;
}

/**
 * Nothing on this board can be driven by LinkedIn, so every change is the
 * user telling Waypoint what happened. Each action returns true when it worked.
 * A failure shows next to the action. A toast repeats a confirmation only.
 */
export function usePendingActions(refresh: () => Promise<unknown>, setToast: (s: string) => void): PendingActions {
  const [busy, setBusy] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const run = async (id: string, work: () => Promise<void>) => {
    setBusy(id);
    setErrors(({ [id]: _gone, ...rest }) => rest);
    // The item can leave its section when the action works. Then the focus goes to the section heading.
    const section = sectionOfItem(document, id);
    try {
      await work();
      requestAnimationFrame(() => keepFocus(document, section));
      return true;
    } catch (e) {
      setErrors((old) => ({ ...old, [id]: (e as Error).message }));
      return false;
    } finally {
      setBusy(null);
    }
  };

  return {
    busy,
    errors,
    clearError: (id) => setErrors(({ [id]: _gone, ...rest }) => rest),
    send: (item, body) =>
      run(item.id, async () => {
        const res = await patch<{ copy: string; open: string | null }>(`/api/outreach/${item.id}`, { handled: true, body: body ?? item.draft });
        await copyAndOpen(res.copy, res.open);
        setToast('Message copied and LinkedIn opened. Paste and send it there.');
        await refresh();
      }),
    draftReferral: (a, who) =>
      run(a.id, async () => {
        // An alumnus who accepted is a connection now, so they get the same referral message, with the CV link, that a 1st-degree contact would.
        const { res, copied, opened } = await draftCopyOpen(
          runTask<{ copy: string; open: string | null; name: string }>(() => post('/api/outreach', { jobId: a.jobId, action: 'accepted', name: who.name, profileUrl: who.url })),
        );
        await refresh();
        const first = res.name.split(' ')[0];
        setToast(
          copied && opened ? `Referral message copied and ${first}'s profile opened. Paste it into a message there.`
          : copied ? `Referral message copied. The browser blocked the new tab; open ${first}'s profile from the job.`
          : `The browser blocked the clipboard. Open the job to copy the message to ${first}.`,
        );
      }),
    submitReply: (a, incoming) =>
      run(a.id, async () => {
        const res = await runTask<{ certain: boolean }>(() => post('/api/outreach', { jobId: a.jobId, action: 'replied', incoming }));
        await refresh();
        setToast(res.certain ? 'The answer was already on file, so the reply is drafted and marked safe to send.' : 'That reply needs a decision from you. It is in Needs you with the reason.');
      }),
  };
}
