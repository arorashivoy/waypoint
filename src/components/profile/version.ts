'use client';

import { createContext, useContext } from 'react';

/**
 * The profile version that the screen loaded. Each write sends it. If another
 * tab changed the profile since, the server answers 409. The write then calls
 * `onStale`, which loads the new version, and the user makes the change again.
 */
export const ProfileVersionContext = createContext<{ version: number; onStale: (error: unknown) => void }>({ version: 0, onStale: () => {} });

export const useProfileVersion = () => useContext(ProfileVersionContext);
