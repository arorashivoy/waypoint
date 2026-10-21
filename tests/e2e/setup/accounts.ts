import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const PORT = 3150;
// The app listens on 127.0.0.1 only, so nobody else on the network can sign in.
export const BASE_URL = `http://127.0.0.1:${PORT}`;
/** The scratch folder: the database, the user files, the app folder and the saved sign-ins. start.sh makes it new for each run. */
export const SCRATCH = join(tmpdir(), 'waypoint-e2e');
/** The report folder of Playwright. It is not inside SCRATCH, because start.sh wipes SCRATCH. */
export const RESULTS = join(tmpdir(), 'waypoint-e2e-results');

/** prepare.ts makes a new random password for each run and writes it here (mode 600). Nothing prints it. */
export const CREDENTIALS = join(SCRATCH, 'credentials.json');
export const password = (): string => (JSON.parse(readFileSync(CREDENTIALS, 'utf8')) as { password: string }).password;
export const ADMIN = { email: 'admin@example.com', name: 'Ada Admin' };

/** A member who has finished the wizard and has no CV source, so a CV build fails in a way that the page must show. */
export const NO_CV = { email: 'no-cv@example.com', name: 'Noa Nocv' };

/** The names of the projects of playwright.config.ts. */
export const PROJECTS = ['iphone-15', 'pixel-7', 'ipad-portrait', 'ipad-landscape', 'ipad-pro', 'desktop'] as const;
export type ProjectName = (typeof PROJECTS)[number];

/** Each project has its own new member, because the wizard changes the member for good. */
export const memberOf = (project: string) => ({ email: `member-${project}@example.com`, name: `Mia ${project}` });

export const stateFile = (who: string) => join(SCRATCH, 'state', `${who}.json`);
