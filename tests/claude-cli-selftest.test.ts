import { describe, expect, it, vi } from 'vitest';

// The canary must never start a process. The test records how it calls runProgram.
vi.mock('@/lib/exec', async (orig) => ({
  ...(await orig<typeof import('@/lib/exec')>()),
  runProgram: vi.fn(async () => ({ code: 0, stdout: JSON.stringify({ result: 'NONE', num_turns: 1, modelUsage: {}, permission_denials: [] }), stderr: '' })),
}));

import { chmodSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { runProgram } from '@/lib/exec';
import { cliSelfTest, SELFTEST_TIMEOUT_MS } from '@/lib/claude/cli';
import { resetEnvForTests } from '@/lib/env';

describe('cliSelfTest', () => {
  it('uses a 30 second limit and passes the abort signal to the process', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'selftest-bin-'));
    const bin = join(dir, 'claude');
    writeFileSync(bin, '#!/bin/sh\n');
    chmodSync(bin, 0o755);
    vi.stubEnv('WAYPOINT_CLAUDE_BIN', bin);
    vi.stubEnv('WAYPOINT_CLAUDE_TIMEOUT_MS', '120000');
    resetEnvForTests();
    try {
      const ac = new AbortController();
      await cliSelfTest(ac.signal);
      const opts = vi.mocked(runProgram).mock.calls[0][2];
      expect(SELFTEST_TIMEOUT_MS).toBe(30_000);
      expect(opts.timeoutMs).toBe(30_000);
      expect(opts.signal).toBe(ac.signal);
    } finally {
      vi.unstubAllEnvs();
      resetEnvForTests();
    }
  });
});
