import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as dns } from 'node:dns';
import { ALLOWED_HOSTS, SafeFetchError, isRefusedAddress, safeFetch } from '@/lib/net/safe-fetch';

const GOOD = [{ address: '18.205.1.1', family: 4 }];
const URL_OK = 'https://boards-api.greenhouse.io/v1/boards/acme/jobs/1?content=true';

let lookup: ReturnType<typeof vi.spyOn>;
let fetchMock: ReturnType<typeof vi.fn>;

const json = (body: unknown, init: ResponseInit = {}) => new Response(JSON.stringify(body), { status: 200, ...init });
const redirect = (to: string, status = 302) => new Response(null, { status, headers: { location: to } });

beforeEach(() => {
  lookup = vi.spyOn(dns, 'lookup').mockResolvedValue(GOOD as never);
  fetchMock = vi.fn(async () => json({ ok: 1 }));
  vi.stubGlobal('fetch', fetchMock);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('safeFetch: host list', () => {
  it('fetches an allowed host and returns the body', async () => {
    const res = await safeFetch(URL_OK);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: 1 });
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ redirect: 'manual' });
    expect(lookup).toHaveBeenCalledWith('boards-api.greenhouse.io', { all: true, verbatim: true });
  });

  it.each([
    'https://evil.example/v1/boards/acme',
    'https://boards.greenhouse.io/acme/jobs/1',
    'https://169.254.169.254/latest/meta-data',
    'https://boards-api.greenhouse.io.evil.example/x',
    'https://boards-api.greenhouse.io@evil.example/x',
    'https://boards-api.greenhouse.io:8443/x',
    'https://user:pw@boards-api.greenhouse.io/x',
    'http://boards-api.greenhouse.io/x',
    'ftp://boards-api.greenhouse.io/x',
    'not a url',
  ])('refuses %s before DNS and before fetch', async (url) => {
    await expect(safeFetch(url)).rejects.toBeInstanceOf(SafeFetchError);
    expect(lookup).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('lists exactly the six API hosts', () => {
    expect([...ALLOWED_HOSTS].sort()).toEqual(
      ['api.eu.lever.co', 'api.lever.co', 'api.ashbyhq.com', 'apply.workable.com', 'boards-api.eu.greenhouse.io', 'boards-api.greenhouse.io'].sort(),
    );
  });
});

