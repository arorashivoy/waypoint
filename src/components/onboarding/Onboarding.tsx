'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { patch } from '../api';
import { useProfile, type Me, type ProfileData } from '../data';
import { ProfileVersionContext, useProfileVersionValue } from '../profile/version';
import type { Run } from '../settings/parts';
import { BrandMark } from '../shell/icons';
import { Button } from '../ui';
import StepRoute from './StepRoute';
import { AccountStep, ClaudeStep, FirstJobsStep, ImportStep, ReviewStep, SearchStep } from './Steps';
import { startStep, wizardSteps, type WizardStep } from './steps';
import { useFirstJobs } from './useFirstJobs';

type Props = {
  me: Me;
  setToast: (s: string) => void;
  toggleCountry: (cc: string, on: boolean) => void | Promise<unknown>;
  /** Loads the data of every screen again. */
  refresh: () => Promise<unknown>;
  /** The wizard is done or skipped: the app opens on Jobs. */
  onLeave: () => void;
};

const SEARCH_FORM = 'ob-search-form';
const first = (name: string) => name.trim().split(/\s+/)[0] || 'there';

/** What each step says: its title and the one sentence under it. */
function words(step: WizardStep, me: Me): { title: string; lead: string } {
  switch (step) {
    case 'account':
      return { title: `Welcome, ${first(me.user.name)}`, lead: 'Your account is ready. Setup takes a few minutes, and you can skip any step. You can finish it later in Settings.' };
    case 'search':
      return { title: 'Where do you want to work?', lead: 'Turn on the countries to search. Then choose your fields and write your visa status. Waypoint uses both to rank the jobs.' };
    case 'claude':
      return me.claude.mode === 'none'
        ? { title: 'Add your Claude key', lead: 'Claude reads each job and compares it with your profile. Waypoint has no key for you yet. Add your own Anthropic API key, or skip and add it later in Settings.' }
        : { title: 'Add your own Claude key', lead: 'Claude reads each job for you. Add your own Anthropic API key if you want Waypoint to use it in place of the key it uses now.' };
    case 'import':
      return { title: 'Add your experience', lead: 'Import a résumé, a LinkedIn export, your GitHub repositories or a claims.yml file. Import at least one, or skip this step.' };
    case 'review':
      return { title: 'Review your drafts', lead: 'Accept the drafts that are right. Your profile changes only when you accept a draft.' };
    case 'refresh':
      return { title: 'Find your first jobs', lead: 'Waypoint fetches the jobs for your countries and scores each one against your profile.' };
  }
}

