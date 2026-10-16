'use client';

import { useState } from 'react';
import type { ClaimsDoc } from '@/lib/profile/doc';
import { ApiError, put } from '../api';
import ItemList from './ItemList';

type Props = { doc: ClaimsDoc; levels?: string[]; onSaved: (reply: any) => void; setToast: (s: string) => void };

export default function ExperienceTab({ doc, levels, onSaved, setToast }: Props) {
  const [name, setName] = useState(doc.profile.name);
  const [headline, setHeadline] = useState(doc.profile.headline);
  const [errors, setErrors] = useState<string[]>([]);
  const saveMeta = async () => {
    setErrors([]);
    try {
      onSaved(await put('/api/profile/meta', { name, headline }));
      setToast('Saved.');
    } catch (e) {
      setErrors(e instanceof ApiError && Array.isArray(e.data.errors) ? e.data.errors : [(e as Error).message]);
    }
  };
  return (
    <>
      <section className="card stack" style={{ gap: 12, padding: 20, marginBottom: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Name and headline</h2>
        <label className="label" htmlFor="p-name">Name</label>
        <input id="p-name" className="field" value={name} onChange={(e) => setName(e.target.value)} />
        <label className="label" htmlFor="p-headline">Headline</label>
        <input id="p-headline" className="field" value={headline} onChange={(e) => setHeadline(e.target.value)} placeholder="For example: Backend engineer, Java and Kafka" />
        {errors.length > 0 && <ul className="err" role="alert">{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div><button className="btn btn-dark" onClick={saveMeta} disabled={!name.trim()}>Save</button></div>
      </section>
      <ItemList kind="position" title="Experience" empty="No positions yet. Add one, or import a résumé or a LinkedIn export in the Imports tab." items={doc.targets.positions} doc={doc} onSaved={onSaved} setToast={setToast} />
      <ItemList kind="education" title="Education" empty="No education yet. The alumni referral route needs a school." items={doc.targets.educations} doc={doc} onSaved={onSaved} setToast={setToast} />
      <section className="card stack" style={{ gap: 8, padding: 20, marginTop: 20 }}>
        <h2 style={{ margin: 0, fontSize: 20 }}>Inferred level</h2>
        <span>{levels?.length ? levels.join(' and ') : 'No level yet.'}</span>
        <span className="hint">Waypoint reads this level from the titles and dates of your positions. It sets the “From LinkedIn” level filter on the Jobs screen. It also sets the level part of each match score. You cannot edit it. Change your positions to change it.</span>
      </section>
    </>
  );
}
