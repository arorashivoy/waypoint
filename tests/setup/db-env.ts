import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Runs one time, before any worker starts. The workers inherit this value,
// so db.ts opens a temporary database and never the real one.
let dir = '';

export function setup(): void {
  dir = mkdtempSync(join(tmpdir(), 'waypoint-vitest-'));
  process.env.DATABASE_URL = `file:${join(dir, 'test.db')}`;
}

export function teardown(): void {
  if (dir) rmSync(dir, { recursive: true, force: true });
}
