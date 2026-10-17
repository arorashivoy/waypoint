import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, symlinkSync, linkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { PrismaClient } from '@prisma/client';
import * as tar from 'tar';
import { applyMigrations } from './setup/migrate';

vi.mock('@/lib/exec', async (importOriginal) => {
  const real = await importOriginal<typeof import('@/lib/exec')>();
  return { ...real, runProgram: vi.fn() };
});

import { runProgram } from '@/lib/exec';
import { resetEnvForTests } from '@/lib/env';
import { backupNow, checkArchive, databasePath, pruneBackups, restoreBackup, uploadBackup } from '@/lib/backup';

const run = vi.mocked(runProgram);
const work = mkdtempSync(join(tmpdir(), 'wp-backup-'));
let n = 0;
const fresh = (name: string) => {
  const d = join(work, `${name}-${++n}`);
  mkdirSync(d, { recursive: true });
  return d;
};

// Each test works on a temporary database file. The real data/waypoint.db is never opened.
let client: PrismaClient;
beforeAll(async () => {
  client = new PrismaClient({ datasourceUrl: `file:${join(work, 'src.db')}?connection_limit=1` });
  await applyMigrations(client);
  for (let i = 0; i < 3; i++) {
    await client.llmCache.create({ data: { key: `k${i}`, kind: 'test', model: 'm', value: 'v' } });
  }
});
afterAll(async () => {
  await client.$disconnect();
  rmSync(work, { recursive: true, force: true });
});
beforeEach(() => {
  run.mockReset();
  run.mockResolvedValue({ code: 3, stdout: 'inactive\n', stderr: '' });
  vi.unstubAllEnvs();
  resetEnvForTests();
});

const NOW = new Date('2026-10-17T03:00:00Z');

describe('backupNow', () => {
  it('writes a database copy that opens and has the same row counts', async () => {
    const dir = fresh('b');
    const r = await backupNow({ dir, usersDir: fresh('u'), now: NOW }, client);
    expect(r.db).toBe(join(dir, '2026-10-17.db'));
    const copy = new PrismaClient({ datasourceUrl: `file:${r.db}` });
    try {
      expect(await copy.llmCache.count()).toBe(await client.llmCache.count());
      expect(await copy.llmCache.count()).toBe(3);
    } finally {
      await copy.$disconnect();
    }
  });

  it('replaces a backup of the same date', async () => {
    const dir = fresh('b');
    await backupNow({ dir, usersDir: fresh('u'), now: NOW }, client);
    await expect(backupNow({ dir, usersDir: fresh('u'), now: NOW }, client)).resolves.toBeTruthy();
  });

  it('refuses a path with a quote and leaves no file', async () => {
    const dir = join(fresh('b'), "it's");
    await expect(backupNow({ dir, usersDir: fresh('u'), now: NOW }, client)).rejects.toThrow(/not allowed/);
    expect(existsSync(dir)).toBe(false);
  });

  it('packs data/users and the archive lists the files', async () => {
    const users = fresh('u');
    mkdirSync(join(users, 'abc12345', 'resumes'), { recursive: true });
    writeFileSync(join(users, 'abc12345', 'resumes', 'cv.pdf'), 'pdf');
    const r = await backupNow({ dir: fresh('b'), usersDir: users, now: NOW }, client);
    const names: string[] = [];
    await tar.list({ file: r.users, onReadEntry: (e) => void names.push(String(e.path)) });
    expect(names.some((p) => p.endsWith('abc12345/resumes/cv.pdf'))).toBe(true);
  });
});

describe('backupNow archive filter', () => {
  it('leaves out a symlink, so checkArchive accepts the archive', async () => {
    const users = fresh('u');
    writeFileSync(join(users, 'real.txt'), 'x');
    symlinkSync('/etc/passwd', join(users, 'link'));
    const r = await backupNow({ dir: fresh('b'), usersDir: users, now: NOW }, client);
    await expect(checkArchive(r.users)).resolves.toBeUndefined();
    const names: string[] = [];
    await tar.list({ file: r.users, onReadEntry: (e) => void names.push(String(e.path)) });
    expect(names.some((p) => p.endsWith('real.txt'))).toBe(true);
    expect(names.some((p) => p.endsWith('link'))).toBe(false);
  });
});

