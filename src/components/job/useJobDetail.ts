'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { api, del, draftCopyOpen, patch, post } from '../api';
import { answersResult, cvResult, emailResult, messageResult, parser, referralResult, wordingResult } from '../task-results';
import { runTask } from '../tasks';
import { suggestBlockedNote } from './CvSection';
import { gmailCompose } from './gmail';
import type { Answers, AnswersBusy, Cv, CvBusy, JobDetailState, JobView, Wording } from './types';


/**
 * The open job: its data, and the actions of the sections. A task outlives a click
 * to another job, so an answer that comes late never lands on the job that is open.
 */
export function useJobDetail(id: string, opts: { claude: { mode: string; cliOff?: boolean }; refresh: () => Promise<unknown>; setToast: (s: string) => void }): { state: JobDetailState | null; error: string | null; retry: () => void } {
  const { claude, refresh, setToast } = opts;
  const [job, setJob] = useState<JobView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'send' | 'alumni' | 'recruiter' | 'email' | null>(null);
  const [blocked, setBlocked] = useState(false);
  const [cv, setCv] = useState<Cv | null>(null);
  const [cvBusy, setCvBusy] = useState<CvBusy>(null);
  const [wording, setWording] = useState<Wording | null>(null);
  const [answers, setAnswers] = useState<Answers | null>(null);
  const [answersBusy, setAnswersBusy] = useState<AnswersBusy>(null);
  const [answersError, setAnswersError] = useState<string | null>(null);
  const [cvError, setCvError] = useState<string | null>(null);
  const [wayError, setWayError] = useState<string | null>(null);
  const [applyError, setApplyError] = useState<string | null>(null);
  const [cvRev, setCvRev] = useState(0);
  const [tries, setTries] = useState(0);
  const shown = useRef(id);

  useEffect(() => {
    let live = true;
    shown.current = id;
    setJob(null);
    setLoadError(null);
    setBlocked(false);
    setCv(null);
    setWording(null);
    setAnswers(null);
    setAnswersBusy(null);
    setAnswersError(null);
    setCvBusy(null);
    setCvError(null);
    setWayError(null);
    setApplyError(null);
    api<JobView>(`/api/jobs/${id}`)
      .then(async (j) => {
        if (!live) return;
        setJob(j);
        setCv(j.cv);
        setWording(j.wording ?? null);
        setAnswers(j.answers ?? null);
        // The worker reads the job. The screen shows the estimate until the task ends, then loads the job again.
        if (!j.analysing) return;
        try {
          await runTask(async () => ({ taskId: j.analysing! }));
          const done = await api<JobView>(`/api/jobs/${id}`);
          if (live) setJob({ ...done, analysing: null });
        } catch {
          // The estimate stays. A later visit queues the analysis again.
          if (live) setJob((cur) => cur && { ...cur, analysing: null });
        }
      })
      .catch((e: Error) => { if (live) setLoadError(e.message); });
    return () => { live = false; };
  }, [id, tries]);

  const findContact = useCallback(async () => {
    if (!job) return;
    setBusy('send');
    setWayError(null);
    try {
      const { res, copied, opened } = await draftCopyOpen(runTask(() => post<{ taskId: string }>('/api/outreach', { jobId: id, action: 'referral' }), { parse: parser(referralResult) }));
      if (shown.current !== id) return;
      setJob((cur) => cur && { ...cur, isSent: true, referral: { copy: res.copy, open: res.open, name: res.name } });
      setBlocked(!opened);
      // The referral built and uploaded the CV, so the CV section now has a file to show.
      api<JobView>(`/api/jobs/${id}`).then((j) => { if (shown.current === id) { setCv(j.cv); setCvRev((r) => r + 1); } }).catch(() => {});
      await refresh();
      const built = res.resume;
      const cvNote = !built ? null : built.publicUrl ? `CV link in the message${built.tailored && built.lead ? `, leading with ${built.lead}` : ''}.` : built.shareReason || built.reason;
      const did = copied && opened ? `Referral message copied and ${res.name}'s profile opened. Paste it into a message there.`
        : copied ? `Referral message copied. The browser blocked the new tab, so open ${res.name}'s profile in your way in.`
        : `The browser blocked the clipboard. Use the buttons in your way in to copy the message and open ${res.name}'s profile.`;
      setToast([did, cvNote].filter(Boolean).join(' '));
    } catch (e) {
      if (shown.current === id) setWayError((e as Error).message);
    } finally {
      if (shown.current === id) setBusy(null);
    }
  }, [id, job, refresh, setToast]);

  const findAlumni = useCallback(async () => {
    if (!job) return;
    setBusy('alumni');
    setWayError(null);
    try {
      const { res, copied, opened } = await draftCopyOpen(runTask(() => post<{ taskId: string }>('/api/outreach', { jobId: id, action: 'alumni' }), { parse: parser(messageResult) }));
      if (shown.current !== id) return;
      setJob((cur) => cur && { ...cur, isSent: true, referral: { copy: res.copy, open: res.open, name: res.name, alumni: true } });
      setBlocked(!opened);
      await refresh();
      setToast(
        copied && opened ? `Connection note copied and the ${job.alumni?.school} alumni search opened. Pick one person, press Connect, then Add a note, and paste.`
        : copied ? 'Connection note copied. The browser blocked the new tab, so open the alumni search in your way in.'
        : 'The browser blocked the clipboard. Copy the note in your way in and open the alumni search.',
      );
    } catch (e) {
      if (shown.current === id) setWayError((e as Error).message);
    } finally {
      if (shown.current === id) setBusy(null);
    }
  }, [id, job, refresh, setToast]);

  const findRecruiter = useCallback(async () => {
    setBusy('recruiter');
    setWayError(null);
    try {
      const r = await post<{ name: string; email: string; position: string; confidence: number }>('/api/outreach', { jobId: id, action: 'recruiter' });
      if (shown.current !== id) return;
      setJob((cur) => cur && { ...cur, recruiter: { name: r.name, email: r.email, why: [r.position, `${r.confidence}% sure`].filter(Boolean).join(', ') }, coldEmail: null });
    } catch (e) {
      if (shown.current === id) setWayError((e as Error).message);
    } finally {
      if (shown.current === id) setBusy(null);
    }
  }, [id]);

  const draftEmail = useCallback(async (email: string) => {
    setBusy('email');
    setWayError(null);
    try {
      const res = await runTask(() => post<{ taskId: string }>('/api/outreach', { jobId: id, action: 'cold', email }), { parse: parser(emailResult) });
      if (shown.current !== id) return;
      setJob((cur) => cur && { ...cur, coldEmail: { id: res.id, name: res.name, email: res.email, subject: res.subject, body: res.body, approved: false } });
      // The draft built and uploaded the CV, so the CV section now has a file to show.
      api<JobView>(`/api/jobs/${id}`).then((j) => { if (shown.current === id) { setCv(j.cv); setCvRev((r) => r + 1); } }).catch(() => {});
    } catch (e) {
      if (shown.current === id) setWayError((e as Error).message);
    } finally {
      if (shown.current === id) setBusy(null);
    }
  }, [id]);

  const approveEmail = useCallback(async (v: { email: string; subject: string; body: string }) => {
    const draft = job?.coldEmail;
    if (!draft) return;
    setWayError(null);
    try {
      await patch(`/api/outreach/${draft.id}`, { email: v.email, subject: v.subject, body: v.body, handled: true });
    } catch (e) {
      if (shown.current === id) setWayError((e as Error).message);
      throw e;
    }
    if (shown.current !== id) return;
    setJob((cur) => cur && cur.coldEmail && { ...cur, coldEmail: { ...cur.coldEmail, ...v, approved: true } });
    // The text is on the clipboard too, for the case that Gmail drops it from a long link.
    navigator.clipboard?.writeText(v.body).catch(() => {});
    const tab = window.open(gmailCompose(v), '_blank');
    if (tab) tab.opener = null;
    setBlocked(!tab);
    setToast(tab ? `Approved. Gmail is open with the email to ${draft.name}. Press Send there.` : `Approved. The browser blocked the new tab, so use "Open in Gmail" in your way in.`);
  }, [id, job, setToast]);

  const markApplied = useCallback(async () => {
    if (!job) return;
    const next = !job.isApplied;
    setApplyError(null);
    try {
      await patch(`/api/jobs/${id}`, { applied: next });
    } catch (e) {
      // The bar shows the error next to the button. The throw stops the "Marked as applied" text of the button.
      if (shown.current === id) setApplyError((e as Error).message);
      throw e;
    }
    if (shown.current === id) setJob((cur) => cur && { ...cur, isApplied: next });
    await refresh();
  }, [id, job, refresh]);

  const cvCall = useCallback(async (kind: Exclude<CvBusy, null>, start: () => Promise<{ taskId: string }>) => {
    const forId = id;
    setCvBusy(kind);
    setCvError(null);
    try {
      // A suggest task builds no PDF. Its result holds only the suggestions and the keyword report.
      if (kind === 'suggest') {
        const w = await runTask(start, { parse: parser(wordingResult) });
        if (shown.current === forId) setWording({ suggestions: w.suggestions, keywords: w.keywords });
      } else {
        const fresh = await runTask(start, { parse: parser(cvResult) });
        if (shown.current === forId) {
          setCv(fresh);
          setCvRev((r) => r + 1);
          if (fresh.suggestions && fresh.keywords) setWording({ suggestions: fresh.suggestions, keywords: fresh.keywords });
        }
      }
      return true;
    } catch (e) {
      if (shown.current === forId) setCvError((e as Error).message);
      return false;
    } finally {
      if (shown.current === forId) setCvBusy(null);
    }
  }, [id]);

  const generate = useCallback(() => cvCall('generate', () => post<{ taskId: string }>(`/api/jobs/${id}/resume`)), [cvCall, id]);
  const refine = useCallback((message: string) => cvCall('refine', () => post<{ taskId: string }>(`/api/jobs/${id}/resume/refine`, { message })), [cvCall, id]);
  const reset = useCallback(() => cvCall('reset', () => del<{ taskId: string }>(`/api/jobs/${id}/resume/refine`)), [cvCall, id]);
  const suggest = useCallback(() => cvCall('suggest', () => post<{ taskId: string }>(`/api/jobs/${id}/resume/suggestions`, { action: 'suggest' })), [cvCall, id]);
  // Accept builds the CV again in the worker. Reject changes only the mark of the suggestion.
  const original = useCallback((lineId: string) => cvCall('generate', () => post<{ taskId: string }>(`/api/jobs/${id}/resume/suggestions`, { action: 'original', id: lineId })), [cvCall, id]);
  const decide = useCallback(async (bulletId: string, action: 'accept' | 'reject') => {
    if (action === 'accept') return cvCall('generate', () => post<{ taskId: string }>(`/api/jobs/${id}/resume/suggestions`, { bulletId, action }));
    try {
      await post(`/api/jobs/${id}/resume/suggestions`, { bulletId, action });
      setWording((w) => w && { ...w, suggestions: { ...w.suggestions, items: w.suggestions.items.map((i) => (i.bulletId === bulletId ? { ...i, status: 'rejected' as const } : i)) } });
      return true;
    } catch (e) {
      setCvError((e as Error).message);
      return false;
    }
  }, [cvCall, id]);

  const answersCall = useCallback(async (kind: Exclude<AnswersBusy, null>, start: () => Promise<{ taskId: string }>) => {
    const forId = id;
    setAnswersBusy(kind);
    setAnswersError(null);
    try {
      const fresh = await runTask(start, { parse: parser(answersResult) });
      if (shown.current === forId) setAnswers(fresh as Answers);
      return true;
    } catch (e) {
      if (shown.current === forId) setAnswersError((e as Error).message);
      return false;
    } finally {
      if (shown.current === forId) setAnswersBusy(null);
    }
  }, [id]);
  const answer = useCallback((questions: string) => answersCall('answer', () => post<{ taskId: string }>(`/api/jobs/${id}/answers`, { action: 'answer', text: questions })), [answersCall, id]);
  const refineAnswers = useCallback((message: string) => answersCall('refine', () => post<{ taskId: string }>(`/api/jobs/${id}/answers`, { action: 'refine', text: message })), [answersCall, id]);
  const saveAnswers = useCallback(async (text: string) => {
    const forId = id;
    setAnswersError(null);
    try {
      const saved = await patch<Answers>(`/api/jobs/${id}/answers`, { text });
      if (shown.current === forId) setAnswers((cur) => cur && { ...cur, text: saved.text, updatedAt: saved.updatedAt });
      return true;
    } catch (e) {
      if (shown.current === forId) setAnswersError((e as Error).message);
      return false;
    }
  }, [id]);

  const retry = () => setTries((n) => n + 1);
  if (!job) return { state: null, error: loadError, retry };
  return {
    error: null,
    retry,
    state: { job, cv, wording, answers, answersBusy, answersError, busy, cvBusy, cvError, blocked, wayError, applyError, cvRev, claudeNote: suggestBlockedNote(claude), findContact, findAlumni, findRecruiter, draftEmail, approveEmail, markApplied, generate, refine, reset, suggest, decide, original, answer, refineAnswers, saveAnswers, setToast },
  };
}
