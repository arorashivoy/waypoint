import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PORT = 3150;
export const BASE_URL = `http://localhost:${PORT}`;
/** The scratch folder: the database, the user files and the saved sign-ins. The setup makes it new for each run. */
export const SCRATCH = join(tmpdir(), 'waypoint-e2e');

export const PASSWORD = 'waypoint-e2e-check-pw';
export const ADMIN = { email: 'admin@example.com', name: 'Ada Admin' };

/** The names of the projects of playwright.config.ts. */
export const PROJECTS = ['iphone-15', 'pixel-7', 'ipad-portrait', 'ipad-landscape', 'ipad-pro', 'desktop'] as const;
export type ProjectName = (typeof PROJECTS)[number];

/** Each project has its own new member, because the wizard changes the member for good. */
export const memberOf = (project: string) => ({ email: `member-${project}@example.com`, name: `Mia ${project}` });

export const stateFile = (who: string) => join(SCRATCH, 'state', `${who}.json`);
