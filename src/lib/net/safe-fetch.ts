import { promises as dns } from 'node:dns';
import { isIP } from 'node:net';

/** The public API hosts of the boards, except Workday (see below). Nothing else can be fetched. */
export const ALLOWED_HOSTS: readonly string[] = [
  'boards-api.greenhouse.io',
  'boards-api.eu.greenhouse.io',
  'api.lever.co',
  'api.eu.lever.co',
  'api.ashbyhq.com',
  'apply.workable.com',
];

/** A Workday careers site has one host for each company: `<tenant>.<wdN>.myworkdayjobs.com`. */
const ALLOWED_HOST_PATTERNS: readonly RegExp[] = [/^[a-z0-9-]{1,63}\.wd\d{1,3}\.myworkdayjobs\.com$/];

const MAX_REDIRECTS = 3;
const REDIRECT_STATUS = new Set([301, 302, 303, 307, 308]);
const NULL_BODY_STATUS = new Set([204, 205, 304]);

/** An error with a text for the user. */
export class SafeFetchError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SafeFetchError';
  }
}

/** The 4 bytes of an IPv4 address, or null. */
function v4Bytes(address: string): number[] | null {
  const parts = address.split('.');
  if (parts.length !== 4) return null;
  const bytes = parts.map((p) => (/^\d{1,3}$/.test(p) ? Number(p) : NaN));
  return bytes.every((b) => b >= 0 && b <= 255) ? bytes : null;
}

/** The 16 bytes of an IPv6 address, or null. */
function v6Bytes(address: string): number[] | null {
  let text = address.split('%')[0].toLowerCase();
  // A dotted tail (::ffff:1.2.3.4) is 2 groups.
  const dotted = text.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (dotted) {
    const tail = v4Bytes(dotted[2]);
    if (!tail) return null;
    text = `${dotted[1]}${((tail[0] << 8) | tail[1]).toString(16)}:${((tail[2] << 8) | tail[3]).toString(16)}`;
  }
  const halves = text.split('::');
  if (halves.length > 2) return null;
  const groups = (s: string) => (s === '' ? [] : s.split(':'));
  const head = groups(halves[0]);
  const tail = halves.length === 2 ? groups(halves[1]) : [];
  const fill = 8 - head.length - tail.length;
  if (halves.length === 2 ? fill < 1 : fill !== 0) return null;
  const all = [...head, ...new Array<string>(halves.length === 2 ? fill : 0).fill('0'), ...tail];
  const bytes: number[] = [];
  for (const g of all) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
    const n = parseInt(g, 16);
    bytes.push(n >> 8, n & 255);
  }
  return bytes.length === 16 ? bytes : null;
}

function refusedV4([a, b, c, d]: number[]): boolean {
  return (
    a === 0 || // 0.0.0.0/8
    (a === 192 && b === 0 && (c === 0 || c === 2)) || // 192.0.0.0/24 and 192.0.2.0/24
    (a === 198 && (b === 18 || b === 19)) || // 198.18.0.0/15
    (a === 198 && b === 51 && c === 100) || // 198.51.100.0/24
    (a === 203 && b === 0 && c === 113) || // 203.0.113.0/24
    a === 10 ||
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    a === 127 ||
    (a === 169 && b === 254) ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    a >= 224 || // multicast, reserved and 255.255.255.255
    (a === 255 && b === 255 && c === 255 && d === 255)
  );
}

/** True when the address is in a range that a fetch must never reach. An address that Waypoint cannot read also counts. */
export function isRefusedAddress(address: string): boolean {
  const kind = isIP(address.split('%')[0]);
  if (kind === 4) {
    const b = v4Bytes(address);
    return !b || refusedV4(b);
  }
  if (kind !== 6) return true;
  const b = v6Bytes(address);
  if (!b) return true;
  if (b.every((x) => x === 0)) return true; // ::
  if (b.slice(0, 15).every((x) => x === 0) && b[15] === 1) return true; // ::1
  // IPv4 inside IPv6: mapped (::ffff:a.b.c.d), compatible (::a.b.c.d) and NAT64 (64:ff9b::/96).
  const mapped = b.slice(0, 10).every((x) => x === 0) && b[10] === 255 && b[11] === 255;
  const compatible = b.slice(0, 12).every((x) => x === 0);
  const nat64 = b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b && b.slice(4, 12).every((x) => x === 0);
  // IPv4-translated (::ffff:0:a.b.c.d) holds an IPv4 address too.
  const translated = b.slice(0, 8).every((x) => x === 0) && b[8] === 255 && b[9] === 255 && b[10] === 0 && b[11] === 0;
  if (mapped || compatible || nat64 || translated) return refusedV4(b.slice(12));
  if (b[0] === 0 && b[1] === 0x64 && b[2] === 0xff && b[3] === 0x9b) return true; // 64:ff9b:1::/48, local NAT64
  if (b[0] === 0x20 && b[1] === 0x02) return refusedV4(b.slice(2, 6)); // 6to4 holds an IPv4 address
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0 && b[3] === 0) return true; // Teredo
  if ((b[0] & 0xfe) === 0xfc) return true; // fc00::/7
  if (b[0] === 0xfe) return true; // fe00::/8: link-local fe80::/10 and site-local fec0::/10
  if (b[0] === 0xff) return true; // ff00::/8
  if (b[0] === 0x20 && b[1] === 0x01 && b[2] === 0x0d && b[3] === 0xb8) return true; // 2001:db8::/32, documentation
  return false;
}