describe('pruneBackups', () => {
  it('keeps 14 daily and 8 weekly', async () => {
    const dir = fresh('p');
    const dates: string[] = [];
    for (let i = 69; i >= 0; i--) dates.push(new Date(NOW.getTime() - i * 86_400_000).toISOString().slice(0, 10));
    expect(dates[0]).toBe('2026-08-09');
    expect(dates[69]).toBe('2026-10-17');
    for (const d of dates) {
      writeFileSync(join(dir, `${d}.db`), 'x');
      writeFileSync(join(dir, `${d}-users.tar.gz`), 'x');
    }
    writeFileSync(join(dir, 'pre-restore-2026-01-01T00-00-00.000Z.db'), 'x');
    const removed = await pruneBackups(dir, NOW);

    // Newest 14: 2026-10-04 to 2026-10-17. The 8 newest ISO weeks start on 10-12, 10-05, 09-28,
    // 09-21, 09-14, 09-07, 08-31 and 08-24. Their newest dates are 10-17, 10-11, 10-04,
    // 09-27, 09-20, 09-13, 09-06 and 08-30. The first three are in the 14 already: 14 + 5 = 19.
    const kept = [...new Set(readdirSync(dir).filter((f) => /^\d/.test(f)).map((f) => f.slice(0, 10)))].sort();
    expect(kept).toHaveLength(19);
    expect(kept.slice(0, 5)).toEqual(['2026-08-30', '2026-09-06', '2026-09-13', '2026-09-20', '2026-09-27']);
    expect(kept.slice(5)).toEqual(dates.slice(-14));
    expect(removed).toHaveLength((70 - 19) * 2);
    // Both files of a date go together, and other files stay.
    expect(readdirSync(dir)).toHaveLength(19 * 2 + 1);
    expect(existsSync(join(dir, 'pre-restore-2026-01-01T00-00-00.000Z.db'))).toBe(true);
  });
});

describe('uploadBackup', () => {
  it('does nothing when no remote is set', async () => {
    await uploadBackup(['/x/2026-10-17.db']);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a bad remote name and starts no process', async () => {
    vi.stubEnv('WAYPOINT_BACKUP_REMOTE', 'gdrive:a b; rm -rf /');
    resetEnvForTests();
    await expect(uploadBackup(['/x/2026-10-17.db'])).rejects.toThrow(/REMOTE/);
    expect(run).not.toHaveBeenCalled();
  });

  it('refuses a remote that starts with a dash', async () => {
    vi.stubEnv('WAYPOINT_BACKUP_REMOTE', '-x:y');
    resetEnvForTests();
    await expect(uploadBackup(['/x/2026-10-17.db'])).rejects.toThrow(/REMOTE/);
    expect(run).not.toHaveBeenCalled();
  });

  it('runs rclone once per file', async () => {
    vi.stubEnv('WAYPOINT_BACKUP_REMOTE', 'gdrive:waypoint-backups');
    resetEnvForTests();
    run.mockResolvedValue({ code: 0, stdout: '', stderr: '' });
    await uploadBackup(['/x/2026-10-17.db', '/x/2026-10-17-users.tar.gz']);
    expect(run).toHaveBeenCalledTimes(2);
    expect(run.mock.calls[0].slice(0, 2)).toEqual(['rclone', ['copy', '--no-traverse', '/x/2026-10-17.db', 'gdrive:waypoint-backups']]);
    expect(run.mock.calls[1][1]).toEqual(['copy', '--no-traverse', '/x/2026-10-17-users.tar.gz', 'gdrive:waypoint-backups']);
  });
});

