import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
// Tests check the files with `bash -n`, which only parses and runs nothing.
// eslint-disable-next-line no-restricted-imports -- test-only syntax check; src/lib/exec.ts is for app code
import { spawnSync } from 'node:child_process';

const root = join(__dirname, '..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const services = ['web', 'worker', 'tunnel', 'backup'].map((n) => `deploy/systemd/waypoint-${n}.service`);

describe('systemd units', () => {
  for (const file of services) {
    it(`each service has Restart=on-failure, WorkingDirectory, EnvironmentFile and WantedBy=default.target (${file})`, () => {
      const t = read(file);
      expect(t).toMatch(/^Restart=on-failure$/m);
      expect(t).toMatch(/^RestartSec=5$/m);
      expect(t).toMatch(/^WorkingDirectory=@CHECKOUT@$/m);
      expect(t).toMatch(/^EnvironmentFile=@CHECKOUT@\/\.env$/m);
      expect(t).toMatch(/^WantedBy=default\.target$/m);
      expect(t).not.toContain('%h');
    });
  }

  it('the units start the right commands', () => {
    expect(read(services[0])).toMatch(/^ExecStart=\/usr\/bin\/env npm run start$/m);
    const worker = read(services[1]);
    expect(worker).toMatch(/^ExecStart=\/usr\/bin\/env npm run worker$/m);
    expect(worker).toMatch(/^KillSignal=SIGTERM$/m);
    expect(worker).toMatch(/^TimeoutStopSec=90$/m);
    const tunnel = read(services[2]);
    expect(tunnel).toMatch(/^ExecStart=@CHECKOUT@\/scripts\/tunnel\.sh$/m);
    expect(tunnel).toMatch(/^After=.*waypoint-web\.service/m);
    const backup = read(services[3]);
    expect(backup).toMatch(/^Type=oneshot$/m);
    expect(backup).toMatch(/^ExecStart=\/usr\/bin\/env npm run backup$/m);
  });

  it('the timer runs at 03:00 and is persistent', () => {
    const t = read('deploy/systemd/waypoint-backup.timer');
    expect(t).toMatch(/^OnCalendar=\*-\*-\* 03:00:00$/m);
    expect(t).toMatch(/^Persistent=true$/m);
  });
});

describe('scripts', () => {
  it('deploy.sh runs the steps in the spec order, with the backup before the migration, and restart last', () => {
    const lines = read('scripts/deploy.sh').split('\n').map((l) => l.trim());
    const steps = [
      'git pull --ff-only',
      'npm ci',
      'npm run backup',
      'npx prisma migrate deploy',
      'npm run build',
      'systemctl --user restart waypoint-web waypoint-worker waypoint-tunnel',
    ];
    const at = steps.map((s) => lines.indexOf(s));
    expect(at.every((i) => i >= 0)).toBe(true);
    expect([...at].sort((a, b) => a - b)).toEqual(at);
    expect(at[5]).toBe(Math.max(...at));
  });

  it('deploy.sh has set -euo pipefail', () => {
    expect(read('scripts/deploy.sh')).toMatch(/^set -euo pipefail$/m);
  });

  it('tunnel.sh reads the port with port.mjs and runs the share with exec', () => {
    const t = read('scripts/tunnel.sh');
    expect(t).toMatch(/^set -euo pipefail$/m);
    expect(t).toContain('node scripts/port.mjs');
    expect(t).toMatch(/^exec zrok2 share public "localhost:\$PORT" -n "\$ZROK_NS:\$ZROK_NAME" --headless$/m);
  });

  it('tunnel.sh has no basic auth flag', () => {
    expect(read('scripts/tunnel.sh')).not.toMatch(/basic-auth|--basic|-b\s/i);
  });

  it('install-units.sh checks the path and does not run enable or linger', () => {
    const t = read('scripts/install-units.sh');
    expect(t).toContain('A-Za-z0-9._/-');
    const code = t.split('\n').filter((l) => !/^\s*(#|echo)/.test(l)).join('\n');
    expect(code).not.toMatch(/systemctl --user (enable|start|restart)/);
    expect(code).not.toContain('loginctl');
  });

  it('bash -n passes for tunnel.sh, deploy.sh and install-units.sh', () => {
    for (const f of ['tunnel.sh', 'deploy.sh', 'install-units.sh']) {
      const r = spawnSync('bash', ['-n', join(root, 'scripts', f)], { encoding: 'utf8' });
      expect(r.stderr, f).toBe('');
      expect(r.status, f).toBe(0);
    }
  });
});
