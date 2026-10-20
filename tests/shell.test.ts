import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { NAV, navAction, readLocation, writeLocation } from '@/components/shell/nav';
import { claudeLine, taskLine } from '@/components/shell/task';

describe('NAV', () => {
  it('has exactly Jobs, Pending, Profile and Settings, in this order', () => {
    expect(NAV.map((n) => n.label)).toEqual(['Jobs', 'Pending', 'Profile', 'Settings']);
    expect(NAV.map((n) => n.key)).toEqual(['jobs', 'pending', 'profile', 'settings']);
  });
});

describe('taskLine', () => {
  it('says how many jobs are left while work runs, and nothing otherwise', () => {
    expect(taskLine({ running: true, done: 3, total: 15 })).toBe('Checking 12 jobs');
    expect(taskLine({ running: true, done: 14, total: 15 })).toBe('Checking 1 job');
    expect(taskLine({ running: false, done: 15, total: 15 })).toBeNull();
    expect(taskLine(null)).toBeNull();
  });
});

describe('location in the URL', () => {
  it('reads the view and the job', () => {
    expect(readLocation('?view=pending')).toEqual({ view: 'pending', job: null });
    expect(readLocation('?view=jobs&job=abc123')).toEqual({ view: 'jobs', job: 'abc123' });
    expect(readLocation('?job=abc123')).toEqual({ view: 'jobs', job: 'abc123' });
  });

  it('falls back to jobs for an unknown or missing view', () => {
    expect(readLocation('')).toEqual({ view: 'jobs', job: null });
    expect(readLocation('?view=resume')).toEqual({ view: 'jobs', job: null });
    expect(readLocation('?view=detail&job=x')).toEqual({ view: 'jobs', job: 'x' });
    expect(readLocation('?view=')).toEqual({ view: 'jobs', job: null });
  });

  it('ignores a job on a view that is not jobs', () => {
    expect(readLocation('?view=profile&job=abc')).toEqual({ view: 'profile', job: null });
  });

  it('ignores a job id that is too long or has odd characters', () => {
    expect(readLocation(`?job=${'a'.repeat(200)}`).job).toBeNull();
    expect(readLocation('?job=a%20b').job).toBeNull();
  });

  it('writes a short query and round-trips', () => {
    expect(writeLocation({ view: 'jobs', job: null })).toBe('');
    expect(writeLocation({ view: 'pending', job: null })).toBe('?view=pending');
    expect(writeLocation({ view: 'jobs', job: 'abc123' })).toBe('?job=abc123');
    for (const loc of [
      { view: 'jobs', job: null },
      { view: 'jobs', job: 'j_1-2' },
      { view: 'pending', job: null },
      { view: 'profile', job: null },
      { view: 'settings', job: null },
    ] as const) {
      expect(readLocation(writeLocation(loc))).toEqual(loc);
    }
  });
});

describe('home-screen app', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));

  it('opens like an app, in the colour of the night ground', () => {
    expect(manifest.name).toBe('Waypoint');
    expect(manifest.short_name).toBeTruthy();
    expect(manifest.display).toBe('standalone');
    expect(manifest.theme_color).toBe('#121019');
    expect(manifest.background_color).toBe('#121019');
  });

  it('lists the 192 and 512 icons and a maskable 512, and each file exists', () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
    for (const icon of manifest.icons as { src: string }[]) {
      expect(existsSync(`public${icon.src}`), icon.src).toBe(true);
    }
    expect(existsSync('public/icons/apple-touch-icon.png')).toBe(true);
  });
});

describe('phone detection', () => {
  it('has no file in src that uses useIsPhone', () => {
    const walk = (dir: string): string[] =>
      readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(join(dir, e.name)) : [join(dir, e.name)]));
    const found = walk('src').filter((f) => /\.(ts|tsx|css)$/.test(f) && readFileSync(f, 'utf8').includes('useIsPhone'));
    expect(found).toEqual([]);
  });
});

describe('navAction', () => {
  it('does nothing for the place that is open, so Back does not repeat it', () => {
    expect(navAction({ view: 'jobs', job: null }, 'jobs')).toBe('none');
    expect(navAction({ view: 'pending', job: null }, 'pending')).toBe('none');
  });

  it('closes the open job when Jobs is tapped', () => {
    expect(navAction({ view: 'jobs', job: 'abc' }, 'jobs')).toBe('close-job');
  });

  it('pushes a new place, also from an open job', () => {
    expect(navAction({ view: 'jobs', job: null }, 'pending')).toBe('push');
    expect(navAction({ view: 'jobs', job: 'abc' }, 'profile')).toBe('push');
  });
});

describe('claudeLine', () => {
  it('names each mode in plain words', () => {
    expect(claudeLine('none')).toBe('Claude: not connected');
    expect(claudeLine('own')).toBe('Claude: your API key');
    expect(claudeLine('shared')).toBe('Claude: the shared key');
    expect(claudeLine('cli')).toBe('Claude: the admin subscription');
  });
});

describe('globals.css hover rules', () => {
  it('has no :hover selector outside @media (hover: hover)', () => {
    let css = readFileSync('src/app/globals.css', 'utf8');
    // Remove each @media (hover: hover) block, with its nested braces.
    for (;;) {
      const start = css.indexOf('@media (hover: hover)');
      if (start === -1) break;
      let depth = 0;
      let end = css.indexOf('{', start);
      for (; end < css.length; end++) {
        if (css[end] === '{') depth++;
        if (css[end] === '}' && --depth === 0) break;
      }
      css = css.slice(0, start) + css.slice(end + 1);
    }
    expect(css.match(/[^{}]*:hover[^{}]*\{/g) ?? []).toEqual([]);
  });
});
