'use client';

import { useState } from 'react';
import CountriesScreen from '../CountriesScreen';
import ProfileScreen from '../ProfileScreen';
import ResumeScreen from '../ResumeScreen';
import SettingsScreen from '../SettingsScreen';
import { useProfile } from '../data';
import { Tabs } from '../ui';
import { Wait } from './Views';

type Common = { state: any; refresh: () => Promise<any>; setToast: (s: string) => void };

/** Interim home of Profile: a 2-tab switch. The Profile and Résumé tasks rebuild both screens. */
function ProfileHome({ state, refresh, setToast }: Common) {
  const [tab, setTab] = useState('profile');
  const { data, error, mutate } = useProfile();
  const full = data && { ...state, ...data.view };
  return (
    <div className="sh-split">
      <Tabs
        label="Profile sections"
        value={tab}
        onChange={setTab}
        tabs={[
          { id: 'profile', label: 'Profile', panel: tab === 'profile' ? <ProfileScreen state={state} refresh={refresh} setToast={setToast} /> : null },
          { id: 'resume', label: 'Résumé', panel: tab !== 'resume' ? null : full ? <ResumeScreen state={full} refresh={refresh} setToast={setToast} /> : <Wait error={error} onRetry={() => { mutate(); }} /> },
        ]}
      />
    </div>
  );
}

/** Interim home of Settings: the country list above the settings. */
function SettingsHome({ state, setToast, toggleCountry }: Pick<Common, 'state' | 'setToast'> & { toggleCountry: (cc: string, on: boolean) => void }) {
  return (
    <div className="sh-stack">
      <header className="sh-title"><h1 className="display">Settings</h1></header>
      <section aria-labelledby="sh-job-search">
        <h2 id="sh-job-search" className="sh-section">Job search</h2>
        <CountriesScreen state={state} toggleCountry={toggleCountry} />
      </section>
      <SettingsScreen state={state} setToast={setToast} />
    </div>
  );
}

export const Interim = { Profile: ProfileHome, Settings: SettingsHome };