export default function Onboarding({ me, setToast, toggleCountry, refresh, onLeave }: Props) {
  const [ownKey, setOwnKey] = useState(false);
  const [current, setCurrent] = useState<WizardStep>(() => startStep(wizardSteps(me), me.onboarding.step));
  const steps = useMemo(() => wizardSteps(me, ownKey || current === 'claude'), [me, ownKey, current]);
  const at = Math.max(steps.indexOf(current), 0);
  const last = at === steps.length - 1;
  const { title, lead } = words(current, me);

  // The heading takes focus when the step changes, so a screen reader reads the new step. Not on the first paint.
  const heading = useRef<HTMLHeadingElement>(null);
  const shown = useRef(current);
  useEffect(() => {
    if (shown.current === current) return;
    shown.current = current;
    heading.current?.focus();
    window.scrollTo(0, 0);
  }, [current]);

  const go = useCallback(async (step: WizardStep) => {
    setCurrent(step);
    try {
      await patch('/api/onboarding', { step });
    } catch (e) {
      setToast((e as Error).message);
    }
  }, [setToast]);

  const leave = useCallback(async (body: { onboarded: true; step: WizardStep | null }) => {
    try {
      await patch('/api/onboarding', body);
      await refresh();
      onLeave();
    } catch (e) {
      setToast((e as Error).message);
    }
  }, [refresh, onLeave, setToast]);

  const next = () => (last ? leave({ onboarded: true, step: null }) : go(steps[at + 1]));
  const back = () => go(steps[at - 1]);

  /** For the forms of Settings: runs the request and shows the error as a toast. True when the request worked. */
  const run: Run = useCallback(async (fn, done) => {
    try {
      await fn();
      if (done) setToast(done);
      await refresh();
      return true;
    } catch (e) {
      setToast((e as Error).message);
      return false;
    }
  }, [refresh, setToast]);

  // The profile serves the import and the review step.
  const { data: profile, error: profileError, mutate } = useProfile();
  const version = useProfileVersionValue(profile, mutate);
  const state = useMemo(() => (profile ? { ...me, ...profile.view } : me), [me, profile]);
  const changed = useCallback(async () => { await refresh(); }, [refresh]);
  const onCount = useCallback(
    (n: number) => { mutate((d?: ProfileData) => (d && d.pendingDrafts !== n ? { ...d, pendingDrafts: n } : d), { revalidate: false }); },
    [mutate],
  );
  const [note, setNote] = useState('');
  const imported = (profile?.pendingDrafts ?? 0) > 0 || !!profile?.view?.lastImport;

  const [jobs, fetchJobs] = useFirstJobs(refresh);

  // The main button of the card: one for each step.
  const primary = (() => {
    switch (current) {
      case 'account':
      case 'review':
        return <Button variant="go" onClick={next}>Continue</Button>;
      case 'search':
        return <Button variant="go" type="submit" form={SEARCH_FORM}>Save and continue</Button>;
      case 'claude':
        return null; // The key form has its own button.
      case 'import':
        return <Button variant="go" disabled={!imported} onClick={next}>Continue</Button>;
      case 'refresh':
        return jobs.phase === 'done'
          ? <Button variant="go" onClick={next}>See your jobs</Button>
          : <Button variant="go" busy={jobs.phase === 'running'} disabled={!me.countries.some((c) => c.on)} onClick={fetchJobs}>{jobs.phase === 'running' ? 'Fetching' : 'Fetch jobs'}</Button>;
    }
  })();

  const body = (() => {
    switch (current) {
      case 'account':
        return <AccountStep me={me} setToast={setToast} run={run} onOwnKey={() => { setOwnKey(true); go('claude'); }} />;
      case 'search':
        return <SearchStep me={me} setToast={setToast} run={run} toggleCountry={toggleCountry} formId={SEARCH_FORM} onSaved={next} />;
      case 'claude':
        return <ClaudeStep run={run} onSaved={next} />;
      case 'import':
        return <ImportStep data={profile} error={profileError} retry={mutate} changed={changed} note={note} setNote={setNote} state={state} />;
      case 'review':
        return <ReviewStep data={profile} error={profileError} retry={mutate} changed={changed} setToast={setToast} onCount={onCount} onBack={back} />;
      case 'refresh':
        return <FirstJobsStep me={me} jobs={jobs} onRetry={fetchJobs} />;
    }
  })();

  const skipLabel = last && jobs.phase === 'done' ? null : 'Skip for now';

  return (
    <ProfileVersionContext.Provider value={version}>
      <main className="ob">
        <div className="ob-card glass">
          <aside className="ob-side">
            <div className="ob-brand">
              <BrandMark />
              <span className="ob-brand-name">Waypoint</span>
            </div>
            <StepRoute steps={steps} current={current} />
            <div className="ob-leave">
              <Button variant="link" onClick={() => leave({ onboarded: true, step: current })}>Skip setup</Button>
              <span className="ob-leave-note">Finish it later in Settings.</span>
            </div>
          </aside>

          <section className="ob-main" aria-labelledby="ob-title">
            <header className="ob-head">
              <h1 id="ob-title" ref={heading} tabIndex={-1} className="ob-title">{title}</h1>
              <p className="ob-lead">{lead}</p>
            </header>
            <div className="ob-body" key={current}>{body}</div>
            <footer className="ob-foot">
              {at > 0 ? <Button variant="link" onClick={back}>Back</Button> : <span />}
              <div className="ob-foot-main">
                {skipLabel && <Button variant="link" onClick={next}>{skipLabel}</Button>}
                {primary}
              </div>
            </footer>
          </section>
        </div>
      </main>
    </ProfileVersionContext.Provider>
  );
}
