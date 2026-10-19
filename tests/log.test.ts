import { Writable } from 'node:stream';
import { describe, expect, it } from 'vitest';
import { makeLogger, scrub } from '@/lib/log';

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

  it('scrub removes JSON-style secrets and keeps the key', () => {
    const text = `{"token":"A1","api_key": "A2","password":"A3"} {'secret': 'A4'} x-api-key: A5`;
    const out = scrub(text);
    for (const v of ['A1', 'A2', 'A3', 'A4', 'A5']) expect(out).not.toContain(v);
    expect(out).toContain('"token":"[removed]"');
    expect(out).toContain('"api_key": "[removed]"');
    expect(out).toContain("'secret': '[removed]'");
    expect(out).toContain('x-api-key: [removed]');
  });

  it('the logger scrubs nested error values, causes and aggregate errors', () => {
    const { stream, lines } = memory();
    const cause = new Error('inner sk-ant-api03-NEST1');
    const e = Object.assign(new Error('outer', { cause }), {
      config: { headers: { authorization: 'NEST2', note: 'Bearer NEST3' }, list: ['password=NEST4'] },
      response: { data: '{"token":"NEST5"}' },
    });
    const agg = new AggregateError([new Error('part token=NEST6')], 'many');
    const loop: Record<string, unknown> = { apiKey: 'NEST7' };
    loop.self = loop;
    const withLoop = Object.assign(new Error('loop'), { loop });
    const log = makeLogger(stream);
    log.error({ err: e }, 'a');
    log.error({ err: agg }, 'b');
    log.error({ err: withLoop }, 'c');
    expect(lines).toHaveLength(3);
    const all = lines.join('\n');
    for (let i = 1; i <= 7; i++) expect(all).not.toContain(`NEST${i}`);
    expect(JSON.parse(lines[0]).err.config.headers.authorization).toBe('[removed]');
  });
});
