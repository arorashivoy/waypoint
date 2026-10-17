import { chmodSync, copyFileSync, existsSync, mkdirSync, openSync, readSync, closeSync, renameSync, rmSync } from 'node:fs';
import { readdir, rm } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import type { PrismaClient } from '@prisma/client';
import * as tar from 'tar';
import { db } from '@/lib/db';
import { env } from '@/lib/env';
import { programEnv, runProgram, RCLONE_REMOTE } from '@/lib/exec';
import { log } from '@/lib/log';

/**
 * Backups of the database and of the user folders (spec 4.6).
 * A backup of a date is two files in one folder:
 *   <YYYY-MM-DD>.db            a copy that VACUUM INTO makes
 *   <YYYY-MM-DD>-users.tar.gz  the folders of the users
 */

const SAFE_PATH = /^[A-Za-z0-9._\/-]+$/;
const BACKUP_NAME = /^(\d{4}-\d{2}-\d{2})(\.db|-users\.tar\.gz)$/;
const KEEP_DAILY = 14;
const KEEP_WEEKLY = 8;
const STOPPED = new Set(['inactive', 'failed', 'unknown']);
const UNITS = ['waypoint-web', 'waypoint-worker'] as const;

/** The path of the database file, from DATABASE_URL. Prisma reads a relative path from the prisma folder. */
export function databasePath(url = process.env.DATABASE_URL ?? ''): string {
  if (!url.startsWith('file:')) throw new Error('DATABASE_URL must start with file:');
  const raw = url.slice('file:'.length).split('?')[0];
  if (!raw) throw new Error('DATABASE_URL has no file name');
  return isAbsolute(raw) ? raw : resolve(process.cwd(), 'prisma', raw);
}

/**
 * A backup holds the password hashes, the secrets and the files of every user. Only the owner may read it.
 * `mkdirSync` with a mode does not change a folder that exists, so the mode is set after each write.
 */
function ownerOnly(path: string, mode: 0o600 | 0o700): void {
  chmodSync(path, mode);
}

function dateOf(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function backupNow(
  opts: { dir: string; usersDir: string; now?: Date },
  client: PrismaClient = db,
): Promise<{ db: string; users: string }> {
  const date = dateOf(opts.now ?? new Date());
  const dir = resolve(opts.dir);
  const dbFile = join(dir, `${date}.db`);
  const usersFile = join(dir, `${date}-users.tar.gz`);
  // VACUUM INTO needs the path inside the SQL text. Refuse anything but plain characters.
  if (!SAFE_PATH.test(dbFile)) throw new Error('The backup path has a character that is not allowed.');
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  ownerOnly(dir, 0o700);

  rmSync(dbFile, { force: true });
  try {
    await client.$executeRawUnsafe(`VACUUM INTO '${dbFile}'`);
    ownerOnly(dbFile, 0o600);
  } catch (e) {
    rmSync(dbFile, { force: true });
    throw e;
  }

  const usersDir = resolve(opts.usersDir);
  mkdirSync(usersDir, { recursive: true, mode: 0o700 });
  rmSync(usersFile, { force: true });
  try {
    await tar.create(
      {
        gzip: true,
        cwd: usersDir,
        portable: true,
        file: usersFile,
        // Keep plain files and folders only, so the restore check always accepts the archive.
        filter: (_path, entry) => {
          const st = entry as { isFile?: () => boolean; isDirectory?: () => boolean };
          return Boolean(st.isFile?.() || st.isDirectory?.());
        },
      },
      ['.'],
    );
    ownerOnly(usersFile, 0o600);
  } catch (e) {
    rmSync(usersFile, { force: true });
    throw e;
  }
  return { db: dbFile, users: usersFile };
}

/** Monday of the ISO week of a UTC date, as YYYY-MM-DD. */
function weekOf(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  const back = (d.getUTCDay() + 6) % 7;
  return new Date(d.getTime() - back * 86_400_000).toISOString().slice(0, 10);
}

/** The dates to keep: the newest 14, and the newest date of each of the 8 newest weeks. */
export function datesToKeep(dates: string[]): Set<string> {
  const sorted = [...new Set(dates)].sort().reverse();
  const keep = new Set(sorted.slice(0, KEEP_DAILY));
  const weeks = new Map<string, string>();
  for (const d of sorted) {
    const w = weekOf(d);
    if (!weeks.has(w)) weeks.set(w, d); // sorted newest first, so the first date of a week is the newest
  }
  for (const d of [...weeks.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, KEEP_WEEKLY).map((e) => e[1])) keep.add(d);
  return keep;
}

/**
 * Removes the old backups and returns the names that it removed. A date that is
 * later than `now` stays, because the clock may be wrong. Other files stay too.
 */
export async function pruneBackups(dir: string, now: Date = new Date()): Promise<string[]> {
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return [];
  }
  const today = dateOf(now);
  const files = names.flatMap((n) => {
    const m = BACKUP_NAME.exec(n);
    return m ? [{ name: n, date: m[1] }] : [];
  });
  const keep = datesToKeep(files.map((f) => f.date).filter((d) => d <= today));
  const removed: string[] = [];
  for (const f of files.sort((a, b) => a.name.localeCompare(b.name))) {
    if (f.date > today || keep.has(f.date)) continue;
    await rm(join(dir, f.name), { force: true });
    removed.push(f.name);
  }
  return removed;
}

/** Copies the files with rclone, but only when WAYPOINT_BACKUP_REMOTE is set. */
export async function uploadBackup(files: string[]): Promise<void> {
  const remote = env().WAYPOINT_BACKUP_REMOTE;
  if (!remote) return;
  if (!RCLONE_REMOTE.test(remote)) throw new Error('WAYPOINT_BACKUP_REMOTE must look like name:folder.');
  for (const file of files) {
    const r = await runProgram('rclone', ['copy', '--no-traverse', file, remote], {
      cwd: tmpdir(),
      timeoutMs: 600_000,
      env: programEnv('rclone'),
    });
    if (r.code !== 0) throw new Error(`rclone failed with code ${r.code}: ${r.stderr.trim().slice(0, 300)}`);
  }
}

