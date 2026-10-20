'use client';

import CountriesScreen from '../CountriesScreen';
import SettingsScreen from '../SettingsScreen';

type Common = { state: any; refresh: () => Promise<any>; setToast: (s: string) => void };

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

export const Interim = { Settings: SettingsHome };
