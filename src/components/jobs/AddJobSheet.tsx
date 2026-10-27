'use client';

import { useState, type RefObject } from 'react';
import { post } from '../api';
import { parser, pasteResult } from '../task-results';
import { runTask } from '../tasks';
import { Button, ErrorNote, Field, Sheet } from '../ui';

interface Props {
  open: boolean;
  onClose: () => void;
  opener: RefObject<HTMLElement | null>;
  refresh: () => Promise<unknown>;
  openJob: (id: string) => void;
  setToast: (s: string) => void;
}

/** Adds a job from a pasted link. The note and the warning of the result stay in the sheet; a toast only confirms. */
export default function AddJobSheet({ open, onClose, opener, refresh, openJob, setToast }: Props) {
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<{ jobId: string; warning: string | null; note: string | null } | null>(null);

  // The job opens when the sheet closes. On a phone the open job hides the list, and the note must stay in view until then.
  const close = (jobId?: string) => {
    setUrl('');
    setError(null);
    setResult(null);
    onClose();
    if (jobId) {
      setToast('Job added.');
      openJob(jobId);
    }
  };

  const add = async () => {
    if (!url.trim() || busy) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      // The task reads the job from the board. A warning or a note comes back with the result.
      const res = await runTask(() => post<{ taskId: string }>('/api/jobs/paste', { url: url.trim() }), { parse: parser(pasteResult) });
      await refresh();
      if (res.warning || res.note) setResult({ jobId: res.jobId, warning: res.warning, note: res.note ?? null });
      else close(res.jobId);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onClose={() => close(result?.jobId)} title="Add a job link" opener={opener}>
      <form
        className="aj-form"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <Field label="Job link" hint="Greenhouse, Lever, Ashby, Workable and Workday boards work.">
          {(c) => <input {...c} type="url" data-autofocus placeholder="https://" maxLength={2000} value={url} onChange={(e) => setUrl(e.target.value)} />}
        </Field>
        {error && <ErrorNote live what="Waypoint could not add this job." fix={error} />}
        {result?.warning && <p className="jl-note" role="status">{result.warning}</p>}
        {result?.note && <p className="jl-note" role="status">{result.note}</p>}
        {result ? (
          <Button variant="go" onClick={() => close(result.jobId)}>Open the job</Button>
        ) : (
          <Button variant="go" type="submit" busy={busy} disabled={!url.trim()}>
            {busy ? 'Reading the job…' : 'Add the job'}
          </Button>
        )}
      </form>
    </Sheet>
  );
}