describe('restoreBackup', () => {
  async function setup() {
    const dataDir = fresh('data');
    const usersDir = join(dataDir, 'users');
    mkdirSync(usersDir);
    writeFileSync(join(usersDir, 'old.txt'), 'old');
    const target = join(dataDir, 'waypoint.db');
    writeFileSync(target, 'OLD DATABASE');
    writeFileSync(`${target}-wal`, 'w');
    writeFileSync(`${target}-shm`, 's');
    const made = await backupNow({ dir: fresh('b'), usersDir: fresh('u'), now: NOW }, client);
    return { dataDir, usersDir, target, made };
  }
  const unchanged = (s: Awaited<ReturnType<typeof setup>>) => {
    expect(readFileSync(s.target, 'utf8')).toBe('OLD DATABASE');
    expect(existsSync(`${s.target}-wal`)).toBe(true);
    expect(existsSync(join(s.dataDir, 'backups'))).toBe(false);
    expect(readdirSync(s.usersDir)).toEqual(['old.txt']);
  };
  const archive = async (entries: (cwd: string) => string[], opts: Record<string, unknown> = {}) => {
    const cwd = fresh('arc');
    const files = entries(cwd);
    const file = join(fresh('arcout'), 'bad.tar.gz');
    await tar.create({ gzip: true, cwd, file, ...opts }, files);
    return file;
  };

  it('refuses while waypoint-web is active', async () => {
    const s = await setup();
    run.mockImplementation(async (_p, args) => ({ code: 0, stdout: args[2] === 'waypoint-web' ? 'active\n' : 'inactive\n', stderr: '' }));
    await expect(restoreBackup({ dbFile: s.made.db, usersTar: s.made.users, dataDir: s.dataDir, usersDir: s.usersDir })).rejects.toThrow(/waypoint-web/);
    unchanged(s);
  });

  it('refuses while waypoint-worker is active', async () => {
    const s = await setup();
    run.mockImplementation(async (_p, args) => ({ code: 0, stdout: args[2] === 'waypoint-worker' ? 'active\n' : 'inactive\n', stderr: '' }));
    await expect(restoreBackup({ dbFile: s.made.db, dataDir: s.dataDir, usersDir: s.usersDir })).rejects.toThrow(/waypoint-worker/);
    unchanged(s);
  });

  it.each([['empty output', ''], ['activating', 'activating\n'], ['reloading', 'reloading\n']])('refuses when systemctl prints %s', async (_n, out) => {
    const s = await setup();
    run.mockResolvedValue({ code: 0, stdout: out, stderr: '' });
    await expect(restoreBackup({ dbFile: s.made.db, dataDir: s.dataDir, usersDir: s.usersDir })).rejects.toThrow(/Stop/);
    unchanged(s);
  });

  it('refuses when systemctl fails in another way than a missing program', async () => {
    const s = await setup();
    run.mockRejectedValue(new Error('systemctl took longer than 10000 ms'));
    await expect(restoreBackup({ dbFile: s.made.db, dataDir: s.dataDir, usersDir: s.usersDir })).rejects.toThrow(/could not be asked/);
    unchanged(s);
  });

  it.each(['inactive', 'failed', 'unknown'])('accepts the answer %s', async (out) => {
    const s = await setup();
    run.mockResolvedValue({ code: 3, stdout: `${out}\n`, stderr: '' });
    await restoreBackup({ dbFile: s.made.db, dataDir: s.dataDir, usersDir: s.usersDir });
  });

  it('treats a missing systemctl as not running', async () => {
    const s = await setup();
    run.mockRejectedValue(new Error('systemctl is not installed'));
    await restoreBackup({ dbFile: s.made.db, dataDir: s.dataDir, usersDir: s.usersDir });
    expect(readFileSync(s.target).subarray(0, 15).toString()).toBe('SQLite format 3');
  });

  it('refuses an archive with ../, an absolute path or a symlink', async () => {
    const s = await setup();
    writeFileSync(join(work, 'outside.txt'), 'x');
    const cases: [string, string, RegExp][] = [
      ['dotdot', await archive(() => ['../outside.txt'], { preservePaths: true }), /\.\. segment/],
      ['absolute', await archive(() => [join(work, 'outside.txt')], { preservePaths: true }), /absolute path/],
      ['symlink', await archive((cwd) => (symlinkSync('/etc/passwd', join(cwd, 'link')), ['link'])), /SymbolicLink/],
      [
        'hardlink',
        await archive((cwd) => {
          writeFileSync(join(cwd, 'a'), 'x');
          linkSync(join(cwd, 'a'), join(cwd, 'b'));
          return ['a', 'b'];
        }),
        /Link/,
      ],
    ];
    for (const [name, file, why] of cases) {
      await expect(restoreBackup({ dbFile: s.made.db, usersTar: file, dataDir: s.dataDir, usersDir: s.usersDir }), name).rejects.toThrow(why);
      unchanged(s);
    }
    expect(existsSync(join(s.dataDir, 'outside.txt'))).toBe(false);
  });

  it('refuses a file that is not an SQLite database', async () => {
    const s = await setup();
    const bogus = join(s.dataDir, 'bogus.db');
    writeFileSync(bogus, 'not a database at all');
    await expect(restoreBackup({ dbFile: bogus, dataDir: s.dataDir, usersDir: s.usersDir })).rejects.toThrow(/SQLite/);
    unchanged(s);
  });

  it('makes a pre-restore copy first, replaces the database and removes -wal and -shm', async () => {
    const s = await setup();
    await restoreBackup({ dbFile: s.made.db, usersTar: s.made.users, dataDir: s.dataDir, usersDir: s.usersDir });
    const copies = readdirSync(join(s.dataDir, 'backups')).filter((f) => /^pre-restore-.*\.db$/.test(f));
    expect(copies).toHaveLength(1);
    expect(copies[0]).not.toContain(':');
    expect(readFileSync(join(s.dataDir, 'backups', copies[0]), 'utf8')).toBe('OLD DATABASE');
    expect(readFileSync(s.target).equals(readFileSync(s.made.db))).toBe(true);
    expect(existsSync(`${s.target}-wal`)).toBe(false);
    expect(existsSync(`${s.target}-shm`)).toBe(false);
  });

  it('removes a user folder that the archive lacks and keeps it in the pre-restore copy', async () => {
    const s = await setup();
    mkdirSync(join(s.usersDir, 'orphan99'));
    writeFileSync(join(s.usersDir, 'orphan99', 'secret.txt'), 'private');
    const users = fresh('u3');
    mkdirSync(join(users, 'abc12345'));
    writeFileSync(join(users, 'abc12345', 'cv.txt'), 'new');
    const made = await backupNow({ dir: fresh('b'), usersDir: users, now: NOW }, client);
    await restoreBackup({ dbFile: made.db, usersTar: made.users, dataDir: s.dataDir, usersDir: s.usersDir });
    expect(readdirSync(s.usersDir)).toEqual(['abc12345']);
    const old = readdirSync(join(s.dataDir, 'backups')).find((f) => /^pre-restore-.*-users$/.test(f))!;
    expect(readFileSync(join(s.dataDir, 'backups', old, 'orphan99', 'secret.txt'), 'utf8')).toBe('private');
    expect(readdirSync(s.dataDir).filter((f) => f.includes('restore-new'))).toEqual([]);
  });

  it('leaves the old users folder and database as they were with a broken archive', async () => {
    const s = await setup();
    const broken = join(fresh('arcout'), 'broken.tar.gz');
    const good = await archive((cwd) => (writeFileSync(join(cwd, 'f.txt'), 'x'.repeat(5000)), ['f.txt']));
    const bytes = readFileSync(good);
    writeFileSync(broken, bytes.subarray(0, Math.floor(bytes.length / 2)));
    await expect(restoreBackup({ dbFile: s.made.db, usersTar: broken, dataDir: s.dataDir, usersDir: s.usersDir })).rejects.toThrow();
    expect(readFileSync(s.target, 'utf8')).toBe('OLD DATABASE');
    expect(readdirSync(s.usersDir)).toEqual(['old.txt']);
    expect(readdirSync(s.dataDir).filter((f) => f.includes('restore-'))).toEqual([]);
  });

  it.skipIf(process.getuid?.() === 0)('leaves the old data as it was when the new folder cannot be made', async () => {
    const s = await setup();
    chmodSync(s.dataDir, 0o500); // the new users folder is a sibling of the old one, in this folder
    try {
      await expect(restoreBackup({ dbFile: s.made.db, usersTar: s.made.users, dataDir: s.dataDir, usersDir: s.usersDir })).rejects.toThrow(/EACCES/);
    } finally {
      chmodSync(s.dataDir, 0o700);
    }
    expect(readFileSync(s.target, 'utf8')).toBe('OLD DATABASE');
    expect(readdirSync(s.usersDir)).toEqual(['old.txt']);
  });

  it('extracts the users archive', async () => {
    const s = await setup();
    const users = fresh('u2');
    mkdirSync(join(users, 'abc12345'));
    writeFileSync(join(users, 'abc12345', 'cv.txt'), 'new');
    const made = await backupNow({ dir: fresh('b'), usersDir: users, now: NOW }, client);
    await restoreBackup({ dbFile: made.db, usersTar: made.users, dataDir: s.dataDir, usersDir: s.usersDir });
    expect(readFileSync(join(s.usersDir, 'abc12345', 'cv.txt'), 'utf8')).toBe('new');
  });
});

describe('databasePath', () => {
  it('reads a relative path from the prisma folder and drops the query', () => {
    expect(databasePath('file:../data/waypoint.db?connection_limit=1')).toBe(join(process.cwd(), 'data', 'waypoint.db'));
    expect(databasePath('file:/tmp/a.db')).toBe('/tmp/a.db');
    expect(() => databasePath('postgres://x')).toThrow(/file:/);
  });
});