describe('safeFetch: DNS check', () => {
  it.each(['127.0.0.1', '169.254.169.254', '10.1.2.3', '::1', '::ffff:127.0.0.1', '::ffff:7f00:1', 'fd00::1'])('refuses a host that resolves to %s before fetch', async (address) => {
    lookup.mockResolvedValue([{ address, family: address.includes(':') ? 6 : 4 }] as never);
    await expect(safeFetch(URL_OK)).rejects.toBeInstanceOf(SafeFetchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses when one address among good ones is bad', async () => {
    lookup.mockResolvedValue([GOOD[0], { address: '192.168.1.5', family: 4 }, { address: '2606:4700::1', family: 6 }] as never);
    await expect(safeFetch(URL_OK)).rejects.toBeInstanceOf(SafeFetchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an empty answer and a failed lookup', async () => {
    lookup.mockResolvedValueOnce([] as never);
    await expect(safeFetch(URL_OK)).rejects.toBeInstanceOf(SafeFetchError);
    lookup.mockRejectedValueOnce(new Error('ENOTFOUND'));
    await expect(safeFetch(URL_OK)).rejects.toBeInstanceOf(SafeFetchError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('accepts public IPv4 and IPv6 addresses', async () => {
    lookup.mockResolvedValue([{ address: '2606:4700:4700::1111', family: 6 }, GOOD[0]] as never);
    await expect(safeFetch(URL_OK)).resolves.toBeInstanceOf(Response);
  });

  it.each([
    ['0.0.0.0', true], ['0.1.2.3', true], ['10.0.0.1', true], ['100.64.0.1', true], ['100.127.255.255', true], ['100.128.0.1', false],
    ['127.0.0.1', true], ['169.254.1.1', true], ['172.16.0.1', true], ['172.31.255.255', true], ['172.32.0.1', false],
    ['192.168.0.1', true], ['224.0.0.1', true], ['240.0.0.1', true], ['255.255.255.255', true], ['8.8.8.8', false],
    ['::', true], ['::1', true], ['fc00::1', true], ['fdff::1', true], ['fe80::1', true], ['febf::1', true], ['ff02::1', true],
    ['::ffff:10.0.0.1', true], ['::ffff:8.8.8.8', false], ['64:ff9b::7f00:1', true], ['64:ff9b::808:808', false],
    ['2002:7f00:1::', true], ['192.0.0.9', true], ['192.0.2.1', true], ['198.18.0.1', true], ['198.19.255.255', true], ['198.20.0.1', false], ['198.51.100.7', true], ['203.0.113.7', true], ['2001:db8::1', true], ['::ffff:0:7f00:1', true], ['::ffff:0:808:808', false], ['2606:4700::1', false], ['not an address', true],
  ])('isRefusedAddress(%s) is %s', (address, refused) => {
    expect(isRefusedAddress(address as string)).toBe(refused);
  });
});

describe('safeFetch: redirects', () => {
  it('refuses a redirect to another host', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://evil.example/x'));
    await expect(safeFetch(URL_OK)).rejects.toBeInstanceOf(SafeFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('refuses a redirect to the metadata address and to http', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://169.254.169.254/latest'));
    await expect(safeFetch(URL_OK)).rejects.toBeInstanceOf(SafeFetchError);
    fetchMock.mockResolvedValueOnce(redirect('http://boards-api.greenhouse.io/x'));
    await expect(safeFetch(URL_OK)).rejects.toBeInstanceOf(SafeFetchError);
  });

  it('follows a redirect to an allowed host, also a relative one', async () => {
    fetchMock.mockResolvedValueOnce(redirect('https://api.lever.co/v0/postings/a/b', 301)).mockResolvedValueOnce(redirect('/v0/postings/c', 307));
    const res = await safeFetch(URL_OK);
    expect(res.status).toBe(200);
    expect(fetchMock.mock.calls.map((c) => String(c[0]))).toEqual([URL_OK, 'https://api.lever.co/v0/postings/a/b', 'https://api.lever.co/v0/postings/c']);
  });

  it('checks DNS again for the redirect target', async () => {
    lookup.mockResolvedValueOnce(GOOD as never).mockResolvedValueOnce([{ address: '127.0.0.1', family: 4 }] as never);
    fetchMock.mockResolvedValueOnce(redirect('https://api.lever.co/x'));
    await expect(safeFetch(URL_OK)).rejects.toBeInstanceOf(SafeFetchError);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('follows 3 redirects and refuses the 4th', async () => {
    fetchMock.mockImplementation(async () => redirect(URL_OK));
    await expect(safeFetch(URL_OK)).rejects.toThrow(/too many redirects/);
    expect(fetchMock).toHaveBeenCalledTimes(4);

    fetchMock.mockReset();
    fetchMock.mockResolvedValueOnce(redirect(URL_OK)).mockResolvedValueOnce(redirect(URL_OK)).mockResolvedValueOnce(redirect(URL_OK)).mockResolvedValueOnce(json({ ok: 2 }));
    expect(await (await safeFetch(URL_OK)).json()).toEqual({ ok: 2 });
  });

  it('refuses a redirect with no Location', async () => {
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 302 }));
    await expect(safeFetch(URL_OK)).rejects.toBeInstanceOf(SafeFetchError);
  });
});

describe('safeFetch: limits', () => {
  it('refuses a body over the cap by content-length, without a read', async () => {
    const res = new Response('{}', { status: 200, headers: { 'content-length': '5000' } });
    const read = vi.spyOn(res.body!, 'getReader');
    fetchMock.mockResolvedValueOnce(res);
    await expect(safeFetch(URL_OK, { maxBytes: 1000 })).rejects.toThrow(/too big/);
    expect(read).not.toHaveBeenCalled();
  });

  it('refuses a stream with no length that grows past the cap', async () => {
    let sent = 0;
    const body = new ReadableStream<Uint8Array>({
      pull(c) {
        sent += 400;
        c.enqueue(new Uint8Array(400));
      },
    });
    fetchMock.mockResolvedValueOnce(new Response(body, { status: 200 }));
    await expect(safeFetch(URL_OK, { maxBytes: 1000 })).rejects.toThrow(/too big/);
    expect(sent).toBeLessThan(5000);
  });

  it('accepts a body at the cap', async () => {
    fetchMock.mockResolvedValueOnce(new Response('a'.repeat(1000), { status: 200 }));
    expect((await (await safeFetch(URL_OK, { maxBytes: 1000 })).text()).length).toBe(1000);
  });

  it('stops a DNS lookup that does not end, at the time limit', async () => {
    lookup.mockImplementationOnce(() => new Promise(() => {}));
    await expect(safeFetch(URL_OK, { timeoutMs: 20 })).rejects.toThrow(/too long/);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('gives a SafeFetchError when the board is slow', async () => {
    fetchMock.mockImplementationOnce((_u: unknown, init: RequestInit) => new Promise((_res, rej) => init.signal!.addEventListener('abort', () => rej(new Error('aborted')))));
    await expect(safeFetch(URL_OK, { timeoutMs: 20 })).rejects.toThrow(/too long/);
  });

  it('keeps the status of a board error', async () => {
    fetchMock.mockResolvedValueOnce(new Response('nope', { status: 404 }));
    expect((await safeFetch(URL_OK)).status).toBe(404);
  });
});
