import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { fetchSignal } from '@/lib/fetch-timeout';
import { scrub } from '@/lib/log';

/**
 * Uploads a tailored CV to Google Drive and returns a link a recruiter can open.
 *
 * OAuth as him rather than a service account: a service account has no consumer
 * Drive quota, so uploads into a personal Drive fail unless a Workspace shared
 * drive exists. A refresh token makes every file owned by him, stored against
 * his own 15 GB, revocable from his Google account page, and deletable by hand.
 *
 * The scope is `drive.file` — this app can only ever see the files it created
 * itself. It cannot read the rest of his Drive, and asking for a wider scope to
 * upload one PDF would be the wrong trade even though it is easier.
 *
 * Talks to the REST API through `fetch` rather than pulling in `googleapis`,
 * which is a very large dependency for three endpoints.
 */

const TOKEN_URL = 'https://oauth2.googleapis.com/token';
const UPLOAD_URL = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink';
const FILES_URL = 'https://www.googleapis.com/drive/v3/files';

const env = (k: string) => {
  const v = (process.env[k] || '').trim();
  return v ? v : null;
};

export type DriveConfig = { clientId: string; clientSecret: string; refreshToken: string; folderId: string | null };

export function driveConfig(): DriveConfig | null {
  const clientId = env('GDRIVE_CLIENT_ID');
  const clientSecret = env('GDRIVE_CLIENT_SECRET');
  const refreshToken = env('GDRIVE_REFRESH_TOKEN');
  if (!clientId || !clientSecret || !refreshToken) return null;
  return { clientId, clientSecret, refreshToken, folderId: env('GDRIVE_FOLDER_ID') };
}

/** Access tokens last an hour; one is cached per process rather than minted per
 *  upload, with a minute of slack so a token never expires mid-request. */
let token: { value: string; expires: number } | null = null;

async function accessToken(cfg: DriveConfig): Promise<string> {
  if (token && token.expires > Date.now() + 60_000) return token.value;
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    signal: fetchSignal(),
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.refreshToken,
      grant_type: 'refresh_token',
    }),
  });
  const data: any = await res.json();
  if (!res.ok) throw new Error(scrub(String(data.error_description || data.error || `token request failed (${res.status})`)));
  token = { value: data.access_token, expires: Date.now() + (data.expires_in || 3600) * 1000 };
  return token.value;
}

/** A filename a referrer can make sense of in their downloads folder. */
const safe = (s: string) => s.replace(/[^\w]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

export type Shared = { url: string; id: string; name: string };

/**
 * Uploads one PDF and makes it readable by anyone holding the link.
 *
 * "Anyone with the link" is what makes the link work in a LinkedIn message, and
 * it is also genuinely public to whoever it is forwarded to — his phone number
 * and email are in that document. It is deliberately not "public on the web":
 * Drive does not index these, and any one of them can be revoked later from
 * the file's sharing menu.
 */
export async function uploadResume(pdfPath: string, company: string, role: string): Promise<Shared> {
  const cfg = driveConfig();
  if (!cfg) throw new Error('Google Drive is not configured');

  const bytes = readFileSync(pdfPath);
  // Owner name comes from WAYPOINT_NAME in .env, e.g. "Jane Doe" -> "JaneDoe-CV-...".
  const owner = safe((process.env.WAYPOINT_NAME || '').replace(/\s+/g, ''));
  const name = `${owner ? `${owner}-` : ''}CV-${safe(company)}-${safe(role)}.pdf`;
  const metadata: Record<string, unknown> = { name, mimeType: 'application/pdf' };
  if (cfg.folderId) metadata.parents = [cfg.folderId];

  const boundary = `waypoint-${createHash('sha1').update(name).digest('hex').slice(0, 16)}`;
  const head = Buffer.from(
    `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(metadata)}\r\n` +
      `--${boundary}\r\nContent-Type: application/pdf\r\n\r\n`,
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);

  const at = await accessToken(cfg);
  const res = await fetch(UPLOAD_URL, {
    method: 'POST',
    signal: fetchSignal(),
    headers: { Authorization: `Bearer ${at}`, 'Content-Type': `multipart/related; boundary=${boundary}` },
    body: new Uint8Array(Buffer.concat([head, new Uint8Array(bytes), tail])),
  });
  const file: any = await res.json();
  if (!res.ok) throw new Error(scrub(String(file?.error?.message || `upload failed (${res.status})`)));

  const perm = await fetch(`${FILES_URL}/${file.id}/permissions`, {
    method: 'POST',
    signal: fetchSignal(),
    headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ role: 'reader', type: 'anyone' }),
  });
  if (!perm.ok) {
    const e: any = await perm.json().catch(() => ({}));
    throw new Error(scrub(String(e?.error?.message || `uploaded, but could not share it (${perm.status})`)));
  }

  return { url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`, id: file.id, name };
}

/**
 * Replaces the bytes of a file this app uploaded earlier, keeping its id, its
 * link and its "anyone with the link" permission. Null when the file is gone —
 * deleted by hand from Drive — so the caller can upload a fresh one instead.
 */
export async function replaceResume(fileId: string, pdfPath: string): Promise<{ url: string; id: string } | null> {
  const cfg = driveConfig();
  if (!cfg) throw new Error('Google Drive is not configured');

  const at = await accessToken(cfg);
  const res = await fetch(`https://www.googleapis.com/upload/drive/v3/files/${encodeURIComponent(fileId)}?uploadType=media&fields=id,webViewLink`, {
    method: 'PATCH',
    signal: fetchSignal(),
    headers: { Authorization: `Bearer ${at}`, 'Content-Type': 'application/pdf' },
    body: new Uint8Array(readFileSync(pdfPath)),
  });
  if (res.status === 404) return null;
  const file: any = await res.json();
  if (!res.ok) throw new Error(scrub(String(file?.error?.message || `update failed (${res.status})`)));
  return { url: file.webViewLink || `https://drive.google.com/file/d/${file.id}/view`, id: file.id };
}

/**
 * The Drive link for one application's CV: one file per job, uploaded the first
 * time and overwritten in place after, so the link in a message already sent
 * keeps working and always shows the latest version built for that company.
 *
 * Per job rather than per PDF: two postings that select the same order build
 * the same PDF, and if they shared a Drive file, refining one company's CV
 * would silently rewrite the one the other company was sent.
 *
 * `uploaded` is the local PDF the Drive file currently holds, so an unchanged
 * rebuild costs no upload. Never throws. A failed upload costs the link, not the
 * referral.
 */
export async function shareResume(
  pdfPath: string,
  company: string,
  role: string,
  prior: { id: string | null; url: string | null; uploaded: string | null },
): Promise<{ url: string | null; id: string | null; reason: string | null }> {
  if (!driveConfig()) return { url: null, id: prior.id, reason: 'Google Drive is not configured — see GDRIVE_* in .env.example' };
  if (!pdfPath || !existsSync(pdfPath)) return { url: null, id: prior.id, reason: 'there is no CV file to upload' };
  if (prior.id && prior.url && prior.uploaded === pdfPath) return { url: prior.url, id: prior.id, reason: null };

  try {
    const replaced = prior.id ? await replaceResume(prior.id, pdfPath) : null;
    const shared = replaced || (await uploadResume(pdfPath, company, role));
    return { url: shared.url, id: shared.id, reason: null };
  } catch (e) {
    return { url: null, id: prior.id, reason: `Drive upload failed: ${scrub((e as Error).message)}` };
  }
}
