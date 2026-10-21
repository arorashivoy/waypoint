'use client';

import { useEffect, useRef, useState } from 'react';
import { STALE_PROFILE_MESSAGE } from '@/lib/profile/stale';
import type { ClaimsDoc } from '@/lib/profile/doc';
import { ApiError, put } from '../api';
import { Button, Field, Fold } from '../ui';
import Problems from './Problems';
import type { ProfileTab } from './model';
import ItemList from './ItemList';
import { useEditVersion } from './version';

type Props = { doc: ClaimsDoc; levels?: string[]; onSaved: (reply: any) => void; setToast: (s: string) => void; onGoto?: (tab: ProfileTab) => void };

export default function ExperienceTab({ doc, levels, onSaved, setToast, onGoto }: Props) {
  const [name, setName] = useState(doc.profile.name);
  const [headline, setHeadline] = useState(doc.profile.headline);
  const [errors, setErrors] = useState<string[]>([]);
  const { version, reload, begin, rebase } = useEditVersion();

  // A new profile from another tab fills the form only when the user has no unsaved edits.
  const synced = useRef({ name: doc.profile.name, headline: doc.profile.headline });
  useEffect(() => {
    const was = synced.current;
    synced.current = { name: doc.profile.name, headline: doc.profile.headline };
    if (name === was.name && headline === was.headline) {
      setName(doc.profile.name);
      setHeadline(doc.profile.headline);
    }
    // Only a new profile triggers this. The form values are read as they are at that time.
  }, [doc.profile.name, doc.profile.headline]);

  const loadNew = async () => {
    const fresh = await reload();
    if (!fresh) return;
    synced.current = { name: fresh.doc.profile.name, headline: fresh.doc.profile.headline };
    setName(fresh.doc.profile.name);
    setHeadline(fresh.doc.profile.headline);
    rebase(null);
    setErrors([]);
  };
  const saveMeta = async () => {
    setErrors([]);
    try {
      onSaved(await put('/api/profile/meta', { name, headline, version }));
      rebase(null);
      setToast('Saved.');
    } catch (e) {
      setErrors(e instanceof ApiError && Array.isArray(e.data.errors) ? e.data.errors : [(e as Error).message]);
    }
  };
  return (
    <div className="pf-stack">
      <section className="pf-section pf-meta" aria-labelledby="pf-meta-h">
        <div className="pf-head"><h2 id="pf-meta-h">Name and headline</h2></div>
        <div className="pf-box">
          <div className="pf-fields">
            <Field label="Name">{(c) => <input {...c} type="text" value={name} onChange={(e) => { begin(); setName(e.target.value); }} />}</Field>
            <Field label="Headline" hint="For example: Backend engineer, Java and Kafka">
              {(c) => <input {...c} type="text" value={headline} onChange={(e) => { begin(); setHeadline(e.target.value); }} />}
            </Field>
          </div>
          <Problems live list={errors} />
          <div className="pf-actions">
            <Button onClick={saveMeta} disabled={!name.trim()}>Save</Button>
            {errors.includes(STALE_PROFILE_MESSAGE) && <Button onClick={loadNew}>Load the new version</Button>}
          </div>
        </div>
      </section>
      <ItemList
        kind="position"
        title="Experience"
        noun="position"
        primary
        empty={{ cause: 'No positions yet.', detail: 'Add one, or import a résumé or a LinkedIn export on the Imports tab.', alt: onGoto && { label: 'Go to Imports', onClick: () => onGoto('imports') } }}
        items={doc.targets.positions}
        doc={doc}
        onSaved={onSaved}
        setToast={setToast}
      />
      <ItemList
        kind="education"
        title="Education"
        noun="school"
        addLabel="Add education"
        empty={{ cause: 'No education yet.', detail: 'The alumni referral route needs a school.' }}
        items={doc.targets.educations}
        doc={doc}
        onSaved={onSaved}
        setToast={setToast}
      />
      <Fold title="Inferred level" status={levels?.length ? levels.join(' and ') : 'No level yet'}>
        <p className="pf-note">
          Waypoint reads this level from the titles and dates of your positions. It sets the “From LinkedIn” level filter on the Jobs screen and the level part of each match score.
          You cannot edit it. Change your positions to change it.
        </p>
      </Fold>
      {onGoto && (
        <p className="pf-note">
          Made a mistake? <Button variant="link" onClick={() => onGoto('resume')}>See the profile history</Button>
        </p>
      )}
    </div>
  );
}
