'use client';

import { useEffect, useState } from 'react';

/** True when the address has ?view=. A link into the app skips the wizard. */
export const hasViewParam = (search: string) => new URLSearchParams(search).has('view');

/**
 * Whether the wizard stays away for this page load. It reads the address one time, so a tap on Jobs (which drops ?view=)
 * does not throw the user back into the wizard. `set(false)` opens the wizard again; `set(true)` keeps it away.
 */
export function useWizardBypass() {
  const [bypass, setBypass] = useState(false);
  useEffect(() => setBypass(hasViewParam(window.location.search)), []);
  return [bypass, setBypass] as const;
}