/** Throws unless the URL is an https URL on an allowed host and every address of the host is public. */
async function check(url: URL, signal: AbortSignal): Promise<void> {
  if (url.protocol !== 'https:') throw new SafeFetchError('Waypoint only fetches https links.');
  if (url.username || url.password || url.port) throw new SafeFetchError('Waypoint does not fetch a link with a user name or a port.');
  const hostname = url.hostname.toLowerCase();
  if (!ALLOWED_HOSTS.includes(hostname) && !ALLOWED_HOST_PATTERNS.some((re) => re.test(hostname))) throw new SafeFetchError('Waypoint does not fetch from this host.');
  let found: { address: string }[];
  try {
    // The lookup is under the same time limit as the fetch.
    const aborted = new Promise<never>((_, reject) => {
      const stop = () => reject(new SafeFetchError('The board took too long to answer.'));
      if (signal.aborted) stop();
      else signal.addEventListener('abort', stop, { once: true });
    });
    aborted.catch(() => {});
    found = await Promise.race([dns.lookup(url.hostname, { all: true, verbatim: true }), aborted]);
  } catch (e) {
    if (e instanceof SafeFetchError) throw e;
    throw new SafeFetchError('Waypoint could not find the address of the board.');
  }
  if (!found.length || found.some((a) => isRefusedAddress(a.address))) {
    throw new SafeFetchError('The address of the board is not a public address. Waypoint did not fetch it.');
  }
}

async function readCapped(res: Response, maxBytes: number): Promise<string> {
  const length = Number(res.headers.get('content-length'));
  if (Number.isFinite(length) && length > maxBytes) {
    await res.body?.cancel().catch(() => {});
    throw new SafeFetchError('The answer of the board is too big.');
  }
  if (!res.body) return '';
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      await reader.cancel().catch(() => {});
      throw new SafeFetchError('The answer of the board is too big.');
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString('utf8');
}

/**
 * Fetches a URL on one of the board API hosts. Each URL, also each redirect target, must pass the host list
 * and the DNS check. The body is at most `maxBytes` and the whole call is at most `timeoutMs`.
 *
 * Known gap: `fetch` resolves the host name again, so a DNS answer can change between the check and the
 * fetch (DNS rebinding). The list of six fixed public API hosts is the main guard.
 */
export async function safeFetch(url: string, opts: { timeoutMs?: number; maxBytes?: number } = {}): Promise<Response> {
  const { timeoutMs = 15_000, maxBytes = 2 * 1024 * 1024 } = opts;
  const signal = AbortSignal.timeout(timeoutMs);
  let current: URL;
  try {
    current = new URL(url);
  } catch {
    throw new SafeFetchError('Waypoint cannot read this link.');
  }
  for (let hops = 0; ; hops++) {
    await check(current, signal);
    let res: Response;
    try {
      res = await fetch(current, { redirect: 'manual', signal, cache: 'no-store', headers: { accept: 'application/json', 'user-agent': 'Waypoint/0.1 (personal job search)' } });
    } catch (e) {
      if (e instanceof SafeFetchError) throw e;
      throw new SafeFetchError(signal.aborted ? 'The board took too long to answer.' : 'Waypoint could not reach the board.');
    }
    if (REDIRECT_STATUS.has(res.status)) {
      await res.body?.cancel().catch(() => {});
      const location = res.headers.get('location');
      if (!location) throw new SafeFetchError('The board sent a redirect with no target.');
      if (hops >= MAX_REDIRECTS) throw new SafeFetchError('The board sent too many redirects.');
      try {
        current = new URL(location, current);
      } catch {
        throw new SafeFetchError('The board sent a redirect that Waypoint cannot read.');
      }
      continue;
    }
    let body: string;
    try {
      body = await readCapped(res, maxBytes);
    } catch (e) {
      if (e instanceof SafeFetchError) throw e;
      throw new SafeFetchError(signal.aborted ? 'The board took too long to answer.' : 'Waypoint could not read the answer of the board.');
    }
    return new Response(NULL_BODY_STATUS.has(res.status) ? null : body, {
      status: res.status,
      statusText: res.statusText,
      headers: { 'content-type': res.headers.get('content-type') ?? 'application/octet-stream' },
    });
  }
}
