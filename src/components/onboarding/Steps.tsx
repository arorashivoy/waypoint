'use client';

import { useState } from 'react';
import { PasswordForm } from '../settings/AccountSection';
import { ClaudeKeyForm } from '../settings/ClaudeSection';
import { CountryList, SearchForm, type CountryRow } from '../settings/JobSearch';
import type { Run } from '../settings/parts';
import { LoadError, Row } from '../settings/parts';
import { useSearchSettings, type Me, type ProfileData } from '../data';
import DraftList from '../profile/DraftList';
import ImportSources from '../profile/ImportSources';
import LinkedInPanel from '../profile/LinkedInPanel';
import { taskLine } from '../shell/task';
import { Button, EmptyState, ErrorNote, Fold, Skeleton, TaskIndicator } from '../ui';
import type { FirstJobs } from './useFirstJobs';

const CLAUDE_WORDS: Record<string, string> = {
  shared: 'Waypoint uses the shared key.',
  own: 'Waypoint uses your own API key.',
  cli: 'Waypoint uses the subscription of the admin.',
};

type Common = { me: Me; setToast: (s: string) => void; run: Run };

/** Step 1. The name and email come from the invite. The password is optional here. */
export function AccountStep({ me, run, onOwnKey }: Common & { onOwnKey: () => void }) {
  const [changed, setChanged] = useState(false);
  const hasClaude = me.claude.mode !== 'none';
  return (
    <div className="pf-stack">
      <ul className="pf-rows ob-rows">
        <Row title={me.user.name} sub="Your name" />
        <Row title={me.user.email} sub="Your email" />
      </ul>
      {changed ? (
        <p className="pf-note ob-ok" role="status">Password changed. Your other devices are signed out.</p>
      ) : (
        <Fold title="Change your password" status="Optional. Use 12 characters or more.">
          <PasswordForm run={run} onDone={() => setChanged(true)} />
        </Fold>
      )}
      {hasClaude && (
        <p className="pf-note">
          Claude reads each job for you. {CLAUDE_WORDS[me.claude.mode]}{' '}
          <Button variant="link" onClick={onOwnKey}>Use my own key</Button>
        </p>
      )}
    </div>
  );
}

/** Step 2. The countries switch at once. The fields and the visa status save with the main button of the card. */
export function SearchStep({ me, setToast, toggleCountry, formId, onSaved }: Common & { toggleCountry: (cc: string, on: boolean) => void | Promise<unknown>; formId: string; onSaved: () => void }) {
  const search = useSearchSettings();
  const on = me.countries.filter((c) => c.on).length;
  return (
    <div className="pf-stack">
      <section className="pf-section" aria-labelledby="ob-countries">
        <h2 id="ob-countries" className="pf-group-title">Countries, in your order ({on} on)</h2>
        <CountryList countries={me.countries as CountryRow[]} onToggle={toggleCountry} />
      </section>
      <section className="pf-section" aria-labelledby="ob-fields">
        <h2 id="ob-fields" className="pf-group-title">Fields and visa status</h2>
        <LoadError what="your job search settings" error={search.error} retry={search.mutate} />
        {search.data ? (
          <SearchForm value={search.data} formId={formId} hideSave setToast={setToast} onSaved={async (saved) => { await search.mutate(saved, { revalidate: false }); onSaved(); }} />
        ) : (
          !search.error && <Skeleton rows={3} />
        )}
      </section>
    </div>
  );
}

/** Step 3. The key form has its own button. It is the main button of this step. */
export function ClaudeStep({ run, onSaved }: { run: Run; onSaved: () => void }) {
  return <ClaudeKeyForm run={run} onDone={onSaved} />;
}

type ProfileProps = { data: ProfileData | undefined; error?: Error; retry: () => unknown; changed: () => Promise<void>; setToast: (s: string) => void };

function ProfileWait({ data, error, retry }: Pick<ProfileProps, 'data' | 'error' | 'retry'>) {
  if (data) return null;
  return error ? (
    <ErrorNote live what="Waypoint could not load your profile." fix={`${error.message.replace(/\.?$/, '.')} Check your connection, then try again.`} onRetry={() => { retry(); }} />
  ) : (
    <Skeleton rows={3} />
  );
}

/** Step 4. The import panels of the Profile screen. Each import shows its progress and its result on the card. */
export function ImportStep({ data, error, retry, changed, setNote, note, state }: Omit<ProfileProps, 'setToast'> & { setNote: (s: string) => void; note: string; state: any }) {
  return (
    <div className="pf-stack">
      <ProfileWait data={data} error={error} retry={retry} />
      {data && (
        <>
          <section className="glass ui-panel ob-sources" aria-label="Import">
            <ImportSources imported={changed} setToast={setNote} />
          </section>
          <p className="pf-note ob-result" role="status" aria-live="polite">{note}</p>
          <LinkedInPanel state={state} refresh={changed} setToast={setNote} folded />
        </>
      )}
    </div>
  );
}

/** Step 5. The calm draft list of the Profile screen. */
export function ReviewStep({ data, error, retry, changed, setToast, onCount, onBack }: ProfileProps & { onCount: (n: number) => void; onBack: () => void }) {
  return (
    <div className="pf-stack">
      <ProfileWait data={data} error={error} retry={retry} />
      {data && (data.pendingDrafts > 0 ? (
        <DraftList doc={data.doc} changed={changed} setToast={setToast} onCount={onCount} />
      ) : (
        <EmptyState cause="No drafts wait for you." detail="An import puts its drafts here. Go back to import something, or continue." action={{ label: 'Back to import', onClick: onBack }} />
      ))}
    </div>
  );
}

/** Step 6. The first refresh of the job boards runs here. */
export function FirstJobsStep({ me, jobs, onRetry }: { me: Me; jobs: FirstJobs; onRetry: () => void }) {
  const names = me.countries.filter((c) => c.on).map((c) => c.name);
  const checking = taskLine(me.analysing);
  return (
    <div className="pf-stack">
      {jobs.phase === 'idle' && (
        <p className="ob-plain">
          {names.length > 0
            ? `Waypoint reads the job boards in ${names.length > 3 ? `${names.length} countries` : names.join(', ')}. Then Claude reads the best matches. This takes about a minute.`
            : 'No country is on, so there is nothing to fetch. Go back and turn on one country.'}
        </p>
      )}
      {jobs.phase === 'running' && (
        <div className="ob-run">
          <TaskIndicator text="Fetching jobs from the boards" />
          <p className="pf-note">You can wait here. This takes about a minute.</p>
        </div>
      )}
      {jobs.phase === 'done' && (
        <div className="ob-run" role="status">
          <p className="ob-plain">{jobs.line}</p>
          {checking && <TaskIndicator text={checking} />}
        </div>
      )}
      {jobs.phase === 'error' && (
        <ErrorNote live what="Waypoint could not fetch the jobs." fix={`${jobs.message.replace(/\.?$/, '.')} Try again, or skip this step. You can fetch jobs from the Jobs screen.`} onRetry={onRetry} />
      )}
    </div>
  );
}
