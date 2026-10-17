import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { makeLogger } from '@/lib/log';

function memory() {
  const lines: string[] = [];
  const stream = new Writable({
    write(chunk, _enc, cb) {
      lines.push(...chunk.toString().split('\n').filter(Boolean));
      cb();
    },
  });
  return { stream, lines };
}

describe('log', () => {
  it('the logger removes passwords, tokens, keys and cookies', () => {
    const { stream, lines } = memory();
    makeLogger(stream).info(
      { password: 'pw-1', user: { token: 'tok-2' }, headers: { cookie: 'ck-3', authorization: 'au-4' }, apiKey: 'ak-5' },
      'test',
    );
    expect(lines).toHaveLength(1);
    for (const v of ['pw-1', 'tok-2', 'ck-3', 'au-4', 'ak-5']) expect(lines[0]).not.toContain(v);
    expect(lines[0]).toContain('[removed]');
    expect(JSON.parse(lines[0]).msg).toBe('test');
  });

  it('the logger scrubs keys in an error and in text fields', () => {
    const { stream, lines } = memory();
    const e = new Error('call failed: sk-ant-api03-SECRET1 at https://x.test/search?app_id=1&app_key=SECRET2&page=1 with Bearer SECRET3');
    makeLogger(stream).error({ err: e, error: 'token=SECRET4', message: 'password=SECRET5' }, 'failed');
    const line = lines[0];
    for (const v of ['SECRET1', 'SECRET2', 'SECRET3', 'SECRET4', 'SECRET5']) expect(line).not.toContain(v);
    expect(line).toContain('app_id=1');
    expect(JSON.parse(line).err.message).toContain('[removed]');
    expect(JSON.parse(line).err.stack).not.toContain('SECRET2');
  });
});