/**
 * Fails closed: a unit counts as stopped only when systemctl says so, or when
 * systemctl is not installed. Any other answer counts as running.
 */
async function runningUnits(): Promise<string[]> {
  const running: string[] = [];
  for (const unit of UNITS) {
    try {
      const r = await runProgram('systemctl', ['--user', 'is-active', unit], {
        cwd: tmpdir(),
        timeoutMs: 10_000,
        env: programEnv('systemctl'),
      });
      if (!STOPPED.has(r.stdout.trim())) running.push(unit);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/is not installed|ENOENT/.test(msg)) continue;
      running.push(`${unit} (systemctl could not be asked: ${msg.slice(0, 120)})`);
    }
  }
  return running;
}

/** Throws if an entry of the archive is not safe. Reads the list only; it extracts nothing. */
export async function checkArchive(file: string): Promise<void> {
  const bad: string[] = [];
  await tar.list({
    file,
    strict: true,
    onReadEntry: (e) => {
      const p = String(e.path);
      const segments = p.split(/[\\/]/);
      if (p.startsWith('/') || p.startsWith('\\') || /^[A-Za-z]:/.test(p)) bad.push(`${p} (absolute path)`);
      else if (segments.includes('..')) bad.push(`${p} (has a .. segment)`);
      else if (e.type !== 'File' && e.type !== 'Directory') bad.push(`${p} (${e.type}, not a plain file or folder)`);
    },
  });
  if (bad.length) throw new Error(`The archive is not safe. Nothing changed. First problem: ${bad[0]}`);
}

function isSqlite(file: string): boolean {
  const fd = openSync(file, 'r');
  try {
    const buf = Buffer.alloc(16);
    readSync(fd, buf, 0, 16, 0);
    return buf.toString('latin1') === 'SQLite format 3\0';
  } finally {
    closeSync(fd);
  }
}

/**
 * Puts a backup in place. Stop waypoint-web and waypoint-worker first.
 * The old database goes to <dataDir>/backups/pre-restore-<time>.db, and the old users folder to
 * <dataDir>/backups/pre-restore-<time>-users. The archive goes into a new folder that replaces usersDir.
 * The pre-restore copies are for the owner only (files 0600, folders 0700).
 */
export async function restoreBackup(opts: {
  dbFile: string;
  usersTar?: string;
  dataDir: string;
  usersDir: string;
  /** The database to replace. The default is <dataDir>/waypoint.db. */
  target?: string;
}): Promise<void> {
  const running = await runningUnits();
  if (running.length) throw new Error(`Stop ${running.join(' and ')} before the restore, or check that systemctl can answer. Nothing changed.`);

  if (!existsSync(opts.dbFile) || !isSqlite(opts.dbFile)) throw new Error('The database file is missing or is not an SQLite file. Nothing changed.');
  if (opts.usersTar) {
    if (!existsSync(opts.usersTar)) throw new Error('The users archive is missing. Nothing changed.');
    await checkArchive(opts.usersTar);
  }

  const target = opts.target ?? join(opts.dataDir, 'waypoint.db');
  const stamp = new Date().toISOString().replace(/:/g, '-');
  const backups = join(opts.dataDir, 'backups');
  const usersDir = resolve(opts.usersDir);
  const newUsers = `${usersDir}.restore-new`;
  const dbTmp = `${target}.restore-tmp`;
  const cleanup = () => {
    rmSync(newUsers, { recursive: true, force: true });
    rmSync(dbTmp, { force: true });
  };

  try {
    // Prepare everything first. A failure here leaves the old data as it was.
    if (opts.usersTar) {
      rmSync(newUsers, { recursive: true, force: true });
      mkdirSync(newUsers, { recursive: true, mode: 0o700 });
      await tar.extract({ file: opts.usersTar, cwd: newUsers, strict: true });
    }
    mkdirSync(dirname(target), { recursive: true });
    copyFileSync(opts.dbFile, dbTmp);

    mkdirSync(backups, { recursive: true, mode: 0o700 });
    ownerOnly(backups, 0o700);
    if (existsSync(target)) {
      const copy = join(backups, `pre-restore-${stamp}.db`);
      copyFileSync(target, copy);
      ownerOnly(copy, 0o600);
      // A crash can leave data in the WAL file. Keep it next to the copy.
      if (existsSync(`${target}-wal`)) {
        copyFileSync(`${target}-wal`, `${copy}-wal`);
        ownerOnly(`${copy}-wal`, 0o600);
      }
      log.info({ copy }, 'saved the old database');
    }

    // Swap the users folder. The old folder moves to the backups folder.
    let oldUsers: string | null = null;
    if (opts.usersTar) {
      if (existsSync(usersDir)) {
        oldUsers = join(backups, `pre-restore-${stamp}-users`);
        renameSync(usersDir, oldUsers);
        ownerOnly(oldUsers, 0o700);
      }
      try {
        renameSync(newUsers, usersDir);
      } catch (e) {
        if (oldUsers) renameSync(oldUsers, usersDir);
        throw e;
      }
      log.info({ oldUsers }, 'replaced the users folder');
    }
  } catch (e) {
    cleanup();
    throw e;
  }

  // Remove -wal and -shm first: an old WAL must never meet the new file.
  rmSync(`${target}-wal`, { force: true });
  rmSync(`${target}-shm`, { force: true });
  renameSync(dbTmp, target);
}
