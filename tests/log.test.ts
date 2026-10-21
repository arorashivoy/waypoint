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

  const NAMES = ['x-api-key', 'api-key', 'apikey', 'api_key', 'access_token', 'refresh_token', 'client_secret', 'id_token', 'authorization'];

  it.each(NAMES)('scrub removes the value of %s in URL text, JSON text and header text', (name) => {
    expect(scrub(`https://x.test/p?a=1&${name}=VAL1&b=2`)).toBe(`https://x.test/p?a=1&${name}=[removed]&b=2`);
    expect(scrub(`{"${name}":"VAL2"}`)).toBe(`{"${name}":"[removed]"}`);
    expect(scrub(`{'${name}': 'VAL3'}`)).toBe(`{'${name}': '[removed]'}`);
    expect(scrub(`${name}: VAL4`)).toBe(`${name}: [removed]`);
    expect(scrub(`{ ${name}: 'VAL5' }`)).not.toContain('VAL5');
  });

  it.each(NAMES)('the logger removes the key %s at any depth, in any case', (name) => {
    const { stream, lines } = memory();
    const e = Object.assign(new Error('x'), { response: { headers: { [name]: 'VAL6', [name.toUpperCase()]: 'VAL7' } } });
    makeLogger(stream).error({ err: e }, 'failed');
    expect(lines[0]).not.toContain('VAL6');
    expect(lines[0]).not.toContain('VAL7');
  });

  it('the logger keeps the token counts of a usage object', () => {
    const { stream, lines } = memory();
    const e = Object.assign(new Error('x'), { usage: { inputTokens: 11, outputTokens: 22, cacheReadTokens: 33, maxTokens: 44 }, accessToken: 'VAL8' });
    makeLogger(stream).error({ err: e }, 'failed');
    expect(JSON.parse(lines[0]).err.usage).toEqual({ inputTokens: 11, outputTokens: 22, cacheReadTokens: 33, maxTokens: 44 });
    expect(JSON.parse(lines[0]).err.accessToken).toBe('[removed]');
  });

  it('the logger writes a Buffer, a Date, a URL, a Map and a Set as short text', () => {
    const { stream, lines } = memory();
    const e = Object.assign(new Error('x'), {
      body: Buffer.from('abcdef'),
      at: new Date('2026-10-17T10:00:00Z'),
      url: new URL('https://x.test/p?app_key=VAL9&page=1'),
      map: new Map([['a', 1]]),
      set: new Set([1]),
    });
    makeLogger(stream).error({ err: e }, 'failed');
    const out = JSON.parse(lines[0]).err;
    expect(out.body).toBe('[Buffer 6 bytes]');
    expect(out.at).toBe('2026-10-17T10:00:00.000Z');
    expect(out.url).toBe('https://x.test/p?app_key=[removed]&page=1');
    expect(out.map).toBe('[Map]');
    expect(out.set).toBe('[Set]');
  });

  it.each([
    ['a-a-…', 'a-'.repeat(100_000)],
    ['a-…:', 'a-'.repeat(100_000) + ':'],
    ['a-a-…=x', 'a-'.repeat(100_000) + '=x'],
    ['password-…', 'password-'.repeat(22_000)],
  ])('scrub reads %s (200 kB) in linear time', (_name, text) => {
    const start = performance.now();
    const out = scrub(text);
    expect(performance.now() - start).toBeLessThan(100);
    expect(out.length).toBeLessThan(20_100);
    expect(out.endsWith(' [cut]')).toBe(true);
  });

  it('scrub still removes a secret after the speed fix', () => {
    expect(scrub('x '.repeat(50) + 'app_key=SEC1 my-long-client-secret: SEC2')).not.toMatch(/SEC[12]/);
    expect(scrub('some-service-oauth-access_token=SEC3')).not.toContain('SEC3');
  });

  it('scrub keeps names that only end in key, and removes the secret names', () => {
    for (const text of ['jobKey=abc', 'dedupeKey: foo', 'sortKey=2', 'monkey: 1', 'inputTokens: 5', 'keyword=x']) expect(scrub(text)).toBe(text);
    for (const name of ['key', 'api_key', 'app_key', 'accessToken', 'client_secret', 'password']) {
      expect(scrub(`${name}=VAL`)).toBe(`${name}=[removed]`);
      expect(scrub(`${name}: VAL`)).toBe(`${name}: [removed]`);
    }
  });
});
